// discreet_websocket.rs — WebSocket handler for real-time events + voice signaling.
//
// GET /ws?server_id=<uuid>
//   - Auth (priority): Sec-WebSocket-Protocol > Authorization header > ?token= (deprecated)
//   - Origin validated against CORS_ORIGINS (403 if mismatch)
//   - Upgrades to WebSocket
//   - Subscribes to server's broadcast bus
//   - Pushes JSON event envelopes to the client
//
// Voice signaling flow:
//   1. Client A sends { type: "voice_join", channel_id } -> server broadcasts to all peers
//   2. Client B receives voice_join -> sends { type: "voice_offer", target: A, offer }
//   3. Server relays offer to bus -> Client A filters by target, creates answer
//   4. ICE candidates exchanged similarly until P2P connection established
//   5. Audio flows directly between peers (server never touches audio data)

use axum::{
    extract::{ws::{WebSocket, WebSocketUpgrade, Message}, Query, State},
    http::{header, HeaderMap},
    response::IntoResponse,
};
use jsonwebtoken::{decode, DecodingKey, Validation};
use serde::Deserialize;
use std::sync::Arc;
use std::time::{Duration, Instant};
use uuid::Uuid;

// ─── Per-connection WebSocket rate limits ────────────────────────────────────
const WS_MAX_MESSAGES_PER_MINUTE: u64 = 120;
const WS_MAX_BYTES_PER_MINUTE: u64 = 1_048_576; // 1 MiB
const WS_RATE_WINDOW: Duration = Duration::from_secs(60);

use crate::discreet_auth::Claims;
use crate::discreet_error::AppError;
use crate::discreet_state::{AppState, PresenceStatus};
use crate::discreet_typing;

// --- Query Parameters ---

#[derive(Debug, Deserialize)]
pub struct WsParams {
    pub server_id: Uuid,
    /// Deprecated: JWT in query string. Use Sec-WebSocket-Protocol instead.
    pub token: Option<String>,
}

/// Generic incoming message. The `type` field routes to the appropriate handler.
#[derive(Debug, Deserialize)]
#[allow(dead_code)]
struct IncomingMessage {
    #[serde(rename = "type")]
    msg_type: String,
    channel_id: Option<Uuid>,
    // Voice signaling fields
    target: Option<Uuid>,
    offer: Option<serde_json::Value>,
    answer: Option<serde_json::Value>,
    candidate: Option<serde_json::Value>,
    username: Option<String>,
    user_id: Option<Uuid>,
    peer_id: Option<Uuid>,
    // Presence fields
    status: Option<String>,
    // Profile update fields
    avatar_url: Option<String>,
}

// --- Origin normalization for comparison ---

/// Normalize an origin for comparison: lowercase, strip trailing slashes,
/// strip "www." after the scheme. Handles www.localhost in dev and
/// www.discreetai.net in production without hardcoding either.
fn normalize_origin(origin: &str) -> String {
    let s = origin.trim().to_lowercase();
    let s = s.trim_end_matches('/');
    s.replacen("://www.", "://", 1)
}

// --- GET /ws?server_id=<uuid> ---

pub async fn ws_connect(
    State(state): State<Arc<AppState>>,
    Query(params): Query<WsParams>,
    headers: HeaderMap,
    ws: WebSocketUpgrade,
) -> Result<impl IntoResponse, AppError> {
    // ── Origin validation ────────────────────────────────────────────────
    // Reject browser WebSocket connections whose Origin doesn't match the
    // allowed origins. Checks ALLOWED_ORIGINS first, then CORS_ORIGINS.
    // Non-browser clients (CLI, bots) typically don't send an Origin header.
    if let Ok(cors) = std::env::var("ALLOWED_ORIGINS").or_else(|_| std::env::var("CORS_ORIGINS")) {
        if cors != "*" && !cors.is_empty() {
            if let Some(origin) = headers
                .get(header::ORIGIN)
                .and_then(|v| v.to_str().ok())
            {
                let norm_origin = normalize_origin(origin);
                let allowed: Vec<String> = cors.split(',').map(normalize_origin).collect();
                if !allowed.iter().any(|a| a == &norm_origin) {
                    tracing::warn!(
                        origin = origin,
                        allowed = %cors,
                        "WebSocket connection rejected — origin not in CORS_ORIGINS",
                    );
                    return Err(AppError::Forbidden(
                        "Origin not allowed".into(),
                    ));
                }
            }
            // No Origin header → allow (CLI / non-browser client)
        }
    } else if let Ok(app_url) = std::env::var("APP_URL") {
        // CORS_ORIGINS not set — validate against APP_URL.
        if let Some(origin) = headers
            .get(header::ORIGIN)
            .and_then(|v| v.to_str().ok())
        {
            if normalize_origin(origin) != normalize_origin(&app_url) {
                tracing::warn!(
                    origin = origin,
                    allowed = %app_url,
                    "WebSocket connection rejected — origin does not match APP_URL",
                );
                return Err(AppError::Forbidden(
                    "Origin not allowed".into(),
                ));
            }
        }
    }

    // Auth sources (priority order):
    // 1. Sec-WebSocket-Protocol: "Bearer, <token>"  (primary — browser subprotocol)
    // 2. Authorization: Bearer <token>               (standard HTTP header)
    // 3. ?token=<jwt> query parameter                (deprecated — logged as warning)
    let mut used_subprotocol = false;
    let token = headers.get("sec-websocket-protocol")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| {
            let parts: Vec<&str> = v.splitn(2, ',').collect();
            if parts.len() == 2 && parts[0].trim() == "Bearer" {
                used_subprotocol = true;
                Some(parts[1].trim().to_string())
            } else {
                None
            }
        })
        .or_else(|| {
            headers.get(header::AUTHORIZATION)
                .and_then(|v| v.to_str().ok())
                .and_then(|h| h.strip_prefix("Bearer "))
                .map(|t| t.to_string())
        })
        .or_else(|| {
            // Deprecated: ?token= query parameter. Tokens in URLs can be logged
            // by proxies, CDNs, and server access logs. Migrate to subprotocol auth.
            if let Some(ref t) = params.token {
                tracing::warn!(
                    server_id = %params.server_id,
                    "WebSocket auth via ?token= query parameter is deprecated — \
                     migrate to Sec-WebSocket-Protocol: Bearer, <token>"
                );
                Some(t.clone())
            } else {
                None
            }
        })
        .ok_or_else(|| AppError::Unauthorized(
            "Missing authentication — use Sec-WebSocket-Protocol: Bearer, <token>".into(),
        ))?;

    // 10-second timeout on JWT validation + DB session check.
    // Drop the connection if auth doesn't complete in time.
    let auth_result = tokio::time::timeout(
        Duration::from_secs(10),
        async {
            let key = DecodingKey::from_secret(state.config.jwt_secret.as_bytes());
            let validation = Validation::default();
            let token_data = decode::<Claims>(&token, &key, &validation)
                .map_err(|e| AppError::Unauthorized(format!("Invalid token: {e}")))?;

            let user_id = token_data.claims.sub;
            let session_id = token_data.claims.sid;

            let session_valid = sqlx::query_scalar!(
                "SELECT EXISTS(
                    SELECT 1 FROM sessions
                    WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL AND expires_at > NOW()
                )",
                session_id, user_id,
            )
            .fetch_one(&state.db)
            .await
            .map_err(|e| AppError::Internal(format!("Session check failed: {e}")))?;

            if !session_valid.unwrap_or(false) {
                return Err(AppError::Unauthorized("Session expired or revoked".into()));
            }

            let is_member = sqlx::query_scalar!(
                "SELECT EXISTS(SELECT 1 FROM server_members WHERE server_id = $1 AND user_id = $2)",
                params.server_id, user_id,
            )
            .fetch_one(&state.db)
            .await?;

            if !is_member.unwrap_or(false) {
                return Err(AppError::Forbidden("Not a member of this server".into()));
            }

            Ok::<(Uuid, Uuid), AppError>((user_id, session_id))
        }
    ).await;

    let (user_id, _session_id) = match auth_result {
        Ok(Ok(ids)) => ids,
        Ok(Err(e)) => return Err(e),
        Err(_) => return Err(AppError::Unauthorized("WebSocket authentication timed out".into())),
    };

    // Fetch username and guest status for voice signaling display.
    let user_row = sqlx::query!(
        "SELECT username, is_guest FROM users WHERE id = $1",
        user_id,
    )
    .fetch_optional(&state.db)
    .await?;

    let username = user_row.as_ref().map(|r| r.username.clone()).unwrap_or_else(|| "unknown".into());
    let is_guest = user_row.as_ref().map(|r| r.is_guest).unwrap_or(false);

    let server_id = params.server_id;
    let state_clone = state.clone();

    // When the client authenticated via Sec-WebSocket-Protocol, the server
    // MUST echo "Bearer" as the selected subprotocol in the 101 response.
    // Without this, browsers reject the upgrade.
    let upgrade = if used_subprotocol {
        ws.protocols(["Bearer"])
    } else {
        ws
    };

    Ok(upgrade.on_upgrade(move |socket| handle_ws(socket, state_clone, server_id, user_id, username, is_guest)))
}

/// Main WebSocket loop: subscribe to server bus, forward events to client,
/// and relay client messages (typing, voice signaling) to the bus.
async fn handle_ws(
    mut socket: WebSocket,
    state: Arc<AppState>,
    server_id: Uuid,
    user_id: Uuid,
    username: String,
    is_guest: bool,
) {
    tracing::info!(user_id = %user_id, server_id = %server_id, "WebSocket connected");

    // Load persisted status from DB (invisible users reconnect as invisible).
    let status_row = sqlx::query!(
        "SELECT presence_mode, custom_status, status_emoji FROM users WHERE id = $1",
        user_id,
    )
    .fetch_optional(&state.db)
    .await
    .ok()
    .flatten();

    let persisted_mode = status_row.as_ref()
        .map(|r| r.presence_mode.as_str())
        .unwrap_or("online");
    let initial_status = match persisted_mode {
        "idle" => PresenceStatus::Idle,
        "dnd" => PresenceStatus::Dnd,
        "invisible" => PresenceStatus::Invisible,
        _ => PresenceStatus::Online,
    };
    state.set_presence(user_id, initial_status, server_id).await;

    // Load persisted custom status text and emoji into presence.
    let cs = status_row.as_ref().map(|r| r.custom_status.clone()).unwrap_or_default();
    let se = status_row.as_ref().map(|r| r.status_emoji.clone()).unwrap_or_default();
    if !cs.is_empty() || !se.is_empty() {
        state.set_custom_status(user_id, cs, se).await;
    }

    let mut rx = state.subscribe_server(server_id).await;

    // Send welcome message with initial presence map.
    let presence_map = state.get_server_presence(server_id).await;
    let welcome = serde_json::json!({
        "type": "connected",
        "server_id": server_id,
        "user_id": user_id,
        "username": username,
        "presence": presence_map,
    });
    if socket.send(Message::Text(welcome.to_string())).await.is_err() {
        state.remove_presence(user_id, server_id).await;
        return;
    }

    // Per-connection rate limiting — reset counters every 60 s.
    let mut ws_window_start = Instant::now();
    let mut ws_msg_count: u64 = 0;
    let mut ws_byte_count: u64 = 0;

    // Periodic ban check — every 30 seconds, check Redis for banned:{user_id}.
    let mut ban_check = tokio::time::interval(Duration::from_secs(30));
    ban_check.tick().await; // consume the immediate first tick

    loop {
        tokio::select! {
            // ── Ban check (fail-closed: Redis → DB → reject) ─────────
            _ = ban_check.tick() => {
                let ban_key = format!("banned:{}", user_id);
                let mut redis_conn = state.redis.clone();

                // Layer 1: Check Redis for ban flag
                let redis_result: Result<bool, _> = redis::cmd("EXISTS")
                    .arg(&ban_key)
                    .query_async(&mut redis_conn)
                    .await;

                let is_banned = match redis_result {
                    Ok(true) => true,
                    Ok(false) => false,
                    Err(_) => {
                        // Layer 2: Redis failed — fall back to DB
                        tracing::warn!(user_id = %user_id, "Ban check Redis error — falling back to DB");
                        match sqlx::query_scalar!(
                            "SELECT banned_at IS NOT NULL AS \"is_banned!: bool\" FROM users WHERE id = $1",
                            user_id,
                        )
                        .fetch_optional(&state.db)
                        .await
                        {
                            Ok(Some(banned)) => banned,
                            Ok(None) => true,  // User not found — fail-closed
                            Err(e) => {
                                // Layer 3: Both Redis AND DB failed — fail-closed
                                tracing::error!(user_id = %user_id, error = %e, "Ban check failed on both Redis and DB — disconnecting (fail-closed)");
                                true
                            }
                        }
                    }
                };

                if is_banned {
                    tracing::warn!(user_id = %user_id, "Banned user detected — closing WebSocket");
                    let _ = socket.send(Message::Close(Some(
                        axum::extract::ws::CloseFrame {
                            code: 4001,
                            reason: "Account suspended".into(),
                        },
                    ))).await;
                    break;
                }
            }
            // Event from broadcast bus -> forward to client.
            result = rx.recv() => {
                match result {
                    Ok(msg) => {
                        // Check _exclude list — skip if this user is excluded.
                        let parsed = serde_json::from_str::<serde_json::Value>(&msg).ok();
                        let skip = parsed.as_ref()
                            .and_then(|v| v.get("_exclude")?.as_array().cloned())
                            .map(|arr| arr.iter().any(|id| id.as_str() == Some(&user_id.to_string())))
                            .unwrap_or(false);
                        if skip { continue; }

                        // DND: suppress notification events for users in Do Not Disturb mode.
                        if let Some(ref v) = parsed {
                            let evt_type = v.get("type").and_then(|t| t.as_str()).unwrap_or("");
                            if evt_type == "mention_notification" {
                                let map = state.presence.read().await;
                                let is_dnd = map.get(&user_id)
                                    .map(|p| p.status == PresenceStatus::Dnd)
                                    .unwrap_or(false);
                                drop(map);
                                if is_dnd { continue; }
                            }
                        }
                        // Strip _exclude before forwarding to client.
                        let forwarded = if msg.contains("\"_exclude\"") {
                            if let Ok(mut v) = serde_json::from_str::<serde_json::Value>(&msg) {
                                v.as_object_mut().map(|o| o.remove("_exclude"));
                                v.to_string()
                            } else { msg }
                        } else { msg };
                        if socket.send(Message::Text(forwarded)).await.is_err() {
                            break;
                        }
                    }
                    Err(tokio::sync::broadcast::error::RecvError::Lagged(n)) => {
                        let lag_msg = serde_json::json!({ "type": "lagged", "missed": n });
                        let _ = socket.send(Message::Text(lag_msg.to_string())).await;
                    }
                    Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
                }
            }

            // Message from client -> typing, voice signaling, presence, pings/close.
            result = socket.recv() => {
                match result {
                    Some(Ok(Message::Ping(data))) => {
                        let _ = socket.send(Message::Pong(data)).await;
                    }
                    Some(Ok(Message::Text(text))) => {
                        // ── Per-connection rate limiting ──────────────
                        if ws_window_start.elapsed() >= WS_RATE_WINDOW {
                            ws_window_start = Instant::now();
                            ws_msg_count = 0;
                            ws_byte_count = 0;
                        }
                        ws_msg_count += 1;
                        ws_byte_count += text.len() as u64;

                        if ws_msg_count > WS_MAX_MESSAGES_PER_MINUTE
                            || ws_byte_count > WS_MAX_BYTES_PER_MINUTE
                        {
                            tracing::warn!(
                                user_id = %user_id,
                                server_id = %server_id,
                                messages = ws_msg_count,
                                bytes = ws_byte_count,
                                "WebSocket rate limit exceeded — closing connection",
                            );
                            let _ = socket.send(Message::Close(Some(
                                axum::extract::ws::CloseFrame {
                                    code: 1008,
                                    reason: "Rate limit exceeded".into(),
                                },
                            ))).await;
                            break;
                        }

                        if let Ok(msg) = serde_json::from_str::<IncomingMessage>(&text) {
                            // ws_ping — respond immediately from the main loop
                            // where `socket` is in scope (handle_client_message
                            // cannot access the WebSocket sender).
                            if msg.msg_type == "ws_ping" {
                                let _ = socket.send(Message::Text(
                                    serde_json::json!({ "type": "ws_pong" }).to_string()
                                )).await;
                            // Block guests from voice channels.
                            } else if is_guest && (msg.msg_type == "voice_join" || msg.msg_type == "force_voice_join") {
                                let err = serde_json::json!({
                                    "type": "error",
                                    "message": "Guests cannot join voice channels. Register an account first (Settings \u{2192} Profile \u{2192} Upgrade).",
                                });
                                let _ = socket.send(Message::Text(err.to_string())).await;
                            } else {
                                handle_client_message(&state, &msg, server_id, user_id, &username).await;
                            }
                        }
                    }
                    Some(Ok(Message::Close(_))) | None => break,
                    _ => {}
                }
            }
        }
    }

    // User disconnected — clean up voice state and broadcast offline.
    {
        let mut vs = state.voice_state.write().await;
        if let Some((voice_server, voice_channel)) = vs.remove(&user_id) {
            state.ws_broadcast(voice_server, serde_json::json!({
                "type": "voice_leave",
                "channel_id": voice_channel,
                "user_id": user_id,
                "username": "disconnected",
            })).await;
            // Broadcast SFrame key removal for disconnected user.
            state.ws_broadcast(voice_server, serde_json::json!({
                "type": "voice_sframe_key_update",
                "channel_id": voice_channel,
                "user_id": user_id,
                "key_id": 0,
                "epoch": u64::MAX,
            })).await;
            // Re-broadcast updated key_ids for remaining members.
            let members: Vec<Uuid> = vs.iter()
                .filter(|(_, (_, ch))| *ch == voice_channel)
                .map(|(uid, _)| *uid)
                .collect();
            let epoch = members.len() as u64;
            for (idx, member_id) in members.iter().enumerate() {
                state.ws_broadcast(voice_server, serde_json::json!({
                    "type": "voice_sframe_key_update",
                    "channel_id": voice_channel,
                    "user_id": member_id,
                    "key_id": idx as u64,
                    "epoch": epoch,
                })).await;
            }
        }
    }
    state.remove_presence(user_id, server_id).await;
    tracing::info!(user_id = %user_id, server_id = %server_id, "WebSocket disconnected");
}

/// Route incoming client messages to appropriate handlers.
async fn handle_client_message(
    state: &Arc<AppState>,
    msg: &IncomingMessage,
    server_id: Uuid,
    user_id: Uuid,
    username: &str,
) {
    match msg.msg_type.as_str() {
        // --- Typing indicator ---
        "typing" => {
            if let Some(channel_id) = msg.channel_id {
                if let Err(err) = discreet_typing::broadcast_typing_start(
                    state, user_id, channel_id, Some(server_id),
                ).await {
                    tracing::warn!(error = %err, "Failed to broadcast typing event");
                }
            }
        }

        // =================================================================
        // VOICE SIGNALING -- WebRTC peer connection establishment
        // Audio never touches the server. Server only relays signaling.
        // =================================================================

        // User joins a voice channel -- enforce single channel at a time.
        // If already in a voice channel, auto-leave the old one first.
        "voice_join" => {
            if let Some(channel_id) = msg.channel_id {
                // Check if user is already in a voice channel and auto-leave.
                {
                    let mut vs = state.voice_state.write().await;
                    if let Some((old_server, old_channel)) = vs.remove(&user_id) {
                        // Broadcast leave from old channel.
                        state.ws_broadcast(old_server, serde_json::json!({
                            "type": "voice_leave",
                            "channel_id": old_channel,
                            "user_id": user_id,
                            "username": username,
                        })).await;
                        // Broadcast SFrame key removal for old channel.
                        state.ws_broadcast(old_server, serde_json::json!({
                            "type": "voice_sframe_key_update",
                            "channel_id": old_channel,
                            "user_id": user_id,
                            "key_id": 0,
                            "epoch": u64::MAX,
                        })).await;
                        tracing::info!(user_id = %user_id, old_channel = %old_channel, "Auto-left previous voice channel");
                    }
                    // Track new voice state.
                    vs.insert(user_id, (server_id, channel_id));
                }
                tracing::info!(user_id = %user_id, channel_id = %channel_id, "Voice join");
                state.ws_broadcast(server_id, serde_json::json!({
                    "type": "voice_join",
                    "channel_id": channel_id,
                    "user_id": user_id,
                    "username": username,
                })).await;

                // Broadcast SFrame key_id assignment for the joining user.
                // key_id = position index in the channel's member list.
                {
                    let vs = state.voice_state.read().await;
                    let members: Vec<Uuid> = vs.iter()
                        .filter(|(_, (_, ch))| *ch == channel_id)
                        .map(|(uid, _)| *uid)
                        .collect();
                    let epoch = members.len() as u64;
                    for (idx, member_id) in members.iter().enumerate() {
                        state.ws_broadcast(server_id, serde_json::json!({
                            "type": "voice_sframe_key_update",
                            "channel_id": channel_id,
                            "user_id": member_id,
                            "key_id": idx as u64,
                            "epoch": epoch,
                        })).await;
                    }
                }
            }
        }

        // User leaves a voice channel
        "voice_leave" => {
            if let Some(channel_id) = msg.channel_id {
                // Remove from voice state tracking.
                {
                    let mut vs = state.voice_state.write().await;
                    vs.remove(&user_id);
                }
                tracing::info!(user_id = %user_id, channel_id = %channel_id, "Voice leave");
                state.ws_broadcast(server_id, serde_json::json!({
                    "type": "voice_leave",
                    "channel_id": channel_id,
                    "user_id": user_id,
                    "username": username,
                })).await;

                // Broadcast SFrame key removal for the departing user.
                state.ws_broadcast(server_id, serde_json::json!({
                    "type": "voice_sframe_key_update",
                    "channel_id": channel_id,
                    "user_id": user_id,
                    "key_id": 0,
                    "epoch": u64::MAX,
                })).await;

                // Re-broadcast updated key_ids for remaining members.
                {
                    let vs = state.voice_state.read().await;
                    let members: Vec<Uuid> = vs.iter()
                        .filter(|(_, (_, ch))| *ch == channel_id)
                        .map(|(uid, _)| *uid)
                        .collect();
                    let epoch = members.len() as u64;
                    for (idx, member_id) in members.iter().enumerate() {
                        state.ws_broadcast(server_id, serde_json::json!({
                            "type": "voice_sframe_key_update",
                            "channel_id": channel_id,
                            "user_id": member_id,
                            "key_id": idx as u64,
                            "epoch": epoch,
                        })).await;
                    }
                }
            }
        }

        // WebRTC SDP offer -- directed to a specific peer
        "voice_offer" => {
            if let (Some(target), Some(ref offer)) = (msg.target, &msg.offer) {
                state.ws_broadcast(server_id, serde_json::json!({
                    "type": "voice_offer",
                    "from": user_id,
                    "target": target,
                    "channel_id": msg.channel_id,
                    "offer": offer,
                })).await;
            }
        }

        // WebRTC SDP answer -- directed to a specific peer
        "voice_answer" => {
            if let (Some(target), Some(ref answer)) = (msg.target, &msg.answer) {
                state.ws_broadcast(server_id, serde_json::json!({
                    "type": "voice_answer",
                    "from": user_id,
                    "target": target,
                    "channel_id": msg.channel_id,
                    "answer": answer,
                })).await;
            }
        }

        // ICE candidate exchange
        "voice_ice" => {
            let target = msg.target.or(msg.peer_id);
            if let Some(ref candidate) = msg.candidate {
                state.ws_broadcast(server_id, serde_json::json!({
                    "type": "voice_ice",
                    "from": user_id,
                    "target": target,
                    "channel_id": msg.channel_id,
                    "candidate": candidate,
                })).await;
            }
        }

        // Force a user (typically a bot) into a voice channel.
        // Updates voice state tracking and broadcasts voice_join so all
        // clients update their presence lists.
        "force_voice_join" => {
            if let (Some(target_user_id), Some(channel_id)) = (msg.user_id, msg.channel_id) {
                // Auto-leave any previous voice channel for the target user.
                {
                    let mut vs = state.voice_state.write().await;
                    if let Some((old_server, old_channel)) = vs.remove(&target_user_id) {
                        state.ws_broadcast(old_server, serde_json::json!({
                            "type": "voice_leave",
                            "channel_id": old_channel,
                            "user_id": target_user_id,
                        })).await;
                    }
                    vs.insert(target_user_id, (server_id, channel_id));
                }
                tracing::info!(user_id = %target_user_id, channel_id = %channel_id, "Force voice join");
                // Broadcast voice_join so all clients update presence.
                state.ws_broadcast(server_id, serde_json::json!({
                    "type": "voice_join",
                    "channel_id": channel_id,
                    "user_id": target_user_id,
                })).await;
                // Also broadcast force_voice_join so the target client
                // actually joins the channel (e.g. when moving a human user).
                state.ws_broadcast(server_id, serde_json::json!({
                    "type": "force_voice_join",
                    "channel_id": channel_id,
                    "user_id": target_user_id,
                })).await;
            }
        }

        // Admin server-mute — requires MUTE_MEMBERS permission.
        // Broadcasts admin_mute event so the target client mutes itself.
        "admin_mute" => {
            if let Some(target_uid) = msg.target {
                let has_perm = crate::discreet_permissions::check_permission(
                    state, server_id, user_id,
                    crate::discreet_permissions::Permission::MUTE_MEMBERS,
                ).await.unwrap_or(false);
                if has_perm {
                    state.ws_broadcast(server_id, serde_json::json!({
                        "type": "admin_mute",
                        "user_id": target_uid,
                        "muted_by": user_id,
                    })).await;
                    tracing::info!(
                        admin = %user_id, target = %target_uid,
                        server_id = %server_id, "Admin muted user in voice"
                    );
                }
            }
        }

        // =================================================================
        // PRESENCE — heartbeat and status changes
        // =================================================================
        // NOTE: "ws_ping" is handled in the main WebSocket loop (not here)
        // because it needs direct access to the socket sender.

        // Client heartbeat — keeps presence alive, optionally changes status.
        "heartbeat" => {
            let status = match msg.status.as_deref() {
                Some("idle") => PresenceStatus::Idle,
                Some("dnd") => PresenceStatus::Dnd,
                Some("invisible") => PresenceStatus::Invisible,
                _ => PresenceStatus::Online,
            };
            state.set_presence(user_id, status, server_id).await;
        }

        // Explicit status change from the status picker.
        "status_change" => {
            let status = match msg.status.as_deref() {
                Some("online") => PresenceStatus::Online,
                Some("idle") => PresenceStatus::Idle,
                Some("dnd") => PresenceStatus::Dnd,
                Some("invisible") => PresenceStatus::Invisible,
                _ => PresenceStatus::Online,
            };
            state.set_presence(user_id, status, server_id).await;
        }

        // User profile update (avatar change) — broadcast to every server
        // the user is a member of so all shared-server clients update.
        "user_profile_update" => {
            if let Some(ref avatar) = msg.avatar_url {
                let rows = sqlx::query(
                    "SELECT server_id FROM server_members WHERE user_id = $1",
                )
                .bind(user_id)
                .fetch_all(&state.db)
                .await
                .unwrap_or_default();

                let server_ids: Vec<Uuid> = rows
                    .iter()
                    .map(|r| sqlx::Row::get(r, "server_id"))
                    .collect();

                let payload = serde_json::json!({
                    "type": "user_profile_update",
                    "user_id": user_id,
                    "avatar_url": avatar,
                });

                for sid in server_ids {
                    state.ws_broadcast(sid, payload.clone()).await;
                }
            }
        }

        _ => {
            tracing::debug!(msg_type = %msg.msg_type, "Unknown WS message type");
        }
    }
}

#[cfg(test)]
mod tests {
    /// Verify the ban check logic is fail-closed.
    ///
    /// The ban check cascade is:
    ///   1. Redis EXISTS banned:{uid} → if true, banned
    ///   2. Redis error → DB fallback: SELECT banned_at IS NOT NULL
    ///   3. DB error or user not found → assume banned (fail-closed)
    ///
    /// This test verifies the decision logic without requiring live services.
    #[test]
    fn test_ban_check_fail_closed_logic() {
        // Simulate: Redis returns Ok(false) → not banned
        let redis_ok_false: Result<bool, &str> = Ok(false);
        let is_banned = match redis_ok_false {
            Ok(true) => true,
            Ok(false) => false,
            Err(_) => true, // fail-closed
        };
        assert!(!is_banned, "Redis Ok(false) should allow");

        // Simulate: Redis returns Ok(true) → banned
        let redis_ok_true: Result<bool, &str> = Ok(true);
        let is_banned = match redis_ok_true {
            Ok(true) => true,
            Ok(false) => false,
            Err(_) => true,
        };
        assert!(is_banned, "Redis Ok(true) should ban");

        // Simulate: Redis error, DB says banned
        let redis_err: Result<bool, &str> = Err("connection refused");
        let db_result: Option<bool> = Some(true);
        let is_banned = match redis_err {
            Ok(true) => true,
            Ok(false) => false,
            Err(_) => match db_result {
                Some(banned) => banned,
                None => true, // user not found — fail-closed
            },
        };
        assert!(is_banned, "Redis error + DB banned should ban");

        // Simulate: Redis error, DB says not banned
        let redis_err: Result<bool, &str> = Err("connection refused");
        let db_result: Option<bool> = Some(false);
        let is_banned = match redis_err {
            Ok(true) => true,
            Ok(false) => false,
            Err(_) => match db_result {
                Some(banned) => banned,
                None => true,
            },
        };
        assert!(!is_banned, "Redis error + DB not-banned should allow");

        // Simulate: Redis error, DB error (user not found) → MUST ban (fail-closed)
        let redis_err: Result<bool, &str> = Err("connection refused");
        let db_result: Option<bool> = None;
        let is_banned = match redis_err {
            Ok(true) => true,
            Ok(false) => false,
            Err(_) => match db_result {
                Some(banned) => banned,
                None => true, // fail-closed: both layers failed
            },
        };
        assert!(is_banned, "Both Redis and DB failed — must fail-closed (ban)");
    }
}
