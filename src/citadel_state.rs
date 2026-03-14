// citadel_state.rs — Shared application state injected into all handlers.
//
// Axum passes Arc<AppState> to every handler via State extractor.
// This is the single source of truth for database pools, Redis,
// WebSocket connections, and runtime configuration.

use crate::citadel_config::Config;
use crate::citadel_rate_limit::RateLimiter;
use crate::citadel_typing::TypingCooldown;
use sqlx::PgPool;
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::{broadcast, RwLock};
use uuid::Uuid;

/// Per-server broadcast capacity (messages buffered before slow readers lag).
const WS_CHANNEL_CAPACITY: usize = 256;

/// User presence status.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum PresenceStatus {
    Online,
    Idle,
    Dnd,
    Offline,
    Invisible,
}

impl std::fmt::Display for PresenceStatus {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Online => write!(f, "online"),
            Self::Idle => write!(f, "idle"),
            Self::Dnd => write!(f, "dnd"),
            Self::Offline => write!(f, "offline"),
            Self::Invisible => write!(f, "invisible"),
        }
    }
}

/// Tracks a connected user's presence and which servers they're on.
#[derive(Debug, Clone)]
pub struct UserPresence {
    pub status: PresenceStatus,
    pub custom_status: String,
    pub status_emoji: String,
    pub server_ids: Vec<Uuid>,
    pub last_heartbeat: std::time::Instant,
}

/// Application state shared across all request handlers.
#[derive(Clone)]
pub struct AppState {
    /// PostgreSQL connection pool.
    pub db: PgPool,
    /// Redis connection manager.
    pub redis: redis::aio::ConnectionManager,
    /// Server configuration.
    pub config: Config,
    /// Server-scoped WebSocket broadcast buses.
    pub ws_buses: Arc<RwLock<HashMap<Uuid, broadcast::Sender<String>>>>,
    /// Per-IP rate limiter.
    pub rate_limiter: Arc<RateLimiter>,
    /// Typing indicator cooldown tracker.
    pub typing_cooldown: Arc<TypingCooldown>,
    /// Online user presence: user_id -> presence info.
    pub presence: Arc<RwLock<HashMap<Uuid, UserPresence>>>,
    /// Voice state: user_id -> (server_id, channel_id). Users can only be in ONE voice channel.
    pub voice_state: Arc<RwLock<HashMap<Uuid, (Uuid, Uuid)>>>,
}

impl AppState {
    /// Create a new AppState from configuration.
    pub async fn new(config: Config) -> Result<Self, Box<dyn std::error::Error>> {
        let db = PgPool::connect_with(
            config.database_url.parse::<sqlx::postgres::PgConnectOptions>()?
        )
        .await?;

        let redis_client = redis::Client::open(config.redis_url.as_str())?;
        let redis = redis::aio::ConnectionManager::new(redis_client).await?;

        Ok(Self {
            db,
            redis,
            rate_limiter: Arc::new(RateLimiter::new(config.rate_limit_per_minute)),
            typing_cooldown: Arc::new(TypingCooldown::new()),
            config,
            ws_buses: Arc::new(RwLock::new(HashMap::new())),
            presence: Arc::new(RwLock::new(HashMap::new())),
            voice_state: Arc::new(RwLock::new(HashMap::new())),
        })
    }

    /// Get or create a broadcast channel for a server.
    /// Returns a Sender you can broadcast on.
    pub async fn get_server_bus(&self, server_id: Uuid) -> broadcast::Sender<String> {
        // Fast path: read lock.
        {
            let buses = self.ws_buses.read().await;
            if let Some(tx) = buses.get(&server_id) {
                return tx.clone();
            }
        }
        // Slow path: create.
        let mut buses = self.ws_buses.write().await;
        buses.entry(server_id)
            .or_insert_with(|| broadcast::channel(WS_CHANNEL_CAPACITY).0)
            .clone()
    }

    /// Subscribe to events for a server. Returns a Receiver.
    pub async fn subscribe_server(&self, server_id: Uuid) -> broadcast::Receiver<String> {
        self.get_server_bus(server_id).await.subscribe()
    }

    /// Broadcast a JSON event to all WebSocket clients subscribed to a server.
    /// Fire-and-forget: if no one is listening, the message is silently dropped.
    pub async fn ws_broadcast(&self, server_id: Uuid, payload: serde_json::Value) {
        let msg = payload.to_string();
        let tx = self.get_server_bus(server_id).await;
        // send() returns Err if zero receivers — that's fine.
        let _ = tx.send(msg);
    }

    /// Broadcast a JSON event excluding specific user IDs (e.g. blocked-by list).
    /// Adds an `_exclude` array to the payload; the WebSocket forwarder strips it.
    pub async fn ws_broadcast_filtered(&self, server_id: Uuid, mut payload: serde_json::Value, exclude: &[Uuid]) {
        if !exclude.is_empty() {
            let ids: Vec<String> = exclude.iter().map(|id| id.to_string()).collect();
            payload.as_object_mut().map(|o| o.insert("_exclude".into(), serde_json::json!(ids)));
        }
        let msg = payload.to_string();
        let tx = self.get_server_bus(server_id).await;
        let _ = tx.send(msg);
    }

    /// Set a user's presence and broadcast the change to all their servers.
    pub async fn set_presence(&self, user_id: Uuid, status: PresenceStatus, server_id: Uuid) {
        let mut map = self.presence.write().await;
        let entry = map.entry(user_id).or_insert_with(|| UserPresence {
            status: PresenceStatus::Online,
            custom_status: String::new(),
            status_emoji: String::new(),
            server_ids: vec![],
            last_heartbeat: std::time::Instant::now(),
        });
        entry.status = status.clone();
        entry.last_heartbeat = std::time::Instant::now();
        if !entry.server_ids.contains(&server_id) {
            entry.server_ids.push(server_id);
        }
        let servers = entry.server_ids.clone();
        let custom_status = entry.custom_status.clone();
        let status_emoji = entry.status_emoji.clone();
        drop(map);

        // Broadcast to all servers this user is in.
        let event = serde_json::json!({
            "type": "presence_update",
            "user_id": user_id,
            "status": status.to_string(),
            "custom_status": custom_status,
            "status_emoji": status_emoji,
        });
        for sid in servers {
            self.ws_broadcast(sid, event.clone()).await;
        }
    }

    /// Remove a user's presence from a server. If no servers left, remove entirely.
    pub async fn remove_presence(&self, user_id: Uuid, server_id: Uuid) {
        let mut map = self.presence.write().await;
        let _should_broadcast_offline;
        if let Some(entry) = map.get_mut(&user_id) {
            entry.server_ids.retain(|s| *s != server_id);
            _should_broadcast_offline = entry.server_ids.is_empty();
            if _should_broadcast_offline {
                map.remove(&user_id);
            }
        } else {
            _should_broadcast_offline = false;
        }
        drop(map);

        // Broadcast offline to this server.
        self.ws_broadcast(server_id, serde_json::json!({
            "type": "presence_update",
            "user_id": user_id,
            "status": "offline",
        })).await;
    }

    /// Get all online users and their statuses for a given server.
    pub async fn get_server_presence(&self, server_id: Uuid) -> HashMap<Uuid, String> {
        let map = self.presence.read().await;
        map.iter()
            .filter(|(_, p)| p.server_ids.contains(&server_id) && p.status != PresenceStatus::Invisible)
            .map(|(uid, p)| (*uid, p.status.to_string()))
            .collect()
    }

    /// Update custom status text and emoji for a user, then broadcast.
    pub async fn set_custom_status(&self, user_id: Uuid, custom_status: String, status_emoji: String) {
        let mut map = self.presence.write().await;
        let servers = if let Some(entry) = map.get_mut(&user_id) {
            entry.custom_status = custom_status.clone();
            entry.status_emoji = status_emoji.clone();
            entry.server_ids.clone()
        } else {
            return; // User not connected — DB update is sufficient
        };
        let status = map.get(&user_id).map(|e| e.status.to_string()).unwrap_or_default();
        drop(map);

        let event = serde_json::json!({
            "type": "presence_update",
            "user_id": user_id,
            "status": status,
            "custom_status": custom_status,
            "status_emoji": status_emoji,
        });
        for sid in servers {
            self.ws_broadcast(sid, event.clone()).await;
        }
    }
}
