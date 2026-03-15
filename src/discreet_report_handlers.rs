// discreet_report_handlers.rs — Content report endpoints.
//
// Endpoints:
//   POST  /api/v1/reports                 — Submit a report (any member)
//   GET   /api/v1/admin/reports           — List reports (admin only)
//   PATCH /api/v1/admin/reports/:id       — Resolve a report (admin only)

use axum::{extract::{Path, Query, State, Json}, http::StatusCode, response::IntoResponse};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use uuid::Uuid;
use crate::{citadel_auth::AuthUser, citadel_error::AppError, citadel_state::AppState};
use crate::citadel_platform_permissions::PlatformUser;
use crate::citadel_platform_admin_handlers::require_staff_role;

const VALID_REASONS: &[&str] = &["spam", "harassment", "illegal_content", "other"];

#[derive(Debug, Deserialize)]
pub struct CreateReportRequest {
    pub message_id: Uuid,
    pub reason: String,
    pub details: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct ResolveReportRequest {
    /// 'dismissed' or 'actioned'
    pub status: String,
}

#[derive(Debug, Deserialize)]
pub struct ListReportsParams {
    pub status: Option<String>,
    pub limit: Option<i64>,
    pub offset: Option<i64>,
}

#[derive(Debug, Serialize)]
pub struct ReportResponse {
    pub id: Uuid,
    pub reporter_id: Uuid,
    pub reporter_username: Option<String>,
    pub message_id: Option<Uuid>,
    pub channel_id: Option<Uuid>,
    pub server_id: Option<Uuid>,
    pub reason: String,
    pub details: Option<String>,
    pub status: String,
    pub resolved_by: Option<Uuid>,
    pub resolved_at: Option<String>,
    pub created_at: String,
    pub message_content: Option<String>,
    pub message_author_id: Option<Uuid>,
    pub message_author_username: Option<String>,
}

/// POST /reports — submit a content report.
pub async fn create_report(
    auth: AuthUser,
    State(state): State<Arc<AppState>>,
    Json(req): Json<CreateReportRequest>,
) -> Result<impl IntoResponse, AppError> {
    let reason = req.reason.to_lowercase();
    if !VALID_REASONS.contains(&reason.as_str()) {
        return Err(AppError::BadRequest(format!(
            "Reason must be one of: {}", VALID_REASONS.join(", ")
        )));
    }

    let details = req.details.unwrap_or_default();
    if details.len() > 2000 {
        return Err(AppError::BadRequest("Details must be 2000 characters or fewer".into()));
    }

    // Look up message to get channel and server
    let msg = sqlx::query!(
        "SELECT m.id, m.channel_id, c.server_id
         FROM messages m
         JOIN channels c ON c.id = m.channel_id
         WHERE m.id = $1",
        req.message_id,
    )
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::NotFound("Message not found".into()))?;

    // Verify reporter is a member of the server
    let is_member = sqlx::query_scalar!(
        r#"SELECT EXISTS(SELECT 1 FROM server_members WHERE server_id = $1 AND user_id = $2) as "exists!""#,
        msg.server_id, auth.user_id,
    )
    .fetch_one(&state.db)
    .await?;

    if !is_member {
        return Err(AppError::Forbidden("Not a member of this server".into()));
    }

    // Rate limit: max 10 reports per hour per user
    let recent = sqlx::query_scalar!(
        r#"SELECT COUNT(*) as "count!" FROM content_reports
         WHERE reporter_id = $1 AND created_at > NOW() - INTERVAL '1 hour'"#,
        auth.user_id,
    )
    .fetch_one(&state.db)
    .await?;

    if recent >= 10 {
        return Err(AppError::RateLimited("You can submit up to 10 reports per hour".into()));
    }

    let row = sqlx::query!(
        "INSERT INTO content_reports (reporter_id, message_id, channel_id, server_id, reason, details)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id, created_at",
        auth.user_id,
        req.message_id,
        msg.channel_id,
        msg.server_id,
        reason,
        details,
    )
    .fetch_one(&state.db)
    .await?;

    Ok((StatusCode::CREATED, Json(serde_json::json!({
        "id": row.id,
        "message_id": req.message_id,
        "reason": reason,
        "created_at": row.created_at.to_rfc3339(),
    }))))
}

/// Row type for the list_reports query (avoids if/else type mismatch).
#[derive(sqlx::FromRow)]
struct ReportRow {
    id: Uuid,
    reporter_id: Uuid,
    message_id: Option<Uuid>,
    channel_id: Option<Uuid>,
    server_id: Option<Uuid>,
    reason: String,
    details: Option<String>,
    status: String,
    resolved_by: Option<Uuid>,
    resolved_at: Option<chrono::DateTime<chrono::Utc>>,
    created_at: chrono::DateTime<chrono::Utc>,
    reporter_username: Option<String>,
    message_content: Option<Vec<u8>>,
    message_author_id: Option<Uuid>,
    message_author_username: Option<String>,
}

/// GET /admin/reports — list content reports (admin only).
pub async fn list_reports(
    caller: PlatformUser,
    State(state): State<Arc<AppState>>,
    Query(params): Query<ListReportsParams>,
) -> Result<impl IntoResponse, AppError> {
    require_staff_role(&caller)?;

    let status_filter = params.status.unwrap_or_else(|| "open".into());
    let limit = params.limit.unwrap_or(50).min(200);
    let offset = params.offset.unwrap_or(0).max(0);

    let rows = sqlx::query_as!(
        ReportRow,
        r#"SELECT r.id, r.reporter_id, r.message_id, r.channel_id, r.server_id,
                  r.reason, r.details, r.status, r.resolved_by, r.resolved_at, r.created_at,
                  reporter.username as "reporter_username?",
                  m.content_ciphertext as "message_content?",
                  m.author_id as "message_author_id?",
                  author.username as "message_author_username?"
           FROM content_reports r
           LEFT JOIN users reporter ON reporter.id = r.reporter_id
           LEFT JOIN messages m ON m.id = r.message_id
           LEFT JOIN users author ON author.id = m.author_id
           WHERE r.status = $1
           ORDER BY r.created_at DESC
           LIMIT $2 OFFSET $3"#,
        status_filter,
        limit,
        offset,
    )
    .fetch_all(&state.db)
    .await?;

    let reports: Vec<ReportResponse> = rows.into_iter().map(|r| ReportResponse {
        id: r.id,
        reporter_id: r.reporter_id,
        reporter_username: r.reporter_username,
        message_id: r.message_id,
        channel_id: r.channel_id,
        server_id: r.server_id,
        reason: r.reason,
        details: r.details,
        status: r.status,
        resolved_by: r.resolved_by,
        resolved_at: r.resolved_at.map(|ts: chrono::DateTime<chrono::Utc>| ts.to_rfc3339()),
        created_at: r.created_at.to_rfc3339(),
        message_content: r.message_content.as_ref().map(|b| String::from_utf8_lossy(b).to_string()),
        message_author_id: r.message_author_id,
        message_author_username: r.message_author_username,
    }).collect();

    Ok(Json(reports))
}

/// PATCH /admin/reports/:id — resolve a report (admin only).
pub async fn resolve_report(
    caller: PlatformUser,
    State(state): State<Arc<AppState>>,
    Path(report_id): Path<Uuid>,
    Json(req): Json<ResolveReportRequest>,
) -> Result<impl IntoResponse, AppError> {
    require_staff_role(&caller)?;

    if !matches!(req.status.as_str(), "dismissed" | "actioned") {
        return Err(AppError::BadRequest("Status must be 'dismissed' or 'actioned'".into()));
    }

    let result: Option<_> = sqlx::query!(
        "UPDATE content_reports SET status = $1, resolved_by = $2, resolved_at = NOW()
         WHERE id = $3 AND status = 'open'
         RETURNING id",
        req.status,
        caller.user_id,
        report_id,
    )
    .fetch_optional(&state.db)
    .await?;

    if result.is_none() {
        return Err(AppError::NotFound("Report not found or already resolved".into()));
    }

    Ok(Json(serde_json::json!({
        "id": report_id,
        "status": req.status,
    })))
}
