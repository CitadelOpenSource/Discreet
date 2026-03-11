// citadel_error.rs — Unified error handling for the Citadel server.
//
// Every handler returns Result<_, AppError>. This module defines AppError
// and its conversion to HTTP responses. No panics, no unwrap() in handlers.

use axum::{
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use serde_json::json;

/// Application-wide error type. Converts cleanly into HTTP responses.
#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("Bad request: {0}")]
    BadRequest(String),

    #[error("Unauthorized: {0}")]
    Unauthorized(String),

    #[error("Forbidden: {0}")]
    Forbidden(String),

    #[error("Not found: {0}")]
    NotFound(String),

    #[error("Conflict: {0}")]
    Conflict(String),

    #[error("Rate limited: {0}")]
    RateLimited(String),

    #[error("Payload too large: {0}")]
    PayloadTooLarge(String),

    #[error("Internal error: {0}")]
    Internal(String),

    #[error("Database error: {0}")]
    Database(#[from] sqlx::Error),

    #[error("Serialization error: {0}")]
    Serialization(#[from] serde_json::Error),

    #[error("JWT error: {0}")]
    Jwt(#[from] jsonwebtoken::errors::Error),

    #[error("Crypto error: {0}")]
    Crypto(String),

    #[error("Agent spawn error: {0}")]
    AgentSpawn(String),

    #[error("Federation error: {0}")]
    Federation(String),

    #[error("Gone: {0}")]
    Gone(String),

    #[error("Not implemented: {0}")]
    NotImplemented(String),
}

impl IntoResponse for AppError {
    fn into_response(self) -> Response {
        let (status, code, message) = match &self {
            AppError::BadRequest(msg) => (StatusCode::BAD_REQUEST, "BAD_REQUEST", msg.clone()),
            AppError::Unauthorized(msg) => (StatusCode::UNAUTHORIZED, "UNAUTHORIZED", msg.clone()),
            AppError::Forbidden(msg) => (StatusCode::FORBIDDEN, "FORBIDDEN", msg.clone()),
            AppError::NotFound(msg) => (StatusCode::NOT_FOUND, "NOT_FOUND", msg.clone()),
            AppError::Conflict(msg) => (StatusCode::CONFLICT, "CONFLICT", msg.clone()),
            AppError::RateLimited(msg) => (StatusCode::TOO_MANY_REQUESTS, "RATE_LIMITED", msg.clone()),
            AppError::PayloadTooLarge(msg) => (StatusCode::PAYLOAD_TOO_LARGE, "PAYLOAD_TOO_LARGE", msg.clone()),
            AppError::Gone(msg) => (StatusCode::GONE, "GONE", msg.clone()),
            AppError::NotImplemented(msg) => (StatusCode::NOT_IMPLEMENTED, "NOT_IMPLEMENTED", msg.clone()),
            AppError::Database(e) => {
                tracing::error!("Database error: {e}");
                (StatusCode::INTERNAL_SERVER_ERROR, "DATABASE_ERROR", "Internal database error".into())
            }
            AppError::Serialization(e) => {
                tracing::error!("Serialization error: {e}");
                (StatusCode::INTERNAL_SERVER_ERROR, "SERIALIZATION_ERROR", "Internal error".into())
            }
            AppError::Jwt(e) => {
                (StatusCode::UNAUTHORIZED, "JWT_ERROR", format!("Token error: {e}"))
            }
            AppError::Crypto(msg) => {
                tracing::error!("Crypto error: {msg}");
                (StatusCode::INTERNAL_SERVER_ERROR, "CRYPTO_ERROR", "Cryptographic operation failed".into())
            }
            AppError::AgentSpawn(msg) => (StatusCode::INTERNAL_SERVER_ERROR, "AGENT_SPAWN_ERROR", msg.clone()),
            AppError::Federation(msg) => (StatusCode::BAD_GATEWAY, "FEDERATION_ERROR", msg.clone()),
            AppError::Internal(msg) => {
                tracing::error!("Internal error: {msg}");
                (StatusCode::INTERNAL_SERVER_ERROR, "INTERNAL_ERROR", "Internal server error".into())
            }
        };

        (status, Json(json!({
            "error": {
                "code": code,
                "message": message,
            }
        }))).into_response()
    }
}
