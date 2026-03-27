// discreet_message_handlers.rs — Zero-knowledge message handling.
//
// THE CORE PRIVACY GUARANTEE:
// The server stores ONLY content_ciphertext (MLS ApplicationMessage).
// It cannot decrypt, search, or moderate message content.
// Clients encrypt before sending and decrypt after receiving.
//
// Endpoints:
//   POST   /channels/{channel_id}/messages           — Send encrypted message
//   GET    /channels/{channel_id}/messages           — Get message history (paginated)
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

use crate::discreet_auth::AuthUser;
use crate::discreet_error::AppError;
use crate::discreet_permissions::{
    require_permission, PERM_ATTACH_FILES, PERM_MANAGE_MESSAGES, PERM_SEND_MESSAGES,
    PERM_VIEW_CHANNEL,
};
use crate::discreet_state::AppState;
use crate::discreet_agent_config::load_server_agent_config;
use crate::discreet_automod::{load_automod_config, check_message, AutoModAction};
use crate::discreet_agent_memory::{build_context, should_agent_respond};
use crate::discreet_agent_provider::{AgentMessage, create_provider, strip_metadata};

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
    /// Optional: thread parent message ID (for threaded replies).
    pub parent_message_id: Option<Uuid>,
    /// Optional: UUIDs of mentioned users (client-provided, max 20).
    /// Special value "00000000-0000-0000-0000-000000000000" means @everyone.
    pub mentioned_user_ids: Option<Vec<Uuid>>,
    /// Optional priority: 'important' or 'urgent'. Urgent requires acknowledgement.
    pub priority: Option<String>,
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
    /// Thread parent message ID.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub parent_message_id: Option<Uuid>,
    /// Number of threaded replies to this message.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reply_count: Option<i64>,
    /// UUIDs of mentioned users.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mentioned_user_ids: Option<serde_json::Value>,
}

// ─── POST /channels/{channel_id}/messages ────────────────────────────────

pub async fn send_message(
    auth: AuthUser,
    State(state): State<Arc<AppState>>,
    Path(channel_id): Path<Uuid>,
    Json(req): Json<SendMessageRequest>,
) -> Result<impl IntoResponse, AppError> {
    crate::discreet_premium::require_verified(&auth)?;

    // Per-user + per-channel rate limit: 30/min/channel.
    crate::discreet_rate_limit::check_scoped_rate_limit(&state, &auth.user_id.to_string(), &channel_id.to_string(), "send_message")
        .await.map_err(|(_status, body)| AppError::RateLimited(format!("Message rate limit exceeded. Retry after {}s", body.0["retry_after"].as_u64().unwrap_or(60))))?;

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

    // Look up channel to get server_id and nsfw flag, then verify membership.
    let channel = sqlx::query!(
        "SELECT c.server_id, c.nsfw, c.disappearing_messages, c.read_only,
                c.is_archived AS channel_archived,
                s.disappearing_messages_default, s.is_archived
         FROM channels c
         JOIN servers s ON s.id = c.server_id
         WHERE c.id = $1",
        channel_id,
    )
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::NotFound("Channel not found".into()))?;

    // Archived servers are read-only.
    if channel.is_archived {
        return Err(AppError::Forbidden(
            "This server is archived and read-only. No new messages can be sent.".into(),
        ));
    }

    // Archived channels are read-only.
    if channel.channel_archived {
        return Err(AppError::Forbidden(
            "This channel is archived and read-only.".into(),
        ));
    }

    // Read-only channels: only users with MANAGE_CHANNELS can post.
    if channel.read_only && require_permission(
        &state, channel.server_id, auth.user_id,
        crate::discreet_permissions::PERM_MANAGE_CHANNELS,
    ).await.is_err() {
        return Err(AppError::Forbidden(
            "This is a read-only channel. Only admins and moderators can post.".into(),
        ));
    }

    require_permission(&state, channel.server_id, auth.user_id, PERM_SEND_MESSAGES).await?;

    if req.attachment_blob_id.is_some() {
        require_permission(&state, channel.server_id, auth.user_id, PERM_ATTACH_FILES).await?;
    }

    // Clear auto_response when user sends a message (they're back).
    let _ = sqlx::query!(
        "UPDATE users SET auto_response_message = NULL WHERE id = $1 AND auto_response_message IS NOT NULL",
        auth.user_id,
    )
    .execute(&state.db)
    .await;

    // ── AutoMod check ─────────────────────────────────────────────────────
    // Skip automod for DM and group-DM channels — those are E2EE and private.
    // DM channels live in dm_channels/group_dm_channels, not the channels table,
    // so they won't normally reach here. This guard is belt-and-suspenders.
    //
    // NOTE: content_ciphertext is base64-encoded MLS ciphertext. AutoMod runs
    // against the raw base64 string, which means keyword detection only works
    // for unencrypted bot channels. For E2EE channels, AutoMod rules that
    // inspect content (bad words, links) are ineffective by design — the
    // server cannot read encrypted messages. Structural rules (mentions via
    // @-patterns in ciphertext) may still trigger.
    {
        // Skip automod if this is a DM or group DM channel.
        let is_dm = sqlx::query_scalar!(
            "SELECT EXISTS(SELECT 1 FROM dm_channels WHERE id = $1) OR EXISTS(SELECT 1 FROM group_dm_channels WHERE id = $1)",
            channel_id,
        )
        .fetch_one(&state.db)
        .await
        .ok()
        .flatten()
        .unwrap_or(false);

        if is_dm {
            // DMs are private — skip automod entirely.
        } else {
        let automod_config = load_automod_config(&state.db, channel.server_id).await;
        if automod_config.enabled {
            match check_message(&automod_config, &req.content_ciphertext, channel.nsfw, state.config.federation_domain.as_deref()) {
                AutoModAction::Allow => {}
                AutoModAction::Warn(reason) => {
                    // Allow the message but notify the author via WebSocket.
                    // target_user_id lets the client filter — only the author sees this.
                    state.ws_broadcast(
                        channel.server_id,
                        serde_json::json!({
                            "type": "automod_warn",
                            "target_user_id": auth.user_id,
                            "channel_id": channel_id,
                            "reason": reason,
                        }),
                    ).await;
                }
                AutoModAction::Delete(reason) => {
                    return Err(AppError::Forbidden(
                        format!("Message blocked by AutoMod: {reason}"),
                    ));
                }
            }
        }
        }
    }

    // Store the message. The server never sees plaintext.
    let message_id = Uuid::new_v4();

    // Compute expires_at from effective disappearing messages setting.
    // Priority: channel override > server default > global default. Most restrictive wins.
    let expires_at: Option<chrono::DateTime<chrono::Utc>> = {
        let global_dis = crate::discreet_platform_settings::get_platform_settings(&state)
            .await
            .map(|s| s.global_disappearing_default)
            .unwrap_or_else(|_| "off".into());

        // Collect all non-"off" settings, pick the shortest duration (most restrictive).
        let candidates: Vec<&str> = [
            channel.disappearing_messages.as_deref(),
            channel.disappearing_messages_default.as_deref(),
            Some(global_dis.as_str()),
        ]
        .into_iter()
        .flatten()
        .filter(|s| *s != "off" && !s.is_empty())
        .collect();

        fn to_seconds(s: &str) -> Option<i64> {
            match s {
                "24h" => Some(86_400),
                "7d"  => Some(604_800),
                "30d" => Some(2_592_000),
                _     => None,
            }
        }

        candidates
            .iter()
            .filter_map(|s| to_seconds(s))
            .min()
            .map(|secs| chrono::Utc::now() + chrono::Duration::seconds(secs))
    };

    // ── Mention validation ────────────────────────────────────────────────
    let mentions = req.mentioned_user_ids.clone().unwrap_or_default();
    let everyone_uuid = Uuid::nil(); // 00000000-... means @everyone
    let has_everyone = mentions.contains(&everyone_uuid);

    // Cap individual mentions at 20.
    let raw_individual_mentions: Vec<Uuid> = mentions.iter().filter(|&&id| id != everyone_uuid).copied().collect();
    if raw_individual_mentions.len() > 20 {
        return Err(AppError::BadRequest("Too many mentions — max 20 per message".into()));
    }

    // @everyone / @here: check server-level role permission.
    // If user lacks permission, strip the mention ping (message posts but no notification).
    let here_uuid = Uuid::from_bytes([0,0,0,0, 0,0, 0,0, 0,0, 0,0,0,0,0,1]); // sentinel for @here
    let has_here = mentions.contains(&here_uuid);
    let mut strip_everyone = false;
    let mut strip_here = false;

    if has_everyone || has_here {
        let srv = sqlx::query!(
            "SELECT owner_id, mention_everyone_role, mention_here_role FROM servers WHERE id = $1",
            channel.server_id,
        )
        .fetch_one(&state.db)
        .await?;

        let is_owner = srv.owner_id == auth.user_id;

        // Resolve user's effective role level
        let user_role_level: &str = if is_owner {
            "admin"
        } else {
            // Check if user has admin or moderator role
            let max_pos = sqlx::query_scalar!(
                r#"SELECT COALESCE(MAX(r.position), 0) as "pos!"
                   FROM roles r
                   JOIN member_roles mr ON mr.role_id = r.id
                   WHERE mr.user_id = $1 AND r.server_id = $2"#,
                auth.user_id,
                channel.server_id,
            )
            .fetch_one(&state.db)
            .await
            .unwrap_or(0);
            if max_pos >= 90 { "admin" } else if max_pos >= 50 { "moderator" } else { "everyone" }
        };

        if has_everyone {
            let required = srv.mention_everyone_role.as_str();
            let allowed = match required {
                "everyone" => true,
                "moderator" => user_role_level == "admin" || user_role_level == "moderator",
                _ => user_role_level == "admin",
            };
            if !allowed {
                strip_everyone = true;
            } else {
                // Rate limit: once per 5 min per channel
                let rate_key = format!("mention_everyone:{}:{}:{}", auth.user_id, channel_id, channel.server_id);
                let mut redis_conn = state.redis.clone();
                let count: i64 = crate::discreet_error::redis_or_503(redis::cmd("INCR").arg(&rate_key).query_async(&mut redis_conn).await)?;
                if count == 1 {
                    let _: Result<bool, _> = redis::cmd("EXPIRE").arg(&rate_key).arg(300i64).query_async(&mut redis_conn).await;
                }
                if count > 1 {
                    return Err(AppError::RateLimited("@everyone can only be used once per 5 minutes in this channel".into()));
                }
            }
        }

        if has_here {
            let required = srv.mention_here_role.as_str();
            let allowed = match required {
                "everyone" => true,
                "moderator" => user_role_level == "admin" || user_role_level == "moderator",
                _ => user_role_level == "admin",
            };
            if !allowed {
                strip_here = true;
            }
        }
    }

    // Build final mention list: strip unauthorized @everyone/@here pings
    let effective_mentions: Vec<Uuid> = mentions.iter()
        .filter(|&&id| !(strip_everyone && id == everyone_uuid || strip_here && id == here_uuid))
        .copied()
        .collect();
    // Recompute individual mentions from the effective list
    let individual_mentions: Vec<Uuid> = effective_mentions.iter()
        .filter(|&&id| id != everyone_uuid && id != here_uuid)
        .copied()
        .collect();

    let mentions_json = serde_json::json!(effective_mentions);

    // Validate priority if provided
    if let Some(ref p) = req.priority {
        if !matches!(p.as_str(), "important" | "urgent") {
            return Err(AppError::BadRequest("priority must be 'important' or 'urgent'".into()));
        }
    }

    sqlx::query!(
        "INSERT INTO messages (id, channel_id, author_id, content_ciphertext, mls_epoch, attachment_blob_id, reply_to_id, parent_message_id, mentioned_user_ids, expires_at, priority)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)",
        message_id,
        channel_id,
        auth.user_id,
        &ciphertext_bytes,
        req.mls_epoch,
        req.attachment_blob_id,
        req.reply_to_id,
        req.parent_message_id,
        mentions_json,
        expires_at,
        req.priority,
    )
    .execute(&state.db)
    .await?;

    // Update server last_activity_at.
    let _ = sqlx::query!(
        "UPDATE servers SET last_activity_at = NOW() WHERE id = $1",
        channel.server_id,
    )
    .execute(&state.db)
    .await;

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
                "mentioned_user_ids": effective_mentions,
                "priority": req.priority,
            }),
        )
        .await;

    // Push mention_notification for each mentioned user (excluding sender and
    // members who set notification_level = 'nothing' for this server).
    {
        let muted_uids: Vec<Uuid> = sqlx::query_scalar!(
            "SELECT user_id FROM server_members WHERE server_id = $1 AND notification_level = 'nothing'",
            channel.server_id,
        )
        .fetch_all(&state.db)
        .await
        .unwrap_or_default();

        for &uid in &individual_mentions {
            if uid != auth.user_id && !muted_uids.contains(&uid) {
                state.ws_broadcast(channel.server_id, serde_json::json!({
                    "type": "mention_notification",
                    "channel_id": channel_id,
                    "message_id": message_id,
                    "author_id": auth.user_id,
                    "mentioned_user_id": uid,
                })).await;
            }
        }
    }

    // ── Auto-reply for away/afk users ────────────────────────────────────
    // If a mentioned user has auto_response_message set, broadcast a system
    // auto_reply event. Rate-limited to one per sender×channel×target per 5 min.
    {
        let auto_reply_targets: Vec<Uuid> = individual_mentions
            .iter()
            .copied()
            .filter(|&uid| uid != auth.user_id)
            .collect();

        if !auto_reply_targets.is_empty() {
            let rows = sqlx::query!(
                "SELECT id, username, auto_response_message FROM users
                 WHERE id = ANY($1) AND auto_response_message IS NOT NULL",
                &auto_reply_targets,
            )
            .fetch_all(&state.db)
            .await
            .unwrap_or_default();

            for row in rows {
                if let Some(ref auto_msg) = row.auto_response_message {
                    // Rate limit: one auto-reply per sender→target per channel per 5 min.
                    let rate_key = format!(
                        "auto_reply:{}:{}:{}",
                        auth.user_id, channel_id, row.id
                    );
                    let mut redis_conn = state.redis.clone();
                    let already_sent: bool = redis::cmd("EXISTS")
                        .arg(&rate_key)
                        .query_async(&mut redis_conn)
                        .await
                        .unwrap_or(false);

                    if already_sent {
                        continue;
                    }

                    // Set rate-limit key with 5-minute TTL.
                    let _: Result<(), _> = redis::cmd("SET")
                        .arg(&rate_key)
                        .arg("1")
                        .arg("EX")
                        .arg(300_i64)
                        .query_async(&mut redis_conn)
                        .await;

                    // Broadcast auto_reply as a system event (not stored as a message).
                    state.ws_broadcast(channel.server_id, serde_json::json!({
                        "type": "auto_reply",
                        "channel_id": channel_id,
                        "user_id": row.id,
                        "username": row.username,
                        "message": auto_msg,
                    })).await;
                }
            }
        }
    }

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
                    == crate::discreet_agent_config::MemoryMode::Summary;
                let mut messages = build_context(
                    &state_task.db,
                    task_channel,
                    bot_user_id,
                    cfg.context_message_count,
                    use_summary,
                    state_task.config.agent_key_secret.as_bytes(),
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

    // ── Agent configs auto-response (from agent_configs table) ──
    // Check for enabled agents in this server and trigger if mentioned.
    // Rate limited to 1 response per 5 seconds per channel to prevent loops.
    {
        let agent_configs = sqlx::query!(
            r#"SELECT id, name, provider_type, model, endpoint_url, system_prompt,
                      max_tokens, temperature, encrypted_api_key IS NOT NULL as "has_key!"
               FROM agent_configs
               WHERE server_id = $1 AND enabled = TRUE"#,
            channel.server_id,
        )
        .fetch_all(&state.db)
        .await
        .unwrap_or_default();

        for ac in agent_configs {
            // Simple mention check: @agent_name in the ciphertext (base64-encoded)
            let name_lower = ac.name.to_lowercase();
            let ct_lower = req.content_ciphertext.to_lowercase();
            let mentioned = ct_lower.contains(&format!("@{name_lower}"))
                || ct_lower.contains(&name_lower);

            if !mentioned {
                continue;
            }

            // Rate limit: 1 agent response per 5 seconds per channel
            let agent_rate_key = format!("agent_resp:{}:{}", ac.id, channel_id);
            let mut agent_redis = state.redis.clone();
            let already_responding: bool = redis::cmd("EXISTS")
                .arg(&agent_rate_key)
                .query_async(&mut agent_redis)
                .await
                .unwrap_or(false);

            if already_responding {
                continue;
            }

            // Set rate limit key (5-second TTL)
            let _: Result<String, _> = redis::cmd("SET")
                .arg(&agent_rate_key)
                .arg("1")
                .arg("EX")
                .arg(5_i64)
                .query_async(&mut agent_redis)
                .await;

            let state_task = state.clone();
            let task_channel = channel_id;
            let server_id = channel.server_id;
            let agent_id = ac.id;
            let agent_name = ac.name.clone();
            let provider_type_str = ac.provider_type.clone();
            let model_str = ac.model.clone().unwrap_or_default();
            let endpoint_url = ac.endpoint_url.clone().unwrap_or_default();
            let system_prompt = ac.system_prompt.clone()
                .unwrap_or_else(|| "You are a helpful assistant.".into());
            let max_tokens = ac.max_tokens.unwrap_or(1000) as u32;
            let temperature = ac.temperature.unwrap_or(0.7);

            tokio::spawn(async move {
                // 1-second delay to feel natural
                tokio::time::sleep(std::time::Duration::from_secs(1)).await;

                // Build context from recent messages
                let mut context = build_context(
                    &state_task.db,
                    task_channel,
                    agent_id, // use agent config id as pseudo user_id for role detection
                    20,
                    false,
                    state_task.config.agent_key_secret.as_bytes(),
                ).await.unwrap_or_default();

                // Resolve provider
                let provider_type: crate::discreet_agent_provider::ProviderType = provider_type_str
                    .parse()
                    .unwrap_or(crate::discreet_agent_provider::ProviderType::OpenAi);
                let provider = create_provider(&provider_type);

                // Build model config
                // Decrypt API key from agent_configs if available
                let api_key: Option<String> = {
                    match sqlx::query_scalar!(
                        "SELECT encrypted_api_key FROM agent_configs WHERE id = $1",
                        agent_id,
                    )
                    .fetch_optional(&state_task.db)
                    .await
                    {
                        Ok(Some(Some(blob))) if blob.len() > 12 => {
                            crate::discreet_agent_config::decrypt_api_key(
                                &blob[12..], &blob[..12],
                                state_task.config.agent_key_secret.as_bytes(), &agent_id,
                            ).ok()
                        }
                        _ => None,
                    }
                };

                let model_config = crate::discreet_agent_provider::AgentModelConfig {
                    model_id: model_str,
                    api_key,
                    endpoint_url: if endpoint_url.is_empty() {
                        match provider_type {
                            crate::discreet_agent_provider::ProviderType::Anthropic => "https://api.anthropic.com".into(),
                            crate::discreet_agent_provider::ProviderType::Ollama => "http://localhost:11434".into(),
                            crate::discreet_agent_provider::ProviderType::OpenJarvis => "http://localhost:8000".into(),
                            _ => "https://api.openai.com".into(),
                        }
                    } else {
                        endpoint_url
                    },
                    max_tokens,
                    temperature,
                    timeout_secs: 30,
                    mcp_tool_urls: vec![],
                };

                // Call LLM (with tool use loop — max 1 tool round-trip)
                let mut reply_text = match provider.complete(&system_prompt, context.clone(), &model_config).await {
                    Ok(result) => result.text,
                    Err(e) => {
                        tracing::warn!(
                            agent_id = %agent_id,
                            agent_name = %agent_name,
                            error = %e,
                            "Agent config LLM call failed"
                        );
                        crate::discreet_error_telemetry::log_server_error(
                            &state_task.db,
                            &format!("agent:{agent_name}"),
                            &format!("LLM provider error: {e}"),
                            None,
                            "error",
                        ).await;
                        return;
                    }
                };

                // Check for tool use in the response — execute and re-call LLM
                if let Some(_tool_result) = crate::discreet_agent_tools::process_tool_use(
                    &state_task.db,
                    &reply_text,
                    &mut context,
                    task_channel,
                    server_id,
                    agent_id,
                ).await {
                    // Re-call LLM with tool result appended to context
                    match provider.complete(&system_prompt, context, &model_config).await {
                        Ok(result) => { reply_text = result.text; }
                        Err(e) => {
                            tracing::warn!(agent_id = %agent_id, error = %e, "LLM re-call after tool use failed");
                            // Use tool acknowledgment as fallback reply
                            reply_text = format!("I used a tool but couldn't formulate a final response. Tool: {}", _tool_result.tool_name);
                        }
                    }
                }

                // Store reply as a message (plaintext, epoch 0)
                let reply_id = Uuid::new_v4();
                let content_bytes = reply_text.as_bytes().to_vec();

                if let Err(e) = sqlx::query!(
                    "INSERT INTO messages (id, channel_id, author_id, content_ciphertext, mls_epoch)
                     VALUES ($1, $2, $3, $4, 0)",
                    reply_id,
                    task_channel,
                    agent_id,
                    &content_bytes,
                ).execute(&state_task.db).await {
                    tracing::error!(agent_id = %agent_id, error = %e, "Failed to insert agent reply");
                    return;
                }

                // Broadcast
                state_task.ws_broadcast(server_id, serde_json::json!({
                    "type": "message_create",
                    "channel_id": task_channel,
                    "message_id": reply_id,
                    "author_id": agent_id,
                })).await;

                tracing::info!(
                    agent_id = %agent_id,
                    agent_name = %agent_name,
                    channel_id = %task_channel,
                    "Agent config auto-response sent"
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
            parent_message_id: req.parent_message_id,
            reply_count: Some(0),
            mentioned_user_ids: req.mentioned_user_ids.as_ref().map(|ids| serde_json::json!(ids)),
        }),
    ))
}

// ─── GET /channels/{channel_id}/messages ─────────────────────────────────

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
                    m.reply_to_id, m.parent_message_id, m.mentioned_user_ids,
                    r.content_ciphertext AS \"reply_ciphertext?\",
                    r.author_id AS \"reply_author_id?\",
                    (SELECT COUNT(*) FROM messages c WHERE c.parent_message_id = m.id) AS reply_count
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
            parent_message_id: r.parent_message_id,
            reply_count: r.reply_count,
            mentioned_user_ids: Some(r.mentioned_user_ids),
        })
        .collect()
    } else {
        // Most recent messages (default).
        sqlx::query!(
            "SELECT m.id, m.channel_id, m.author_id, m.content_ciphertext, m.mls_epoch,
                    m.attachment_blob_id, m.edited_at, m.deleted, m.created_at,
                    m.reply_to_id, m.parent_message_id, m.mentioned_user_ids,
                    r.content_ciphertext AS \"reply_ciphertext?\",
                    r.author_id AS \"reply_author_id?\",
                    (SELECT COUNT(*) FROM messages c WHERE c.parent_message_id = m.id) AS reply_count
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
            parent_message_id: r.parent_message_id,
            reply_count: r.reply_count,
            mentioned_user_ids: Some(r.mentioned_user_ids),
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

    // Data retention check: if retention policy is set, messages within the
    // retention window cannot be deleted by users or moderators.
    {
        let settings = crate::discreet_platform_settings::get_platform_settings(&state).await?;
        if settings.default_retention_days > 0 {
            let msg_created = sqlx::query_scalar!(
                "SELECT created_at FROM messages WHERE id = $1",
                message_id,
            )
            .fetch_one(&state.db)
            .await?;
            let retention_end = msg_created + chrono::Duration::days(settings.default_retention_days as i64);
            if retention_end > chrono::Utc::now() {
                return Err(AppError::Forbidden(
                    "This message is within the mandatory data retention period and cannot be deleted. Contact your administrator.".into(),
                ));
            }
        }
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

// ─── POST /channels/{channel_id}/messages/bulk-delete ─────────────────

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
    if let Err(e) = crate::discreet_audit::log_action(
        &state.db,
        crate::discreet_audit::AuditEntry {
            server_id: channel.server_id,
            actor_id: auth.user_id,
            action: "BULK_DELETE_MESSAGES",
            target_type: Some("channel"),
            target_id: Some(channel_id),
            changes: Some(serde_json::json!({
                "count": count,
                "reason": req.reason.as_deref().unwrap_or("Word search & delete"),
            })),
            reason: req.reason.as_deref(),
        },
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

// ─── GET /channels/{channel_id}/messages/search ──────────────────────────

#[derive(Debug, Deserialize)]
pub struct SearchParams {
    pub q: Option<String>,
    #[serde(default = "default_limit")]
    pub limit: i64,
}

/// Search messages in a channel. Since all content is E2EE ciphertext, the
/// server cannot perform plaintext search. Returns a message explaining that
/// search must happen client-side on decrypted content.
pub async fn search_messages(
    auth: AuthUser,
    State(state): State<Arc<AppState>>,
    Path(channel_id): Path<Uuid>,
    Query(params): Query<SearchParams>,
) -> Result<impl IntoResponse, AppError> {
    // Verify channel exists and user has view permission.
    let channel = sqlx::query!(
        "SELECT server_id FROM channels WHERE id = $1",
        channel_id,
    )
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::NotFound("Channel not found".into()))?;

    require_permission(&state, channel.server_id, auth.user_id, PERM_VIEW_CHANNEL).await?;

    let query = params.q.unwrap_or_default().trim().to_string();
    if query.is_empty() {
        return Err(AppError::BadRequest("Search query 'q' is required".into()));
    }

    // All channels use E2EE — server stores only ciphertext and cannot search it.
    Ok(Json(serde_json::json!({
        "encrypted": true,
        "results": [],
        "message": "This channel is end-to-end encrypted. The server cannot search message content. Search is performed client-side on your decrypted messages.",
        "total": 0
    })))
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

// ─── GET /messages/{id}/thread ─────────────────────────────────────────

pub async fn get_thread_replies(
    auth: AuthUser,
    State(state): State<Arc<AppState>>,
    Path(message_id): Path<Uuid>,
) -> Result<impl IntoResponse, AppError> {
    // Look up the parent message to find its channel → server → verify membership.
    let parent = sqlx::query!(
        "SELECT m.channel_id, c.server_id FROM messages m JOIN channels c ON c.id = m.channel_id WHERE m.id = $1",
        message_id,
    )
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::NotFound("Message not found".into()))?;

    require_permission(&state, parent.server_id, auth.user_id, PERM_VIEW_CHANNEL).await?;

    let replies = sqlx::query!(
        "SELECT m.id, m.channel_id, m.author_id, m.content_ciphertext, m.mls_epoch,
                m.attachment_blob_id, m.edited_at, m.deleted, m.created_at,
                m.reply_to_id, m.parent_message_id, m.mentioned_user_ids,
                r.content_ciphertext AS \"reply_ciphertext?\",
                r.author_id AS \"reply_author_id?\"
         FROM messages m
         LEFT JOIN messages r ON m.reply_to_id = r.id
         WHERE m.parent_message_id = $1
         ORDER BY m.created_at ASC
         LIMIT 100",
        message_id,
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
        parent_message_id: r.parent_message_id,
        reply_count: None,
        mentioned_user_ids: Some(r.mentioned_user_ids),
    })
    .collect::<Vec<_>>();

    Ok(Json(replies))
}

// ─── Route Registration ─────────────────────────────────────────────────

pub fn message_routes() -> axum::Router<Arc<AppState>> {
    use axum::routing::{delete, get, patch, post};
    axum::Router::new()
        .route("/channels/{channel_id}/messages", post(send_message))
        .route("/channels/{channel_id}/messages", get(get_messages))
        .route("/channels/{channel_id}/messages/search", get(search_messages))
        .route("/channels/{channel_id}/messages/bulk-delete", post(bulk_delete_messages))
        .route("/messages/{id}", patch(edit_message))
        .route("/messages/{id}", delete(delete_message))
        .route("/messages/{id}/thread", get(get_thread_replies))
}
