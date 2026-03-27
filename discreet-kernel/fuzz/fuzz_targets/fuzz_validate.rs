/// Fuzz target: input validation.
///
/// Generates random strings (0 to 10000 chars, full Unicode range) and
/// feeds them to validate_field() for every supported field type. Asserts
/// the function NEVER panics — it must always return a Result.
///
/// Run before every release:
///   cargo fuzz run fuzz_validate -- -max_len=10000
///   # Let it run for at least 10 minutes.
#![no_main]

use libfuzzer_sys::fuzz_target;

use discreet_kernel::validation::validate_field;

const FIELD_TYPES: &[&str] = &[
    "username",
    "email",
    "password",
    "display_name",
    "message",
    "server_name",
    "channel_name",
    "channel_topic",
    "custom_status",
    "about_me",
    "invite_code",
    "url",
];

fuzz_target!(|data: &[u8]| {
    let input = match std::str::from_utf8(data) {
        Ok(s) => s,
        Err(_) => return,
    };

    for field in FIELD_TYPES {
        // Must return Ok or Err — NEVER panic
        let _ = validate_field(field, input);
    }

    // Also test with an unknown field type
    let _ = validate_field("unknown_field_xyz", input);
});
