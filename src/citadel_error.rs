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

    #[error("Service unavailable: {0}")]
    ServiceUnavailable(String),

    #[error("Premium required: {needed} tier needed (current: {current})")]
    PremiumRequired { current: String, needed: String },

    #[error("Tier limit reached")]
    TierLimit(serde_json::Value),

    #[error("Not configured: {0}")]
    NotConfigured(String),
}

impl IntoResponse for AppError {
    fn into_response(self) -> Response {
        let (status, code, message) = match &self {
            AppError::BadRequest(msg) => (StatusCode::BAD_REQUEST, "BAD_REQUEST", msg.clone()),
            AppError::Unauthorized(msg) => (StatusCode::UNAUTHORIZED, "UNAUTHORIZED", if msg.is_empty() { "Please log in".into() } else { msg.clone() }),
            AppError::Forbidden(msg) => (StatusCode::FORBIDDEN, "FORBIDDEN", if msg.is_empty() { "Access denied".into() } else { msg.clone() }),
            AppError::NotFound(msg) => (StatusCode::NOT_FOUND, "NOT_FOUND", if msg.is_empty() { "Page not found".into() } else { msg.clone() }),
            AppError::Conflict(msg) => (StatusCode::CONFLICT, "CONFLICT", msg.clone()),
            AppError::RateLimited(msg) => (StatusCode::TOO_MANY_REQUESTS, "RATE_LIMITED", if msg.is_empty() { "Too many requests — please slow down".into() } else { msg.clone() }),
            AppError::PayloadTooLarge(msg) => (StatusCode::PAYLOAD_TOO_LARGE, "PAYLOAD_TOO_LARGE", msg.clone()),
            AppError::Gone(msg) => (StatusCode::GONE, "GONE", msg.clone()),
            AppError::NotImplemented(msg) => (StatusCode::NOT_IMPLEMENTED, "NOT_IMPLEMENTED", msg.clone()),
            AppError::Database(e) => {
                tracing::error!("Database error: {e}");
                (StatusCode::INTERNAL_SERVER_ERROR, "INTERNAL_ERROR", "Internal error — our team has been notified".into())
            }
            AppError::Serialization(e) => {
                tracing::error!("Serialization error: {e}");
                (StatusCode::INTERNAL_SERVER_ERROR, "INTERNAL_ERROR", "Internal error — our team has been notified".into())
            }
            AppError::Jwt(e) => {
                (StatusCode::UNAUTHORIZED, "UNAUTHORIZED", format!("Please log in (token expired: {e})"))
            }
            AppError::Crypto(msg) => {
                tracing::error!("Crypto error: {msg}");
                (StatusCode::INTERNAL_SERVER_ERROR, "INTERNAL_ERROR", "Internal error — our team has been notified".into())
            }
            AppError::AgentSpawn(msg) => (StatusCode::INTERNAL_SERVER_ERROR, "AGENT_SPAWN_ERROR", msg.clone()),
            AppError::Federation(msg) => (StatusCode::BAD_GATEWAY, "FEDERATION_ERROR", msg.clone()),
            AppError::Internal(msg) => {
                tracing::error!("Internal error: {msg}");
                (StatusCode::INTERNAL_SERVER_ERROR, "INTERNAL_ERROR", "Internal error — our team has been notified".into())
            }
            AppError::ServiceUnavailable(msg) => (StatusCode::SERVICE_UNAVAILABLE, "SERVICE_UNAVAILABLE", if msg.is_empty() { "Service temporarily unavailable".into() } else { msg.clone() }),
            AppError::PremiumRequired { current, needed } => {
                let body = serde_json::json!({
                    "error": {
                        "code": "PREMIUM_REQUIRED",
                        "message": format!("This feature requires the {} tier", needed),
                        "current_tier": current,
                        "needed_tier": needed,
                    }
                });
                return (StatusCode::PAYMENT_REQUIRED, Json(body)).into_response();
            }
            AppError::TierLimit(body) => {
                return (StatusCode::FORBIDDEN, Json(serde_json::json!({ "error": body }))).into_response();
            }
            AppError::NotConfigured(msg) => (StatusCode::SERVICE_UNAVAILABLE, "NOT_CONFIGURED", msg.clone()),
        };

        (status, Json(json!({
            "error": {
                "code": code,
                "message": message,
            }
        }))).into_response()
    }
}
