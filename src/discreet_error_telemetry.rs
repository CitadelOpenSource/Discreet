// discreet_error_telemetry.rs — Error reporting and developer dashboard.
//
// Endpoints:
//   POST  /api/v1/errors/report              — Submit error from client ErrorBoundary.
//   GET   /api/v1/admin/errors               — List error reports (admin, paginated, filtered).
//   PATCH /api/v1/admin/errors/:id/resolve   — Mark single report resolved.
//   POST  /api/v1/admin/errors/bulk-resolve  — Mark multiple reports resolved.
//
// Also exports `log_server_error()` for server-side handler error recording.

use std::sync::Arc;

use axum::{
    extract::{Json, Path, Query, State},
    http::StatusCode,
    response::IntoResponse,
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::json;
use uuid::Uuid;

use crate::discreet_auth::AuthUser;
use crate::discreet_error::AppError;
use crate::discreet_platform_admin_handlers::require_staff_role;
use crate::discreet_platform_permissions::PlatformUser;
use crate::discreet_state::AppState;

// ─── POST /errors/report ────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct ClientErrorReport {
    pub component: Option<String>,
    pub error_message: String,
    pub stack: Option<String>,
    pub timestamp: Option<String>,
    pub browser: Option<String>,
}

/// Accept an error report from the client ErrorBoundary.
/// Rate limited to 10 per minute per user. No auth required (errors
/// may occur before authentication completes).
pub async fn report_error(
    auth: Option<AuthUser>,
    State(state): State<Arc<AppState>>,
    Json(req): Json<ClientErrorReport>,
) -> Result<impl IntoResponse, AppError> {
    // Rate limit: 10 per minute (keyed by user_id or "anon")
    let rate_id = auth.as_ref().map(|a| a.user_id.to_string()).unwrap_or_else(|| "anon".into());
    let rate_key = format!("err_report:{rate_id}");
    let mut redis_conn = state.redis.clone();

    let count: i64 = redis::cmd("INCR")
        .arg(&rate_key)
        .query_async::<Option<i64>>(&mut redis_conn)
        .await
        .unwrap_or(Some(1))
        .unwrap_or(1);

    if count == 1 {
        let _: Result<bool, _> = redis::cmd("EXPIRE")
            .arg(&rate_key)
            .arg(60_i64)
            .query_async(&mut redis_conn)
            .await;
    }

    if count > 10 {
        return Err(AppError::RateLimited("Too many error reports. Try again in a minute.".into()));
    }

    // Truncate fields to prevent abuse
    let error_message = truncate(&req.error_message, 2000);
    let component = req.component.as_deref().map(|s| truncate(s, 100));
    let stack_trace = req.stack.as_deref().map(|s| truncate(s, 5000));
    let browser = req.browser.as_deref().map(|s| truncate(s, 200));
    let user_id = auth.as_ref().map(|a| a.user_id);

    sqlx::query!(
        "INSERT INTO error_reports (user_id, source, component, error_message, stack_trace, browser, severity)
         VALUES ($1, 'client', $2, $3, $4, $5, 'error')",
        user_id,
        component,
        error_message,
        stack_trace,
        browser,
    )
    .execute(&state.db)
    .await?;

    Ok(StatusCode::CREATED)
}

// ─── Server-side error logging helper ───────────────────────────────────

/// Record a server-side error in the error_reports table.
/// Call this from handler error paths or middleware.
pub async fn log_server_error(
    db: &sqlx::PgPool,
    component: &str,
    error_message: &str,
    stack_trace: Option<&str>,
    severity: &str,
) {
    let result = sqlx::query!(
        "INSERT INTO error_reports (source, component, error_message, stack_trace, severity)
         VALUES ('server', $1, $2, $3, $4)",
        component,
        error_message,
        stack_trace,
        severity,
    )
    .execute(db)
    .await;

    if let Err(e) = result {
        tracing::warn!("Failed to log server error to DB: {e}");
    }
}

// ─── GET /admin/errors ──────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct ErrorListQuery {
    pub page: Option<i64>,
    pub per_page: Option<i64>,
    pub source: Option<String>,
    pub severity: Option<String>,
    pub resolved: Option<bool>,
    pub start: Option<String>,
    pub end: Option<String>,
}

#[derive(Debug, Serialize, sqlx::FromRow)]
struct ErrorReportRow {
    id: Uuid,
    user_id: Option<Uuid>,
    source: String,
    component: Option<String>,
    error_message: String,
    stack_trace: Option<String>,
    browser: Option<String>,
    severity: String,
    resolved: bool,
    resolved_by: Option<Uuid>,
    resolved_at: Option<DateTime<Utc>>,
    created_at: DateTime<Utc>,
    user_email: Option<String>,
}

/// List error reports with pagination and filters. Admin only.
/// Returns X-Unresolved-Count header with total unresolved errors.
pub async fn list_errors(
    caller: PlatformUser,
    State(state): State<Arc<AppState>>,
    Query(params): Query<ErrorListQuery>,
) -> Result<impl IntoResponse, AppError> {
    require_staff_role(&caller)?;

    let page = params.page.unwrap_or(1).max(1);
    let per_page = params.per_page.unwrap_or(50).clamp(1, 200);
    let offset = (page - 1) * per_page;

    // Parse date filters
    let start: Option<DateTime<Utc>> = params.start.as_ref().and_then(|s| {
        DateTime::parse_from_rfc3339(s).ok().map(|d| d.with_timezone(&Utc))
    });
    let end: Option<DateTime<Utc>> = params.end.as_ref().and_then(|s| {
        DateTime::parse_from_rfc3339(s).ok().map(|d| d.with_timezone(&Utc))
    });

    // Build filtered query — use a single flexible query with optional filters
    let rows: Vec<ErrorReportRow> = sqlx::query_as!(
        ErrorReportRow,
        r#"SELECT e.id, e.user_id, e.source, e.component, e.error_message,
                  e.stack_trace, e.browser, e.severity, e.resolved,
                  e.resolved_by, e.resolved_at, e.created_at,
                  u.email as user_email
           FROM error_reports e
           LEFT JOIN users u ON u.id = e.user_id
           WHERE ($1::text IS NULL OR e.source = $1)
             AND ($2::text IS NULL OR e.severity = $2)
             AND ($3::bool IS NULL OR e.resolved = $3)
             AND ($4::timestamptz IS NULL OR e.created_at >= $4)
             AND ($5::timestamptz IS NULL OR e.created_at <= $5)
           ORDER BY e.created_at DESC
           LIMIT $6 OFFSET $7"#,
        params.source,
        params.severity,
        params.resolved,
        start,
        end,
        per_page,
        offset,
    )
    .fetch_all(&state.db)
    .await?;

    // Total count for pagination
    let total: i64 = sqlx::query_scalar!(
        r#"SELECT COUNT(*) FROM error_reports e
           WHERE ($1::text IS NULL OR e.source = $1)
             AND ($2::text IS NULL OR e.severity = $2)
             AND ($3::bool IS NULL OR e.resolved = $3)
             AND ($4::timestamptz IS NULL OR e.created_at >= $4)
             AND ($5::timestamptz IS NULL OR e.created_at <= $5)"#,
        params.source,
        params.severity,
        params.resolved,
        start,
        end,
    )
    .fetch_one(&state.db)
    .await?
    .unwrap_or(0);

    // Unresolved count for header
    let unresolved: i64 = sqlx::query_scalar!(
        "SELECT COUNT(*) FROM error_reports WHERE resolved = FALSE"
    )
    .fetch_one(&state.db)
    .await?
    .unwrap_or(0);

    let total_pages = (total + per_page - 1) / per_page;

    let body = json!({
        "errors": rows,
        "page": page,
        "per_page": per_page,
        "total": total,
        "total_pages": total_pages,
        "unresolved_count": unresolved,
    });

    Ok((
        [(
            axum::http::header::HeaderName::from_static("x-unresolved-count"),
            axum::http::header::HeaderValue::from_str(&unresolved.to_string())
                .unwrap_or_else(|_| axum::http::header::HeaderValue::from_static("0")),
        )],
        Json(body),
    ))
}

// ─── PATCH /admin/errors/:id/resolve ────────────────────────────────────

/// Mark a single error report as resolved.
pub async fn resolve_error(
    caller: PlatformUser,
    State(state): State<Arc<AppState>>,
    Path(error_id): Path<Uuid>,
) -> Result<impl IntoResponse, AppError> {
    require_staff_role(&caller)?;

    let result = sqlx::query!(
        "UPDATE error_reports SET resolved = TRUE, resolved_by = $1, resolved_at = NOW()
         WHERE id = $2 AND resolved = FALSE",
        caller.user_id,
        error_id,
    )
    .execute(&state.db)
    .await?;

    if result.rows_affected() == 0 {
        return Err(AppError::NotFound("Error report not found or already resolved".into()));
    }

    Ok(Json(json!({ "resolved": true, "id": error_id })))
}

// ─── POST /admin/errors/bulk-resolve ────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct BulkResolveRequest {
    pub ids: Vec<Uuid>,
}

/// Mark multiple error reports as resolved in one request.
pub async fn bulk_resolve_errors(
    caller: PlatformUser,
    State(state): State<Arc<AppState>>,
    Json(req): Json<BulkResolveRequest>,
) -> Result<impl IntoResponse, AppError> {
    require_staff_role(&caller)?;

    if req.ids.is_empty() {
        return Err(AppError::BadRequest("ids array cannot be empty".into()));
    }
    if req.ids.len() > 500 {
        return Err(AppError::BadRequest("Maximum 500 IDs per bulk resolve".into()));
    }

    let result = sqlx::query!(
        "UPDATE error_reports SET resolved = TRUE, resolved_by = $1, resolved_at = NOW()
         WHERE id = ANY($2) AND resolved = FALSE",
        caller.user_id,
        &req.ids,
    )
    .execute(&state.db)
    .await?;

    Ok(Json(json!({
        "resolved_count": result.rows_affected(),
        "requested": req.ids.len(),
    })))
}

// ─── Helpers ────────────────────────────────────────────────────────────

fn truncate(s: &str, max: usize) -> String {
    if s.len() <= max {
        s.to_string()
    } else {
        format!("{}…", &s[..max.min(s.len())])
    }
}
