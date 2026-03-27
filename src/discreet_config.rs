// discreet_config.rs — Server configuration loaded from environment variables.
//
// All sensitive values come from env vars (never hardcoded).
// Non-sensitive defaults are set here for development convenience.

use serde::Deserialize;

/// Top-level server configuration.
#[derive(Debug, Clone, Deserialize)]
pub struct Config {
    // ── Network ──────────────────────────────────────────
    /// Bind address (default: 0.0.0.0)
    #[serde(default = "default_host")]
    pub host: String,
    /// Bind port (default: 3000)
    #[serde(default = "default_port")]
    pub port: u16,

    // ── URLs ──────────────────────────────────────────────
    /// Public-facing URL (e.g., https://discreetai.net).
    /// Used for email footers, Open Graph metadata, external links.
    pub public_url: Option<String>,
    /// Frontend app URL (e.g., https://app.discreetai.net).
    /// Used as default CORS origin when CORS_ORIGINS is not set.
    /// Email verification and password reset links point here.
    pub app_url: Option<String>,
    /// API base URL (e.g., https://api.discreetai.net/api/v1).
    /// Self-hosted instances default to same-origin /api/v1.
    pub api_url: Option<String>,

    // ── Database ─────────────────────────────────────────
    /// PostgreSQL connection URL
    pub database_url: String,
    /// Max database connections (default: 20)
    #[serde(default = "default_db_pool")]
    pub database_max_connections: u32,

    // ── Redis ────────────────────────────────────────────
    /// Redis connection URL
    pub redis_url: String,

    // ── Auth ─────────────────────────────────────────────
    /// JWT signing secret (min 32 bytes)
    pub jwt_secret: String,
    /// JWT access token expiry in seconds (default: 900 = 15 minutes)
    #[serde(default = "default_jwt_expiry")]
    pub jwt_expiry_secs: u64,
    /// Refresh token expiry in seconds (default: 604800 = 7 days)
    #[serde(default = "default_refresh_expiry")]
    pub refresh_expiry_secs: u64,
    /// AES-256-GCM key for encrypting TOTP secrets at rest (hex-encoded, 32 bytes = 64 hex chars).
    /// If not set, derives a key from JWT_SECRET via SHA-256. Set a separate key in production.
    pub totp_encryption_key: Option<String>,

    // ── Feature Flags ────────────────────────────────────
    /// Enable post-quantum cryptography endpoints
    #[serde(default)]
    pub pq_enabled: bool,
    /// Default PQ security level (1-4)
    #[serde(default = "default_pq_level")]
    pub pq_security_level: u8,
    /// Enable federation protocol
    #[serde(default)]
    pub federation_enabled: bool,
    /// Enable AI agent framework
    #[serde(default)]
    pub agents_enabled: bool,
    /// Self-hosted mode — relaxes production credential checks,
    /// grants enterprise tier to all users. Defaults API URL to same-origin /api/v1.
    #[serde(default)]
    pub self_hosted: bool,

    // ── AI Agents ────────────────────────────────────────
    /// Master secret for AES-256-GCM encryption of agent API keys at rest.
    /// Each agent derives a unique key via SHA-256(secret || ":" || agent_id).
    /// Generate with: openssl rand -hex 32
    #[serde(default = "default_agent_key_secret")]
    pub agent_key_secret: String,
    /// LLM inference endpoint for managed agents
    pub agent_llm_endpoint: Option<String>,
    /// Max concurrent agents per server
    #[serde(default = "default_max_agents")]
    pub max_agents_per_server: u32,

    // ── Federation ───────────────────────────────────────
    /// This instance's public domain (e.g., "chat.example.com")
    pub federation_domain: Option<String>,
    /// Federation listener port (default: 8448)
    #[serde(default = "default_federation_port")]
    pub federation_port: u16,

    // ── Rate Limiting ────────────────────────────────────
    /// Max requests per minute per IP (default: 120)
    #[serde(default = "default_rate_limit")]
    pub rate_limit_per_minute: u32,

    // ── Uploads ───────────────────────────────────────────
    /// Max upload body size in bytes (default: 25 MB = 26214400).
    /// Applied as a body limit on file upload endpoints.
    #[serde(default = "default_max_upload_bytes")]
    pub max_upload_bytes: usize,
}

impl Config {
    /// Load configuration from environment variables.
    /// Panics on missing required vars (fail-fast at startup).
    pub fn from_env() -> Self {
        dotenvy::dotenv().ok();
        envy::from_env().expect(
            "Failed to load configuration. Required env vars: \
             DATABASE_URL, REDIS_URL, JWT_SECRET"
        )
    }
}

// ── Defaults ────────────────────────────────────────────────────────────

fn default_host() -> String { "0.0.0.0".into() }
fn default_port() -> u16 { 3000 }
fn default_db_pool() -> u32 { 20 }
fn default_jwt_expiry() -> u64 { 900 }
fn default_refresh_expiry() -> u64 { 604_800 }
fn default_pq_level() -> u8 { 3 }
fn default_agent_key_secret() -> String { "CHANGE_ME_generate_with_openssl_rand_hex_32".into() }
fn default_max_agents() -> u32 { 50 }
fn default_federation_port() -> u16 { 8448 }
fn default_rate_limit() -> u32 { 120 }
fn default_max_upload_bytes() -> usize { 25 * 1024 * 1024 } // 25 MB
