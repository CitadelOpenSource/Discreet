// citadel_health.rs — Health check and server info endpoints.
//
// Endpoints:
//   GET /health       — Simple "OK" for load balancers (fast, no auth)
//   GET /api/v1/info  — Server version, feature flags, connectivity status

use axum::{
    extract::State,
    response::IntoResponse,
    Json,
};
use std::sync::Arc;

use crate::citadel_state::AppState;

/// GET /api/v1/info — Returns server version, features, and connectivity status.
/// Useful for clients to check what the server supports.
pub async fn server_info(
    State(state): State<Arc<AppState>>,
) -> impl IntoResponse {
    // Check Postgres connectivity.
    let db_ok = sqlx::query_scalar!("SELECT 1 as alive")
        .fetch_one(&state.db)
        .await
        .is_ok();

    // Check Redis connectivity.
    let redis_ok = {
        let mut conn = state.redis.clone();
        redis::cmd("PING")
            .query_async::<_, String>(&mut conn)
            .await
            .is_ok()
    };

    Json(serde_json::json!({
        "name": "discreet-server",
        "version": env!("CARGO_PKG_VERSION"),
        "architecture": "zero-knowledge",
        "features": {
            "agents": state.config.agents_enabled,
            "federation": state.config.federation_enabled,
            "post_quantum": state.config.pq_enabled,
            "rate_limiting": true,
            "reactions": true,
            "typing_indicators": true,
        },
        "connectivity": {
            "database": db_ok,
            "redis": redis_ok,
        },
        "endpoints": {
            "api_version": "v1",
            "websocket": "/ws?server_id={uuid}",
            "docs": "https://github.com/CitadelOpenSource/Discreet",
        },
        "limits": {
            "rate_limit_per_minute": state.config.rate_limit_per_minute,
            "auth_rate_limit_per_minute": 30,
        }
    }))
}
