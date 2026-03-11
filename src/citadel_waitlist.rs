// citadel_waitlist.rs — Waitlist signup endpoint.
//
// Endpoints:
//   POST /api/v1/waitlist  — Add email to launch waitlist (no auth required)

use axum::{
    extract::State,
    http::StatusCode,
    response::IntoResponse,
    Json,
};
use serde::Deserialize;
use std::sync::Arc;

use crate::citadel_error::AppError;
use crate::citadel_state::AppState;

#[derive(Debug, Deserialize)]
pub struct WaitlistRequest {
    pub email: String,
}

pub async fn join_waitlist(
    State(state): State<Arc<AppState>>,
    Json(req): Json<WaitlistRequest>,
) -> Result<impl IntoResponse, AppError> {
    let email = req.email.trim().to_lowercase();

    // Basic email validation: must contain @ and a dot after @
    let at_pos = email.find('@');
    let valid = match at_pos {
        Some(pos) => pos > 0 && email[pos + 1..].contains('.'),
        None => false,
    };
    if !valid {
        return Err(AppError::BadRequest("Invalid email address".into()));
    }

    // Check if already registered
    let exists = sqlx::query_scalar!(
        "SELECT EXISTS(SELECT 1 FROM waitlist WHERE email = $1)",
        email,
    )
    .fetch_one(&state.db)
    .await?
    .unwrap_or(false);

    if exists {
        return Ok((StatusCode::OK, Json(serde_json::json!({ "status": "already_registered" }))));
    }

    sqlx::query!(
        "INSERT INTO waitlist (email) VALUES ($1)",
        email,
    )
    .execute(&state.db)
    .await?;

    Ok((StatusCode::CREATED, Json(serde_json::json!({ "status": "ok" }))))
}
