use serde::{Deserialize, Serialize};
use typeshare::typeshare;

use crate::permissions::CapabilitySet;

/// Decrypted message ready for UI rendering.
#[typeshare]
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RenderMessage {
    pub id: String,
    pub content: SanitizedContent,
    pub capabilities: CapabilitySet,
    pub author: AuthorInfo,
    pub timestamp: i64,
    pub edited: bool,
    pub pinned: Option<String>,
    pub thread_id: Option<String>,
    pub reply_to: Option<String>,
}

/// Clean text + structured formatting extracted by the sanitizer.
#[typeshare]
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SanitizedContent {
    pub text: String,
    pub formatting: Vec<FormattingSpan>,
    pub mentions: Vec<Mention>,
    pub code_blocks: Vec<CodeBlock>,
    pub links: Vec<ValidatedLink>,
}

#[typeshare]
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuthorInfo {
    pub id: String,
    pub display_name: String,
    pub avatar_url: Option<String>,
    pub tier: String,
    pub is_bot: bool,
    pub badge: Option<String>,
}

impl Default for AuthorInfo {
    fn default() -> Self {
        Self {
            id: String::new(),
            display_name: String::new(),
            avatar_url: None,
            tier: "unverified".to_string(),
            is_bot: false,
            badge: None,
        }
    }
}

/// SSRF-validated link.
#[typeshare]
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ValidatedLink {
    pub url: String,
    pub display_text: String,
    pub is_internal: bool,
    pub is_safe: bool,
}

#[typeshare]
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FormattingSpan {
    pub start: u32,
    pub end: u32,
    pub style: FormattingStyle,
}

#[typeshare]
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum FormattingStyle {
    Bold,
    Italic,
    Code,
    Strikethrough,
    Spoiler,
}

#[typeshare]
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Mention {
    pub username: String,
    pub start: u32,
    pub end: u32,
}

#[typeshare]
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CodeBlock {
    pub content: String,
    pub language: Option<String>,
    pub start: u32,
    pub end: u32,
    pub is_inline: bool,
}

#[typeshare]
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AttachmentMeta {
    pub id: String,
    pub filename: String,
    pub content_type: String,
    pub size_bytes: u64,
}
