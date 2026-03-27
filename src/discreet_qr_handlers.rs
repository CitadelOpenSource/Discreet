// discreet_qr_handlers.rs — QR code generation for friend connect and server invites.
//
// Endpoints:
//   GET /api/v1/users/@me/qr              — PNG QR code linking to the caller's friend-connect URL.
//   GET /api/v1/servers/:server_id/invite-qr — PNG QR code linking to a server invite URL.
//   GET /api/v1/connect/:code             — Resolve a connect code to its metadata.
//
// Each QR encodes a URL of the form https://discreetai.net/connect/{code}.
// The 12-char alphanumeric code is stored in Redis with a 24-hour TTL
// alongside JSON metadata: { "type": "friend"|"server", "target_id": "<uuid>" }.
//
// Rate limit: 10 QR generations per hour per user (Redis, fail-closed).

use std::sync::Arc;

use axum::{
    extract::{Path, State},
    http::header,
    response::IntoResponse,
    Json,
};
use uuid::Uuid;

use crate::discreet_auth::AuthUser;
use crate::discreet_error::AppError;
use crate::discreet_state::AppState;

/// Rate limit: 10 QR generations per hour per user.
const QR_RATE_LIMIT: i64 = 10;
const QR_RATE_WINDOW_SECS: i64 = 3600;

/// Connect code TTL: 24 hours.
const CODE_TTL_SECS: i64 = 86400;

// ─── GET /users/@me/qr ─────────────────────────────────────────────────

/// Generate a QR code PNG for the calling user's friend-connect link.
///
/// The code resolves to `{ "type": "friend", "target_id": "<user_id>" }`
/// when looked up in Redis via `connect:{code}`.
pub async fn user_qr(
    auth: AuthUser,
    State(state): State<Arc<AppState>>,
) -> Result<impl IntoResponse, AppError> {
    enforce_rate_limit(&state, auth.user_id).await?;

    let code = generate_connect_code();
    let metadata = serde_json::json!({
        "type": "friend",
        "target_id": auth.user_id.to_string(),
    });

    store_connect_code(&state, &code, &metadata).await?;

    let url = format!("https://discreetai.net/connect/{code}");
    let png = render_qr_png(&url)?;

    tracing::info!(user_id = %auth.user_id, code = %code, "Friend QR code generated");

    Ok((
        [(header::CONTENT_TYPE, "image/png"),
         (header::CACHE_CONTROL, "no-store")],
        png,
    ))
}

// ─── GET /servers/:server_id/invite-qr ──────────────────────────────────

/// Generate a QR code PNG for a server invite link.
///
/// The code resolves to `{ "type": "server", "target_id": "<server_id>" }`
/// when looked up in Redis via `connect:{code}`.
pub async fn server_invite_qr(
    auth: AuthUser,
    State(state): State<Arc<AppState>>,
    Path(server_id): Path<Uuid>,
) -> Result<impl IntoResponse, AppError> {
    // Verify server exists and caller is a member.
    let server = sqlx::query!(
        "SELECT id FROM servers WHERE id = $1",
        server_id,
    )
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::NotFound("Server not found".into()))?;

    let is_member = sqlx::query_scalar!(
        "SELECT EXISTS(SELECT 1 FROM server_members WHERE server_id = $1 AND user_id = $2)",
        server.id,
        auth.user_id,
    )
    .fetch_one(&state.db)
    .await?
    .unwrap_or(false);

    if !is_member {
        return Err(AppError::Forbidden("You must be a member of this server".into()));
    }

    enforce_rate_limit(&state, auth.user_id).await?;

    let code = generate_connect_code();
    let metadata = serde_json::json!({
        "type": "server",
        "target_id": server_id.to_string(),
    });

    store_connect_code(&state, &code, &metadata).await?;

    let url = format!("https://discreetai.net/connect/{code}");
    let png = render_qr_png(&url)?;

    tracing::info!(
        user_id = %auth.user_id,
        server_id = %server_id,
        code = %code,
        "Server invite QR code generated"
    );

    Ok((
        [(header::CONTENT_TYPE, "image/png"),
         (header::CACHE_CONTROL, "no-store")],
        png,
    ))
}

// ─── GET /connect/:code ─────────────────────────────────────────────────

/// Resolve a connect code to its metadata (type + target_id).
/// No authentication required — the code itself is the bearer token.
/// Returns 404 if the code does not exist or has expired.
pub async fn resolve_connect_code(
    State(state): State<Arc<AppState>>,
    Path(code): Path<String>,
) -> Result<impl IntoResponse, AppError> {
    if code.len() != 12 || !code.chars().all(|c| c.is_ascii_alphanumeric()) {
        return Err(AppError::BadRequest("Invalid connect code format".into()));
    }

    let key = format!("connect:{code}");
    let mut redis_conn = state.redis.clone();

    let stored: Option<String> = crate::discreet_error::redis_or_503(
        redis::cmd("GET")
            .arg(&key)
            .query_async(&mut redis_conn)
            .await,
    )?;

    let json_str = stored.ok_or_else(|| AppError::NotFound("Connect code not found or expired".into()))?;

    let metadata: serde_json::Value = serde_json::from_str(&json_str)
        .map_err(|_| AppError::Internal("Corrupt connect code data".into()))?;

    Ok(Json(metadata))
}

// ─── Helpers ────────────────────────────────────────────────────────────

/// Generate a 12-character alphanumeric connect code.
fn generate_connect_code() -> String {
    use rand::Rng;
    const CHARS: &[u8] = b"ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
    let mut rng = rand::thread_rng();
    (0..12)
        .map(|_| CHARS[rng.gen_range(0..CHARS.len())] as char)
        .collect()
}

/// Store a connect code in Redis with 24-hour TTL.
async fn store_connect_code(
    state: &AppState,
    code: &str,
    metadata: &serde_json::Value,
) -> Result<(), AppError> {
    let key = format!("connect:{code}");
    let json = serde_json::to_string(metadata)
        .map_err(|e| AppError::Internal(format!("JSON serialization failed: {e}")))?;

    let mut redis_conn = state.redis.clone();
    let set_result: Result<String, _> = redis::cmd("SET")
        .arg(&key)
        .arg(&json)
        .arg("EX")
        .arg(CODE_TTL_SECS)
        .query_async(&mut redis_conn)
        .await;
    if let Err(e) = set_result {
        tracing::error!("Failed to store connect code in Redis: {e}");
        return Err(AppError::Internal("Failed to store connect code".into()));
    }

    Ok(())
}

/// Enforce per-user QR generation rate limit (10/hour, fail-closed).
async fn enforce_rate_limit(state: &AppState, user_id: Uuid) -> Result<(), AppError> {
    let rate_key = format!("qr_gen:{user_id}");
    let mut redis_conn = state.redis.clone();

    let count: i64 = crate::discreet_error::redis_or_503(
        redis::cmd("INCR")
            .arg(&rate_key)
            .query_async::<Option<i64>>(&mut redis_conn)
            .await,
    )?
    .unwrap_or(1);

    if count == 1 {
        let expire_result: Result<bool, _> = redis::cmd("EXPIRE")
            .arg(&rate_key)
            .arg(QR_RATE_WINDOW_SECS)
            .query_async(&mut redis_conn)
            .await;
        if let Err(e) = expire_result {
            tracing::debug!("QR rate limit EXPIRE failed: {e}");
        }
    }

    if count > QR_RATE_LIMIT {
        return Err(AppError::RateLimited(
            "Too many QR codes generated. Limit is 10 per hour.".into(),
        ));
    }

    Ok(())
}

/// Render a URL as a QR code PNG image (returns raw bytes).
fn render_qr_png(url: &str) -> Result<Vec<u8>, AppError> {
    use image::Luma;
    use qrcode::QrCode;

    let qr = QrCode::new(url.as_bytes())
        .map_err(|e| AppError::Internal(format!("QR generation failed: {e}")))?;

    let img = qr.render::<Luma<u8>>()
        .quiet_zone(true)
        .min_dimensions(300, 300)
        .build();

    let mut png_bytes: Vec<u8> = Vec::new();
    let mut cursor = std::io::Cursor::new(&mut png_bytes);

    image::DynamicImage::ImageLuma8(img)
        .write_to(&mut cursor, image::ImageFormat::Png)
        .map_err(|e| AppError::Internal(format!("PNG encoding failed: {e}")))?;

    Ok(png_bytes)
}
