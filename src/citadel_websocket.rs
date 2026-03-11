// citadel_websocket.rs — WebSocket handler for real-time events + voice signaling.
//
// GET /ws?server_id=<uuid>
//   - Requires Authorization: Bearer <JWT>
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
use uuid::Uuid;

use crate::citadel_auth::Claims;
use crate::citadel_error::AppError;
use crate::citadel_state::{AppState, PresenceStatus};
use crate::citadel_typing;

// --- Query Parameters ---

#[derive(Debug, Deserialize)]
pub struct WsParams {
    pub server_id: Uuid,
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
}

// --- GET /ws?server_id=<uuid> ---

pub async fn ws_connect(
    State(state): State<Arc<AppState>>,
    Query(params): Query<WsParams>,
    headers: HeaderMap,
    ws: WebSocketUpgrade,
) -> Result<impl IntoResponse, AppError> {
    // Try multiple auth sources:
    // 1. Authorization header (standard HTTP)
    // 2. Sec-WebSocket-Protocol header (browser WebSocket subprotocol)
    // 3. Token query parameter (fallback)
    let token = headers
        .get(header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .and_then(|h| h.strip_prefix("Bearer "))
        .map(|t| t.to_string())
        .or_else(|| {
            // Check Sec-WebSocket-Protocol: "Bearer, <token>"
            headers.get("sec-websocket-protocol")
                .and_then(|v| v.to_str().ok())
                .and_then(|v| {
                    let parts: Vec<&str> = v.splitn(2, ',').collect();
                    if parts.len() == 2 && parts[0].trim() == "Bearer" {
                        Some(parts[1].trim().to_string())
                    } else {
                        None
                    }
                })
        })
        .or_else(|| params.token.clone())
        .ok_or_else(|| AppError::Unauthorized("Missing authentication".into()))?;

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

    // Fetch username and guest status for voice signaling display.
    let user_row = sqlx::query!(
        "SELECT username, is_guest FROM users WHERE id = $1",
        user_id,
    )
    .fetch_optional(&state.db)
    .await?;

    let username = user_row.as_ref().map(|r| r.username.clone()).unwrap_or_else(|| "unknown".into());
    let is_guest = user_row.as_ref().and_then(|r| r.is_guest).unwrap_or(false);

    let server_id = params.server_id;
    let state_clone = state.clone();

    Ok(ws.on_upgrade(move |socket| handle_ws(socket, state_clone, server_id, user_id, username, is_guest)))
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

    // Set user online and broadcast presence to all peers.
    state.set_presence(user_id, PresenceStatus::Online, server_id).await;

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

    loop {
        tokio::select! {
            // Event from broadcast bus -> forward to client.
            result = rx.recv() => {
                match result {
                    Ok(msg) => {
                        if socket.send(Message::Text(msg)).await.is_err() {
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
                        if let Ok(msg) = serde_json::from_str::<IncomingMessage>(&text) {
                            // Block guests from voice channels.
                            if is_guest && (msg.msg_type == "voice_join" || msg.msg_type == "force_voice_join") {
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
                if let Err(err) = citadel_typing::broadcast_typing_start(
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

        // =================================================================
        // PRESENCE — heartbeat and status changes
        // =================================================================

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

        _ => {
            tracing::debug!(msg_type = %msg.msg_type, "Unknown WS message type");
        }
    }
}
