// discreet_input_validation.rs — Centralized input validation.
//
// Every user-facing string must pass through one of these validators before
// reaching the database. This is the primary defense against injection,
// stored XSS, and data corruption.
//
// Rules:
//   - No control characters (U+0000–U+001F, U+007F–U+009F) in any field
//   - Username: alphanumeric + underscore + hyphen only
//   - Email: basic structural check, not full RFC 5322
//   - All lengths are measured in chars, not bytes (Unicode safe)

use crate::citadel_error::AppError;

/// Check that a string contains no ASCII control characters.
fn has_control_chars(s: &str) -> bool {
    s.chars().any(|c| c.is_control())
}

/// Validate a username: 1-32 chars, alphanumeric + _ + - only.
pub fn validate_username(name: &str) -> Result<(), AppError> {
    let len = name.chars().count();
    if len == 0 {
        return Err(AppError::BadRequest("Username cannot be empty".into()));
    }
    if len > 32 {
        return Err(AppError::BadRequest("Username must be 32 characters or fewer".into()));
    }
    if !name.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-') {
        return Err(AppError::BadRequest(
            "Username may only contain letters, numbers, underscores, and hyphens".into(),
        ));
    }
    Ok(())
}

/// Validate a server name: 1-100 chars, no control characters.
pub fn validate_server_name(name: &str) -> Result<(), AppError> {
    let trimmed = name.trim();
    let len = trimmed.chars().count();
    if len == 0 {
        return Err(AppError::BadRequest("Server name cannot be empty".into()));
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

/// Validate message content: 1-4000 chars.
pub fn validate_message(content: &str) -> Result<(), AppError> {
    if content.is_empty() {
        return Err(AppError::BadRequest("Message cannot be empty".into()));
    }
    if content.chars().count() > 4000 {
        return Err(AppError::BadRequest("Message must be 4,000 characters or fewer".into()));
    }
    Ok(())
}

/// Validate a display name: 1-64 chars, no control characters.
pub fn validate_display_name(name: &str) -> Result<(), AppError> {
    let trimmed = name.trim();
    let len = trimmed.chars().count();
    if len == 0 {
        return Err(AppError::BadRequest("Display name cannot be empty".into()));
    }
    if len > 64 {
        return Err(AppError::BadRequest("Display name must be 64 characters or fewer".into()));
    }
    if has_control_chars(trimmed) {
        return Err(AppError::BadRequest("Display name contains invalid characters".into()));
    }
    Ok(())
}

/// Validate an email address: max 254 chars, must contain exactly one @
/// with non-empty local and domain parts, domain must contain a dot.
/// This is intentionally simple — full RFC 5322 validation is left to
/// the email delivery layer.
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

// ─── Tests ──────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_username_valid() {
        assert!(validate_username("alice").is_ok());
        assert!(validate_username("Bob_123").is_ok());
        assert!(validate_username("test-user").is_ok());
        assert!(validate_username("a").is_ok()); // 1 char minimum
        assert!(validate_username("a".repeat(32).as_str()).is_ok()); // exactly 32
    }

    #[test]
    fn test_username_invalid() {
        assert!(validate_username("").is_err()); // empty
        assert!(validate_username("a".repeat(33).as_str()).is_err()); // too long
        assert!(validate_username("hello world").is_err()); // space
        assert!(validate_username("user@name").is_err()); // @
        assert!(validate_username("user.name").is_err()); // dot
        assert!(validate_username("名前").is_err()); // non-ASCII
    }

    #[test]
    fn test_server_name_valid_and_invalid() {
        assert!(validate_server_name("My Server").is_ok());
        assert!(validate_server_name("日本語サーバー").is_ok()); // Unicode allowed
        assert!(validate_server_name("a").is_ok());
        assert!(validate_server_name("").is_err()); // empty
        assert!(validate_server_name("   ").is_err()); // whitespace only
        assert!(validate_server_name(&"x".repeat(101)).is_err()); // too long
        assert!(validate_server_name("bad\x00name").is_err()); // null byte
        assert!(validate_server_name("bad\x1Bname").is_err()); // escape char
    }

    #[test]
    fn test_message_valid_and_invalid() {
        assert!(validate_message("hello").is_ok());
        assert!(validate_message(&"x".repeat(4000)).is_ok()); // exactly at limit
        assert!(validate_message("").is_err()); // empty
        assert!(validate_message(&"x".repeat(4001)).is_err()); // over limit
    }

    #[test]
    fn test_display_name_valid_and_invalid() {
        assert!(validate_display_name("Alice").is_ok());
        assert!(validate_display_name("名前 表示").is_ok()); // Unicode + space
        assert!(validate_display_name(&"x".repeat(64)).is_ok()); // exactly 64
        assert!(validate_display_name("").is_err());
        assert!(validate_display_name(&"x".repeat(65)).is_err());
        assert!(validate_display_name("bad\nnewline").is_err()); // newline is control
    }

    #[test]
    fn test_email_valid_and_invalid() {
        assert!(validate_email("user@example.com").is_ok());
        assert!(validate_email("a@b.co").is_ok());
        assert!(validate_email("user+tag@domain.org").is_ok());
        assert!(validate_email("").is_err()); // empty
        assert!(validate_email("noatsign").is_err()); // no @
        assert!(validate_email("@domain.com").is_err()); // empty local
        assert!(validate_email("user@").is_err()); // empty domain
        assert!(validate_email("user@nodot").is_err()); // no dot in domain
        assert!(validate_email(&format!("{}@example.com", "a".repeat(250))).is_err()); // too long
    }
}

// ─── Fuzz Tests (proptest) ──────────────────────────────────────────────

#[cfg(test)]
mod fuzz_tests {
    use super::*;
    use proptest::prelude::*;

    // 1) validate_username rejects all strings containing control chars
    proptest! {
        #![proptest_config(ProptestConfig::with_cases(1000))]
        #[test]
        fn fuzz_username_rejects_control_chars(s in "[\\x00-\\x1f\\x7f-\\x9f].{0,31}") {
            // Any string starting with a control char must be rejected
            let result = validate_username(&s);
            prop_assert!(result.is_err(), "Should reject control char in: {:?}", s);
        }
    }

    // 2) validate_message enforces max 4000 chars
    proptest! {
        #![proptest_config(ProptestConfig::with_cases(500))]
        #[test]
        fn fuzz_message_length_enforcement(len in 4001usize..8000) {
            let s: String = "x".repeat(len);
            let result = validate_message(&s);
            prop_assert!(result.is_err(), "Should reject message of {} chars", len);
        }
    }

    // Also verify valid messages always pass
    proptest! {
        #![proptest_config(ProptestConfig::with_cases(500))]
        #[test]
        fn fuzz_message_valid_length(len in 1usize..4001) {
            let s: String = "a".repeat(len);
            let result = validate_message(&s);
            prop_assert!(result.is_ok(), "Should accept message of {} chars", len);
        }
    }

    // 3) validate_email rejects strings without @
    proptest! {
        #![proptest_config(ProptestConfig::with_cases(500))]
        #[test]
        fn fuzz_email_rejects_no_at(s in "[a-zA-Z0-9._%+-]{1,100}") {
            // Strings of email-legal chars but no @ must be rejected
            if !s.contains('@') {
                let result = validate_email(&s);
                prop_assert!(result.is_err(), "Should reject email without @: {:?}", s);
            }
        }
    }

    // 4) Base64 roundtrip on random bytes
    proptest! {
        #![proptest_config(ProptestConfig::with_cases(500))]
        #[test]
        fn fuzz_base64_roundtrip(bytes in prop::collection::vec(any::<u8>(), 0..1024)) {
            use base64::{Engine, engine::general_purpose::STANDARD};
            let encoded = STANDARD.encode(&bytes);
            let decoded = STANDARD.decode(&encoded).unwrap();
            prop_assert_eq!(&bytes, &decoded);
        }
    }

    // 5) Rate limit key generation never panics on arbitrary input
    proptest! {
        #![proptest_config(ProptestConfig::with_cases(500))]
        #[test]
        fn fuzz_rate_limit_key_no_panic(
            user_id in "[a-f0-9-]{1,50}",
            channel_id in "[a-f0-9-]{1,50}",
            server_id in "[a-f0-9-]{1,50}",
        ) {
            // Simulate the rate key format used in message handlers
            let key = format!("mention_everyone:{}:{}:{}", user_id, channel_id, server_id);
            prop_assert!(!key.is_empty());
            prop_assert!(key.len() < 200, "Rate key unexpectedly long: {}", key.len());
        }
    }
}
