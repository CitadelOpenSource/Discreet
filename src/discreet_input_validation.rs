// discreet_input_validation.rs — Centralized input validation.
//
// Every user-facing string must pass through one of these validators before
// reaching the database. This is the primary defense against injection,
// stored XSS, and data corruption.
//
// Control character policy:
//   - REJECT: null bytes (0x00), control chars (0x01-0x08, 0x0B-0x0C, 0x0E-0x1F, 0x7F-0x9F)
//   - ALLOW: newline (0x0A) and tab (0x09) ONLY in message content and channel topics
//   - All other fields reject ALL control characters
//
// SSRF protection:
//   - validate_url_no_ssrf() resolves hostnames and rejects private/reserved IPs
//   - Used by: webhook URLs, agent endpoints, link preview fetcher

use crate::discreet_error::AppError;
use std::net::IpAddr;

// ─── Control character checks ───────────────────────────────────────────────

/// Strict check: rejects ALL control characters including newline and tab.
/// Use for: usernames, display names, server names, channel names, about_me, custom_status.
fn has_control_chars(s: &str) -> bool {
    s.chars().any(|c| c.is_control())
}

/// Relaxed check: allows newline (0x0A) and tab (0x09), rejects everything else.
/// Use for: message content, channel topics.
fn has_forbidden_control_chars(s: &str) -> bool {
    s.chars().any(|c| c.is_control() && c != '\n' && c != '\t')
}

// ─── Field validators ───────────────────────────────────────────────────────

// ─── Reserved usernames (checked case-insensitively) ────────────────────────

const RESERVED_USERNAMES: &[&str] = &[
    // System / platform
    "admin", "administrator", "mod", "moderator", "system", "bot", "root",
    "daemon", "server", "channel", "user", "account", "profile", "settings",
    "help", "info", "status", "api", "app", "web", "mail", "email", "ftp",
    "ssh", "www", "test", "testing", "null", "undefined", "void", "anonymous",
    "guest", "unknown", "deleted", "removed", "blocked", "banned", "suspended",
    // Brand (all variations)
    "discreet", "discreetai", "discreet_ai", "discreet_dev", "discreet_admin",
    "discreet_mod", "discreet_support", "discreet_help", "discreet_bot",
    "discreet_system", "discreet_official", "discreetofficial", "discreetdev",
    "discreetadmin", "discreetmod", "discreetsupport", "discreethelp",
    "discreetbot", "discreetsystem", "d1screet", "d1scr33t", "discr33t", "disc_reet",
    // Legacy brand
    "citadel", "citadeladmin", "citadeldev", "citadelmod", "citadelbot",
    // Roles
    "owner", "developer", "dev", "tester", "founder", "ceo", "cto", "staff",
    "team", "official", "verified", "support", "security", "abuse", "postmaster",
    "webmaster", "noreply", "no_reply", "mailer_daemon", "notifications",
    // Chat specific
    "everyone", "here", "ghost",
];

// ─── Hate speech / slur ban list (NOT general profanity) ────────────────────

const BANNED_USERNAME_WORDS: &[&str] = &[
    // Racial slurs
    "nigger", "nigga", "chink", "spic", "wetback", "kike", "gook", "raghead",
    "towelhead", "beaner", "coon", "darkie", "jigaboo", "porchmonkey", "zipperhead",
    // Homophobic slurs
    "faggot", "fag", "dyke", "tranny",
    // Other hate
    "nazi", "hitler", "kkk", "whitepower", "heil", "siegheil", "1488", "gasjews",
];

/// Normalize a string for leetspeak-resistant profanity matching.
/// Lowercase, strip underscores, replace common substitutions.
fn normalize_leetspeak(s: &str) -> String {
    s.to_lowercase()
        .replace('_', "")
        .replace('0', "o")
        .replace('1', "i")
        .replace('3', "e")
        .replace('4', "a")
        .replace('5', "s")
        .replace('7', "t")
        .replace('@', "a")
        .replace('$', "s")
}

/// Check if a string contains any banned hate speech words after leetspeak normalization.
fn contains_banned_word(s: &str) -> bool {
    let normalized = normalize_leetspeak(s);
    BANNED_USERNAME_WORDS.iter().any(|w| normalized.contains(w))
}

/// Validate a username: 2-30 chars, ^[a-zA-Z0-9_]{2,30}$, not reserved, no hate speech.
pub fn validate_username(name: &str) -> Result<(), AppError> {
    let len = name.chars().count();
    if len < 2 {
        return Err(AppError::BadRequest("Username must be at least 2 characters".into()));
    }
    if len > 30 {
        return Err(AppError::BadRequest("Username must be 30 characters or fewer".into()));
    }
    if !name.chars().all(|c| c.is_ascii_alphanumeric() || c == '_') {
        return Err(AppError::BadRequest(
            "Username may only contain letters, numbers, and underscores".into(),
        ));
    }
    // Reserved name check (case-insensitive)
    let lower = name.to_lowercase();
    if RESERVED_USERNAMES.contains(&lower.as_str()) {
        return Err(AppError::BadRequest("This username is reserved".into()));
    }
    // Hate speech check (leetspeak-normalized)
    if contains_banned_word(name) {
        return Err(AppError::BadRequest("Username contains prohibited content".into()));
    }
    Ok(())
}

/// Validate display name content for hate speech (used for nicknames and profiles).
pub fn validate_display_name_content(name: &str) -> Result<(), AppError> {
    if contains_banned_word(name) {
        return Err(AppError::BadRequest("Display name contains prohibited content".into()));
    }
    Ok(())
}

/// Validate a server name: 2-100 chars, no control characters.
pub fn validate_server_name(name: &str) -> Result<(), AppError> {
    let trimmed = name.trim();
    let len = trimmed.chars().count();
    if len < 2 {
        return Err(AppError::BadRequest("Server name must be at least 2 characters".into()));
    }
    if len > 100 {
        return Err(AppError::BadRequest("Server name must be 100 characters or fewer".into()));
    }
    if has_control_chars(trimmed) {
        return Err(AppError::BadRequest("Server name contains invalid characters".into()));
    }
    Ok(())
}

/// Validate a channel name: 1-100 chars, no control characters.
pub fn validate_channel_name(name: &str) -> Result<(), AppError> {
    let trimmed = name.trim();
    let len = trimmed.chars().count();
    if len == 0 {
        return Err(AppError::BadRequest("Channel name cannot be empty".into()));
    }
    if len > 100 {
        return Err(AppError::BadRequest("Channel name must be 100 characters or fewer".into()));
    }
    if has_control_chars(trimmed) {
        return Err(AppError::BadRequest("Channel name contains invalid characters".into()));
    }
    Ok(())
}

/// Validate a channel topic: max 1024 chars, allows newlines and tabs.
pub fn validate_channel_topic(topic: &str) -> Result<(), AppError> {
    if topic.chars().count() > 1024 {
        return Err(AppError::BadRequest("Channel topic must be 1,024 characters or fewer".into()));
    }
    if has_forbidden_control_chars(topic) {
        return Err(AppError::BadRequest("Channel topic contains invalid control characters".into()));
    }
    Ok(())
}

/// Validate message content: 1-4000 chars, allows newlines and tabs.
pub fn validate_message(content: &str) -> Result<(), AppError> {
    if content.is_empty() {
        return Err(AppError::BadRequest("Message cannot be empty".into()));
    }
    if content.chars().count() > 4000 {
        return Err(AppError::BadRequest("Message must be 4,000 characters or fewer".into()));
    }
    if has_forbidden_control_chars(content) {
        return Err(AppError::BadRequest("Message contains invalid control characters".into()));
    }
    Ok(())
}

/// Validate a display name: 1-32 chars, no control characters, no hate speech.
pub fn validate_display_name(name: &str) -> Result<(), AppError> {
    let trimmed = name.trim();
    let len = trimmed.chars().count();
    if len == 0 {
        return Err(AppError::BadRequest("Display name cannot be empty".into()));
    }
    if len > 32 {
        return Err(AppError::BadRequest("Display name must be 32 characters or fewer".into()));
    }
    if has_control_chars(trimmed) {
        return Err(AppError::BadRequest("Display name contains invalid characters".into()));
    }
    validate_display_name_content(trimmed)?;
    Ok(())
}

/// Validate about_me text: max 190 chars, no control characters.
pub fn validate_about_me(text: &str) -> Result<(), AppError> {
    if text.chars().count() > 190 {
        return Err(AppError::BadRequest("About me must be 190 characters or fewer".into()));
    }
    if has_control_chars(text) {
        return Err(AppError::BadRequest("About me contains invalid characters".into()));
    }
    Ok(())
}

/// Validate custom status: max 128 chars, no control characters.
pub fn validate_custom_status(status: &str) -> Result<(), AppError> {
    if status.chars().count() > 128 {
        return Err(AppError::BadRequest("Status must be 128 characters or fewer".into()));
    }
    if has_control_chars(status) {
        return Err(AppError::BadRequest("Status contains invalid characters".into()));
    }
    Ok(())
}

/// Validate an invite code: 1-32 chars, alphanumeric only.
pub fn validate_invite_code(code: &str) -> Result<(), AppError> {
    if code.is_empty() {
        return Err(AppError::BadRequest("Invite code cannot be empty".into()));
    }
    if code.len() > 32 {
        return Err(AppError::BadRequest("Invite code must be 32 characters or fewer".into()));
    }
    if !code.chars().all(|c| c.is_ascii_alphanumeric()) {
        return Err(AppError::BadRequest("Invite code must be alphanumeric only".into()));
    }
    Ok(())
}

/// Validate an email address: max 254 chars, must contain exactly one @
/// with non-empty local and domain parts, domain must contain a dot.
pub fn validate_email(email: &str) -> Result<(), AppError> {
    let trimmed = email.trim();
    if trimmed.is_empty() {
        return Err(AppError::BadRequest("Email cannot be empty".into()));
    }
    if trimmed.len() > 254 {
        return Err(AppError::BadRequest("Email must be 254 characters or fewer".into()));
    }
    let parts: Vec<&str> = trimmed.splitn(2, '@').collect();
    if parts.len() != 2 || parts[0].is_empty() || parts[1].is_empty() {
        return Err(AppError::BadRequest("Invalid email format".into()));
    }
    if !parts[1].contains('.') {
        return Err(AppError::BadRequest("Invalid email domain".into()));
    }
    if has_control_chars(trimmed) {
        return Err(AppError::BadRequest("Email contains invalid characters".into()));
    }
    Ok(())
}

// ─── SSRF Protection ────────────────────────────────────────────────────────

/// Returns true if the IP address is in a private, reserved, or link-local range.
/// Blocks: RFC 1918, loopback, link-local, cloud metadata, ULA, etc.
fn is_private_ip(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(v4) => {
            v4.is_loopback()              // 127.0.0.0/8
            || v4.is_private()            // 10/8, 172.16/12, 192.168/16
            || v4.is_link_local()         // 169.254.0.0/16
            || v4.is_broadcast()          // 255.255.255.255
            || v4.is_unspecified()        // 0.0.0.0
            || v4.octets() == [169, 254, 169, 254]  // AWS/GCP/Azure metadata
            || v4.octets()[0] == 100 && (v4.octets()[1] & 0xC0) == 64 // 100.64/10 (CGNAT)
            || v4.octets()[0] == 198 && v4.octets()[1] >= 18 && v4.octets()[1] <= 19 // 198.18/15 (benchmarks)
        }
        IpAddr::V6(v6) => {
            v6.is_loopback()              // ::1
            || v6.is_unspecified()        // ::
            || (v6.segments()[0] & 0xfe00) == 0xfc00  // ULA (fc00::/7)
            || (v6.segments()[0] & 0xffc0) == 0xfe80  // Link-local (fe80::/10)
        }
    }
}

/// Validate a URL for SSRF safety: HTTPS required (except localhost HTTP),
/// DNS resolution checked against private IP ranges, cloud metadata blocked.
///
/// Call this before making ANY outbound HTTP request with a user-supplied URL.
pub async fn validate_url_no_ssrf(url_str: &str) -> Result<(), AppError> {
    if url_str.len() > 2048 {
        return Err(AppError::BadRequest("URL must be 2048 characters or fewer".into()));
    }

    let parsed = url::Url::parse(url_str)
        .map_err(|_| AppError::BadRequest("Invalid URL format".into()))?;

    let host = parsed.host_str()
        .ok_or_else(|| AppError::BadRequest("URL has no host".into()))?;

    let is_localhost = host == "localhost" || host == "127.0.0.1" || host == "[::1]" || host == "0.0.0.0";

    // Scheme check
    match parsed.scheme() {
        "https" => {} // always allowed
        "http" if is_localhost => {} // localhost HTTP allowed for development
        "http" => return Err(AppError::BadRequest("External URLs must use HTTPS".into())),
        _ => return Err(AppError::BadRequest("URL scheme must be HTTPS".into())),
    }

    // Skip DNS resolution for localhost (it's always safe and avoids unnecessary lookups)
    if is_localhost {
        return Ok(());
    }

    // DNS resolve and check all IPs
    let port = parsed.port_or_known_default().unwrap_or(443);
    let addrs: Vec<std::net::SocketAddr> = tokio::net::lookup_host(format!("{host}:{port}"))
        .await
        .map_err(|_| AppError::BadRequest("DNS resolution failed for URL".into()))?
        .collect();

    if addrs.is_empty() {
        return Err(AppError::BadRequest("URL hostname has no DNS records".into()));
    }

    for addr in &addrs {
        if is_private_ip(addr.ip()) {
            tracing::warn!(
                url = url_str,
                resolved_ip = %addr.ip(),
                "SSRF blocked: URL resolves to private IP"
            );
            return Err(AppError::BadRequest("URL resolves to a private or reserved IP address".into()));
        }
    }

    Ok(())
}

// ─── Tests ──────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_username_valid() {
        assert!(validate_username("alice").is_ok());
        assert!(validate_username("Bob_123").is_ok());
        assert!(validate_username("ab").is_ok()); // 2 char minimum
        assert!(validate_username(&"a".repeat(30)).is_ok()); // exactly 30
        assert!(validate_username("x_y").is_ok());
    }

    #[test]
    fn test_username_invalid_format() {
        assert!(validate_username("").is_err()); // empty
        assert!(validate_username("a").is_err()); // too short (< 2)
        assert!(validate_username(&"a".repeat(31)).is_err()); // too long (> 30)
        assert!(validate_username("hello world").is_err()); // space
        assert!(validate_username("user@name").is_err()); // @
        assert!(validate_username("user.name").is_err()); // dot
        assert!(validate_username("test-user").is_err()); // hyphen not allowed
        assert!(validate_username("名前").is_err()); // non-ASCII
    }

    #[test]
    fn test_username_reserved() {
        assert!(validate_username("admin").is_err());
        assert!(validate_username("Admin").is_err()); // case-insensitive
        assert!(validate_username("SYSTEM").is_err());
        assert!(validate_username("discreet").is_err());
        assert!(validate_username("DiscreetAI").is_err());
        // Personal names are NOT reserved — founder registers normally
        assert!(validate_username("moderator").is_err());
    }

    #[test]
    fn test_username_profanity() {
        assert!(validate_username("n1gg3r_user").is_err()); // leetspeak slur
        assert!(validate_username("f4gg0t").is_err()); // leetspeak slur
        assert!(validate_username("coolnazi99").is_err()); // contains "nazi"
        // General profanity is NOT banned
        assert!(validate_username("fuck_yeah").is_ok()); // general swearing allowed
        assert!(validate_username("shitpost").is_ok()); // general swearing allowed
    }

    #[test]
    fn test_server_name_valid_and_invalid() {
        assert!(validate_server_name("My Server").is_ok());
        assert!(validate_server_name("日本語サーバー").is_ok());
        assert!(validate_server_name("ab").is_ok()); // min 2
        assert!(validate_server_name("a").is_err()); // too short
        assert!(validate_server_name("").is_err());
        assert!(validate_server_name("   ").is_err()); // whitespace only
        assert!(validate_server_name(&"x".repeat(101)).is_err());
        assert!(validate_server_name("bad\x00name").is_err());
        assert!(validate_server_name("bad\x1Bname").is_err());
    }

    #[test]
    fn test_message_allows_newlines_and_tabs() {
        assert!(validate_message("line1\nline2").is_ok()); // newline allowed
        assert!(validate_message("col1\tcol2").is_ok()); // tab allowed
        assert!(validate_message("bad\x00null").is_err()); // null byte rejected
        assert!(validate_message("bad\x01ctrl").is_err()); // control char rejected
    }

    #[test]
    fn test_channel_topic() {
        assert!(validate_channel_topic("Welcome to the channel!").is_ok());
        assert!(validate_channel_topic("Line 1\nLine 2").is_ok()); // newlines allowed
        assert!(validate_channel_topic(&"x".repeat(1024)).is_ok()); // exactly at limit
        assert!(validate_channel_topic(&"x".repeat(1025)).is_err()); // over limit
        assert!(validate_channel_topic("bad\x00topic").is_err()); // null byte
    }

    #[test]
    fn test_display_name_max_32() {
        assert!(validate_display_name("Alice").is_ok());
        assert!(validate_display_name(&"x".repeat(32)).is_ok());
        assert!(validate_display_name(&"x".repeat(33)).is_err());
        assert!(validate_display_name("bad\nnewline").is_err());
    }

    #[test]
    fn test_about_me() {
        assert!(validate_about_me("I like coding").is_ok());
        assert!(validate_about_me(&"x".repeat(190)).is_ok());
        assert!(validate_about_me(&"x".repeat(191)).is_err());
    }

    #[test]
    fn test_custom_status() {
        assert!(validate_custom_status("Working").is_ok());
        assert!(validate_custom_status(&"x".repeat(128)).is_ok());
        assert!(validate_custom_status(&"x".repeat(129)).is_err());
    }

    #[test]
    fn test_invite_code() {
        assert!(validate_invite_code("abc123").is_ok());
        assert!(validate_invite_code("ABC").is_ok());
        assert!(validate_invite_code("").is_err());
        assert!(validate_invite_code(&"a".repeat(33)).is_err());
        assert!(validate_invite_code("code-with-hyphen").is_err());
        assert!(validate_invite_code("code with space").is_err());
    }

    #[test]
    fn test_email_valid_and_invalid() {
        assert!(validate_email("user@example.com").is_ok());
        assert!(validate_email("a@b.co").is_ok());
        assert!(validate_email("user+tag@domain.org").is_ok());
        assert!(validate_email("").is_err());
        assert!(validate_email("noatsign").is_err());
        assert!(validate_email("@domain.com").is_err());
        assert!(validate_email("user@").is_err());
        assert!(validate_email("user@nodot").is_err());
        assert!(validate_email(&format!("{}@example.com", "a".repeat(250))).is_err());
    }

    #[test]
    fn test_private_ip_detection() {
        assert!(is_private_ip("127.0.0.1".parse().unwrap()));
        assert!(is_private_ip("10.0.0.1".parse().unwrap()));
        assert!(is_private_ip("172.16.0.1".parse().unwrap()));
        assert!(is_private_ip("192.168.1.1".parse().unwrap()));
        assert!(is_private_ip("169.254.169.254".parse().unwrap())); // cloud metadata
        assert!(is_private_ip("0.0.0.0".parse().unwrap()));
        assert!(is_private_ip("::1".parse().unwrap()));
        assert!(!is_private_ip("8.8.8.8".parse().unwrap()));
        assert!(!is_private_ip("1.1.1.1".parse().unwrap()));
    }
}

// ─── Fuzz tests (proptest) ──────────────────────────────────────────────

#[cfg(test)]
mod fuzz_tests {
    use super::*;
    use proptest::prelude::*;

    proptest! {
        /// No valid input should crash the validator — every input returns Ok or Err.
        #[test]
        fn username_never_panics(s in ".*") {
            let _ = validate_username(&s);
        }

        /// Control chars must always be rejected in strict fields.
        #[test]
        fn control_chars_rejected_in_display_name(c in 0u8..32u8) {
            let bad = format!("a{}b", char::from(c));
            // All control chars should be rejected in display names
            if c != b'\n' && c != b'\t' && c != b'\r' {
                // These are control chars that should fail
                assert!(validate_display_name(&bad).is_err() || c == b'\n' || c == b'\t');
            }
        }

        /// Messages may contain newlines and tabs but not null bytes.
        #[test]
        fn message_rejects_null_bytes(s in "[^\x00]{1,100}\x00[^\x00]{0,100}") {
            assert!(validate_message(&s).is_err());
        }
    }
}
