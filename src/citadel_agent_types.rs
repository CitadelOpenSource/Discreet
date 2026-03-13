// citadel_agent_types.rs — Data types for the AI Agent Framework.
//
// Defines the core structures for auto-spawning specialist AI agents
// that participate as MLS group members in E2EE channels.
//
// This file contains types only. Handlers are in citadel_agent_handlers.rs.
// Database migrations are in migrations/003_agents.sql.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use uuid::Uuid;

// ─── Agent Identity ─────────────────────────────────────────────────────

/// A single AI agent with its own cryptographic identity.
/// Architecturally identical to a human user at the MLS protocol level.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentIdentity {
    pub agent_id: Uuid,
    /// Ed25519 signing key (public half).
    pub identity_public_key: Vec<u8>,
    /// X25519 key agreement key (public half, consumed by MLS KeyPackages).
    pub key_agreement_public_key: Vec<u8>,
    /// Human-readable display name (e.g., "Discreet Legal — immigration").
    pub display_name: String,
    pub specialization: AgentSpecialization,
    pub created_at: DateTime<Utc>,
    pub status: AgentStatus,
    /// Hex-encoded SHA-256 fingerprint for out-of-band identity verification.
    pub fingerprint: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum AgentStatus {
    Spawning,
    Active,
    Processing,
    Hibernated,
    Decommissioned,
}

// ─── Specialization ─────────────────────────────────────────────────────

/// Domain-specific persona for an AI agent. Determines system prompt,
/// safety guardrails, model selection, and RAG knowledge base.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum AgentSpecialization {
    General,
    Legal { jurisdiction: Option<String> },
    Medical { specialty: Option<String> },
    Security { focus: SecurityFocus },
    Engineering { languages: Vec<String> },
    Financial { domain: FinancialDomain },
    Research { field: String },
    Creative { style: Option<String> },
    Translation { languages: Vec<String> },
    Custom {
        name: String,
        system_prompt: String,
        safety_config: SafetyConfig,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum SecurityFocus {
    ThreatIntel,
    Forensics,
    PenTest,
    Compliance,
    IncidentResponse,
    General,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum FinancialDomain {
    PersonalFinance,
    CorporateFinance,
    TaxInformation,
    Investment,
    Crypto,
    General,
}

// ─── Safety ─────────────────────────────────────────────────────────────

/// Per-agent safety constraints applied before every LLM response.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct SafetyConfig {
    pub max_response_tokens: u32,
    pub blocked_topics: Vec<String>,
    pub web_search_enabled: bool,
    pub code_execution_enabled: bool,
    pub disclaimer: Option<String>,
    pub rate_limit_per_user: u32,
}

impl Default for SafetyConfig {
    fn default() -> Self {
        Self {
            max_response_tokens: 4096,
            blocked_topics: vec![
                "weapons_manufacturing".into(),
                "illegal_substances".into(),
                "child_exploitation".into(),
                "self_harm_instructions".into(),
            ],
            web_search_enabled: false,
            code_execution_enabled: false,
            disclaimer: None,
            rate_limit_per_user: 60,
        }
    }
}

// ─── Channel Binding ────────────────────────────────────────────────────

/// Links an agent to a channel within a server. One agent can serve
/// multiple channels; each binding has its own MLS group membership.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentChannel {
    pub channel_id: Uuid,
    pub server_id: Uuid,
    pub agent_id: Uuid,
    pub topic: String,
    pub mls_group_id: Vec<u8>,
    pub mls_epoch: u64,
    pub member_count: u32,
    pub created_at: DateTime<Utc>,
    pub last_active: DateTime<Utc>,
    pub archived: bool,
}

// ─── Spawn Lifecycle ────────────────────────────────────────────────────

/// A request to spawn a new specialist agent. Created when a user search
/// query matches no existing agent channel and auto_spawn is enabled.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SpawnRequest {
    pub request_id: Uuid,
    pub requesting_user_id: Uuid,
    pub server_id: Uuid,
    pub query: String,
    pub inferred_specialization: AgentSpecialization,
    pub confidence: f64,
    pub status: SpawnStatus,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum SpawnStatus {
    Analyzing,
    Provisioning,
    GeneratingKeys,
    UploadingKeyPackages,
    JoiningGroup,
    Ready,
    Failed { reason: String },
}

// ─── Runtime Configuration ──────────────────────────────────────────────

/// How the agent's LLM backend is provisioned and configured.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentRuntimeConfig {
    pub backend: LLMBackend,
    /// Model identifier (e.g., "llama-3.1-70b-instruct").
    pub model_id: String,
    pub temperature: f32,
    pub max_context_tokens: u32,
    /// Derived from the agent's specialization.
    pub system_prompt: String,
    pub rag_enabled: bool,
    pub rag_store_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum LLMBackend {
    /// Citadel-managed cloud inference (Pro tier).
    CitadelCloud { endpoint: String, api_version: String },
    /// Customer-managed on-premise deployment.
    OnPremise { endpoint: String, air_gapped: bool },
    /// External provider via user-supplied API key.
    ExternalAPI { provider: String, encrypted_api_key: Vec<u8> },
    /// Local model on user hardware (Ollama, llama.cpp).
    LocalModel { endpoint: String, model_name: String },
}

// ─── Message Processing ─────────────────────────────────────────────────

/// Metadata attached to each agent interaction (never contains plaintext).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentMessageMetadata {
    pub inference_latency_ms: Option<u64>,
    pub tokens_used: Option<u32>,
    pub rag_used: bool,
    pub rag_chunks: u32,
    pub safety_filtered: bool,
}

// ─── Spawn Engine ───────────────────────────────────────────────────────

/// Maps user search queries to agent specializations.
/// The engine tokenizes the query, matches against the topic map,
/// and returns the best specialization with a confidence score.
#[derive(Debug, Clone)]
pub struct SpawnEngine {
    pub topic_map: HashMap<String, AgentSpecialization>,
    pub spawn_threshold: f64,
    pub max_agents_per_server: u32,
    pub max_agents_per_user: u32,
    pub spawn_cooldown_secs: u64,
}

impl Default for SpawnEngine {
    fn default() -> Self {
        let mut m = HashMap::new();

        let legal_topics = [
            "lawyer", "legal", "law", "attorney", "contract", "patent",
            "copyright", "trademark", "liability", "compliance", "regulation",
            "immigration", "employment law", "GDPR", "HIPAA",
        ];
        let medical_topics = [
            "doctor", "medical", "health", "symptom", "diagnosis",
            "medication", "therapy", "mental health", "nutrition",
            "fitness", "wellness", "cardiology", "dermatology",
        ];
        let security_topics = [
            "cybersecurity", "pentest", "vulnerability", "exploit",
            "malware", "forensics", "incident response", "SIEM",
            "threat intel", "IOC", "CVE", "OSINT", "red team", "blue team",
        ];
        let engineering_topics = [
            "code review", "programming", "debugging", "architecture",
            "rust", "python", "javascript", "typescript", "golang",
            "devops", "kubernetes", "terraform", "database", "API design",
        ];
        let financial_topics = [
            "finance", "investing", "stocks", "crypto", "tax",
            "budgeting", "retirement", "mortgage", "insurance",
            "portfolio", "market analysis", "trading",
        ];

        for t in legal_topics {
            m.insert(t.into(), AgentSpecialization::Legal { jurisdiction: None });
        }
        for t in medical_topics {
            m.insert(t.into(), AgentSpecialization::Medical { specialty: None });
        }
        for t in security_topics {
            m.insert(t.into(), AgentSpecialization::Security { focus: SecurityFocus::General });
        }
        for t in engineering_topics {
            m.insert(t.into(), AgentSpecialization::Engineering { languages: vec![] });
        }
        for t in financial_topics {
            m.insert(t.into(), AgentSpecialization::Financial { domain: FinancialDomain::General });
        }

        Self {
            topic_map: m,
            spawn_threshold: 0.7,
            max_agents_per_server: 50,
            max_agents_per_user: 10,
            spawn_cooldown_secs: 30,
        }
    }
}

impl SpawnEngine {
    /// Match a user query against the topic taxonomy.
    /// Returns (specialization, confidence). Confidence range: 0.0–1.0.
    pub fn analyze_query(&self, query: &str) -> (AgentSpecialization, f64) {
        let query_lower = query.to_lowercase();
        let words: Vec<&str> = query_lower.split_whitespace().collect();
        let mut best: Option<(AgentSpecialization, f64)> = None;

        for (keyword, spec) in &self.topic_map {
            let kw_lower = keyword.to_lowercase();

            // Exact phrase match → high confidence.
            if query_lower.contains(&kw_lower) {
                let conf = 0.95;
                if best.as_ref().map_or(true, |(_, c)| conf > *c) {
                    best = Some((spec.clone(), conf));
                }
                continue;
            }

            // Partial word overlap → moderate confidence.
            let kw_words: Vec<&str> = kw_lower.split_whitespace().collect();
            let hits = kw_words.iter()
                .filter(|kw| words.iter().any(|w| w.contains(**kw) || kw.contains(w)))
                .count();

            if hits > 0 {
                let conf = 0.6 + (0.3 * hits as f64 / kw_words.len() as f64);
                if best.as_ref().map_or(true, |(_, c)| conf > *c) {
                    best = Some((spec.clone(), conf));
                }
            }
        }

        best.unwrap_or((AgentSpecialization::General, 0.3))
    }
}

// ─── Crypto Primitives ──────────────────────────────────────────────────

/// A signing or key-agreement keypair. In production, the secret half
/// is held in memory only during key generation, then stored in the
/// agent's secure runtime (or HSM for on-premise deployments).
pub struct KeyPair {
    pub public: Vec<u8>,
    pub secret: Vec<u8>,
}
