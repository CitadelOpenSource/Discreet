/// Fuzz target: message sanitization pipeline.
///
/// Generates random strings with embedded HTML tags, PUA characters, control
/// characters, null bytes, and valid markdown. Feeds them to sanitize_message().
/// Asserts:
///   1. NEVER panics — always returns Result
///   2. On Ok, output NEVER contains raw HTML angle brackets (< or >)
///   3. On Ok, output NEVER contains null bytes
///
/// Run before every release:
///   cargo fuzz run fuzz_sanitize -- -max_len=4096
///   # Let it run for at least 10 minutes.
#![no_main]

use libfuzzer_sys::fuzz_target;

use discreet_kernel::sanitize::sanitize_message;

fuzz_target!(|data: &[u8]| {
    let input = match std::str::from_utf8(data) {
        Ok(s) => s,
        Err(_) => return, // sanitize_message expects valid UTF-8
    };

    match sanitize_message(input) {
        Ok(content) => {
            // Safety invariant: sanitized output must NEVER contain raw HTML
            // angle brackets. The ammonia pass strips all tags, so any < or >
            // in the output would indicate a sanitization bypass.
            assert!(
                !content.text.contains('<'),
                "Sanitized output contains '<': {:?}",
                &content.text[..content.text.len().min(200)]
            );
            assert!(
                !content.text.contains('>'),
                "Sanitized output contains '>': {:?}",
                &content.text[..content.text.len().min(200)]
            );

            // Verify no null bytes survived
            assert!(
                !content.text.contains('\0'),
                "Sanitized output contains null byte"
            );
        }
        Err(_) => {
            // Rejection is a valid outcome — the sanitizer correctly
            // identified unsafe input (null bytes, PUA chars, control chars).
        }
    }
});
