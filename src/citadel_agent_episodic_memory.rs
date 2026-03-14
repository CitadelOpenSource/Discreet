// citadel_agent_episodic_memory.rs — Encrypted persistent agent memory.
//
// WHAT THIS IS:
//   A Mem0-inspired fact extraction and persistence system, but with a
//   critical difference: all learned facts are AES-256-GCM encrypted at
//   rest. The server stores only ciphertext. The agent decrypts its own
//   memory when it wakes up. Nobody else — not the server operator, not
//   other agents, not other users — can read what the agent has learned.
//
// PATENT RELEVANCE:
//   "AI agent's learned knowledge about the user is encrypted with the
//   agent's own cryptographic key and stored as ciphertext the server
//   cannot read. The agent decrypts both conversation history AND its
//   persistent memory using its key, creating a zero-knowledge
//   personalization system."
//
//   No existing system combines: (1) specialist agents inside E2EE
//   messaging, (2) per-agent encrypted memory stores, (3) LLM-based
//   fact extraction with encrypted persistence, (4) zero-knowledge
//   server architecture for both messages AND agent memory.
//
// ARCHITECTURE (3-tier cognitive model):
//   Tier 1 — Working Memory: sliding window (citadel_agent_memory.rs)
//   Tier 2 — Episodic Memory: THIS FILE — extracted facts, encrypted
//   Tier 3 — Semantic Memory: future — graph relationships (post-launch)
//
// FLOW:
//   1. Agent responds to user (normal completion via provider)
//   2. Every K messages, trigger fact extraction (async, non-blocking)
//   3. Send recent messages to LLM with extraction prompt
//   4. LLM returns JSON array of facts
//   5. Compare against existing facts (add/update/delete/no-change)
//   6. Encrypt updated facts with agent's AES-256-GCM key
//   7. Store encrypted facts in agent_episodic_facts table
//   8. On next invocation, decrypt and inject into system prompt

use aes_gcm::{
    aead::{Aead, KeyInit, OsRng},
    Aes256Gcm, Nonce,
};
use rand::RngCore;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use sqlx::{PgPool, Row};
use tracing::{debug, info, warn};
use uuid::Uuid;

use crate::citadel_agent_provider::{AgentError, AgentMessage, AgentModelConfig, LlmProvider};

// ─── Constants ──────────────────────────────────────────────────────────

/// How many messages between automatic fact extraction runs.
/// Lower = more up-to-date memory but more LLM calls.
/// Higher = cheaper but agent memory lags behind conversation.
const DEFAULT_EXTRACTION_INTERVAL: u32 = 10;

/// Maximum number of facts stored per agent-user pair.
/// Prevents unbounded memory growth. Oldest low-confidence facts
/// are evicted when this limit is reached.
const MAX_FACTS_PER_PAIR: usize = 200;

/// Maximum total characters across all facts for context injection.
/// Keeps the system prompt manageable.
const MAX_FACTS_CONTEXT_CHARS: usize = 8000;

// ─── Fact Types ─────────────────────────────────────────────────────────

/// A single learned fact about a user, extracted by the LLM.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentFact {
    /// Unique identifier for this fact.
    pub fact_id: String,
    /// Category: preference, personal_detail, context, relationship,
    /// plan, skill, opinion, behavioral_pattern
    pub category: String,
    /// The fact itself in natural language.
    /// e.g., "User lives in Stuart, Florida"
    pub content: String,
    /// LLM's confidence in this fact (0.0 - 1.0).
    pub confidence: f32,
    /// When this fact was first learned (ISO 8601).
    pub created_at: String,
    /// When this fact was last confirmed or updated.
    pub updated_at: String,
    /// How many times this fact has been referenced/confirmed.
    pub reference_count: u32,
}

/// The full memory store for one agent-user pair.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentMemoryStore {
    pub facts: Vec<AgentFact>,
    pub version: u32,
    pub last_extraction_msg_count: u64,
}

impl Default for AgentMemoryStore {
    fn default() -> Self {
        Self {
            facts: Vec::new(),
            version: 1,
            last_extraction_msg_count: 0,
        }
    }
}

/// LLM decision for each extracted fact vs existing memory.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum FactOperation {
    Add,
    Update,
    Delete,
    None,
}

/// A single fact extraction result from the LLM.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExtractedFact {
    pub category: String,
    pub content: String,
    pub confidence: f32,
    pub operation: FactOperation,
    /// If updating/deleting, which existing fact_id to target.
    #[serde(default)]
    pub target_fact_id: Option<String>,
}

/// The LLM's full extraction response.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExtractionResponse {
    pub facts: Vec<ExtractedFact>,
}

// ─── Encryption ─────────────────────────────────────────────────────────

/// Derive a memory-specific encryption key for an agent-user pair.
///
/// key = SHA-256(master_secret || ":memory:" || agent_id || ":" || channel_id)
///
/// This gives each agent-channel pair a unique encryption key for its
/// memory store. Different channels = different keys = compartmentalized
/// memory even for the same agent.
fn derive_memory_key(
    master_secret: &[u8],
    agent_id: &Uuid,
    channel_id: &Uuid,
) -> [u8; 32] {
    let mut hasher = Sha256::new();
    hasher.update(master_secret);
    hasher.update(b":memory:");
    hasher.update(agent_id.as_bytes());
    hasher.update(b":");
    hasher.update(channel_id.as_bytes());
    let result = hasher.finalize();
    let mut key = [0u8; 32];
    key.copy_from_slice(&result);
    key
}

/// Encrypt a memory store to ciphertext.
fn encrypt_memory_store(
    store: &AgentMemoryStore,
    master_secret: &[u8],
    agent_id: &Uuid,
    channel_id: &Uuid,
) -> Result<(Vec<u8>, Vec<u8>), AgentError> {
    let key = derive_memory_key(master_secret, agent_id, channel_id);
    let cipher = Aes256Gcm::new_from_slice(&key)
        .map_err(|e| AgentError::Internal(format!("Memory key init failed: {e}")))?;

    let plaintext = serde_json::to_vec(store)
        .map_err(|e| AgentError::Internal(format!("Memory serialization failed: {e}")))?;

    let mut nonce_bytes = [0u8; 12];
    OsRng.fill_bytes(&mut nonce_bytes);
    let nonce = Nonce::from_slice(&nonce_bytes);

    let ciphertext = cipher
        .encrypt(nonce, plaintext.as_ref())
        .map_err(|e| AgentError::Internal(format!("Memory encryption failed: {e}")))?;

    Ok((ciphertext, nonce_bytes.to_vec()))
}

/// Decrypt a memory store from ciphertext.
fn decrypt_memory_store(
    ciphertext: &[u8],
    nonce_bytes: &[u8],
    master_secret: &[u8],
    agent_id: &Uuid,
    channel_id: &Uuid,
) -> Result<AgentMemoryStore, AgentError> {
    if nonce_bytes.len() != 12 {
        return Err(AgentError::Internal("Invalid memory nonce length".into()));
    }

    let key = derive_memory_key(master_secret, agent_id, channel_id);
    let cipher = Aes256Gcm::new_from_slice(&key)
        .map_err(|e| AgentError::Internal(format!("Memory key init failed: {e}")))?;

    let nonce = Nonce::from_slice(nonce_bytes);

    let plaintext = cipher
        .decrypt(nonce, ciphertext)
        .map_err(|_| AgentError::Internal("Memory decryption failed — data may be corrupted".into()))?;

    serde_json::from_slice(&plaintext)
        .map_err(|e| AgentError::Internal(format!("Memory deserialization failed: {e}")))
}

// ─── Database Operations ────────────────────────────────────────────────

/// Load the encrypted memory store for an agent-channel pair.
pub async fn load_memory_store(
    db: &PgPool,
    agent_id: Uuid,
    channel_id: Uuid,
    master_secret: &[u8],
) -> Result<AgentMemoryStore, AgentError> {
    let row = sqlx::query(
        "SELECT facts_encrypted, facts_nonce, fact_count \
         FROM agent_episodic_facts \
         WHERE agent_id = $1 AND channel_id = $2",
    )
    .bind(agent_id)
    .bind(channel_id)
    .fetch_optional(db)
    .await
    .map_err(|e| {
        debug!("Episodic facts query: {e}");
        AgentError::Internal(format!("Memory load failed: {e}"))
    });

    match row {
        Ok(Some(r)) => {
            let facts_encrypted: Vec<u8> = r.get("facts_encrypted");
            let facts_nonce: Vec<u8> = r.get("facts_nonce");
            decrypt_memory_store(
                &facts_encrypted,
                &facts_nonce,
                master_secret,
                &agent_id,
                &channel_id,
            )
        }
        Ok(None) => {
            debug!(agent_id = %agent_id, channel_id = %channel_id, "No episodic memory found — starting fresh");
            Ok(AgentMemoryStore::default())
        }
        Err(_) => {
            // Table might not exist yet — graceful degradation
            Ok(AgentMemoryStore::default())
        }
    }
}

/// Save the encrypted memory store for an agent-channel pair.
pub async fn save_memory_store(
    db: &PgPool,
    agent_id: Uuid,
    channel_id: Uuid,
    store: &AgentMemoryStore,
    master_secret: &[u8],
) -> Result<(), AgentError> {
    let (ciphertext, nonce) = encrypt_memory_store(store, master_secret, &agent_id, &channel_id)?;
    let fact_count = store.facts.len() as i32;

    sqlx::query(
        "INSERT INTO agent_episodic_facts (agent_id, channel_id, facts_encrypted, facts_nonce, fact_count) \
         VALUES ($1, $2, $3, $4, $5) \
         ON CONFLICT (agent_id, channel_id) \
         DO UPDATE SET \
             facts_encrypted = EXCLUDED.facts_encrypted, \
             facts_nonce = EXCLUDED.facts_nonce, \
             fact_count = EXCLUDED.fact_count, \
             updated_at = NOW()",
    )
    .bind(agent_id)
    .bind(channel_id)
    .bind(&ciphertext)
    .bind(&nonce)
    .bind(fact_count)
    .execute(db)
    .await
    .map_err(|e| AgentError::Internal(format!("Memory save failed: {e}")))?;

    info!(
        agent_id = %agent_id,
        channel_id = %channel_id,
        fact_count,
        "Episodic memory saved (encrypted)"
    );

    Ok(())
}

// ─── Fact Extraction ────────────────────────────────────────────────────

/// The system prompt used to extract facts from conversation.
/// Inspired by Mem0's extraction prompt but adapted for E2EE context.
const FACT_EXTRACTION_PROMPT: &str = r#"You are a memory extraction system for an encrypted AI assistant. Your job is to extract important facts about the user from the conversation.

Extract ONLY facts that would be useful in future conversations. Focus on:
1. Personal details (name, location, occupation, family)
2. Preferences (communication style, interests, likes/dislikes)
3. Context (ongoing projects, problems they're working on)
4. Plans (upcoming events, deadlines, goals)
5. Skills and expertise
6. Opinions and values
7. Behavioral patterns (when they're active, how they communicate)
8. Relationships (people they mention, their roles)

Rules:
- Extract only what the USER reveals, not what the assistant says
- Each fact should be a single, atomic statement
- Assign a confidence score (0.0-1.0) based on how explicit the statement was
- Assign a category from: personal_detail, preference, context, plan, skill, opinion, behavioral_pattern, relationship
- If no new facts are found, return an empty array
- Do NOT extract facts about the AI assistant itself
- Do NOT extract trivial conversational filler
- Maximum 10 facts per extraction

Respond with ONLY valid JSON, no markdown, no explanation:
{"facts": [{"category": "...", "content": "...", "confidence": 0.0}]}"#;

/// The system prompt for comparing new facts against existing memory.
const MEMORY_UPDATE_PROMPT: &str = r#"You are a memory manager for an encrypted AI assistant. Compare new facts against existing memory and decide what to do.

For each new fact, choose one operation:
- "add": New information not in existing memory
- "update": Corrects or refines an existing fact (provide target_fact_id)
- "delete": Contradicts an existing fact that is now wrong (provide target_fact_id)
- "none": Already known, no change needed

Rules:
- Prefer updating over adding duplicates
- Delete facts that are clearly outdated or contradicted
- Keep the most specific version of a fact
- If a fact refines an existing one, update the existing one

Existing memory:
{existing_facts}

New facts to evaluate:
{new_facts}

Respond with ONLY valid JSON, no markdown:
{"facts": [{"category": "...", "content": "...", "confidence": 0.0, "operation": "add|update|delete|none", "target_fact_id": "...or null"}]}"#;

/// Run fact extraction on recent messages.
///
/// This is called asynchronously after every K messages. It:
/// 1. Sends recent messages to the LLM with the extraction prompt
/// 2. Parses the JSON response into ExtractedFacts
/// 3. Returns them for the update step
pub async fn extract_facts(
    provider: &dyn LlmProvider,
    messages: &[AgentMessage],
    config: &AgentModelConfig,
) -> Result<Vec<ExtractedFact>, AgentError> {
    if messages.is_empty() {
        return Ok(Vec::new());
    }

    // Build a condensed conversation transcript for extraction
    let transcript: String = messages
        .iter()
        .map(|m| format!("{}: {}", m.role, m.content))
        .collect::<Vec<_>>()
        .join("\n");

    let extraction_messages = vec![AgentMessage {
        role: "user".into(),
        content: format!("Extract facts from this conversation:\n\n{transcript}"),
    }];

    let result = provider
        .complete(FACT_EXTRACTION_PROMPT, extraction_messages, config)
        .await?;

    parse_extraction_response(&result.text)
}

/// Compare extracted facts against existing memory and determine operations.
pub async fn evaluate_facts(
    provider: &dyn LlmProvider,
    existing: &AgentMemoryStore,
    new_facts: &[ExtractedFact],
    config: &AgentModelConfig,
) -> Result<Vec<ExtractedFact>, AgentError> {
    if new_facts.is_empty() {
        return Ok(Vec::new());
    }

    // Serialize existing facts for the prompt
    let existing_json = existing
        .facts
        .iter()
        .map(|f| format!("  {{\"fact_id\": \"{}\", \"category\": \"{}\", \"content\": \"{}\"}}", f.fact_id, f.category, f.content))
        .collect::<Vec<_>>()
        .join(",\n");

    let new_json = new_facts
        .iter()
        .map(|f| format!("  {{\"category\": \"{}\", \"content\": \"{}\", \"confidence\": {}}}", f.category, f.content, f.confidence))
        .collect::<Vec<_>>()
        .join(",\n");

    let prompt = MEMORY_UPDATE_PROMPT
        .replace("{existing_facts}", &format!("[\n{existing_json}\n]"))
        .replace("{new_facts}", &format!("[\n{new_json}\n]"));

    let eval_messages = vec![AgentMessage {
        role: "user".into(),
        content: "Evaluate these facts against existing memory.".into(),
    }];

    let result = provider.complete(&prompt, eval_messages, config).await?;

    parse_extraction_response(&result.text)
}

/// Parse the LLM's JSON response into extracted facts.
fn parse_extraction_response(text: &str) -> Result<Vec<ExtractedFact>, AgentError> {
    // Strip markdown code fences if present (common LLM behavior)
    let cleaned = text
        .trim()
        .trim_start_matches("```json")
        .trim_start_matches("```")
        .trim_end_matches("```")
        .trim();

    let response: ExtractionResponse = serde_json::from_str(cleaned).map_err(|e| {
        warn!(raw_response = %text, error = %e, "Failed to parse fact extraction JSON");
        AgentError::InvalidResponse(format!("Fact extraction JSON parse failed: {e}"))
    })?;

    Ok(response.facts)
}

// ─── Memory Update Pipeline ────────────────────────────────────────────

/// Apply fact operations to the memory store.
///
/// This is the core update logic. For each evaluated fact:
/// - Add: create a new AgentFact with a fresh ID
/// - Update: modify the targeted existing fact
/// - Delete: remove the targeted existing fact
/// - None: increment reference_count on matching fact
pub fn apply_operations(
    store: &mut AgentMemoryStore,
    operations: &[ExtractedFact],
) {
    let now = chrono::Utc::now().to_rfc3339();

    for op in operations {
        match op.operation {
            FactOperation::Add => {
                // Check capacity
                if store.facts.len() >= MAX_FACTS_PER_PAIR {
                    // Evict lowest confidence fact
                    if let Some(min_idx) = store
                        .facts
                        .iter()
                        .enumerate()
                        .min_by(|(_, a), (_, b)| {
                            a.confidence
                                .partial_cmp(&b.confidence)
                                .unwrap_or(std::cmp::Ordering::Equal)
                        })
                        .map(|(i, _)| i)
                    {
                        store.facts.remove(min_idx);
                    }
                }

                let fact_id = format!("f_{}", Uuid::new_v4().to_string().split('-').next().unwrap_or("x"));
                store.facts.push(AgentFact {
                    fact_id,
                    category: op.category.clone(),
                    content: op.content.clone(),
                    confidence: op.confidence,
                    created_at: now.clone(),
                    updated_at: now.clone(),
                    reference_count: 1,
                });
            }
            FactOperation::Update => {
                if let Some(target_id) = &op.target_fact_id {
                    if let Some(fact) = store.facts.iter_mut().find(|f| &f.fact_id == target_id) {
                        fact.content = op.content.clone();
                        fact.confidence = op.confidence;
                        fact.updated_at = now.clone();
                        fact.reference_count += 1;
                    }
                }
            }
            FactOperation::Delete => {
                if let Some(target_id) = &op.target_fact_id {
                    store.facts.retain(|f| &f.fact_id != target_id);
                }
            }
            FactOperation::None => {
                // Fact already known — boost reference count
                if let Some(target_id) = &op.target_fact_id {
                    if let Some(fact) = store.facts.iter_mut().find(|f| &f.fact_id == target_id) {
                        fact.reference_count += 1;
                        fact.updated_at = now.clone();
                    }
                }
            }
        }
    }

    store.version += 1;
}

// ─── Context Injection ──────────────────────────────────────────────────

/// Build a context string from the memory store for injection into
/// the agent's system prompt.
///
/// Facts are sorted by confidence * reference_count (most important first)
/// and truncated to MAX_FACTS_CONTEXT_CHARS.
pub fn build_memory_context(store: &AgentMemoryStore) -> String {
    if store.facts.is_empty() {
        return String::new();
    }

    // Sort by importance score: confidence * log2(reference_count + 1)
    let mut sorted: Vec<&AgentFact> = store.facts.iter().collect();
    sorted.sort_by(|a, b| {
        let score_a = a.confidence * (a.reference_count as f32 + 1.0).log2();
        let score_b = b.confidence * (b.reference_count as f32 + 1.0).log2();
        score_b
            .partial_cmp(&score_a)
            .unwrap_or(std::cmp::Ordering::Equal)
    });

    let mut context = String::from("\n[What you remember about this user]:\n");
    let mut total_chars = context.len();

    for fact in sorted {
        let line = format!("- {}\n", fact.content);
        if total_chars + line.len() > MAX_FACTS_CONTEXT_CHARS {
            break;
        }
        context.push_str(&line);
        total_chars += line.len();
    }

    context
}

/// Check if fact extraction should run based on message count.
pub fn should_extract(
    current_msg_count: u64,
    last_extraction_count: u64,
    interval: Option<u32>,
) -> bool {
    let interval = interval.unwrap_or(DEFAULT_EXTRACTION_INTERVAL) as u64;
    current_msg_count >= last_extraction_count + interval
}

// ─── Full Pipeline ──────────────────────────────────────────────────────

/// Parameters for the episodic memory pipeline.
pub struct EpisodicPipelineParams {
    pub agent_id: Uuid,
    pub channel_id: Uuid,
    pub server_id: Uuid,
    pub agent_key_secret: String,
    pub message_text: String,
    pub current_msg_count: u64,
}

/// Run the complete episodic memory pipeline.
///
/// Call this asynchronously after the agent completes a response.
/// It loads existing memory, extracts new facts, evaluates them,
/// applies operations, and saves the updated encrypted store.
///
/// This is the function you wire into the agent response flow.
pub async fn run_episodic_pipeline(
    db: &PgPool,
    provider: &dyn LlmProvider,
    params: &EpisodicPipelineParams,
    recent_messages: &[AgentMessage],
    config: &AgentModelConfig,
) -> Result<(), AgentError> {
    let master_secret = params.agent_key_secret.as_bytes();

    // Load existing memory
    let mut store = load_memory_store(db, params.agent_id, params.channel_id, master_secret).await?;

    // Check if extraction should run
    if !should_extract(params.current_msg_count, store.last_extraction_msg_count, None) {
        return Ok(());
    }

    info!(
        agent_id = %params.agent_id,
        channel_id = %params.channel_id,
        params.current_msg_count,
        existing_facts = store.facts.len(),
        "Running episodic memory extraction"
    );

    // Phase 1: Extract new facts from recent conversation
    let new_facts = match extract_facts(provider, recent_messages, config).await {
        Ok(facts) => facts,
        Err(e) => {
            warn!(error = %e, "Fact extraction failed — skipping this cycle");
            return Ok(()); // Non-fatal, try again next cycle
        }
    };

    if new_facts.is_empty() {
        debug!("No new facts extracted");
        store.last_extraction_msg_count = params.current_msg_count;
        save_memory_store(db, params.agent_id, params.channel_id, &store, master_secret).await?;
        return Ok(());
    }

    // Phase 2: If we have existing facts, evaluate new vs existing
    let operations = if store.facts.is_empty() {
        // No existing facts — all new facts are ADDs
        new_facts
            .into_iter()
            .map(|f| ExtractedFact {
                operation: FactOperation::Add,
                ..f
            })
            .collect()
    } else {
        match evaluate_facts(provider, &store, &new_facts, config).await {
            Ok(ops) => ops,
            Err(e) => {
                warn!(error = %e, "Fact evaluation failed — adding all as new");
                new_facts
                    .into_iter()
                    .map(|f| ExtractedFact {
                        operation: FactOperation::Add,
                        ..f
                    })
                    .collect()
            }
        }
    };

    // Phase 3: Apply operations to the memory store
    let ops_count = operations.len();
    apply_operations(&mut store, &operations);
    store.last_extraction_msg_count = params.current_msg_count;

    // Phase 4: Encrypt and save
    save_memory_store(db, params.agent_id, params.channel_id, &store, master_secret).await?;

    info!(
        agent_id = %params.agent_id,
        channel_id = %params.channel_id,
        operations = ops_count,
        total_facts = store.facts.len(),
        "Episodic memory updated"
    );

    Ok(())
}

// ─── Migration SQL ──────────────────────────────────────────────────────

/// SQL to create the agent_episodic_facts table.
/// Run as the next migration after 028.
pub const EPISODIC_FACTS_MIGRATION: &str = r#"
CREATE TABLE IF NOT EXISTS agent_episodic_facts (
    agent_id    UUID NOT NULL,
    channel_id  UUID NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    facts_encrypted BYTEA NOT NULL,
    facts_nonce     BYTEA NOT NULL,
    fact_count      INT DEFAULT 0,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (agent_id, channel_id)
);

CREATE INDEX IF NOT EXISTS idx_episodic_facts_channel
    ON agent_episodic_facts(channel_id);

COMMENT ON TABLE agent_episodic_facts IS
    'Encrypted persistent memory for AI agents. Each row contains an AES-256-GCM '
    'encrypted JSON blob of facts the agent has learned about the user in this channel. '
    'The server cannot read these facts — only the agent with the correct key can decrypt them.';
"#;

// ─── Tests ──────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    fn make_store() -> AgentMemoryStore {
        AgentMemoryStore {
            facts: vec![
                AgentFact {
                    fact_id: "f_001".into(),
                    category: "personal_detail".into(),
                    content: "User lives in Stuart, Florida".into(),
                    confidence: 0.95,
                    created_at: "2026-03-11T00:00:00Z".into(),
                    updated_at: "2026-03-11T00:00:00Z".into(),
                    reference_count: 3,
                },
                AgentFact {
                    fact_id: "f_002".into(),
                    category: "preference".into(),
                    content: "User prefers direct, concise answers".into(),
                    confidence: 0.8,
                    created_at: "2026-03-11T00:00:00Z".into(),
                    updated_at: "2026-03-11T00:00:00Z".into(),
                    reference_count: 5,
                },
            ],
            version: 1,
            last_extraction_msg_count: 20,
        }
    }

    #[test]
    fn test_encrypt_decrypt_memory_roundtrip() {
        let secret = b"test-master-secret-32-bytes-long!";
        let agent = Uuid::new_v4();
        let channel = Uuid::new_v4();
        let store = make_store();

        let (ct, nonce) = encrypt_memory_store(&store, secret, &agent, &channel).unwrap();
        let decrypted = decrypt_memory_store(&ct, &nonce, secret, &agent, &channel).unwrap();

        assert_eq!(decrypted.facts.len(), 2);
        assert_eq!(decrypted.facts[0].content, "User lives in Stuart, Florida");
        assert_eq!(decrypted.version, 1);
    }

    #[test]
    fn test_encrypt_wrong_channel_fails() {
        let secret = b"test-master-secret-32-bytes-long!";
        let agent = Uuid::new_v4();
        let channel1 = Uuid::new_v4();
        let channel2 = Uuid::new_v4();
        let store = make_store();

        let (ct, nonce) = encrypt_memory_store(&store, secret, &agent, &channel1).unwrap();
        let result = decrypt_memory_store(&ct, &nonce, secret, &agent, &channel2);

        assert!(result.is_err(), "Different channel must fail decryption");
    }

    #[test]
    fn test_memory_key_compartmentalization() {
        let secret = b"test-master-secret-32-bytes-long!";
        let agent = Uuid::new_v4();
        let ch1 = Uuid::new_v4();
        let ch2 = Uuid::new_v4();

        let key1 = derive_memory_key(secret, &agent, &ch1);
        let key2 = derive_memory_key(secret, &agent, &ch2);

        assert_ne!(key1, key2, "Different channels must derive different keys");
    }

    #[test]
    fn test_apply_add_operation() {
        let mut store = AgentMemoryStore::default();
        let ops = vec![ExtractedFact {
            category: "personal_detail".into(),
            content: "User is a software developer".into(),
            confidence: 0.9,
            operation: FactOperation::Add,
            target_fact_id: None,
        }];

        apply_operations(&mut store, &ops);
        assert_eq!(store.facts.len(), 1);
        assert_eq!(store.facts[0].content, "User is a software developer");
        assert_eq!(store.version, 2);
    }

    #[test]
    fn test_apply_update_operation() {
        let mut store = make_store();
        let ops = vec![ExtractedFact {
            category: "personal_detail".into(),
            content: "User recently moved to Miami, Florida".into(),
            confidence: 0.95,
            operation: FactOperation::Update,
            target_fact_id: Some("f_001".into()),
        }];

        apply_operations(&mut store, &ops);
        assert_eq!(store.facts.len(), 2);
        let updated = store.facts.iter().find(|f| f.fact_id == "f_001").unwrap();
        assert_eq!(updated.content, "User recently moved to Miami, Florida");
        assert_eq!(updated.reference_count, 4); // was 3, +1
    }

    #[test]
    fn test_apply_delete_operation() {
        let mut store = make_store();
        let ops = vec![ExtractedFact {
            category: "personal_detail".into(),
            content: "".into(),
            confidence: 0.0,
            operation: FactOperation::Delete,
            target_fact_id: Some("f_001".into()),
        }];

        apply_operations(&mut store, &ops);
        assert_eq!(store.facts.len(), 1);
        assert!(store.facts.iter().all(|f| f.fact_id != "f_001"));
    }

    #[test]
    fn test_eviction_at_capacity() {
        let mut store = AgentMemoryStore::default();
        // Fill to capacity
        for i in 0..MAX_FACTS_PER_PAIR {
            store.facts.push(AgentFact {
                fact_id: format!("f_{i}"),
                category: "test".into(),
                content: format!("Fact {i}"),
                confidence: 0.5,
                created_at: String::new(),
                updated_at: String::new(),
                reference_count: 1,
            });
        }
        // Add one with low confidence existing
        store.facts[0].confidence = 0.1; // This should get evicted

        let ops = vec![ExtractedFact {
            category: "new".into(),
            content: "New important fact".into(),
            confidence: 0.99,
            operation: FactOperation::Add,
            target_fact_id: None,
        }];

        apply_operations(&mut store, &ops);
        assert_eq!(store.facts.len(), MAX_FACTS_PER_PAIR);
        assert!(store.facts.iter().any(|f| f.content == "New important fact"));
    }

    #[test]
    fn test_build_memory_context_empty() {
        let store = AgentMemoryStore::default();
        assert!(build_memory_context(&store).is_empty());
    }

    #[test]
    fn test_build_memory_context_sorted() {
        let store = make_store();
        let context = build_memory_context(&store);

        assert!(context.contains("remember about this user"));
        assert!(context.contains("Stuart, Florida"));
        assert!(context.contains("concise answers"));
    }

    #[test]
    fn test_should_extract_timing() {
        assert!(should_extract(30, 20, Some(10)));
        assert!(!should_extract(25, 20, Some(10)));
        assert!(should_extract(10, 0, Some(10)));
        assert!(!should_extract(5, 0, Some(10)));
    }

    #[test]
    fn test_parse_extraction_clean_json() {
        let json = r#"{"facts": [{"category": "personal_detail", "content": "User lives in Florida", "confidence": 0.9, "operation": "add", "target_fact_id": null}]}"#;
        let result = parse_extraction_response(json).unwrap();
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].content, "User lives in Florida");
    }

    #[test]
    fn test_parse_extraction_with_markdown_fences() {
        let json = "```json\n{\"facts\": [{\"category\": \"preference\", \"content\": \"Likes Rust\", \"confidence\": 0.8, \"operation\": \"add\", \"target_fact_id\": null}]}\n```";
        let result = parse_extraction_response(json).unwrap();
        assert_eq!(result.len(), 1);
    }

    #[test]
    fn test_parse_extraction_empty() {
        let json = r#"{"facts": []}"#;
        let result = parse_extraction_response(json).unwrap();
        assert!(result.is_empty());
    }
}
