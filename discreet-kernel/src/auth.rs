/// Session validation — checks expiry against current time.
use crate::state::SessionState;

/// Verify that the session is still valid (not expired).
pub fn is_session_valid(session: &SessionState) -> bool {
    let now = unix_now();
    session.expires_at > now
}

/// Current unix timestamp in seconds.
fn unix_now() -> i64 {
    // In WASM, use js_sys::Date::now(). In native, use std::time.
    #[cfg(target_arch = "wasm32")]
    {
        (js_sys::Date::now() / 1000.0) as i64
    }
    #[cfg(not(target_arch = "wasm32"))]
    {
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs() as i64
    }
}
