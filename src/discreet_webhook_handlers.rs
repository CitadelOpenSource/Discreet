// discreet_webhook_handlers.rs — Outbound webhook management and delivery.
//
// Allows server administrators to configure webhooks that fire on events.
// Each delivery is signed with HMAC-SHA256 using a per-webhook secret and
// includes an X-Discreet-Signature header for verification.
//
// Endpoints:
//   POST   /api/v1/servers/:server_id/webhooks   — Create webhook
//   GET    /api/v1/servers/:server_id/webhooks   — List webhooks
//   PUT    /api/v1/webhooks/:webhook_id          — Update webhook
//   DELETE /api/v1/webhooks/:webhook_id          — Delete webhook
//
// Internal:
//   fire_webhook(db, server_id, event_type, payload) — Deliver to matching hooks.

use std::sync::Arc;

use axum::{
    extract::{Json, Path, State},
    http::StatusCode,
    response::IntoResponse,
};
use serde::Deserialize;
use serde_json::json;
use uuid::Uuid;

use crate::discreet_auth::AuthUser;
use crate::discreet_error::AppError;
use crate::discreet_permissions::{require_permission, Permission};
use crate::discreet_state::AppState;

/// Maximum webhook name length.
const MAX_WEBHOOK_NAME: usize = 100;

/// Maximum webhook URL length.
const MAX_WEBHOOK_URL: usize = 2048;

/// Maximum number of events a webhook can subscribe to.
const MAX_EVENTS: usize = 50;

/// Maximum webhooks per server.
const MAX_WEBHOOKS_PER_SERVER: i64 = 25;

/// Allowed webhook event types.
const VALID_EVENTS: &[&str] = &[
    "message_create", "message_delete", "message_update",
    "member_join", "member_leave",
    "channel_update", "channel_delete",
    "role_update",
];

/// Delivery timeout per attempt.
const DELIVERY_TIMEOUT_SECS: u64 = 5;

/// Retry delays in seconds (exponential backoff).
const RETRY_DELAYS: [u64; 3] = [5, 15, 45];

// ─── Request Types ──────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct CreateWebhookRequest {
    pub name: String,
    pub url: String,
    pub channel_id: Option<Uuid>,
    #[serde(default = "default_events")]
    pub events: Vec<String>,
    #[serde(default = "default_true")]
    pub enabled: bool,
}

#[derive(Debug, Deserialize)]
pub struct UpdateWebhookRequest {
    pub name: Option<String>,
    pub url: Option<String>,
    pub events: Option<Vec<String>>,
    pub enabled: Option<bool>,
}

fn default_events() -> Vec<String> {
    vec!["message_create".to_string()]
}

fn default_true() -> bool {
    true
}

// ─── POST /servers/:server_id/webhooks ──────────────────────────────────

/// Create a new webhook for a server.
pub async fn create_webhook(
    auth: AuthUser,
    State(state): State<Arc<AppState>>,
    Path(server_id): Path<Uuid>,
    Json(req): Json<CreateWebhookRequest>,
) -> Result<impl IntoResponse, AppError> {
    require_permission(&state, server_id, auth.user_id, Permission::MANAGE_SERVER).await?;
    crate::discreet_premium::require_verified(&auth)?;

    // ── Validate name ────────────────────────────────────────────────────
    let name = req.name.trim().to_string();
    if name.is_empty() {
        return Err(AppError::BadRequest("Webhook name cannot be empty".into()));
    }
    if name.chars().count() > MAX_WEBHOOK_NAME {
        return Err(AppError::BadRequest(
            format!("Webhook name must be {} characters or fewer", MAX_WEBHOOK_NAME),
        ));
    }

    // ── Validate URL ─────────────────────────────────────────────────────
    let url = req.url.trim().to_string();
    if url.is_empty() {
        return Err(AppError::BadRequest("Webhook URL cannot be empty".into()));
    }
    if url.len() > MAX_WEBHOOK_URL {
        return Err(AppError::BadRequest("Webhook URL is too long".into()));
    }
    if !url.starts_with("https://") {
        return Err(AppError::BadRequest(
            "Webhook URL must use HTTPS".into(),
        ));
    }

    // ── Validate events ──────────────────────────────────────────────────
    if req.events.is_empty() {
        return Err(AppError::BadRequest("At least one event is required".into()));
    }
    if req.events.len() > MAX_EVENTS {
        return Err(AppError::BadRequest(
            format!("Maximum {} events per webhook", MAX_EVENTS),
        ));
    }
    for ev in &req.events {
        if !VALID_EVENTS.contains(&ev.as_str()) {
            return Err(AppError::BadRequest(format!(
                "Unknown event type: {ev}. Valid: {}",
                VALID_EVENTS.join(", "),
            )));
        }
    }

    // ── Enforce per-server limit ─────────────────────────────────────────
    let count = sqlx::query_scalar!(
        "SELECT COUNT(*) FROM webhooks WHERE server_id = $1",
        server_id,
    )
    .fetch_one(&state.db)
    .await?
    .unwrap_or(0);

    if count >= MAX_WEBHOOKS_PER_SERVER {
        return Err(AppError::BadRequest(
            format!("Maximum {} webhooks per server", MAX_WEBHOOKS_PER_SERVER),
        ));
    }

    // ── Validate channel_id belongs to this server if provided ───────────
    if let Some(cid) = req.channel_id {
        let valid = sqlx::query_scalar!(
            "SELECT EXISTS(SELECT 1 FROM channels WHERE id = $1 AND server_id = $2)",
            cid,
            server_id,
        )
        .fetch_one(&state.db)
        .await?
        .unwrap_or(false);

        if !valid {
            return Err(AppError::BadRequest(
                "Channel does not belong to this server".into(),
            ));
        }
    }

    // ── Generate 32-byte hex secret ──────────────────────────────────────
    let secret = {
        use rand::Rng;
        let mut bytes = [0u8; 32];
        rand::thread_rng().fill(&mut bytes);
        hex::encode(bytes)
    };

    let events_json = serde_json::to_value(&req.events)
        .map_err(|e| AppError::BadRequest(format!("Invalid events array: {e}")))?;

    let row = sqlx::query!(
        "INSERT INTO webhooks (server_id, channel_id, name, url, secret, events, enabled) \
         VALUES ($1, $2, $3, $4, $5, $6, $7) \
         RETURNING id, created_at",
        server_id,
        req.channel_id,
        name,
        url,
        secret,
        events_json,
        req.enabled,
    )
    .fetch_one(&state.db)
    .await?;

    tracing::info!(
        webhook_id = %row.id,
        server_id = %server_id,
        user_id = %auth.user_id,
        "Webhook created"
    );

    Ok((
        StatusCode::CREATED,
        Json(json!({
            "id": row.id,
            "server_id": server_id,
            "channel_id": req.channel_id,
            "name": name,
            "url": url,
            "secret": secret,
            "events": req.events,
            "enabled": req.enabled,
            "failure_count": 0,
            "created_at": row.created_at.map(|t| t.to_rfc3339()),
        })),
    ))
}

// ─── GET /servers/:server_id/webhooks ───────────────────────────────────

/// List all webhooks for a server.
pub async fn list_webhooks(
    auth: AuthUser,
    State(state): State<Arc<AppState>>,
    Path(server_id): Path<Uuid>,
) -> Result<impl IntoResponse, AppError> {
    require_permission(&state, server_id, auth.user_id, Permission::MANAGE_SERVER).await?;

    let rows = sqlx::query!(
        "SELECT id, channel_id, name, url, events, enabled, failure_count, created_at \
         FROM webhooks WHERE server_id = $1 ORDER BY created_at ASC",
        server_id,
    )
    .fetch_all(&state.db)
    .await?;

    let webhooks: Vec<serde_json::Value> = rows
        .iter()
        .map(|r| {
            json!({
                "id": r.id,
                "server_id": server_id,
                "channel_id": r.channel_id,
                "name": r.name,
                "url": r.url,
                "events": r.events,
                "enabled": r.enabled,
                "failure_count": r.failure_count,
                "created_at": r.created_at.map(|t| t.to_rfc3339()),
            })
        })
        .collect();

    Ok(Json(json!(webhooks)))
}

// ─── PUT /webhooks/:webhook_id ──────────────────────────────────────────

/// Update a webhook's name, URL, events, or enabled state.
pub async fn update_webhook(
    auth: AuthUser,
    State(state): State<Arc<AppState>>,
    Path(webhook_id): Path<Uuid>,
    Json(req): Json<UpdateWebhookRequest>,
) -> Result<impl IntoResponse, AppError> {
    // Look up the webhook and verify permission on its server.
    let wh = sqlx::query!(
        "SELECT server_id FROM webhooks WHERE id = $1",
        webhook_id,
    )
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::NotFound("Webhook not found".into()))?;

    require_permission(&state, wh.server_id, auth.user_id, Permission::MANAGE_SERVER).await?;

    // ── Validate fields if provided ──────────────────────────────────────
    if let Some(ref name) = req.name {
        let name = name.trim();
        if name.is_empty() {
            return Err(AppError::BadRequest("Webhook name cannot be empty".into()));
        }
        if name.chars().count() > MAX_WEBHOOK_NAME {
            return Err(AppError::BadRequest(
                format!("Webhook name must be {} characters or fewer", MAX_WEBHOOK_NAME),
            ));
        }
    }
    if let Some(ref url) = req.url {
        let url = url.trim();
        if url.is_empty() {
            return Err(AppError::BadRequest("Webhook URL cannot be empty".into()));
        }
        if url.len() > MAX_WEBHOOK_URL {
            return Err(AppError::BadRequest("Webhook URL is too long".into()));
        }
        if !url.starts_with("https://") {
            return Err(AppError::BadRequest("Webhook URL must use HTTPS".into()));
        }
    }
    if let Some(ref events) = req.events {
        if events.is_empty() {
            return Err(AppError::BadRequest("At least one event is required".into()));
        }
        if events.len() > MAX_EVENTS {
            return Err(AppError::BadRequest(
                format!("Maximum {} events per webhook", MAX_EVENTS),
            ));
        }
        for ev in events {
            if !VALID_EVENTS.contains(&ev.as_str()) {
                return Err(AppError::BadRequest(format!(
                    "Unknown event type: {ev}. Valid: {}",
                    VALID_EVENTS.join(", "),
                )));
            }
        }
    }

    // ── Apply updates ────────────────────────────────────────────────────
    if let Some(ref name) = req.name {
        sqlx::query!(
            "UPDATE webhooks SET name = $2 WHERE id = $1",
            webhook_id,
            name.trim(),
        )
        .execute(&state.db)
        .await?;
    }
    if let Some(ref url) = req.url {
        sqlx::query!(
            "UPDATE webhooks SET url = $2 WHERE id = $1",
            webhook_id,
            url.trim(),
        )
        .execute(&state.db)
        .await?;
    }
    if let Some(ref events) = req.events {
        let events_json = serde_json::to_value(events)
            .map_err(|e| AppError::BadRequest(format!("Invalid events: {e}")))?;
        sqlx::query!(
            "UPDATE webhooks SET events = $2 WHERE id = $1",
            webhook_id,
            events_json,
        )
        .execute(&state.db)
        .await?;
    }
    if let Some(enabled) = req.enabled {
        sqlx::query!(
            "UPDATE webhooks SET enabled = $2, failure_count = CASE WHEN $2 THEN 0 ELSE failure_count END WHERE id = $1",
            webhook_id,
            enabled,
        )
        .execute(&state.db)
        .await?;
    }

    tracing::info!(webhook_id = %webhook_id, user_id = %auth.user_id, "Webhook updated");

    Ok(StatusCode::NO_CONTENT)
}

// ─── DELETE /webhooks/:webhook_id ───────────────────────────────────────

/// Delete a webhook.
pub async fn delete_webhook(
    auth: AuthUser,
    State(state): State<Arc<AppState>>,
    Path(webhook_id): Path<Uuid>,
) -> Result<impl IntoResponse, AppError> {
    let wh = sqlx::query!(
        "SELECT server_id FROM webhooks WHERE id = $1",
        webhook_id,
    )
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::NotFound("Webhook not found".into()))?;

    require_permission(&state, wh.server_id, auth.user_id, Permission::MANAGE_SERVER).await?;

    sqlx::query!("DELETE FROM webhooks WHERE id = $1", webhook_id)
        .execute(&state.db)
        .await?;

    tracing::info!(webhook_id = %webhook_id, user_id = %auth.user_id, "Webhook deleted");

    Ok(StatusCode::NO_CONTENT)
}

// ─── Webhook Delivery ───────────────────────────────────────────────────

/// Fire webhooks for a server event.
///
/// Queries all enabled webhooks whose `events` JSONB array contains the
/// given `event_type`, signs the payload with HMAC-SHA256 using each
/// webhook's secret, and delivers via POST with retries.
///
/// This function is fire-and-forget — delivery failures are logged and
/// the webhook's `failure_count` is incremented, but errors do not
/// propagate to the caller.
pub async fn fire_webhook(
    db: &sqlx::PgPool,
    server_id: Uuid,
    event_type: &str,
    payload: &serde_json::Value,
) {
    // JSONB @> checks array containment: events @> '["message_create"]'
    let event_filter = serde_json::Value::Array(vec![
        serde_json::Value::String(event_type.to_string()),
    ]);

    let hooks = match sqlx::query!(
        "SELECT id, url, secret FROM webhooks \
         WHERE server_id = $1 AND enabled = true AND events @> $2::jsonb",
        server_id,
        event_filter,
    )
    .fetch_all(db)
    .await
    {
        Ok(h) => h,
        Err(e) => {
            tracing::error!(server_id = %server_id, event = %event_type, "Failed to query webhooks: {e}");
            return;
        }
    };

    if hooks.is_empty() {
        return;
    }

    let body = match serde_json::to_string(payload) {
        Ok(b) => b,
        Err(e) => {
            tracing::error!(event = %event_type, "Failed to serialize webhook payload: {e}");
            return;
        }
    };

    let db = db.clone();
    for hook in hooks {
        let db = db.clone();
        let body = body.clone();
        let event_type = event_type.to_string();

        tokio::spawn(async move {
            deliver_webhook(&db, hook.id, &hook.url, &hook.secret, &event_type, &body).await;
        });
    }
}

/// Deliver a single webhook with retries.
///
/// Signs the body with HMAC-SHA256, sends POST with X-Discreet-Signature
/// header. Retries up to 3 times with exponential backoff (5s, 15s, 45s).
/// Increments `failure_count` on permanent failure.
async fn deliver_webhook(
    db: &sqlx::PgPool,
    webhook_id: Uuid,
    url: &str,
    secret: &str,
    event_type: &str,
    body: &str,
) {
    // ── Sign payload ─────────────────────────────────────────────────────
    let signature = {
        use hmac::{Hmac, Mac};
        use sha2::Sha256;
        type HmacSha256 = Hmac<Sha256>;

        let mut mac = match HmacSha256::new_from_slice(secret.as_bytes()) {
            Ok(m) => m,
            Err(e) => {
                tracing::error!(webhook_id = %webhook_id, "HMAC key error: {e}");
                return;
            }
        };
        mac.update(body.as_bytes());
        format!("sha256={}", hex::encode(mac.finalize().into_bytes()))
    };

    let client = match reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(DELIVERY_TIMEOUT_SECS))
        .connect_timeout(std::time::Duration::from_secs(DELIVERY_TIMEOUT_SECS))
        .build()
    {
        Ok(c) => c,
        Err(e) => {
            tracing::error!(webhook_id = %webhook_id, "Failed to build HTTP client: {e}");
            return;
        }
    };

    // ── Attempt delivery with retries ────────────────────────────────────
    let mut last_err = String::new();

    for attempt in 0..=RETRY_DELAYS.len() {
        if attempt > 0 {
            let delay = RETRY_DELAYS[attempt - 1];
            tokio::time::sleep(std::time::Duration::from_secs(delay)).await;
        }

        let result = client
            .post(url)
            .header("Content-Type", "application/json")
            .header("X-Discreet-Signature", &signature)
            .header("X-Discreet-Event", event_type)
            .body(body.to_string())
            .send()
            .await;

        match result {
            Ok(resp) if resp.status().is_success() => {
                tracing::debug!(
                    webhook_id = %webhook_id,
                    status = %resp.status(),
                    attempt,
                    "Webhook delivered"
                );
                return;
            }
            Ok(resp) => {
                last_err = format!("HTTP {}", resp.status());
                tracing::warn!(
                    webhook_id = %webhook_id,
                    status = %resp.status(),
                    attempt,
                    "Webhook delivery got non-2xx response"
                );
            }
            Err(e) => {
                last_err = format!("{e}");
                tracing::warn!(
                    webhook_id = %webhook_id,
                    attempt,
                    "Webhook delivery failed: {e}"
                );
            }
        }
    }

    // ── All retries exhausted — increment failure count ──────────────────
    tracing::error!(
        webhook_id = %webhook_id,
        error = %last_err,
        "Webhook delivery failed after {} retries",
        RETRY_DELAYS.len()
    );

    if let Err(e) = sqlx::query!(
        "UPDATE webhooks SET failure_count = failure_count + 1 WHERE id = $1",
        webhook_id,
    )
    .execute(db)
    .await
    {
        tracing::error!(webhook_id = %webhook_id, "Failed to update webhook failure_count: {e}");
    }
}
