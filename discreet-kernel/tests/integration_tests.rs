/// Integration tests for the Discreet Security Kernel.
///
/// These test the kernel boundary through the public `Kernel::handle()` entry
/// point — the same interface used by the WASM Worker. No internal state is
/// accessed directly. Every test proves that adversarial input is handled
/// correctly and that the kernel NEVER panics.
use discreet_kernel::error::KernelError;
use discreet_kernel::oracle_guard::OracleGuard;
use discreet_kernel::sanitize::sanitize_message;
use discreet_kernel::types::{KernelRequest, KernelResponse};
use discreet_kernel::validation::validate_field;
use discreet_kernel::Kernel;

// ─── Helpers ────────────────────────────────────────────────────────────────

fn init_kernel() -> Kernel {
    let mut k = Kernel::new();
    k.handle(KernelRequest::Initialize).unwrap();
    k
}

fn encrypt(k: &mut Kernel, channel: &str, text: &str) -> String {
    match k
        .handle(KernelRequest::Encrypt {
            channel_id: channel.into(),
            plaintext: text.into(),
        })
        .unwrap()
    {
        KernelResponse::Encrypted { ciphertext } => ciphertext,
        other => panic!("Expected Encrypted, got {:?}", other),
    }
}

fn decrypt_text(k: &mut Kernel, channel: &str, ct: &str) -> String {
    match k
        .handle(KernelRequest::Decrypt {
            channel_id: channel.into(),
            ciphertext: ct.into(),
        })
        .unwrap()
    {
        KernelResponse::Decrypted { render_model } => render_model.content.text,
        other => panic!("Expected Decrypted, got {:?}", other),
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// FULL LIFECYCLE TESTS
// ═══════════════════════════════════════════════════════════════════════════

#[test]
fn lifecycle_encrypt_decrypt_roundtrip() {
    let mut k = init_kernel();
    let ct = encrypt(&mut k, "ch-lifecycle", "Hello, Discreet!");
    let text = decrypt_text(&mut k, "ch-lifecycle", &ct);
    assert_eq!(text, "Hello, Discreet!");
}

#[test]
fn lifecycle_render_model_populated() {
    let mut k = init_kernel();
    let ct = encrypt(&mut k, "ch1", "hello **bold** @alice");

    match k
        .handle(KernelRequest::Decrypt {
            channel_id: "ch1".into(),
            ciphertext: ct,
        })
        .unwrap()
    {
        KernelResponse::Decrypted { render_model } => {
            assert!(render_model.content.text.contains("hello"));
            assert!(render_model.content.text.contains("bold"));
            // Capabilities should be populated
            assert!(render_model.capabilities.can_reply);
            // Formatting spans detected
            assert!(render_model
                .content
                .formatting
                .iter()
                .any(|f| matches!(
                    f.style,
                    discreet_kernel::render_model::FormattingStyle::Bold
                )));
            // Mention extracted
            assert_eq!(render_model.content.mentions.len(), 1);
            assert_eq!(render_model.content.mentions[0].username, "alice");
        }
        other => panic!("Expected Decrypted, got {:?}", other),
    }
}

#[test]
fn lifecycle_cross_channel_decrypt_fails() {
    let mut k = init_kernel();
    let ct = encrypt(&mut k, "channel_a", "secret for A");
    // Ensure channel B has its own key
    encrypt(&mut k, "channel_b", "setup B");

    let err = k
        .handle(KernelRequest::Decrypt {
            channel_id: "channel_b".into(),
            ciphertext: ct,
        })
        .unwrap_err();
    assert!(matches!(err, KernelError::DecryptionFailed(_)));
}

#[test]
fn lifecycle_corrupted_ciphertext_returns_error() {
    let mut k = init_kernel();
    let ct = encrypt(&mut k, "ch-corrupt", "original");

    // Corrupt the ciphertext by flipping bits in the middle
    let mut bytes: Vec<u8> = ct.bytes().collect();
    if bytes.len() > 20 {
        bytes[15] ^= 0xFF;
        bytes[16] ^= 0xFF;
        bytes[17] ^= 0xFF;
    }
    let corrupted = String::from_utf8_lossy(&bytes).to_string();

    let result = k.handle(KernelRequest::Decrypt {
        channel_id: "ch-corrupt".into(),
        ciphertext: corrupted,
    });
    assert!(result.is_err());
}

#[test]
fn lifecycle_persist_restore_decrypt() {
    let mut k = init_kernel();
    let ct = encrypt(&mut k, "ch-persist", "survives restart");

    // Persist state
    let state_json = match k.handle(KernelRequest::PersistState).unwrap() {
        KernelResponse::StatePersisted { sealed_state } => sealed_state,
        other => panic!("Expected StatePersisted, got {:?}", other),
    };

    // Restore into a fresh kernel
    let mut k2 = Kernel::new();
    k2.handle(KernelRequest::RestoreState {
        encrypted_state: state_json,
    })
    .unwrap();

    // Decrypt with restored keys
    let text = decrypt_text(&mut k2, "ch-persist", &ct);
    assert_eq!(text, "survives restart");
}

// ═══════════════════════════════════════════════════════════════════════════
// VALIDATION BOUNDARY TESTS
// ═══════════════════════════════════════════════════════════════════════════

#[test]
fn validation_username_exact_max_length() {
    assert!(validate_field("username", &"a".repeat(30)).is_ok());
    assert!(validate_field("username", &"a".repeat(31)).is_err());
}

#[test]
fn validation_email_exact_max_length() {
    let local = "a".repeat(244);
    let at_max = format!("{}@b.co", local); // 244 + 5 = 249 < 254
    assert!(validate_field("email", &at_max).is_ok());

    let over = format!("{}@example.com", "a".repeat(242)); // 242 + 12 = 254
    assert!(validate_field("email", &over).is_ok());
    let way_over = format!("{}@example.com", "a".repeat(243)); // 255 > 254
    assert!(validate_field("email", &way_over).is_err());
}

#[test]
fn validation_password_exact_max_length() {
    // Exactly 128 chars with all requirements met
    let pw = format!("Aa1!{}", "x".repeat(124));
    assert!(validate_field("password", &pw).is_ok());

    let over = format!("Aa1!{}", "x".repeat(125));
    assert!(validate_field("password", &over).is_err());
}

#[test]
fn validation_display_name_exact_max_length() {
    assert!(validate_field("display_name", &"x".repeat(32)).is_ok());
    assert!(validate_field("display_name", &"x".repeat(33)).is_err());
}

#[test]
fn validation_message_exact_max_length() {
    assert!(validate_field("message", &"x".repeat(4000)).is_ok());
    assert!(validate_field("message", &"x".repeat(4001)).is_err());
}

#[test]
fn validation_server_name_exact_max_length() {
    assert!(validate_field("server_name", &"x".repeat(100)).is_ok());
    assert!(validate_field("server_name", &"x".repeat(101)).is_err());
}

#[test]
fn validation_channel_name_exact_max_length() {
    assert!(validate_field("channel_name", &"x".repeat(100)).is_ok());
    assert!(validate_field("channel_name", &"x".repeat(101)).is_err());
}

#[test]
fn validation_channel_topic_exact_max_length() {
    assert!(validate_field("channel_topic", &"x".repeat(1024)).is_ok());
    assert!(validate_field("channel_topic", &"x".repeat(1025)).is_err());
}

#[test]
fn validation_custom_status_exact_max_length() {
    assert!(validate_field("custom_status", &"x".repeat(128)).is_ok());
    assert!(validate_field("custom_status", &"x".repeat(129)).is_err());
}

#[test]
fn validation_about_me_exact_max_length() {
    assert!(validate_field("about_me", &"x".repeat(190)).is_ok());
    assert!(validate_field("about_me", &"x".repeat(191)).is_err());
}

#[test]
fn validation_invite_code_exact_max_length() {
    assert!(validate_field("invite_code", &"a".repeat(32)).is_ok());
    assert!(validate_field("invite_code", &"a".repeat(33)).is_err());
}

#[test]
fn validation_all_reserved_usernames_blocked() {
    let reserved = [
        "admin", "administrator", "mod", "moderator", "system", "bot", "root",
        "daemon", "server", "channel", "user", "account", "profile", "settings",
        "help", "info", "status", "api", "app", "web", "mail", "email", "ftp",
        "ssh", "www", "test", "testing", "null", "undefined", "void", "anonymous",
        "guest", "unknown", "deleted", "removed", "blocked", "banned", "suspended",
        "discreet", "discreetai", "discreet_ai", "discreet_dev", "discreet_admin",
        "discreet_mod", "discreet_support", "discreet_help", "discreet_bot",
        "discreet_system", "discreet_official", "discreetofficial", "discreetdev",
        "discreetadmin", "discreetmod", "discreetsupport", "discreethelp",
        "discreetbot", "discreetsystem", "d1screet", "d1scr33t", "discr33t", "disc_reet",
        "citadel", "citadeladmin", "citadeldev", "citadelmod", "citadelbot",
        "owner", "developer", "dev", "tester", "founder", "ceo", "cto", "staff",
        "team", "official", "verified", "support", "security", "abuse", "postmaster",
        "webmaster", "noreply", "no_reply", "mailer_daemon", "notifications",
        "everyone", "here", "ghost",
    ];

    for name in &reserved {
        let result = validate_field("username", name);
        assert!(
            result.is_err(),
            "Reserved username '{}' was NOT rejected",
            name
        );
    }
}

#[test]
fn validation_script_tag_stripped_in_sanitized_output() {
    let result = sanitize_message("<script>alert('xss')</script>Safe text").unwrap();
    assert!(!result.text.contains("<script>"));
    assert!(!result.text.contains("</script>"));
    assert!(result.text.contains("Safe text"));
}

#[test]
fn validation_glassworm_pua_characters_rejected() {
    // Variation selector
    assert!(sanitize_message(&format!("test{}", '\u{FE0F}')).is_err());
    // Supplementary variation selector
    assert!(sanitize_message(&format!("test{}", '\u{E0100}')).is_err());
    // Zero-width space
    assert!(sanitize_message(&format!("a{}b", '\u{200B}')).is_err());
    // BOM
    assert!(sanitize_message(&format!("{}text", '\u{FEFF}')).is_err());
    // Zero-width joiner
    assert!(sanitize_message(&format!("a{}b", '\u{200D}')).is_err());
    // Word joiner
    assert!(sanitize_message(&format!("a{}b", '\u{2060}')).is_err());
}

#[test]
fn validation_null_bytes_rejected() {
    assert!(sanitize_message("hello\0world").is_err());
    assert!(sanitize_message("\0").is_err());
    assert!(sanitize_message("a\0").is_err());
}

#[test]
fn validation_ssrf_all_private_ranges_blocked() {
    let ssrf_urls = [
        "http://127.0.0.1",           // loopback
        "http://127.0.0.2/admin",     // loopback range
        "http://10.0.0.1",            // 10/8
        "http://10.255.255.255",      // 10/8 end
        "http://172.16.0.1",          // 172.16/12
        "http://172.31.255.255",      // 172.16/12 end
        "http://192.168.0.1",         // 192.168/16
        "http://192.168.255.255",     // 192.168/16 end
        "http://169.254.1.1",         // link-local
        "http://169.254.169.254",     // AWS/GCP metadata
        "http://0.0.0.0",            // unspecified
        "http://[::1]",              // IPv6 loopback
    ];

    for url in &ssrf_urls {
        let result = validate_field("url", url);
        assert!(result.is_err(), "SSRF URL '{}' was NOT blocked", url);
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// ORACLE BOUNDARY TESTS
// ═══════════════════════════════════════════════════════════════════════════

#[test]
fn oracle_100_decrypts_then_locked() {
    let mut k = init_kernel();
    let ct = encrypt(&mut k, "ch-oracle", "test");

    for i in 0..100 {
        k.handle(KernelRequest::Decrypt {
            channel_id: "ch-oracle".into(),
            ciphertext: ct.clone(),
        })
        .unwrap_or_else(|e| panic!("Decrypt {} failed: {:?}", i, e));
    }

    // 101st triggers rate limit
    let err = k
        .handle(KernelRequest::Decrypt {
            channel_id: "ch-oracle".into(),
            ciphertext: ct,
        })
        .unwrap_err();
    assert!(matches!(err, KernelError::Locked));
}

#[test]
fn oracle_window_expiry_resets_counter() {
    let mut guard = OracleGuard::new();
    let base = 1_000_000.0;

    // Exhaust decrypt limit at time=base
    for _ in 0..100 {
        guard.check_decrypt(base).unwrap();
    }
    assert!(guard.check_decrypt(base).is_err());

    // 11 seconds later: window expires, counter resets
    guard.check_decrypt(base + 11_000.0).unwrap();
}

#[test]
fn oracle_locked_blocks_all_operations() {
    let mut k = init_kernel();
    let ct = encrypt(&mut k, "ch-lock", "test");

    // Trigger lock via rate limit
    for _ in 0..100 {
        let _ = k.handle(KernelRequest::Decrypt {
            channel_id: "ch-lock".into(),
            ciphertext: ct.clone(),
        });
    }
    let _ = k.handle(KernelRequest::Decrypt {
        channel_id: "ch-lock".into(),
        ciphertext: ct.clone(),
    });

    // Encrypt blocked
    assert!(matches!(
        k.handle(KernelRequest::Encrypt {
            channel_id: "ch-lock".into(),
            plaintext: "blocked".into(),
        })
        .unwrap_err(),
        KernelError::Locked
    ));

    // Validate blocked
    assert!(matches!(
        k.handle(KernelRequest::ValidateInput {
            field: "username".into(),
            value: "alice".into(),
        })
        .unwrap_err(),
        KernelError::Locked
    ));

    // GenerateOutgoing blocked
    assert!(matches!(
        k.handle(KernelRequest::GenerateOutgoing {
            channel_id: "ch-lock".into(),
            text: "blocked".into(),
        })
        .unwrap_err(),
        KernelError::Locked
    ));
}

#[test]
fn oracle_unlock_resumes_operations() {
    let mut k = init_kernel();
    let ct = encrypt(&mut k, "ch-resume", "test");

    // Lock via rate limit
    for _ in 0..100 {
        let _ = k.handle(KernelRequest::Decrypt {
            channel_id: "ch-resume".into(),
            ciphertext: ct.clone(),
        });
    }
    let _ = k.handle(KernelRequest::Decrypt {
        channel_id: "ch-resume".into(),
        ciphertext: ct.clone(),
    });

    // Unlock
    k.handle(KernelRequest::Unlock {
        assertion: "user-verified".into(),
    })
    .unwrap();

    // All operations resume
    let ct2 = encrypt(&mut k, "ch-resume", "after unlock");
    let text = decrypt_text(&mut k, "ch-resume", &ct2);
    assert_eq!(text, "after unlock");

    assert!(k
        .handle(KernelRequest::ValidateInput {
            field: "username".into(),
            value: "alice".into(),
        })
        .is_ok());
}

#[test]
fn oracle_50_outgoing_then_locked() {
    let mut k = init_kernel();

    for i in 0..50 {
        k.handle(KernelRequest::GenerateOutgoing {
            channel_id: "ch-out".into(),
            text: format!("msg {}", i),
        })
        .unwrap();
    }

    let err = k
        .handle(KernelRequest::GenerateOutgoing {
            channel_id: "ch-out".into(),
            text: "one too many".into(),
        })
        .unwrap_err();
    assert!(matches!(err, KernelError::Locked));
}

#[test]
fn oracle_200_validations_then_locked() {
    let mut k = init_kernel();

    for _ in 0..200 {
        k.handle(KernelRequest::ValidateInput {
            field: "username".into(),
            value: "alice".into(),
        })
        .unwrap();
    }

    let err = k
        .handle(KernelRequest::ValidateInput {
            field: "username".into(),
            value: "alice".into(),
        })
        .unwrap_err();
    assert!(matches!(err, KernelError::Locked));
}

// ═══════════════════════════════════════════════════════════════════════════
// ERROR RESILIENCE TESTS — must NEVER panic
// ═══════════════════════════════════════════════════════════════════════════

#[test]
fn resilience_empty_json_to_handle() {
    let parsed: Result<KernelRequest, _> = serde_json::from_str("");
    assert!(parsed.is_err());
}

#[test]
fn resilience_malformed_json() {
    let cases = [
        "{",
        "}{",
        "{\"type\":}",
        "null",
        "42",
        "\"just a string\"",
        "[1,2,3]",
        "{\"type\": \"Nonexistent\"}",
        "{\"type\": \"Encrypt\"}",
        "{\"type\": \"Encrypt\", \"channel_id\": \"ch\"}",
    ];

    for json in &cases {
        let parsed: Result<KernelRequest, _> = serde_json::from_str(json);
        // Should either fail to parse or produce a valid request
        // Either way: no panic
        if let Ok(req) = parsed {
            let mut k = init_kernel();
            // Handle should return Result, never panic
            let _ = k.handle(req);
        }
    }
}

#[test]
fn resilience_encrypt_before_initialize() {
    let mut k = Kernel::new();
    let err = k
        .handle(KernelRequest::Encrypt {
            channel_id: "ch1".into(),
            plaintext: "hello".into(),
        })
        .unwrap_err();
    assert!(matches!(err, KernelError::NotInitialized));
}

#[test]
fn resilience_decrypt_before_initialize() {
    let mut k = Kernel::new();
    let err = k
        .handle(KernelRequest::Decrypt {
            channel_id: "ch1".into(),
            ciphertext: "garbage".into(),
        })
        .unwrap_err();
    assert!(matches!(err, KernelError::NotInitialized));
}

#[test]
fn resilience_outgoing_before_initialize() {
    let mut k = Kernel::new();
    let err = k
        .handle(KernelRequest::GenerateOutgoing {
            channel_id: "ch1".into(),
            text: "hello".into(),
        })
        .unwrap_err();
    assert!(matches!(err, KernelError::NotInitialized));
}

#[test]
fn resilience_empty_fields() {
    let mut k = init_kernel();

    // Empty channel_id — should still work (encrypt creates group)
    let _ = k.handle(KernelRequest::Encrypt {
        channel_id: "".into(),
        plaintext: "test".into(),
    });

    // Empty plaintext
    let _ = k.handle(KernelRequest::Encrypt {
        channel_id: "ch".into(),
        plaintext: "".into(),
    });

    // Empty ciphertext
    let result = k.handle(KernelRequest::Decrypt {
        channel_id: "ch".into(),
        ciphertext: "".into(),
    });
    assert!(result.is_err());

    // Empty validation field
    let result = k.handle(KernelRequest::ValidateInput {
        field: "".into(),
        value: "test".into(),
    });
    assert!(result.is_err());

    // Empty validation value
    let result = k.handle(KernelRequest::ValidateInput {
        field: "username".into(),
        value: "".into(),
    });
    // Username empty → validation error (not panic)
    match result {
        Ok(KernelResponse::ValidationResult { valid, .. }) => assert!(!valid),
        Err(_) => {} // also acceptable
        other => panic!("Unexpected: {:?}", other),
    }

    // Empty assertion for unlock
    let _ = k.handle(KernelRequest::Unlock {
        assertion: "".into(),
    });

    // Empty restore state
    let result = k.handle(KernelRequest::RestoreState {
        encrypted_state: "".into(),
    });
    assert!(result.is_err());

    // Empty capabilities
    let _ = k.handle(KernelRequest::GetCapabilities {
        channel_id: "".into(),
        user_id: "".into(),
        user_role: "".into(),
    });

    // Empty incoming
    let _ = k.handle(KernelRequest::ProcessIncoming {
        payload: "".into(),
    });
}

#[test]
fn resilience_restore_invalid_json() {
    let mut k = init_kernel();
    let result = k.handle(KernelRequest::RestoreState {
        encrypted_state: "not json at all!!!{{{".into(),
    });
    assert!(result.is_err());
}

#[test]
fn resilience_decrypt_with_nonexistent_channel() {
    let mut k = init_kernel();
    let result = k.handle(KernelRequest::Decrypt {
        channel_id: "nonexistent".into(),
        ciphertext: "AAAA".into(),
    });
    assert!(result.is_err());
}

#[test]
fn resilience_validate_unknown_field_type() {
    let mut k = init_kernel();
    let result = k.handle(KernelRequest::ValidateInput {
        field: "nonexistent_field_type".into(),
        value: "whatever".into(),
    });
    assert!(result.is_err());
}

#[test]
fn resilience_very_long_input_does_not_panic() {
    let mut k = init_kernel();
    let huge = "x".repeat(100_000);

    // Encrypt huge plaintext — should work or error, not panic
    let _ = k.handle(KernelRequest::Encrypt {
        channel_id: "ch".into(),
        plaintext: huge.clone(),
    });

    // Validate huge input
    let _ = k.handle(KernelRequest::ValidateInput {
        field: "message".into(),
        value: huge,
    });
}
