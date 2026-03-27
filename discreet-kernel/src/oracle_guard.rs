use zeroize::Zeroize;

use crate::error::KernelError;

/// Sliding window rate counter. Rejects when count > limit within window.
#[derive(Zeroize)]
struct RateCounter {
    count: u32,
    window_start: f64,
}

impl RateCounter {
    fn new() -> Self {
        Self {
            count: 0,
            window_start: 0.0,
        }
    }

    /// Check rate. Resets window if expired.
    fn check(&mut self, limit: u32, now: f64, window_ms: f64) -> Result<(), KernelError> {
        if now - self.window_start > window_ms {
            self.count = 0;
            self.window_start = now;
        }
        self.count += 1;
        if self.count > limit {
            Err(KernelError::Locked)
        } else {
            Ok(())
        }
    }

    fn reset(&mut self) {
        self.count = 0;
        self.window_start = 0.0;
    }
}

/// Oracle protection: failure tracking (5 fails → lock) + rate limiting
/// (decrypt 100/10s, sign 50/10s, validate 200/10s). Thresholds at 5-7x
/// above normal human usage.
#[derive(Zeroize)]
pub struct OracleGuard {
    // ── Failure tracking ──
    /// Number of consecutive failed operations.
    pub failure_count: u32,
    /// Maximum failures before locking.
    pub max_failures: u32,

    // ── Rate limiting ──
    decrypt_rate: RateCounter,
    sign_rate: RateCounter,
    validate_rate: RateCounter,
}

impl OracleGuard {
    const DECRYPT_LIMIT: u32 = 100;
    const SIGN_LIMIT: u32 = 50;
    const VALIDATE_LIMIT: u32 = 200;
    const WINDOW_MS: f64 = 10_000.0;

    pub fn new() -> Self {
        Self {
            failure_count: 0,
            max_failures: 5,
            decrypt_rate: RateCounter::new(),
            sign_rate: RateCounter::new(),
            validate_rate: RateCounter::new(),
        }
    }

    /// Record a successful operation — resets the failure counter.
    pub fn record_success(&mut self) {
        self.failure_count = 0;
    }

    /// Record a failed operation. Returns true if the kernel should lock.
    pub fn record_failure(&mut self) -> bool {
        self.failure_count += 1;
        self.failure_count >= self.max_failures
    }

    /// Check decrypt rate limit. Call before every decryption.
    pub fn check_decrypt(&mut self, now: f64) -> Result<(), KernelError> {
        self.decrypt_rate
            .check(Self::DECRYPT_LIMIT, now, Self::WINDOW_MS)
    }

    /// Check sign rate limit. Call before every outgoing message.
    pub fn check_sign(&mut self, now: f64) -> Result<(), KernelError> {
        self.sign_rate
            .check(Self::SIGN_LIMIT, now, Self::WINDOW_MS)
    }

    /// Check validate rate limit. Call before every input validation.
    pub fn check_validate(&mut self, now: f64) -> Result<(), KernelError> {
        self.validate_rate
            .check(Self::VALIDATE_LIMIT, now, Self::WINDOW_MS)
    }

    /// Reset all counters after successful unlock.
    pub fn reset(&mut self) {
        self.failure_count = 0;
        self.decrypt_rate.reset();
        self.sign_rate.reset();
        self.validate_rate.reset();
    }
}

impl Default for OracleGuard {
    fn default() -> Self {
        Self::new()
    }
}
