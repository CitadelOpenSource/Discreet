/// Message sanitization: null/control/Glassworm rejection → HTML strip →
/// markdown parse → mention/code/link extraction.
use ammonia::Builder;
use std::collections::HashSet;
use std::net::IpAddr;

use crate::error::KernelError;
use crate::render_model::{
    CodeBlock, FormattingSpan, FormattingStyle, Mention, SanitizedContent, ValidatedLink,
};

/// Full sanitization pipeline. Returns structured content or rejects unsafe input.
pub fn sanitize_message(raw: &str) -> Result<SanitizedContent, KernelError> {
    // Step 1: Reject null bytes
    if raw.contains('\0') {
        return Err(KernelError::ValidationFailed {
            field: "message".into(),
            message: "Null bytes not allowed".into(),
        });
    }

    // Step 2: Reject invisible Unicode (Glassworm defense)
    // Variation selectors and tag characters can hide content from users
    for ch in raw.chars() {
        let cp = ch as u32;
        if (0xFE00..=0xFE0F).contains(&cp)           // Variation Selectors
            || (0xE0100..=0xE01EF).contains(&cp)       // Supplemental Variation Selectors
            || (0xFFF0..=0xFFFF).contains(&cp)          // Specials block (interlinear annotations)
            || cp == 0x200B                              // Zero-Width Space
            || cp == 0x200C                              // Zero-Width Non-Joiner
            || cp == 0x200D                              // Zero-Width Joiner (except in emoji sequences — revisit)
            || cp == 0x2060                              // Word Joiner
            || cp == 0xFEFF                              // BOM / Zero-Width No-Break Space
        {
            return Err(KernelError::ValidationFailed {
                field: "message".into(),
                message: "Invisible Unicode characters detected".into(),
            });
        }
    }

    // Step 3: Reject control characters (except \n, \t)
    for ch in raw.chars() {
        if ch.is_control() && ch != '\n' && ch != '\t' {
            return Err(KernelError::ValidationFailed {
                field: "message".into(),
                message: "Control characters not allowed".into(),
            });
        }
    }

    // Step 4: Strip ALL HTML (messages are plaintext + markdown)
    let clean = Builder::new()
        .tags(HashSet::new()) // allow NO tags
        .clean(raw)
        .to_string();

    // Step 5: Parse markdown into structured formatting
    let formatting = parse_markdown_spans(&clean);

    // Step 6: Extract @mentions
    let mentions = extract_mentions(&clean);

    // Step 7: Extract code blocks
    let code_blocks = extract_code_blocks(&clean);

    // Step 8: Extract and validate links
    let links = extract_and_validate_links(&clean);

    Ok(SanitizedContent {
        text: clean,
        formatting,
        mentions,
        code_blocks,
        links,
    })
}

/// Strip control chars (keeps \n, \t).
pub fn strip_control_chars(input: &str) -> String {
    input
        .chars()
        .filter(|c| !c.is_control() || *c == '\n' || *c == '\t')
        .collect()
}

// ─── Markdown span parser ───────────────────────────────────────────────────

/// **bold**, *italic*, ~~strike~~, `code` → FormattingSpans.
fn parse_markdown_spans(text: &str) -> Vec<FormattingSpan> {
    let mut spans = Vec::new();
    let chars: Vec<char> = text.chars().collect();
    let len = chars.len();
    let mut i = 0;

    while i < len {
        // Bold: **text**
        if i + 1 < len && chars[i] == '*' && chars[i + 1] == '*' {
            if let Some(end) = find_closing_marker(&chars, i + 2, &['*', '*']) {
                spans.push(FormattingSpan {
                    start: i as u32,
                    end: (end + 2) as u32,
                    style: FormattingStyle::Bold,
                });
                i = end + 2;
                continue;
            }
        }

        // Strikethrough: ~~text~~
        if i + 1 < len && chars[i] == '~' && chars[i + 1] == '~' {
            if let Some(end) = find_closing_marker(&chars, i + 2, &['~', '~']) {
                spans.push(FormattingSpan {
                    start: i as u32,
                    end: (end + 2) as u32,
                    style: FormattingStyle::Strikethrough,
                });
                i = end + 2;
                continue;
            }
        }

        // Italic: *text* (single asterisk, not preceded by another *)
        if chars[i] == '*' && (i == 0 || chars[i - 1] != '*') {
            if let Some(end) = find_single_closing(&chars, i + 1, '*') {
                if end > i + 1 {
                    spans.push(FormattingSpan {
                        start: i as u32,
                        end: (end + 1) as u32,
                        style: FormattingStyle::Italic,
                    });
                    i = end + 1;
                    continue;
                }
            }
        }

        // Inline code: `text`
        if chars[i] == '`' && (i + 1 >= len || chars[i + 1] != '`') {
            if let Some(end) = find_single_closing(&chars, i + 1, '`') {
                spans.push(FormattingSpan {
                    start: i as u32,
                    end: (end + 1) as u32,
                    style: FormattingStyle::Code,
                });
                i = end + 1;
                continue;
            }
        }

        i += 1;
    }

    spans
}

/// Find closing ** or ~~ from position `from`.
fn find_closing_marker(chars: &[char], from: usize, marker: &[char; 2]) -> Option<usize> {
    let len = chars.len();
    let mut i = from;
    while i + 1 < len {
        if chars[i] == marker[0] && chars[i + 1] == marker[1] {
            return Some(i);
        }
        i += 1;
    }
    None
}

/// Find next occurrence of `marker`.
fn find_single_closing(chars: &[char], from: usize, marker: char) -> Option<usize> {
    (from..chars.len()).find(|&i| chars[i] == marker)
}

// ─── Mention extraction ─────────────────────────────────────────────────────

/// Extract @mentions (2-30 char usernames).
fn extract_mentions(text: &str) -> Vec<Mention> {
    let mut mentions = Vec::new();
    let chars: Vec<char> = text.chars().collect();
    let len = chars.len();
    let mut i = 0;

    while i < len {
        if chars[i] == '@' && (i == 0 || chars[i - 1].is_whitespace()) {
            let start = i;
            i += 1; // skip @
            let name_start = i;
            while i < len && (chars[i].is_ascii_alphanumeric() || chars[i] == '_') {
                i += 1;
            }
            let name_len = i - name_start;
            if (2..=30).contains(&name_len) {
                let username: String = chars[name_start..i].iter().collect();
                mentions.push(Mention {
                    username,
                    start: start as u32,
                    end: i as u32,
                });
            }
            continue;
        }
        i += 1;
    }

    mentions
}

// ─── Code block extraction ──────────────────────────────────────────────────

/// Extract fenced + inline code blocks.
fn extract_code_blocks(text: &str) -> Vec<CodeBlock> {
    let mut blocks = Vec::new();
    let chars: Vec<char> = text.chars().collect();
    let len = chars.len();
    let mut i = 0;

    while i < len {
        // Fenced code block: ```
        if i + 2 < len && chars[i] == '`' && chars[i + 1] == '`' && chars[i + 2] == '`' {
            let block_start = i;
            i += 3;

            // Optional language identifier (until newline)
            let lang_start = i;
            while i < len && chars[i] != '\n' {
                i += 1;
            }
            let language: String = chars[lang_start..i].iter().collect();
            let language = language.trim().to_string();
            if i < len {
                i += 1; // skip newline
            }

            // Content until closing ```
            let content_start = i;
            let mut found_end = false;
            while i + 2 < len {
                if chars[i] == '`' && chars[i + 1] == '`' && chars[i + 2] == '`' {
                    let content: String = chars[content_start..i].iter().collect();
                    blocks.push(CodeBlock {
                        content,
                        language: if language.is_empty() { None } else { Some(language.clone()) },
                        start: block_start as u32,
                        end: (i + 3) as u32,
                        is_inline: false,
                    });
                    i += 3;
                    found_end = true;
                    break;
                }
                i += 1;
            }
            if !found_end {
                // Unclosed code block — treat rest as code
                let content: String = chars[content_start..len].iter().collect();
                blocks.push(CodeBlock {
                    content,
                    language: if language.is_empty() { None } else { Some(language) },
                    start: block_start as u32,
                    end: len as u32,
                    is_inline: false,
                });
                i = len;
            }
            continue;
        }

        // Inline code: `text`
        if chars[i] == '`' {
            let start = i;
            i += 1;
            let content_start = i;
            while i < len && chars[i] != '`' {
                if chars[i] == '\n' {
                    break; // inline code doesn't span lines
                }
                i += 1;
            }
            if i < len && chars[i] == '`' && i > content_start {
                let content: String = chars[content_start..i].iter().collect();
                blocks.push(CodeBlock {
                    content,
                    language: None,
                    start: start as u32,
                    end: (i + 1) as u32,
                    is_inline: true,
                });
                i += 1;
                continue;
            }
            // Not a valid inline code — continue
            continue;
        }

        i += 1;
    }

    blocks
}

// ─── Link extraction with SSRF validation ───────────────────────────────────

/// Extract URLs, flag SSRF-unsafe ones.
fn extract_and_validate_links(text: &str) -> Vec<ValidatedLink> {
    let mut links = Vec::new();
    let mut i = 0;
    let bytes = text.as_bytes();
    let len = bytes.len();

    while i < len {
        // Look for http:// or https://
        if i + 7 < len && (starts_with_at(bytes, i, b"https://") || starts_with_at(bytes, i, b"http://")) {
            let start = i;
            // Advance to end of URL (whitespace, newline, or common delimiters)
            while i < len && !is_url_terminator(bytes[i]) {
                i += 1;
            }
            // Strip trailing punctuation that's likely not part of the URL
            while i > start && matches!(bytes[i - 1], b'.' | b',' | b')' | b']' | b';' | b'!' | b'?') {
                i -= 1;
            }
            let url = &text[start..i];
            let is_safe = !is_ssrf_url(url);
            let is_internal = url.contains("discreetai.net") || url.contains("discreet.chat");
            links.push(ValidatedLink {
                display_text: url.to_string(),
                url: url.to_string(),
                is_internal,
                is_safe,
            });
            continue;
        }
        i += 1;
    }

    links
}

fn starts_with_at(bytes: &[u8], pos: usize, prefix: &[u8]) -> bool {
    if pos + prefix.len() > bytes.len() {
        return false;
    }
    bytes[pos..pos + prefix.len()].eq_ignore_ascii_case(prefix)
}

fn is_url_terminator(b: u8) -> bool {
    matches!(b, b' ' | b'\t' | b'\n' | b'\r' | b'<' | b'>' | b'"' | b'\'' | b'`')
}

/// SSRF check: private/reserved IP detection.
fn is_ssrf_url(url: &str) -> bool {
    let lower = url.to_lowercase();
    let after_scheme = if lower.starts_with("https://") {
        &url[8..]
    } else if lower.starts_with("http://") {
        &url[7..]
    } else {
        return false;
    };

    let host_end = after_scheme.find('/').unwrap_or(after_scheme.len());
    let host_port = &after_scheme[..host_end];
    let host = if host_port.starts_with('[') {
        host_port.split(']').next().unwrap_or(host_port).trim_start_matches('[')
    } else {
        host_port.split(':').next().unwrap_or(host_port)
    };

    // Check IP literals
    if let Ok(ip) = host.parse::<IpAddr>() {
        return is_private_ip(ip);
    }

    // Check known cloud metadata hostnames
    let host_lower = host.to_lowercase();
    if host_lower == "metadata.google.internal"
        || host_lower == "instance-data"
        || host_lower.ends_with(".internal")
        || host_lower == "localhost"
    {
        return true;
    }

    false
}

fn is_private_ip(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(v4) => {
            v4.is_loopback()
                || v4.is_private()
                || v4.is_link_local()
                || v4.is_broadcast()
                || v4.is_unspecified()
                || v4.octets() == [169, 254, 169, 254]
                || (v4.octets()[0] == 100 && (v4.octets()[1] & 0xC0) == 64)
                || (v4.octets()[0] == 198 && v4.octets()[1] >= 18 && v4.octets()[1] <= 19)
        }
        IpAddr::V6(v6) => {
            v6.is_loopback()
                || v6.is_unspecified()
                || (v6.segments()[0] & 0xfe00) == 0xfc00
                || (v6.segments()[0] & 0xffc0) == 0xfe80
        }
    }
}

// ─── Tests ──────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    // ── XSS stripping ───────────────────────────────────────────

    #[test]
    fn xss_script_stripped() {
        let result = sanitize_message("<script>alert(1)</script>hello").unwrap();
        assert!(!result.text.contains("<script>"));
        assert!(!result.text.contains("</script>"));
        assert!(result.text.contains("hello"));
    }

    #[test]
    fn xss_img_onerror_stripped() {
        let result = sanitize_message(r#"<img src=x onerror="alert(1)">hi"#).unwrap();
        assert!(!result.text.contains("<img"));
        assert!(!result.text.contains("onerror"));
        assert!(result.text.contains("hi"));
    }

    #[test]
    fn xss_all_html_tags_stripped() {
        let result = sanitize_message("<b>bold</b> <i>italic</i> <a href='x'>link</a>").unwrap();
        assert!(!result.text.contains('<'));
        assert!(result.text.contains("bold"));
        assert!(result.text.contains("italic"));
        assert!(result.text.contains("link"));
    }

    // ── Glassworm / invisible Unicode ───────────────────────────

    #[test]
    fn glassworm_variation_selector_rejected() {
        let input = format!("hello{}world", '\u{FE0F}');
        let result = sanitize_message(&input);
        assert!(result.is_err());
        assert!(matches!(result.unwrap_err(),
            KernelError::ValidationFailed { message, .. } if message.contains("Invisible")));
    }

    #[test]
    fn glassworm_supplemental_vs_rejected() {
        let input = format!("test{}", '\u{E0100}');
        let result = sanitize_message(&input);
        assert!(result.is_err());
    }

    #[test]
    fn glassworm_zero_width_space_rejected() {
        let input = format!("before{}after", '\u{200B}');
        assert!(sanitize_message(&input).is_err());
    }

    #[test]
    fn glassworm_bom_rejected() {
        let input = format!("\u{FEFF}hello");
        assert!(sanitize_message(&input).is_err());
    }

    // ── Null bytes ──────────────────────────────────────────────

    #[test]
    fn null_bytes_rejected() {
        assert!(sanitize_message("hello\0world").is_err());
        assert!(matches!(
            sanitize_message("a\0b").unwrap_err(),
            KernelError::ValidationFailed { message, .. } if message.contains("Null")
        ));
    }

    // ── Control characters ──────────────────────────────────────

    #[test]
    fn control_chars_rejected() {
        assert!(sanitize_message("bad\x01char").is_err());
        assert!(sanitize_message("bad\x07bell").is_err());
        assert!(sanitize_message("bad\x1Bescape").is_err());
    }

    #[test]
    fn newline_and_tab_allowed() {
        let result = sanitize_message("line1\nline2\ttab").unwrap();
        assert!(result.text.contains('\n'));
        assert!(result.text.contains('\t'));
    }

    // ── Markdown formatting ─────────────────────────────────────

    #[test]
    fn markdown_bold_detected() {
        let result = sanitize_message("hello **world** end").unwrap();
        assert!(result.formatting.iter().any(|f| matches!(f.style, FormattingStyle::Bold)));
    }

    #[test]
    fn markdown_italic_detected() {
        let result = sanitize_message("hello *world* end").unwrap();
        assert!(result.formatting.iter().any(|f| matches!(f.style, FormattingStyle::Italic)));
    }

    #[test]
    fn markdown_strikethrough_detected() {
        let result = sanitize_message("hello ~~deleted~~ end").unwrap();
        assert!(result.formatting.iter().any(|f| matches!(f.style, FormattingStyle::Strikethrough)));
    }

    #[test]
    fn markdown_inline_code_detected() {
        let result = sanitize_message("use `println!` here").unwrap();
        assert!(result.formatting.iter().any(|f| matches!(f.style, FormattingStyle::Code)));
    }

    // ── Mentions ────────────────────────────────────────────────

    #[test]
    fn mention_extracted() {
        let result = sanitize_message("hello @alice how are you").unwrap();
        assert_eq!(result.mentions.len(), 1);
        assert_eq!(result.mentions[0].username, "alice");
    }

    #[test]
    fn mention_at_start() {
        let result = sanitize_message("@bob check this").unwrap();
        assert_eq!(result.mentions.len(), 1);
        assert_eq!(result.mentions[0].username, "bob");
    }

    #[test]
    fn mention_too_short_ignored() {
        let result = sanitize_message("hello @a end").unwrap();
        assert_eq!(result.mentions.len(), 0); // "a" is < 2 chars
    }

    // ── Code blocks ─────────────────────────────────────────────

    #[test]
    fn fenced_code_block_extracted() {
        let result = sanitize_message("text\n```rust\nfn main() {}\n```\nmore").unwrap();
        assert_eq!(result.code_blocks.len(), 1);
        assert!(!result.code_blocks[0].is_inline);
        assert_eq!(result.code_blocks[0].language.as_deref(), Some("rust"));
        assert!(result.code_blocks[0].content.contains("fn main()"));
    }

    #[test]
    fn inline_code_extracted() {
        let result = sanitize_message("use `cargo build` here").unwrap();
        let inline: Vec<_> = result.code_blocks.iter().filter(|b| b.is_inline).collect();
        assert_eq!(inline.len(), 1);
        assert_eq!(inline[0].content, "cargo build");
    }

    // ── Links ───────────────────────────────────────────────────

    #[test]
    fn https_link_extracted() {
        let result = sanitize_message("check https://example.com/path please").unwrap();
        assert_eq!(result.links.len(), 1);
        assert_eq!(result.links[0].url, "https://example.com/path");
        assert!(result.links[0].is_safe);
    }

    #[test]
    fn http_link_extracted() {
        let result = sanitize_message("see http://example.org end").unwrap();
        assert_eq!(result.links.len(), 1);
        assert!(result.links[0].is_safe);
    }

    #[test]
    fn private_ip_link_marked_unsafe() {
        let result = sanitize_message("visit http://192.168.1.1/admin now").unwrap();
        assert_eq!(result.links.len(), 1);
        assert!(!result.links[0].is_safe);
    }

    #[test]
    fn localhost_link_marked_unsafe() {
        let result = sanitize_message("go to http://localhost:3000/secret").unwrap();
        assert_eq!(result.links.len(), 1);
        assert!(!result.links[0].is_safe);
    }

    #[test]
    fn cloud_metadata_link_marked_unsafe() {
        let result = sanitize_message("http://169.254.169.254/latest/meta-data/").unwrap();
        assert_eq!(result.links.len(), 1);
        assert!(!result.links[0].is_safe);
    }

    // ── Normal text passthrough ─────────────────────────────────

    #[test]
    fn normal_text_passes_clean() {
        let result = sanitize_message("Hello, this is a normal message!").unwrap();
        assert_eq!(result.text, "Hello, this is a normal message!");
        assert!(!result.text.trim().is_empty());
    }

    #[test]
    fn unicode_text_passes_clean() {
        let result = sanitize_message("こんにちは世界 🌍").unwrap();
        assert!(result.text.contains("こんにちは"));
    }

    #[test]
    fn whitespace_only_content() {
        let result = sanitize_message("   ").unwrap();
        assert!(result.text.trim().is_empty());
    }
}
