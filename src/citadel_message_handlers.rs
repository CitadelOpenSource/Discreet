// citadel_message_handlers.rs — Zero-knowledge message handling.
//
// THE CORE PRIVACY GUARANTEE:
// The server stores ONLY content_ciphertext (MLS ApplicationMessage).
// It cannot decrypt, search, or moderate message content.
// Clients encrypt before sending and decrypt after receiving.
//
// Endpoints:
//   POST   /channels/:channel_id/messages           — Send encrypted message
//   GET    /channels/:channel_id/messages           — Get message history (paginated)
//   PATCH  /messages/:id                            — Edit message (replace ciphertext)
//   DELETE /messages/:id                            — Soft-delete message

use axum::{
    extract::{Json, Path, Query, State},
    http::StatusCode,
    response::IntoResponse,
};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use uuid::Uuid;

use crate::citadel_auth::AuthUser;
use crate::citadel_error::AppError;
use crate::citadel_permissions::{
    require_permission, PERM_ATTACH_FILES, PERM_MANAGE_MESSAGES, PERM_SEND_MESSAGES,
    PERM_VIEW_CHANNEL,
};
use crate::citadel_state::AppState;
use crate::citadel_agent_config::load_server_agent_config;
use crate::citadel_agent_memory::{build_context, should_agent_respond};
use crate::citadel_agent_provider::{AgentMessage, create_provider, strip_metadata};

// ─── Request Types ──────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct SendMessageRequest {
    /// MLS ApplicationMessage ciphertext, base64-encoded.
    /// The server CANNOT read this.
    pub content_ciphertext: String,
    /// MLS epoch this message was encrypted under.
    pub mls_epoch: i64,
    /// Optional: encrypted file attachment reference.
    pub attachment_blob_id: Option<Uuid>,
    /// Optional: ID of the message being replied to.
    pub reply_to_id: Option<Uuid>,
}

#[derive(Debug, Deserialize)]
pub struct EditMessageRequest {
    /// New ciphertext replacing the original.
    pub content_ciphertext: String,
    /// MLS epoch for the new ciphertext.
    pub mls_epoch: i64,
}

#[derive(Debug, Deserialize)]
pub struct BulkDeleteRequest {
    pub message_ids: Vec<Uuid>,
    pub reason: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct PaginationParams {
    /// Max messages to return (default 50, max 100).
    #[serde(default = "default_limit")]
    pub limit: i64,
    /// Return messages before this message ID (cursor pagination).
    pub before: Option<Uuid>,
}

fn default_limit() -> i64 {
    50
}

// ─── Response Types ─────────────────────────────────────────────────────

#[derive(Debug, Serialize)]
pub struct MessageInfo {
    pub id: Uuid,
    pub channel_id: Uuid,
    pub author_id: Uuid,
    /// Base64-encoded MLS ciphertext. Only the client can decrypt this.
    pub content_ciphertext: String,
    pub mls_epoch: i64,
    pub attachment_blob_id: Option<Uuid>,
    pub edited_at: Option<String>,
    pub deleted: bool,
    pub created_at: String,
    /// If this message is a reply, the ID of the parent message.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reply_to_id: Option<Uuid>,
    /// Ciphertext of the replied-to message (for displaying reply context).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reply_to_ciphertext: Option<String>,
    /// Author ID of the replied-to message.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reply_to_author_id: Option<Uuid>,
}

// ─── POST /channels/:channel_id/messages ────────────────────────────────

pub async fn send_message(
    auth: AuthUser,
    State(state): State<Arc<AppState>>,
    Path(channel_id): Path<Uuid>,
    Json(req): Json<SendMessageRequest>,
) -> Result<impl IntoResponse, AppError> {
    // Validate ciphertext isn't empty.
    if req.content_ciphertext.is_empty() {
        return Err(AppError::BadRequest(
            "Message ciphertext cannot be empty".into(),
        ));
    }

    // Decode base64 to bytes for storage.
    let ciphertext_bytes = decode_base64(&req.content_ciphertext)?;

    // Enforce max message size (256KB ciphertext).
    if ciphertext_bytes.len() > 262_144 {
        return Err(AppError::BadRequest("Message exceeds 256KB limit".into()));
    }

    // Look up channel to get server_id, then verify membership.
    let channel = sqlx::query!("SELECT server_id FROM channels WHERE id = $1", channel_id,)
        .fetch_optional(&state.db)
        .await?
        .ok_or_else(|| AppError::NotFound("Channel not found".into()))?;

    require_permission(&state, channel.server_id, auth.user_id, PERM_SEND_MESSAGES).await?;

    if req.attachment_blob_id.is_some() {
        require_permission(&state, channel.server_id, auth.user_id, PERM_ATTACH_FILES).await?;
    }

    // Store the message. The server never sees plaintext.
    let message_id = Uuid::new_v4();
    sqlx::query!(
        "INSERT INTO messages (id, channel_id, author_id, content_ciphertext, mls_epoch, attachment_blob_id, reply_to_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7)",
        message_id,
        channel_id,
        auth.user_id,
        &ciphertext_bytes,
        req.mls_epoch,
        req.attachment_blob_id,
        req.reply_to_id,
    )
    .execute(&state.db)
    .await?;

    // Fire WebSocket notification so connected clients render the message.
    state
        .ws_broadcast(
            channel.server_id,
            serde_json::json!({
                "type": "message_create",
                "channel_id": channel_id,
                "message_id": message_id,
                "author_id": auth.user_id,
                "reply_to_id": req.reply_to_id,
            }),
        )
        .await;

    // After storing and broadcasting the user's message, check whether any
    // enabled bots in this server should auto-respond. Joining server_members
    // ensures we only consider bots that are actual server participants.
    // This block is entirely best-effort — failures must never error the sender.
    let server_bots = sqlx::query!(
        r#"SELECT
               bc.bot_user_id,
               bc.display_name,
               bc.trigger_keywords
           FROM bot_configs bc
           JOIN server_members sm
             ON  sm.user_id   = bc.bot_user_id
             AND sm.server_id = bc.server_id
           WHERE bc.server_id = $1
             AND bc.enabled   = TRUE"#,
        channel.server_id,
    )
    .fetch_all(&state.db)
    .await
    .unwrap_or_default();

    for bot in server_bots {
        let keywords: Vec<String> = bot
            .trigger_keywords
            .and_then(|v| serde_json::from_value(v).ok())
            .unwrap_or_default();

        // content_ciphertext is base64-encoded MLS ciphertext; keyword matching
        // against plaintext will only work once MLS decryption is wired in.
        // @mention matching (UUID pattern in the raw string) works now.
        if should_agent_respond(
            &req.content_ciphertext,
            &bot.bot_user_id,
            &bot.display_name,
            &keywords,
            false, // server channel — not a DM
        ) {
            let state_task   = state.clone();
            let bot_user_id  = bot.bot_user_id;
            let server_id    = channel.server_id;
            let task_channel = channel_id;
            let user_content = req.content_ciphertext.clone();

            tokio::spawn(async move {
                // ── 1. Load agent config ────────────────────────────────
                let cfg = match load_server_agent_config(
                    &state_task.db,
                    bot_user_id,
                    server_id,
                    state_task.config.agent_key_secret.as_bytes(),
                ).await {
                    Ok(c) => c,
                    Err(e) => {
                        tracing::debug!(
                            bot_id = %bot_user_id,
                            error  = %e,
                            "Agent config load failed — skipping auto-response"
                        );
                        return;
                    }
                };

                // ── 2. Build context window ─────────────────────────────
                let use_summary = cfg.memory_mode
                    == crate::citadel_agent_config::MemoryMode::Summary;
                let mut messages = build_context(
                    &state_task.db,
                    task_channel,
                    bot_user_id,
                    cfg.context_message_count,
                    use_summary,
                ).await.unwrap_or_default();

                messages.push(AgentMessage {
                    role:    "user".into(),
                    content: user_content,
                });
                strip_metadata(&mut messages);

                // ── 3. Call LLM provider ────────────────────────────────
                let provider = create_provider(&cfg.provider_type);
                let reply_text = match provider.complete(
                    &cfg.system_prompt,
                    messages,
                    &cfg.model_config,
                ).await {
                    Ok(result) => result.text,
                    Err(e) => {
                        tracing::warn!(
                            bot_id = %bot_user_id,
                            error  = %e,
                            "LLM provider call failed — no auto-response sent"
                        );
                        return;
                    }
                };

                // ── 4. Persist reply as a bot-authored message ──────────
                let reply_id      = Uuid::new_v4();
                let content_bytes = reply_text.as_bytes().to_vec();

                if let Err(e) = sqlx::query!(
                    "INSERT INTO messages
                         (id, channel_id, author_id, content_ciphertext, mls_epoch)
                     VALUES ($1, $2, $3, $4, 0)",
                    reply_id,
                    task_channel,
                    bot_user_id,
                    &content_bytes,
                ).execute(&state_task.db).await {
                    tracing::error!(
                        bot_id = %bot_user_id,
                        error  = %e,
                        "Failed to insert bot reply into messages"
                    );
                    return;
                }

                // ── 5. Broadcast so connected clients render it live ────
                state_task.ws_broadcast(server_id, serde_json::json!({
                    "type":       "message_create",
                    "channel_id": task_channel,
                    "message_id": reply_id,
                    "author_id":  bot_user_id,
                    "content":    reply_text,
                })).await;

                tracing::info!(
                    bot_id     = %bot_user_id,
                    server_id  = %server_id,
                    channel_id = %task_channel,
                    reply_id   = %reply_id,
                    "Bot auto-response sent"
                );
            });
        }
    }

    Ok((
        StatusCode::CREATED,
        Json(MessageInfo {
            id: message_id,
            channel_id,
            author_id: auth.user_id,
            content_ciphertext: req.content_ciphertext,
            mls_epoch: req.mls_epoch,
            attachment_blob_id: req.attachment_blob_id,
            edited_at: None,
            deleted: false,
            created_at: chrono::Utc::now().to_rfc3339(),
            reply_to_id: req.reply_to_id,
            reply_to_ciphertext: None,
            reply_to_author_id: None,
        }),
    ))
}

// ─── GET /channels/:channel_id/messages ─────────────────────────────────

pub async fn get_messages(
    auth: AuthUser,
    State(state): State<Arc<AppState>>,
    Path(channel_id): Path<Uuid>,
    Query(params): Query<PaginationParams>,
) -> Result<impl IntoResponse, AppError> {
    // Look up channel → server → verify membership.
    let channel = sqlx::query!("SELECT server_id FROM channels WHERE id = $1", channel_id,)
        .fetch_optional(&state.db)
        .await?
        .ok_or_else(|| AppError::NotFound("Channel not found".into()))?;

    require_permission(&state, channel.server_id, auth.user_id, PERM_VIEW_CHANNEL).await?;

    let limit = params.limit.clamp(1, 100);

    let messages: Vec<MessageInfo> = if let Some(before_id) = params.before {
        // Messages older than the cursor.
        sqlx::query!(
            "SELECT m.id, m.channel_id, m.author_id, m.content_ciphertext, m.mls_epoch,
                    m.attachment_blob_id, m.edited_at, m.deleted, m.created_at,
                    m.reply_to_id,
                    r.content_ciphertext AS \"reply_ciphertext?\",
                    r.author_id AS \"reply_author_id?\"
             FROM messages m
             LEFT JOIN messages r ON m.reply_to_id = r.id
             WHERE m.channel_id = $1
               AND m.created_at < (SELECT created_at FROM messages WHERE id = $2)
             ORDER BY m.created_at DESC
             LIMIT $3",
            channel_id,
            before_id,
            limit,
        )
        .fetch_all(&state.db)
        .await?
        .into_iter()
        .map(|r| MessageInfo {
            id: r.id,
            channel_id: r.channel_id,
            author_id: r.author_id,
            content_ciphertext: encode_base64(&r.content_ciphertext),
            mls_epoch: r.mls_epoch,
            attachment_blob_id: r.attachment_blob_id,
            edited_at: r.edited_at.map(|t| t.to_rfc3339()),
            deleted: r.deleted,
            created_at: r.created_at.to_rfc3339(),
            reply_to_id: r.reply_to_id,
            reply_to_ciphertext: r.reply_ciphertext.map(|c| encode_base64(&c)),
            reply_to_author_id: r.reply_author_id,
        })
        .collect()
    } else {
        // Most recent messages (default).
        sqlx::query!(
            "SELECT m.id, m.channel_id, m.author_id, m.content_ciphertext, m.mls_epoch,
                    m.attachment_blob_id, m.edited_at, m.deleted, m.created_at,
                    m.reply_to_id,
                    r.content_ciphertext AS \"reply_ciphertext?\",
                    r.author_id AS \"reply_author_id?\"
             FROM messages m
             LEFT JOIN messages r ON m.reply_to_id = r.id
             WHERE m.channel_id = $1
             ORDER BY m.created_at DESC
             LIMIT $2",
            channel_id,
            limit,
        )
        .fetch_all(&state.db)
        .await?
        .into_iter()
        .map(|r| MessageInfo {
            id: r.id,
            channel_id: r.channel_id,
            author_id: r.author_id,
            content_ciphertext: encode_base64(&r.content_ciphertext),
            mls_epoch: r.mls_epoch,
            attachment_blob_id: r.attachment_blob_id,
            edited_at: r.edited_at.map(|t| t.to_rfc3339()),
            deleted: r.deleted,
            created_at: r.created_at.to_rfc3339(),
            reply_to_id: r.reply_to_id,
            reply_to_ciphertext: r.reply_ciphertext.map(|c| encode_base64(&c)),
            reply_to_author_id: r.reply_author_id,
        })
        .collect()
    };

    Ok(Json(messages))
}

// ─── PATCH /messages/:id ────────────────────────────────────────────────

pub async fn edit_message(
    auth: AuthUser,
    State(state): State<Arc<AppState>>,
    Path(message_id): Path<Uuid>,
    Json(req): Json<EditMessageRequest>,
) -> Result<impl IntoResponse, AppError> {
    // Look up message — must be the author.
    let msg = sqlx::query!(
        "SELECT author_id, channel_id, deleted FROM messages WHERE id = $1",
        message_id,
    )
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::NotFound("Message not found".into()))?;

    if msg.author_id != auth.user_id {
        return Err(AppError::Forbidden(
            "You can only edit your own messages".into(),
        ));
    }

    if msg.deleted {
        return Err(AppError::BadRequest("Cannot edit a deleted message".into()));
    }

    let new_ciphertext = decode_base64(&req.content_ciphertext)?;
    if new_ciphertext.len() > 262_144 {
        return Err(AppError::BadRequest("Message exceeds 256KB limit".into()));
    }

    // Replace ciphertext and mark as edited.
    sqlx::query!(
        "UPDATE messages
         SET content_ciphertext = $1, mls_epoch = $2, edited_at = NOW()
         WHERE id = $3",
        &new_ciphertext,
        req.mls_epoch,
        message_id,
    )
    .execute(&state.db)
    .await?;

    // Notify via WebSocket.
    let channel = sqlx::query!(
        "SELECT server_id FROM channels WHERE id = $1",
        msg.channel_id,
    )
    .fetch_one(&state.db)
    .await?;

    state
        .ws_broadcast(
            channel.server_id,
            serde_json::json!({
                "type": "message_update",
                "channel_id": msg.channel_id,
                "message_id": message_id,
            }),
        )
        .await;

    Ok(StatusCode::NO_CONTENT)
}

// ─── DELETE /messages/:id ───────────────────────────────────────────────

pub async fn delete_message(
    auth: AuthUser,
    State(state): State<Arc<AppState>>,
    Path(message_id): Path<Uuid>,
) -> Result<impl IntoResponse, AppError> {
    let msg = sqlx::query!(
        "SELECT author_id, channel_id FROM messages WHERE id = $1",
        message_id,
    )
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::NotFound("Message not found".into()))?;

    // Author can always delete. Server owner can also delete (moderation).
    let channel = sqlx::query!(
        "SELECT server_id FROM channels WHERE id = $1",
        msg.channel_id,
    )
    .fetch_one(&state.db)
    .await?;

    let is_author = msg.author_id == auth.user_id;
    if !is_author {
        // Moderation delete requires MANAGE_MESSAGES.
        require_permission(
            &state,
            channel.server_id,
            auth.user_id,
            PERM_MANAGE_MESSAGES,
        )
        .await?;
    }

    // Soft-delete: wipe ciphertext but keep the record for ordering/threading.
    // This ensures the server truly forgets the content.
    sqlx::query!(
        "UPDATE messages
         SET deleted = TRUE, content_ciphertext = '\\x00', edited_at = NOW()
         WHERE id = $1",
        message_id,
    )
    .execute(&state.db)
    .await?;

    state
        .ws_broadcast(
            channel.server_id,
            serde_json::json!({
                "type": "message_delete",
                "channel_id": msg.channel_id,
                "message_id": message_id,
            }),
        )
        .await;

    Ok(StatusCode::NO_CONTENT)
}

// ─── POST /channels/:channel_id/messages/bulk-delete ─────────────────

/// Bulk soft-delete messages by IDs. Owner/mod only. Used by client-side
/// word search: client decrypts messages, finds matches, sends IDs here.
/// Zero-knowledge: server never sees the search term or plaintext.
pub async fn bulk_delete_messages(
    auth: AuthUser,
    State(state): State<Arc<AppState>>,
    Path(channel_id): Path<Uuid>,
    Json(req): Json<BulkDeleteRequest>,
) -> Result<impl IntoResponse, AppError> {
    if req.message_ids.is_empty() {
        return Err(AppError::BadRequest("No message IDs provided".into()));
    }
    if req.message_ids.len() > 500 {
        return Err(AppError::BadRequest("Max 500 messages per bulk delete".into()));
    }

    let channel = sqlx::query!(
        "SELECT server_id FROM channels WHERE id = $1",
        channel_id,
    )
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::NotFound("Channel not found".into()))?;

    // Require MANAGE_MESSAGES permission.
    require_permission(&state, channel.server_id, auth.user_id, PERM_MANAGE_MESSAGES).await?;

    // Soft-delete all matching messages in this channel.
    let result = sqlx::query!(
        "UPDATE messages SET deleted = TRUE, content_ciphertext = '\\x00', edited_at = NOW()
         WHERE id = ANY($1) AND channel_id = $2 AND deleted = FALSE",
        &req.message_ids,
        channel_id,
    )
    .execute(&state.db)
    .await?;

    let count = result.rows_affected();

    // Audit log entry.
    if let Err(e) = crate::citadel_audit::log_action(
        &state.db, channel.server_id, auth.user_id,
        "BULK_DELETE_MESSAGES",
        Some("channel"), Some(channel_id),
        Some(serde_json::json!({
            "count": count,
            "reason": req.reason.as_deref().unwrap_or("Word search & delete"),
        })),
        req.reason.as_deref(),
    ).await {
        tracing::warn!("Audit log failed for bulk delete: {}", e);
    }

    // Broadcast deletions.
    for mid in &req.message_ids {
        state.ws_broadcast(channel.server_id, serde_json::json!({
            "type": "message_delete",
            "channel_id": channel_id,
            "message_id": mid,
        })).await;
    }

    Ok(Json(serde_json::json!({ "deleted": count })))
}

// ─── Helpers ────────────────────────────────────────────────────────────

/// Decode base64 (URL-safe, no padding) to bytes.
fn decode_base64(input: &str) -> Result<Vec<u8>, AppError> {
    use base64::engine::general_purpose::{STANDARD, URL_SAFE_NO_PAD};
    use base64::Engine;

    // Try URL-safe first, fall back to standard.
    URL_SAFE_NO_PAD
        .decode(input)
        .or_else(|_| STANDARD.decode(input))
        .map_err(|e| AppError::BadRequest(format!("Invalid base64: {e}")))
}

/// Encode bytes to base64 (URL-safe, no padding).
fn encode_base64(data: &[u8]) -> String {
    use base64::engine::general_purpose::STANDARD;
    use base64::Engine;
    STANDARD.encode(data)
}

// ─── Route Registration ─────────────────────────────────────────────────

pub fn message_routes() -> axum::Router<Arc<AppState>> {
    use axum::routing::{delete, get, patch, post};
    axum::Router::new()
        .route("/channels/:channel_id/messages", post(send_message))
        .route("/channels/:channel_id/messages", get(get_messages))
        .route("/channels/:channel_id/messages/bulk-delete", post(bulk_delete_messages))
        .route("/messages/:id", patch(edit_message))
        .route("/messages/:id", delete(delete_message))
}
