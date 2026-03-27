// discreet_circuit_breaker.rs — Circuit breaker for external service calls.
//
// When Redis (or another service) fails repeatedly, the circuit opens and
// all calls short-circuit for a cooldown period. This prevents cascade
// failures and ensures Redis outages degrade gracefully:
//
//   Closed  → normal operation, count failures
//   Open    → skip calls for reset_timeout, then try one (HalfOpen)
//   HalfOpen → single probe: success → Closed, failure → Open
//
// When the Redis circuit is Open:
//   - Rate limiting is SKIPPED (requests allowed through, not rejected)
//   - Caching is SKIPPED (queries go directly to DB)
//   - A warning is logged on each skip
//
// This means Redis dying makes the app slower but NEVER causes user-facing errors.

use std::sync::atomic::{AtomicU8, AtomicU32, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant};

/// Circuit breaker states.
const STATE_CLOSED: u8 = 0;
const STATE_OPEN: u8 = 1;
const STATE_HALF_OPEN: u8 = 2;

/// Global Redis circuit breaker instance.
static REDIS_CIRCUIT: std::sync::LazyLock<CircuitBreaker> =
    std::sync::LazyLock::new(|| CircuitBreaker::new(5, Duration::from_secs(30)));

pub struct CircuitBreaker {
    state: AtomicU8,
    failure_count: AtomicU32,
    threshold: u32,
    reset_timeout: Duration,
    last_failure: Mutex<Option<Instant>>,
}

impl CircuitBreaker {
    /// Create a new circuit breaker.
    /// `threshold`: number of consecutive failures before opening.
    /// `reset_timeout`: how long to stay open before probing.
    pub fn new(threshold: u32, reset_timeout: Duration) -> Self {
        Self {
            state: AtomicU8::new(STATE_CLOSED),
            failure_count: AtomicU32::new(0),
            threshold,
            reset_timeout,
            last_failure: Mutex::new(None),
        }
    }

    /// Current state as a string (for logging/diagnostics).
    pub fn state_name(&self) -> &'static str {
        match self.state.load(Ordering::Relaxed) {
            STATE_CLOSED => "closed",
            STATE_OPEN => "open",
            STATE_HALF_OPEN => "half-open",
            _ => "unknown",
        }
    }

    /// Returns true if the circuit is open (calls should be skipped).
    pub fn is_open(&self) -> bool {
        let state = self.state.load(Ordering::Relaxed);
        if state == STATE_CLOSED {
            return false;
        }
        if state == STATE_OPEN {
            // Check if reset_timeout has elapsed → transition to HalfOpen
            if let Ok(guard) = self.last_failure.lock() {
                if let Some(last) = *guard {
                    if last.elapsed() >= self.reset_timeout {
                        self.state.store(STATE_HALF_OPEN, Ordering::Relaxed);
                        return false; // allow one probe
                    }
                }
            }
            return true; // still in cooldown
        }
        // HalfOpen: allow the probe
        false
    }

    /// Record a successful call. Resets the breaker to Closed.
    pub fn record_success(&self) {
        self.failure_count.store(0, Ordering::Relaxed);
        self.state.store(STATE_CLOSED, Ordering::Relaxed);
    }

    /// Record a failed call. May transition to Open.
    pub fn record_failure(&self) {
        let count = self.failure_count.fetch_add(1, Ordering::Relaxed) + 1;
        if let Ok(mut guard) = self.last_failure.lock() {
            *guard = Some(Instant::now());
        }
        let state = self.state.load(Ordering::Relaxed);
        if state == STATE_HALF_OPEN {
            // Probe failed → back to Open
            self.state.store(STATE_OPEN, Ordering::Relaxed);
            tracing::warn!("Circuit breaker: half-open probe failed, reopening");
        } else if count >= self.threshold {
            self.state.store(STATE_OPEN, Ordering::Relaxed);
            tracing::error!(
                failures = count,
                threshold = self.threshold,
                "Circuit breaker OPENED: too many consecutive failures"
            );
        }
    }

    /// Execute an async operation through the circuit breaker.
    /// Returns `None` if the circuit is open (caller should use fallback).
    /// Returns `Some(Ok(T))` on success, `Some(Err(E))` on failure.
    pub async fn execute<F, T, E>(&self, op: F) -> Option<Result<T, E>>
    where
        F: std::future::Future<Output = Result<T, E>>,
    {
        if self.is_open() {
            return None; // circuit open — skip
        }

        match op.await {
            Ok(val) => {
                self.record_success();
                Some(Ok(val))
            }
            Err(err) => {
                self.record_failure();
                Some(Err(err))
            }
        }
    }
}

// ─── Public API for Redis circuit breaker ───────────────────────────────

/// Check if the Redis circuit breaker is open.
/// When open, callers should skip Redis and use fallback behavior.
pub fn redis_is_open() -> bool {
    REDIS_CIRCUIT.is_open()
}

/// Record a successful Redis operation.
pub fn redis_success() {
    REDIS_CIRCUIT.record_success();
}

/// Record a failed Redis operation.
pub fn redis_failure() {
    REDIS_CIRCUIT.record_failure();
}

/// Execute a Redis operation through the circuit breaker.
/// Returns `None` if the circuit is open (use fallback).
pub async fn redis_execute<F, T, E>(op: F) -> Option<Result<T, E>>
where
    F: std::future::Future<Output = Result<T, E>>,
{
    REDIS_CIRCUIT.execute(op).await
}

/// Get the current state name for diagnostics.
pub fn redis_state() -> &'static str {
    REDIS_CIRCUIT.state_name()
}
