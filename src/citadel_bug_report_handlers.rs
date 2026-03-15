// citadel_bug_report_handlers.rs — Bug report submission & admin view.
//
// Public endpoint — no auth required so login-page bugs can be reported.
// Rate limited to 5 reports per hour per IP via Redis.
//
// Endpoints:
//   POST  /api/v1/bug-reports        — Submit a bug report (public)
//   GET   /api/v1/admin/bug-reports  — List all reports, paginated (admin only)

use axum::{
    extract::{Json, Query, State},
    http::{HeaderMap, StatusCode},
    response::IntoResponse,
};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use uuid::Uuid;

use crate::citadel_error::AppError;
use crate::citadel_platform_admin_handlers::require_staff_role;
use crate::citadel_platform_permissions::PlatformUser;
use crate::citadel_state::AppState;

// ─── Request / Response Types ────────────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct SubmitBugReportRequest {
    pub page: String,
    pub description: String,
    pub error_code: Option<String>,
    pub browser_info: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct BugReportInfo {
    pub id: Uuid,
    pub reporter_user_id: Option<Uuid>,
    pub page: String,
    pub description: String,
    pub error_code: Option<String>,
    pub browser_info: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Deserialize)]
pub struct BugReportPagination {
    #[serde(default = "default_limit")]
    pub limit: i64,
    #[serde(default)]
    pub offset: i64,
}

fn default_limit() -> i64 { 50 }

// ─── POST /api/v1/bug-reports ────────────────────────────────────────────

pub async fn submit_bug_report(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(req): Json<SubmitBugReportRequest>,
) -> Result<impl IntoResponse, AppError> {
    // Validate inputs.
    let description = req.description.trim().to_string();
    if description.is_empty() {
        return Err(AppError::BadRequest("Description cannot be empty".into()));
    }
    if description.len() > 5000 {
        return Err(AppError::BadRequest("Description too long (max 5000 chars)".into()));
    }

    let page = req.page.chars().take(100).collect::<String>();

    // Extract IP for rate limiting.
    let ip = headers
        .get("x-forwarded-for")
        .and_then(|v| v.to_str().ok())
        .map(|s| s.split(',').next().unwrap_or("unknown").trim().to_string())
        .or_else(|| {
            headers
                .get("x-real-ip")
                .and_then(|v| v.to_str().ok())
                .map(|s| s.to_string())
        })
        .unwrap_or_else(|| "unknown".to_string());

    // Rate limit: 5 reports per hour per IP via Redis.
    let rate_key = format!("bug_report_rate:{}", ip);
    let mut redis_conn = state.redis.clone();

    let current: Option<i64> = crate::citadel_error::redis_or_503(
        redis::cmd("GET")
            .arg(&rate_key)
            .query_async(&mut redis_conn)
            .await
    )?;

    if current.unwrap_or(0) >= 5 {
        return Err(AppError::RateLimited(
            "Too many bug reports. Please try again later.".into(),
        ));
    }

    // Increment counter with 1-hour TTL.
    let _: Result<i64, _> = redis::cmd("INCR")
        .arg(&rate_key)
        .query_async(&mut redis_conn)
        .await;

    // Set TTL only on first report (when count becomes 1).
    if current.unwrap_or(0) == 0 {
        let _: Result<bool, _> = redis::cmd("EXPIRE")
            .arg(&rate_key)
            .arg(3600_i64)
            .query_async(&mut redis_conn)
            .await;
    }

    // Try to extract user_id from Authorization header (optional — no error if missing).
    let user_id = extract_optional_user_id(&headers, &state).await;

    let report_id = Uuid::new_v4();
    let error_code = req.error_code.as_deref().map(|s| &s[..s.len().min(50)]);

    sqlx::query!(
        "INSERT INTO bug_reports (id, reporter_user_id, page, description, error_code, browser_info)
         VALUES ($1, $2, $3, $4, $5, $6)",
        report_id,
        user_id,
        page,
        description,
        error_code,
        req.browser_info,
    )
    .execute(&state.db)
    .await?;

    tracing::info!(
        report_id = %report_id,
        page = %page,
        ip = %ip,
        user_id = ?user_id,
        "Bug report submitted"
    );

    Ok((
        StatusCode::CREATED,
        Json(serde_json::json!({
            "message": "Bug report submitted. Thank you!",
            "id": report_id,
        })),
    ))
}

// ─── GET /api/v1/admin/bug-reports ───────────────────────────────────────

pub async fn list_bug_reports(
    caller: PlatformUser,
    State(state): State<Arc<AppState>>,
    Query(params): Query<BugReportPagination>,
) -> Result<impl IntoResponse, AppError> {
    require_staff_role(&caller)?;

    let limit = params.limit.clamp(1, 100);
    let offset = params.offset.max(0);

    let rows = sqlx::query!(
        r#"SELECT id, reporter_user_id, page, description, error_code, browser_info, created_at
           FROM bug_reports
           ORDER BY created_at DESC
           LIMIT $1 OFFSET $2"#,
        limit,
        offset,
    )
    .fetch_all(&state.db)
    .await?;

    let total: i64 = sqlx::query_scalar!("SELECT COUNT(*) FROM bug_reports")
        .fetch_one(&state.db)
        .await?
        .unwrap_or(0);

    let reports: Vec<BugReportInfo> = rows
        .into_iter()
        .map(|r| BugReportInfo {
            id: r.id,
            reporter_user_id: r.reporter_user_id,
            page: r.page,
            description: r.description,
            error_code: r.error_code,
            browser_info: r.browser_info,
            created_at: r.created_at.to_rfc3339(),
        })
        .collect();

    Ok(Json(serde_json::json!({
        "reports": reports,
        "total": total,
        "limit": limit,
        "offset": offset,
    })))
}

// ─── Helpers ─────────────────────────────────────────────────────────────

/// Best-effort extraction of user_id from a Bearer token.
/// Returns None if no token, invalid token, or expired session.
async fn extract_optional_user_id(
    headers: &HeaderMap,
    state: &AppState,
) -> Option<Uuid> {
    let auth_header = headers.get("authorization")?.to_str().ok()?;
    let token = auth_header.strip_prefix("Bearer ")?;

    // Decode JWT claims without full validation — just extract user_id.
    let parts: Vec<&str> = token.split('.').collect();
    if parts.len() != 3 {
        return None;
    }
    let payload = base64_decode_segment(parts[1])?;
    let claims: serde_json::Value = serde_json::from_slice(&payload).ok()?;
    let user_id_str = claims.get("sub")?.as_str()?;
    let user_id = Uuid::parse_str(user_id_str).ok()?;

    // Verify the session is still active.
    let session_id_str = claims.get("sid")?.as_str()?;
    let session_id = Uuid::parse_str(session_id_str).ok()?;
    let active = sqlx::query_scalar!(
        "SELECT EXISTS(SELECT 1 FROM sessions WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL AND expires_at > NOW())",
        session_id,
        user_id,
    )
    .fetch_one(&state.db)
    .await
    .ok()?
    .unwrap_or(false);

    if active { Some(user_id) } else { None }
}

fn base64_decode_segment(seg: &str) -> Option<Vec<u8>> {
    use base64::engine::general_purpose::URL_SAFE_NO_PAD;
    use base64::Engine;
    URL_SAFE_NO_PAD.decode(seg).ok()
}
