/// Input validation — mirrors server-side rules exactly.
/// Control chars rejected everywhere; \n and \t allowed in messages/topics only.
use crate::error::KernelError;
use std::net::IpAddr;

// ─── Control character checks ───────────────────────────────────────────────

/// Strict check: rejects ALL control characters including newline and tab.
fn has_control_chars(s: &str) -> bool {
    s.chars().any(|c| c.is_control())
}

/// Relaxed check: allows newline (0x0A) and tab (0x09), rejects everything else.
fn has_forbidden_control_chars(s: &str) -> bool {
    s.chars().any(|c| c.is_control() && c != '\n' && c != '\t')
}

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

const BANNED_WORDS: &[&str] = &[
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
    BANNED_WORDS.iter().any(|w| normalized.contains(w))
}

fn vfail(field: &str, message: &str) -> KernelError {
    KernelError::ValidationFailed {
        field: field.to_string(),
        message: message.to_string(),
    }
}

// ─── Field validators ───────────────────────────────────────────────────────

/// Dispatch validation by field name. Called from Kernel::handle().
pub fn validate_field(field: &str, value: &str) -> Result<(), KernelError> {
    match field {
        "username" => validate_username(value),
        "email" => validate_email(value),
        "password" => validate_password(value),
        "display_name" => validate_display_name(value),
        "message" => validate_message(value),
        "server_name" => validate_server_name(value),
        "channel_name" => validate_channel_name(value),
        "channel_topic" => validate_channel_topic(value),
        "custom_status" => validate_custom_status(value),
        "about_me" => validate_about_me(value),
        "invite_code" => validate_invite_code(value),
        "url" => validate_url(value),
        _ => Err(KernelError::InvalidRequest(format!("Unknown field: {}", field))),
    }
}

/// Validate a username: 2-30 chars, ^[a-zA-Z0-9_]{2,30}$, not reserved, no hate speech.
pub fn validate_username(name: &str) -> Result<(), KernelError> {
    let len = name.chars().count();
    if len < 2 {
        return Err(vfail("username", "Username must be at least 2 characters"));
    }
    if len > 30 {
        return Err(vfail("username", "Username must be 30 characters or fewer"));
    }
    if !name.chars().all(|c| c.is_ascii_alphanumeric() || c == '_') {
        return Err(vfail("username", "Username may only contain letters, numbers, and underscores"));
    }
    let lower = name.to_lowercase();
    if RESERVED_USERNAMES.contains(&lower.as_str()) {
        return Err(vfail("username", "This username is reserved"));
    }
    if contains_banned_word(name) {
        return Err(vfail("username", "Username contains prohibited content"));
    }
    Ok(())
}

/// Validate email: max 254 chars, one @ with non-empty parts, domain has dot.
pub fn validate_email(email: &str) -> Result<(), KernelError> {
    let trimmed = email.trim();
    if trimmed.is_empty() {
        return Err(vfail("email", "Email cannot be empty"));
    }
    if trimmed.len() > 254 {
        return Err(vfail("email", "Email must be 254 characters or fewer"));
    }
    let parts: Vec<&str> = trimmed.splitn(2, '@').collect();
    if parts.len() != 2 || parts[0].is_empty() || parts[1].is_empty() {
        return Err(vfail("email", "Invalid email format"));
    }
    if !parts[1].contains('.') {
        return Err(vfail("email", "Invalid email domain"));
    }
    if has_control_chars(trimmed) {
        return Err(vfail("email", "Email contains invalid characters"));
    }
    Ok(())
}

/// Validate password requirements:
/// - 12-128 characters
/// - At least one uppercase, one lowercase, one digit, one special character
pub fn validate_password(password: &str) -> Result<(), KernelError> {
    let len = password.len();
    if len < 12 {
        return Err(vfail("password", "Password must be at least 12 characters"));
    }
    if len > 128 {
        return Err(vfail("password", "Password must be 128 characters or fewer"));
    }
    if !password.chars().any(|c| c.is_uppercase()) {
        return Err(vfail("password", "Password must contain at least one uppercase letter"));
    }
    if !password.chars().any(|c| c.is_lowercase()) {
        return Err(vfail("password", "Password must contain at least one lowercase letter"));
    }
    if !password.chars().any(|c| c.is_ascii_digit()) {
        return Err(vfail("password", "Password must contain at least one digit"));
    }
    if !password.chars().any(|c| !c.is_alphanumeric()) {
        return Err(vfail("password", "Password must contain at least one special character"));
    }
    Ok(())
}

/// Validate display name: 1-32 chars, no control chars, no hate speech.
pub fn validate_display_name(name: &str) -> Result<(), KernelError> {
    let trimmed = name.trim();
    let len = trimmed.chars().count();
    if len == 0 {
        return Err(vfail("display_name", "Display name cannot be empty"));
    }
    if len > 32 {
        return Err(vfail("display_name", "Display name must be 32 characters or fewer"));
    }
    if has_control_chars(trimmed) {
        return Err(vfail("display_name", "Display name contains invalid characters"));
    }
    if contains_banned_word(trimmed) {
        return Err(vfail("display_name", "Display name contains prohibited content"));
    }
    Ok(())
}

/// Validate message content: 1-4000 chars, allows newlines and tabs.
pub fn validate_message(content: &str) -> Result<(), KernelError> {
    if content.is_empty() {
        return Err(vfail("message", "Message cannot be empty"));
    }
    if content.chars().count() > 4000 {
        return Err(vfail("message", "Message must be 4,000 characters or fewer"));
    }
    if has_forbidden_control_chars(content) {
        return Err(vfail("message", "Message contains invalid control characters"));
    }
    Ok(())
}

/// Validate server name: 2-100 chars, no control characters.
pub fn validate_server_name(name: &str) -> Result<(), KernelError> {
    let trimmed = name.trim();
    let len = trimmed.chars().count();
    if len < 2 {
        return Err(vfail("server_name", "Server name must be at least 2 characters"));
    }
    if len > 100 {
        return Err(vfail("server_name", "Server name must be 100 characters or fewer"));
    }
    if has_control_chars(trimmed) {
        return Err(vfail("server_name", "Server name contains invalid characters"));
    }
    Ok(())
}

/// Validate channel name: 1-100 chars, no control characters.
pub fn validate_channel_name(name: &str) -> Result<(), KernelError> {
    let trimmed = name.trim();
    let len = trimmed.chars().count();
    if len == 0 {
        return Err(vfail("channel_name", "Channel name cannot be empty"));
    }
    if len > 100 {
        return Err(vfail("channel_name", "Channel name must be 100 characters or fewer"));
    }
    if has_control_chars(trimmed) {
        return Err(vfail("channel_name", "Channel name contains invalid characters"));
    }
    Ok(())
}

/// Validate channel topic: max 1024 chars, allows newlines and tabs.
pub fn validate_channel_topic(topic: &str) -> Result<(), KernelError> {
    if topic.chars().count() > 1024 {
        return Err(vfail("channel_topic", "Channel topic must be 1,024 characters or fewer"));
    }
    if has_forbidden_control_chars(topic) {
        return Err(vfail("channel_topic", "Channel topic contains invalid control characters"));
    }
    Ok(())
}

/// Validate custom status: max 128 chars, no control characters.
pub fn validate_custom_status(status: &str) -> Result<(), KernelError> {
    if status.chars().count() > 128 {
        return Err(vfail("custom_status", "Status must be 128 characters or fewer"));
    }
    if has_control_chars(status) {
        return Err(vfail("custom_status", "Status contains invalid characters"));
    }
    Ok(())
}

/// Validate about_me: max 190 chars, no control characters.
pub fn validate_about_me(text: &str) -> Result<(), KernelError> {
    if text.chars().count() > 190 {
        return Err(vfail("about_me", "About me must be 190 characters or fewer"));
    }
    if has_control_chars(text) {
        return Err(vfail("about_me", "About me contains invalid characters"));
    }
    Ok(())
}

/// Validate invite code: 1-32 chars, alphanumeric only.
pub fn validate_invite_code(code: &str) -> Result<(), KernelError> {
    if code.is_empty() {
        return Err(vfail("invite_code", "Invite code cannot be empty"));
    }
    if code.len() > 32 {
        return Err(vfail("invite_code", "Invite code must be 32 characters or fewer"));
    }
    if !code.chars().all(|c| c.is_ascii_alphanumeric()) {
        return Err(vfail("invite_code", "Invite code must be alphanumeric only"));
    }
    Ok(())
}

// ─── URL / SSRF Validation ──────────────────────────────────────────────────

/// Returns true if the IP address is in a private, reserved, or link-local range.
fn is_private_ip(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(v4) => {
            v4.is_loopback()                 // 127.0.0.0/8
            || v4.is_private()               // 10/8, 172.16/12, 192.168/16
            || v4.is_link_local()            // 169.254.0.0/16
            || v4.is_broadcast()             // 255.255.255.255
            || v4.is_unspecified()           // 0.0.0.0
            || v4.octets() == [169, 254, 169, 254]  // AWS/GCP/Azure metadata
            || (v4.octets()[0] == 100 && (v4.octets()[1] & 0xC0) == 64) // 100.64/10 CGNAT
            || (v4.octets()[0] == 198 && v4.octets()[1] >= 18 && v4.octets()[1] <= 19) // 198.18/15 benchmarks
        }
        IpAddr::V6(v6) => {
            v6.is_loopback()                 // ::1
            || v6.is_unspecified()           // ::
            || (v6.segments()[0] & 0xfe00) == 0xfc00  // ULA (fc00::/7)
            || (v6.segments()[0] & 0xffc0) == 0xfe80  // Link-local (fe80::/10)
        }
    }
}

/// Validate a URL for SSRF safety (synchronous, no DNS resolution).
/// Checks: max length, scheme, host format, IP-literal blocking.
/// Note: Full DNS-resolved SSRF check requires async (server-side only).
/// The kernel validates the URL FORMAT and blocks obvious IP-literal attacks.
pub fn validate_url(url_str: &str) -> Result<(), KernelError> {
    if url_str.is_empty() {
        return Err(vfail("url", "URL cannot be empty"));
    }
    if url_str.len() > 2048 {
        return Err(vfail("url", "URL must be 2,048 characters or fewer"));
    }

    // Basic scheme check
    let lower = url_str.to_lowercase();
    if !lower.starts_with("https://") && !lower.starts_with("http://") {
        return Err(vfail("url", "URL must use HTTP or HTTPS"));
    }

    // Extract host portion
    let after_scheme = if lower.starts_with("https://") {
        &url_str[8..]
    } else {
        &url_str[7..]
    };
    let host_end = after_scheme.find('/').unwrap_or(after_scheme.len());
    let host_port = &after_scheme[..host_end];
    let host = if host_port.starts_with('[') {
        // IPv6 bracket notation
        host_port.split(']').next().unwrap_or(host_port).trim_start_matches('[')
    } else {
        host_port.split(':').next().unwrap_or(host_port)
    };

    if host.is_empty() {
        return Err(vfail("url", "URL has no host"));
    }

    // Check if host is an IP literal and block private IPs
    if let Ok(ip) = host.parse::<IpAddr>() {
        if is_private_ip(ip) {
            return Err(vfail("url", "URL points to a private or reserved IP address"));
        }
    }

    // Block obvious private hostnames
    let host_lower = host.to_lowercase();
    if host_lower == "metadata.google.internal"
        || host_lower == "instance-data"
        || host_lower.ends_with(".internal")
    {
        return Err(vfail("url", "URL points to a cloud metadata endpoint"));
    }

    Ok(())
}

// ─── Tests ──────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    // ── Username ────────────────────────────────────────────────

    #[test]
    fn username_valid() {
        assert!(validate_username("alice").is_ok());
        assert!(validate_username("Bob_123").is_ok());
        assert!(validate_username("ab").is_ok());
        assert!(validate_username(&"a".repeat(30)).is_ok());
    }

    #[test]
    fn username_invalid_length() {
        assert!(validate_username("").is_err());
        assert!(validate_username("a").is_err());
        assert!(validate_username(&"a".repeat(31)).is_err());
    }

    #[test]
    fn username_invalid_chars() {
        assert!(validate_username("hello world").is_err());
        assert!(validate_username("user@name").is_err());
        assert!(validate_username("user.name").is_err());
        assert!(validate_username("test-user").is_err());
        assert!(validate_username("名前").is_err());
    }

    #[test]
    fn username_reserved() {
        assert!(validate_username("admin").is_err());
        assert!(validate_username("Admin").is_err());
        assert!(validate_username("SYSTEM").is_err());
        assert!(validate_username("discreet").is_err());
        assert!(validate_username("DiscreetAI").is_err());
        assert!(validate_username("moderator").is_err());
    }

    #[test]
    fn username_profanity_leetspeak() {
        assert!(validate_username("n1gg3r_user").is_err());
        assert!(validate_username("f4gg0t").is_err());
        assert!(validate_username("coolnazi99").is_err());
        // General profanity is NOT banned — only hate speech
        assert!(validate_username("fuck_yeah").is_ok());
        assert!(validate_username("shitpost").is_ok());
    }

    // ── Email ───────────────────────────────────────────────────

    #[test]
    fn email_valid() {
        assert!(validate_email("user@example.com").is_ok());
        assert!(validate_email("a@b.co").is_ok());
        assert!(validate_email("user+tag@domain.org").is_ok());
    }

    #[test]
    fn email_invalid() {
        assert!(validate_email("").is_err());
        assert!(validate_email("noatsign").is_err());
        assert!(validate_email("@domain.com").is_err());
        assert!(validate_email("user@").is_err());
        assert!(validate_email("user@nodot").is_err());
        assert!(validate_email(&format!("{}@example.com", "a".repeat(250))).is_err());
    }

    #[test]
    fn email_control_chars_rejected() {
        assert!(validate_email("user\x00@example.com").is_err());
        assert!(validate_email("user@exam\x1Bple.com").is_err());
    }

    // ── Password ────────────────────────────────────────────────

    #[test]
    fn password_valid() {
        assert!(validate_password("StrongP@ss123!").is_ok());
        assert!(validate_password("Abcdefgh1234!").is_ok());
    }

    #[test]
    fn password_too_short() {
        assert!(validate_password("Short1!").is_err());
        assert!(validate_password("").is_err());
    }

    #[test]
    fn password_too_long() {
        assert!(validate_password(&format!("Aa1!{}", "x".repeat(125))).is_err());
    }

    #[test]
    fn password_missing_requirements() {
        assert!(validate_password("alllowercase1!").is_err()); // no uppercase
        assert!(validate_password("ALLUPPERCASE1!").is_err()); // no lowercase
        assert!(validate_password("NoDigitsHere!!").is_err()); // no digit
        assert!(validate_password("NoSpecial1234A").is_err()); // no special char
    }

    // ── Display Name ────────────────────────────────────────────

    #[test]
    fn display_name_valid() {
        assert!(validate_display_name("Alice").is_ok());
        assert!(validate_display_name("日本語の名前").is_ok());
        assert!(validate_display_name(&"x".repeat(32)).is_ok());
    }

    #[test]
    fn display_name_invalid() {
        assert!(validate_display_name("").is_err());
        assert!(validate_display_name("   ").is_err());
        assert!(validate_display_name(&"x".repeat(33)).is_err());
        assert!(validate_display_name("bad\nnewline").is_err());
        assert!(validate_display_name("bad\x00null").is_err());
    }

    #[test]
    fn display_name_hate_speech_blocked() {
        assert!(validate_display_name("n1gg3r").is_err());
        assert!(validate_display_name("Cool Person").is_ok());
    }

    // ── Message ─────────────────────────────────────────────────

    #[test]
    fn message_valid() {
        assert!(validate_message("Hello!").is_ok());
        assert!(validate_message("line1\nline2").is_ok());
        assert!(validate_message("col1\tcol2").is_ok());
    }

    #[test]
    fn message_empty() {
        assert!(validate_message("").is_err());
    }

    #[test]
    fn message_too_long() {
        assert!(validate_message(&"x".repeat(4000)).is_ok());
        assert!(validate_message(&"x".repeat(4001)).is_err());
    }

    #[test]
    fn message_control_chars() {
        assert!(validate_message("bad\x00null").is_err());
        assert!(validate_message("bad\x01ctrl").is_err());
        // Newline and tab are allowed
        assert!(validate_message("ok\nok\tok").is_ok());
    }

    // ── Server Name ─────────────────────────────────────────────

    #[test]
    fn server_name_valid() {
        assert!(validate_server_name("My Server").is_ok());
        assert!(validate_server_name("日本語サーバー").is_ok());
        assert!(validate_server_name("ab").is_ok());
    }

    #[test]
    fn server_name_invalid() {
        assert!(validate_server_name("a").is_err());
        assert!(validate_server_name("").is_err());
        assert!(validate_server_name("   ").is_err());
        assert!(validate_server_name(&"x".repeat(101)).is_err());
        assert!(validate_server_name("bad\x00name").is_err());
    }

    // ── Channel Name ────────────────────────────────────────────

    #[test]
    fn channel_name_valid() {
        assert!(validate_channel_name("general").is_ok());
        assert!(validate_channel_name("off-topic").is_ok());
        assert!(validate_channel_name(&"x".repeat(100)).is_ok());
    }

    #[test]
    fn channel_name_invalid() {
        assert!(validate_channel_name("").is_err());
        assert!(validate_channel_name("   ").is_err());
        assert!(validate_channel_name(&"x".repeat(101)).is_err());
        assert!(validate_channel_name("bad\x1Bname").is_err());
    }

    // ── Channel Topic ───────────────────────────────────────────

    #[test]
    fn channel_topic_valid() {
        assert!(validate_channel_topic("Welcome!").is_ok());
        assert!(validate_channel_topic("Line 1\nLine 2").is_ok());
        assert!(validate_channel_topic(&"x".repeat(1024)).is_ok());
    }

    #[test]
    fn channel_topic_invalid() {
        assert!(validate_channel_topic(&"x".repeat(1025)).is_err());
        assert!(validate_channel_topic("bad\x00topic").is_err());
    }

    // ── Custom Status ───────────────────────────────────────────

    #[test]
    fn custom_status_valid() {
        assert!(validate_custom_status("Working").is_ok());
        assert!(validate_custom_status(&"x".repeat(128)).is_ok());
    }

    #[test]
    fn custom_status_invalid() {
        assert!(validate_custom_status(&"x".repeat(129)).is_err());
        assert!(validate_custom_status("bad\x00status").is_err());
    }

    // ── About Me ────────────────────────────────────────────────

    #[test]
    fn about_me_valid() {
        assert!(validate_about_me("I like coding").is_ok());
        assert!(validate_about_me(&"x".repeat(190)).is_ok());
    }

    #[test]
    fn about_me_invalid() {
        assert!(validate_about_me(&"x".repeat(191)).is_err());
        assert!(validate_about_me("bad\x00bio").is_err());
    }

    // ── Invite Code ─────────────────────────────────────────────

    #[test]
    fn invite_code_valid() {
        assert!(validate_invite_code("abc123").is_ok());
        assert!(validate_invite_code("ABC").is_ok());
    }

    #[test]
    fn invite_code_invalid() {
        assert!(validate_invite_code("").is_err());
        assert!(validate_invite_code(&"a".repeat(33)).is_err());
        assert!(validate_invite_code("code-with-hyphen").is_err());
        assert!(validate_invite_code("code with space").is_err());
    }

    // ── URL / SSRF ──────────────────────────────────────────────

    #[test]
    fn url_valid() {
        assert!(validate_url("https://example.com").is_ok());
        assert!(validate_url("https://example.com/path?q=1").is_ok());
        assert!(validate_url("http://localhost:3000").is_ok());
    }

    #[test]
    fn url_invalid_scheme() {
        assert!(validate_url("ftp://example.com").is_err());
        assert!(validate_url("javascript:alert(1)").is_err());
        assert!(validate_url("").is_err());
    }

    #[test]
    fn url_ssrf_ip_literals_blocked() {
        assert!(validate_url("http://127.0.0.1/admin").is_err());
        assert!(validate_url("http://10.0.0.1/internal").is_err());
        assert!(validate_url("http://192.168.1.1/router").is_err());
        assert!(validate_url("http://172.16.0.1/private").is_err());
        assert!(validate_url("http://0.0.0.0").is_err());
        assert!(validate_url("http://169.254.169.254/metadata").is_err());
    }

    #[test]
    fn url_ssrf_ipv6_blocked() {
        assert!(validate_url("http://[::1]/admin").is_err());
    }

    #[test]
    fn url_cloud_metadata_blocked() {
        assert!(validate_url("http://metadata.google.internal/v1").is_err());
        assert!(validate_url("http://instance-data/latest").is_err());
    }

    #[test]
    fn url_too_long() {
        let long = format!("https://example.com/{}", "x".repeat(2040));
        assert!(validate_url(&long).is_err());
    }

    // ── Private IP detection ────────────────────────────────────

    #[test]
    fn private_ip_detection() {
        assert!(is_private_ip("127.0.0.1".parse().unwrap()));
        assert!(is_private_ip("10.0.0.1".parse().unwrap()));
        assert!(is_private_ip("172.16.0.1".parse().unwrap()));
        assert!(is_private_ip("192.168.1.1".parse().unwrap()));
        assert!(is_private_ip("169.254.169.254".parse().unwrap()));
        assert!(is_private_ip("0.0.0.0".parse().unwrap()));
        assert!(is_private_ip("::1".parse().unwrap()));
        assert!(!is_private_ip("8.8.8.8".parse().unwrap()));
        assert!(!is_private_ip("1.1.1.1".parse().unwrap()));
    }

    // ── Field dispatcher ────────────────────────────────────────

    #[test]
    fn validate_field_dispatches_correctly() {
        assert!(validate_field("username", "alice").is_ok());
        assert!(validate_field("email", "a@b.co").is_ok());
        assert!(validate_field("message", "hello").is_ok());
        assert!(validate_field("unknown_field", "val").is_err());
    }

    // ── Leetspeak normalization ──────────────────────────────────

    #[test]
    fn leetspeak_normalization() {
        assert_eq!(normalize_leetspeak("h3ll0"), "hello");
        assert_eq!(normalize_leetspeak("N1GG3R"), "nigger");
        assert_eq!(normalize_leetspeak("f@g_g0t"), "faggot");
        assert_eq!(normalize_leetspeak("$5$"), "sss");
    }
}
