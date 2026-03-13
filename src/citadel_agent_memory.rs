// citadel_agent_memory.rs — Agent conversation context builder.
//
// The agent's "memory" IS the encrypted message history already stored in
// the database. This module reads the last N ciphertext messages, decrypts
// them with the agent's own key, strips metadata, and returns a clean
// `Vec<AgentMessage>` for the LLM context window.
//
// PATENT ALIGNMENT:
//   The MLS transcript IS the agent's memory substrate. No additional
//   storage is needed for the core sliding window. This is both
//   storage-efficient and patent-aligned — the agent participates as
//   a real MLS group member reading its own transcript.
//
// MEMORY MODES:
//   1. SlidingWindow (default) — last N messages, zero extra storage
//   2. Summary — sliding window + periodic summary compression
//      Stores one row per agent per channel in `agent_context_summaries`
//   3. None — each message is independent (no context)
//
// SECURITY:
//   - Messages are decrypted in-memory only for the LLM call duration
//   - User-identifying metadata is stripped before returning
//   - Bot's own messages are included (for conversation continuity)
//   - The decrypted messages are NEVER persisted or logged

use chrono::{DateTime, Utc};
use sqlx::PgPool;
use tracing::{debug, info, warn};
use uuid::Uuid;

use crate::citadel_agent_episodic_memory::{build_memory_context, load_memory_store};
use crate::citadel_agent_provider::{AgentError, AgentMessage};

// ─── Constants ──────────────────────────────────────────────────────────

/// Maximum messages to load in a single sliding window query.
/// Safety valve to prevent loading entire channel history.
const MAX_SLIDING_WINDOW: u32 = 100;

/// Maximum token estimate per message before truncation.
/// Rough heuristic: 1 token ≈ 4 chars in English.
const MAX_MESSAGE_CHARS: usize = 4000;

/// Maximum total context characters to prevent overwhelming the LLM.
/// ~100K chars ≈ ~25K tokens — well within Claude Haiku's 200K window.
const MAX_TOTAL_CONTEXT_CHARS: usize = 100_000;

// ─── Raw Message from DB ────────────────────────────────────────────────

/// A message as stored in the database (encrypted or plaintext for bots).
#[derive(Debug, Clone)]
#[allow(dead_code)]
struct RawChannelMessage {
    id: Uuid,
    author_id: Uuid,
    author_display_name: Option<String>,
    author_is_bot: bool,
    content_ciphertext: Vec<u8>,
    mls_epoch: i64,
    created_at: DateTime<Utc>,
    deleted: bool,
}

// ─── Context Building ───────────────────────────────────────────────────

/// Build the conversation context for an agent's LLM call.
///
/// This is the main entry point. It:
/// 1. Loads the last N messages from the channel
/// 2. Decrypts them (for now, plaintext passthrough — MLS integration pending)
/// 3. Strips user-identifying metadata
/// 4. Labels messages as "user" or "assistant" (for the LLM)
/// 5. Optionally prepends a summary of older context
///
/// # Arguments
/// - `db`: Database pool
/// - `channel_id`: The channel to load messages from
/// - `bot_user_id`: The bot's user ID (to identify assistant messages)
/// - `context_count`: How many messages to load (from agent config)
/// - `include_summary`: Whether to prepend summary context (Summary mode)
///
/// # Returns
/// A vector of `AgentMessage` suitable for passing to `provider.complete()`
pub async fn build_context(
    db: &PgPool,
    channel_id: Uuid,
    bot_user_id: Uuid,
    context_count: u32,
    include_summary: bool,
    master_secret: &[u8],
) -> Result<Vec<AgentMessage>, AgentError> {
    let count = context_count.min(MAX_SLIDING_WINDOW);

    // Load raw messages from DB
    let raw_messages = load_recent_messages(db, channel_id, count).await?;

    if raw_messages.is_empty() {
        debug!(channel_id = %channel_id, "No messages found — empty context");
        return Ok(Vec::new());
    }

    // Convert to agent messages
    let mut context: Vec<AgentMessage> = Vec::with_capacity(raw_messages.len() + 1);

    // Optionally prepend summary from previous context
    if include_summary {
        if let Some(summary) = load_context_summary(db, bot_user_id, channel_id).await? {
            context.push(AgentMessage {
                role: "system".into(),
                content: format!("[Previous conversation summary]: {summary}"),
            });
        }
    }

    // Convert each message, tracking unique users for anonymization
    let mut user_map: std::collections::HashMap<Uuid, String> = std::collections::HashMap::new();
    let mut user_counter: u32 = 0;
    let mut total_chars: usize = 0;

    for msg in &raw_messages {
        // Skip deleted messages
        if msg.deleted {
            continue;
        }

        // Decrypt content (currently plaintext passthrough for bot messages)
        let content = decrypt_message_content(&msg.content_ciphertext, msg.mls_epoch)?;

        if content.is_empty() {
            continue;
        }

        // Truncate overly long messages
        let content = if content.len() > MAX_MESSAGE_CHARS {
            let truncated: String = content.chars().take(MAX_MESSAGE_CHARS).collect();
            format!("{truncated}... [message truncated]")
        } else {
            content
        };

        // Check total context size
        total_chars += content.len();
        if total_chars > MAX_TOTAL_CONTEXT_CHARS {
            debug!(
                channel_id = %channel_id,
                messages_loaded = context.len(),
                "Context size limit reached — truncating"
            );
            break;
        }

        // Determine role: messages from the bot are "assistant", all others are "user"
        let role = if msg.author_id == bot_user_id {
            "assistant".to_string()
        } else {
            "user".to_string()
        };

        // Anonymize user identity — replace real names with "User 1", "User 2"
        // The LLM should not know real usernames (privacy protection)
        let final_content = if msg.author_id == bot_user_id {
            content
        } else {
            let anon_name = user_map
                .entry(msg.author_id)
                .or_insert_with(|| {
                    user_counter += 1;
                    format!("User {user_counter}")
                })
                .clone();
            format!("[{anon_name}]: {content}")
        };

        context.push(AgentMessage {
            role,
            content: final_content,
        });
    }

    // Ensure alternating user/assistant pattern for Anthropic API compatibility.
    // Anthropic requires messages to alternate between "user" and "assistant".
    // Merge consecutive same-role messages.
    let mut context = merge_consecutive_roles(context);

    // Inject episodic memory (learned facts) as a system message at the front.
    match load_memory_store(db, bot_user_id, channel_id, master_secret).await {
        Ok(store) if !store.facts.is_empty() => {
            let memory_ctx = build_memory_context(&store);
            if !memory_ctx.is_empty() {
                context.insert(0, AgentMessage {
                    role: "system".into(),
                    content: memory_ctx,
                });
                debug!(
                    bot_user_id = %bot_user_id,
                    channel_id = %channel_id,
                    fact_count = store.facts.len(),
                    "Episodic memory injected into context"
                );
            }
        }
        Err(e) => {
            debug!(error = %e, "Episodic memory load failed — continuing without");
        }
        _ => {}
    }

    debug!(
        channel_id = %channel_id,
        message_count = context.len(),
        total_chars,
        "Context built successfully"
    );

    Ok(context)
}

/// Load the most recent messages from a channel.
async fn load_recent_messages(
    db: &PgPool,
    channel_id: Uuid,
    count: u32,
) -> Result<Vec<RawChannelMessage>, AgentError> {
    // Query messages in reverse chronological order, then reverse for context
    let rows = sqlx::query!(
        r#"
        SELECT
            m.id,
            m.author_id,
            u.display_name AS author_display_name,
            COALESCE(u.is_bot, FALSE) AS "author_is_bot!",
            m.content_ciphertext,
            COALESCE(m.mls_epoch, 0) AS "mls_epoch!",
            m.created_at AS "created_at!: DateTime<Utc>",
            COALESCE(m.deleted, FALSE) AS "deleted!"
        FROM messages m
        LEFT JOIN users u ON u.id = m.author_id
        WHERE m.channel_id = $1
        ORDER BY m.created_at DESC
        LIMIT $2
        "#,
        channel_id,
        count as i64,
    )
    .fetch_all(db)
    .await
    .map_err(|e| AgentError::Internal(format!("Failed to load messages: {e}")))?;

    // Reverse to chronological order
    let mut messages: Vec<RawChannelMessage> = rows
        .into_iter()
        .map(|r| RawChannelMessage {
            id: r.id,
            author_id: r.author_id,
            author_display_name: r.author_display_name,
            author_is_bot: r.author_is_bot,
            content_ciphertext: r.content_ciphertext,
            mls_epoch: r.mls_epoch,
            created_at: r.created_at,
            deleted: r.deleted,
        })
        .collect();

    messages.reverse();
    Ok(messages)
}

/// Decrypt message content.
///
/// CURRENT STATE: Bot messages are stored as plaintext bytes in the DB
/// (mls_epoch = 0). When full MLS integration is wired, this function
/// will use the agent's X25519 private key to decrypt the ciphertext.
///
/// FUTURE: The agent's MLS leaf key decrypts the application message.
/// This is the patent claim in action — the agent holds its own key
/// and decrypts just like any other MLS group member.
fn decrypt_message_content(
    ciphertext: &[u8],
    mls_epoch: i64,
) -> Result<String, AgentError> {
    if mls_epoch == 0 {
        // Epoch 0 = plaintext (legacy or bot-authored messages)
        String::from_utf8(ciphertext.to_vec()).map_err(|_| {
            AgentError::Internal("Message content is not valid UTF-8".into())
        })
    } else {
        // TODO: MLS decryption with agent's leaf key
        // For now, attempt UTF-8 decode — this will work for the PBKDF2
        // encrypted messages once we wire the AES-GCM decryption here.
        //
        // The client encrypts with:
        //   key = PBKDF2(passphrase=`citadel:{channelId}:{epoch}`, salt="mls-group-secret")
        //   AES-256-GCM(key, nonce=first_12_bytes, plaintext)
        //
        // To properly decrypt, we need:
        //   1. The channel epoch key (distributed via WebSocket)
        //   2. The nonce (prepended to ciphertext)
        //   3. AES-256-GCM decrypt
        //
        // For now, return a placeholder indicating encrypted content.
        warn!(
            mls_epoch,
            "Cannot decrypt MLS epoch > 0 messages yet — MLS key integration pending"
        );
        Ok("[Encrypted message — agent MLS key integration pending]".to_string())
    }
}

// ─── Summary Compression ────────────────────────────────────────────────

/// Load a previously stored context summary for this agent+channel pair.
///
/// The summary table stores one row per (bot_user_id, channel_id) with a
/// compressed natural language summary of older conversations. This gives
/// long-running agents persistent memory without loading thousands of messages.
async fn load_context_summary(
    db: &PgPool,
    bot_user_id: Uuid,
    channel_id: Uuid,
) -> Result<Option<String>, AgentError> {
    let row = sqlx::query!(
        r#"
        SELECT summary_text, message_count, updated_at
        FROM agent_context_summaries
        WHERE bot_user_id = $1 AND channel_id = $2
        "#,
        bot_user_id,
        channel_id,
    )
    .fetch_optional(db)
    .await
    .map_err(|e| {
        // Table might not exist yet — that's fine, just return None
        debug!("agent_context_summaries query: {e}");
        AgentError::Internal(format!("Summary query failed: {e}"))
    });

    match row {
        Ok(Some(r)) => {
            debug!(
                bot_user_id = %bot_user_id,
                channel_id = %channel_id,
                message_count = ?r.message_count,
                "Loaded context summary"
            );
            Ok(r.summary_text)
        }
        Ok(None) => Ok(None),
        Err(_) => Ok(None), // Graceful degradation — no summary is fine
    }
}

/// Store or update a context summary for this agent+channel pair.
///
/// Called after the agent processes a batch of messages. The summary is
/// generated by the LLM itself (meta-summarization).
///
/// SECURITY: The summary is stored as plaintext in the DB. For production,
/// this should be AES-encrypted with the agent's key. Tracked as TODO.
pub async fn store_context_summary(
    db: &PgPool,
    bot_user_id: Uuid,
    channel_id: Uuid,
    summary: &str,
    message_count: i64,
) -> Result<(), AgentError> {
    sqlx::query!(
        r#"
        INSERT INTO agent_context_summaries (bot_user_id, channel_id, summary_text, message_count, updated_at)
        VALUES ($1, $2, $3, $4, NOW())
        ON CONFLICT (bot_user_id, channel_id)
        DO UPDATE SET
            summary_text = EXCLUDED.summary_text,
            message_count = EXCLUDED.message_count,
            updated_at = NOW()
        "#,
        bot_user_id,
        channel_id,
        summary,
        message_count,
    )
    .execute(db)
    .await
    .map_err(|e| AgentError::Internal(format!("Failed to store summary: {e}")))?;

    info!(
        bot_user_id = %bot_user_id,
        channel_id = %channel_id,
        message_count,
        "Context summary stored"
    );

    Ok(())
}

// ─── Context Utilities ──────────────────────────────────────────────────

/// Merge consecutive messages with the same role.
///
/// Anthropic's API requires alternating user/assistant turns. If there are
/// multiple consecutive user messages (e.g., two users speaking before the
/// bot responds), merge them into a single user message.
fn merge_consecutive_roles(messages: Vec<AgentMessage>) -> Vec<AgentMessage> {
    if messages.is_empty() {
        return messages;
    }

    let mut merged: Vec<AgentMessage> = Vec::with_capacity(messages.len());

    for msg in messages {
        if let Some(last) = merged.last_mut() {
            if last.role == msg.role {
                // Same role — append content with newline separator
                last.content.push('\n');
                last.content.push_str(&msg.content);
                continue;
            }
        }
        merged.push(msg);
    }

    // Ensure the first message is always from "user" (Anthropic requirement)
    if let Some(first) = merged.first() {
        if first.role == "assistant" {
            merged.insert(0, AgentMessage {
                role: "user".into(),
                content: "[Conversation start]".into(),
            });
        }
    }

    merged
}

/// Estimate token count for a string.
/// Rough heuristic: 1 token ≈ 4 characters in English.
/// This is intentionally conservative to avoid context overflow.
pub fn estimate_tokens(text: &str) -> u32 {
    (text.len() as u32) / 4 + 1
}

/// Estimate total tokens for a message array.
pub fn estimate_context_tokens(
    system_prompt: &str,
    messages: &[AgentMessage],
) -> u32 {
    let system_tokens = estimate_tokens(system_prompt);
    let message_tokens: u32 = messages
        .iter()
        .map(|m| estimate_tokens(&m.content) + 4) // +4 for role overhead
        .sum();
    system_tokens + message_tokens
}

// ─── Trigger Matching ───────────────────────────────────────────────────

/// Check if a message should trigger an agent response.
///
/// An agent responds when:
/// 1. It is @mentioned (e.g., "@Code Wizard" or "<@bot_uuid>")
/// 2. A trigger keyword appears in the message
/// 3. It's a DM channel (always respond)
///
/// Returns true if the agent should process this message.
pub fn should_agent_respond(
    message_content: &str,
    bot_user_id: &Uuid,
    bot_display_name: &str,
    trigger_keywords: &[String],
    is_dm_channel: bool,
) -> bool {
    // Always respond in DM channels
    if is_dm_channel {
        return true;
    }

    let lower = message_content.to_lowercase();

    // Check @mention (by UUID or display name)
    let uuid_mention = format!("<@{}>", bot_user_id);
    if message_content.contains(&uuid_mention) {
        return true;
    }
    if lower.contains(&bot_display_name.to_lowercase()) {
        return true;
    }

    // Check trigger keywords
    for keyword in trigger_keywords {
        if !keyword.is_empty() && lower.contains(&keyword.to_lowercase()) {
            return true;
        }
    }

    false
}

/// Delete all context summaries and episodic facts for a bot, resetting its memory.
/// Sliding-window memory (raw message history) is unaffected — it reads live DB rows.
pub async fn clear_agent_memory(
    db: &PgPool,
    bot_user_id: Uuid,
) -> Result<u64, AgentError> {
    let summaries = sqlx::query!(
        "DELETE FROM agent_context_summaries WHERE bot_user_id = $1",
        bot_user_id,
    )
    .execute(db)
    .await
    .map_err(|e| AgentError::Internal(format!("Failed to clear agent memory: {e}")))?
    .rows_affected();

    // Also clear episodic facts (agent_id = bot_user_id)
    let episodic = sqlx::query(
        "DELETE FROM agent_episodic_facts WHERE agent_id = $1",
    )
    .bind(bot_user_id)
    .execute(db)
    .await
    .unwrap_or_default()
    .rows_affected();

    let total = summaries + episodic;
    info!(bot_user_id = %bot_user_id, summaries, episodic, "Agent memory cleared");
    Ok(total)
}

/// Count total messages tracked in context summaries for a bot (across all channels).
/// Returns 0 if no summaries exist yet.
pub async fn agent_memory_fact_count(
    db: &PgPool,
    bot_user_id: Uuid,
) -> i64 {
    sqlx::query_scalar!(
        "SELECT COALESCE(SUM(message_count), 0)::BIGINT FROM agent_context_summaries WHERE bot_user_id = $1",
        bot_user_id,
    )
    .fetch_one(db)
    .await
    .unwrap_or(None)
    .unwrap_or(0)
}

// ─── SQL for Summary Table ──────────────────────────────────────────────

/// SQL to create the agent_context_summaries table.
/// Run as a migration (next available migration number).
///
/// ```sql
/// CREATE TABLE IF NOT EXISTS agent_context_summaries (
///     bot_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
///     channel_id  UUID NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
///     summary_text TEXT,
///     message_count BIGINT DEFAULT 0,
///     updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
///     PRIMARY KEY (bot_user_id, channel_id)
/// );
///
/// CREATE INDEX idx_agent_summaries_channel
///     ON agent_context_summaries(channel_id);
/// ```
pub const SUMMARY_TABLE_MIGRATION: &str = r#"
CREATE TABLE IF NOT EXISTS agent_context_summaries (
    bot_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    channel_id  UUID NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    summary_text TEXT,
    message_count BIGINT DEFAULT 0,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (bot_user_id, channel_id)
);

CREATE INDEX IF NOT EXISTS idx_agent_summaries_channel
    ON agent_context_summaries(channel_id);
"#;

// ─── Tests ──────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_merge_consecutive_user_messages() {
        let messages = vec![
            AgentMessage { role: "user".into(), content: "Hello".into() },
            AgentMessage { role: "user".into(), content: "How are you?".into() },
            AgentMessage { role: "assistant".into(), content: "I'm good!".into() },
            AgentMessage { role: "user".into(), content: "Great".into() },
        ];

        let merged = merge_consecutive_roles(messages);
        assert_eq!(merged.len(), 3);
        assert_eq!(merged[0].role, "user");
        assert!(merged[0].content.contains("Hello"));
        assert!(merged[0].content.contains("How are you?"));
        assert_eq!(merged[1].role, "assistant");
        assert_eq!(merged[2].role, "user");
    }

    #[test]
    fn test_merge_starts_with_assistant() {
        let messages = vec![
            AgentMessage { role: "assistant".into(), content: "Hi there".into() },
            AgentMessage { role: "user".into(), content: "Hello".into() },
        ];

        let merged = merge_consecutive_roles(messages);
        assert_eq!(merged.len(), 3);
        assert_eq!(merged[0].role, "user");
        assert_eq!(merged[0].content, "[Conversation start]");
    }

    #[test]
    fn test_merge_empty() {
        let merged = merge_consecutive_roles(Vec::new());
        assert!(merged.is_empty());
    }

    #[test]
    fn test_estimate_tokens() {
        assert_eq!(estimate_tokens(""), 1); // minimum 1
        assert_eq!(estimate_tokens("Hello world!"), 4); // 12 chars / 4 + 1
    }

    #[test]
    fn test_should_respond_dm() {
        let bot_id = Uuid::new_v4();
        assert!(should_agent_respond(
            "anything",
            &bot_id,
            "Test Bot",
            &[],
            true, // DM
        ));
    }

    #[test]
    fn test_should_respond_mention_uuid() {
        let bot_id = Uuid::new_v4();
        let content = format!("Hey <@{}> can you help?", bot_id);
        assert!(should_agent_respond(
            &content,
            &bot_id,
            "Test Bot",
            &[],
            false,
        ));
    }

    #[test]
    fn test_should_respond_mention_name() {
        let bot_id = Uuid::new_v4();
        assert!(should_agent_respond(
            "Hey Code Wizard, can you help with this?",
            &bot_id,
            "Code Wizard",
            &[],
            false,
        ));
    }

    #[test]
    fn test_should_respond_keyword() {
        let bot_id = Uuid::new_v4();
        assert!(should_agent_respond(
            "I need help with my python code",
            &bot_id,
            "Code Bot",
            &["python".into(), "javascript".into()],
            false,
        ));
    }

    #[test]
    fn test_should_not_respond_no_trigger() {
        let bot_id = Uuid::new_v4();
        assert!(!should_agent_respond(
            "Just chatting about the weather",
            &bot_id,
            "Code Bot",
            &["python".into()],
            false,
        ));
    }

    #[test]
    fn test_decrypt_plaintext_message() {
        let content = "Hello, this is a test message!";
        let result = decrypt_message_content(content.as_bytes(), 0);
        assert_eq!(result.unwrap(), content);
    }

    #[test]
    fn test_decrypt_encrypted_message_placeholder() {
        let result = decrypt_message_content(b"encrypted-data", 5);
        assert!(result.unwrap().contains("pending"));
    }
}
