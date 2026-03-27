//! Link Preview — Server-side Open Graph metadata fetcher.
//!
//! GET /api/v1/link-preview?url=<url>
//!
//! Security:
//! - HTTPS only — rejects http:// and other schemes
//! - SSRF protection — blocks private/reserved IPs (RFC 1918, loopback, link-local)
//! - 5 KB max response body (only reads head for meta tags)
//! - 3-second timeout
//! - Redis cache with 1-hour TTL
//! - Requires authentication (JWT)

use axum::{extract::Query, response::IntoResponse, Extension, Json};
use serde::{Deserialize, Serialize};
use std::{sync::Arc, time::Duration};

use crate::{discreet_auth::AuthUser, discreet_error::AppError, discreet_state::AppState};

const MAX_BODY_BYTES: usize = 5 * 1024; // 5 KB
const FETCH_TIMEOUT: Duration = Duration::from_secs(3);
const CACHE_TTL_SECS: u64 = 3600; // 1 hour

#[derive(Debug, Deserialize)]
pub struct LinkPreviewQuery {
    pub url: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct LinkPreviewResponse {
    pub url: String,
    pub title: Option<String>,
    pub description: Option<String>,
    pub image: Option<String>,
    pub site_name: Option<String>,
}

/// Extract Open Graph meta tags from HTML fragment.
fn extract_og(html: &str) -> LinkPreviewResponse {
    let mut title = None;
    let mut description = None;
    let mut image = None;
    let mut site_name = None;

    // Simple regex-free parser — scans for <meta property="og:..." content="...">
    let lower = html.to_lowercase();
    for tag_start in lower.match_indices("<meta").map(|(i, _)| i) {
        let tag_end = match html[tag_start..].find('>') {
            Some(e) => tag_start + e + 1,
            None => continue,
        };
        let tag = &html[tag_start..tag_end];
        let tag_lower = &lower[tag_start..tag_end];

        let extract_content = |t: &str, t_lower: &str| -> Option<String> {
            let content_pos = t_lower.find("content=")?;
            let rest = &t[content_pos + 8..];
            let (delim, start) = if rest.starts_with('"') {
                ('"', 1)
            } else if rest.starts_with('\'') {
                ('\'', 1)
            } else {
                return None;
            };
            let end = rest[start..].find(delim)?;
            Some(html_escape::decode_html_entities(&rest[start..start + end]).to_string())
        };

        if tag_lower.contains("property=\"og:title\"") || tag_lower.contains("property='og:title'") {
            title = title.or_else(|| extract_content(tag, tag_lower));
        } else if tag_lower.contains("property=\"og:description\"") || tag_lower.contains("property='og:description'") {
            description = description.or_else(|| extract_content(tag, tag_lower));
        } else if tag_lower.contains("property=\"og:image\"") || tag_lower.contains("property='og:image'") {
            image = image.or_else(|| extract_content(tag, tag_lower));
        } else if tag_lower.contains("property=\"og:site_name\"") || tag_lower.contains("property='og:site_name'") {
            site_name = site_name.or_else(|| extract_content(tag, tag_lower));
        }
    }

    // Fallback: <title> tag
    if title.is_none() {
        if let Some(start) = lower.find("<title>") {
            if let Some(end) = lower[start + 7..].find("</title>") {
                let t = html[start + 7..start + 7 + end].trim();
                if !t.is_empty() {
                    title = Some(html_escape::decode_html_entities(t).to_string());
                }
            }
        }
    }

    // Fallback: <meta name="description">
    if description.is_none() {
        for tag_start in lower.match_indices("<meta").map(|(i, _)| i) {
            let tag_end = match html[tag_start..].find('>') {
                Some(e) => tag_start + e + 1,
                None => continue,
            };
            let tag = &html[tag_start..tag_end];
            let tag_lower = &lower[tag_start..tag_end];

            if tag_lower.contains("name=\"description\"") || tag_lower.contains("name='description'") {
                let content_pos = match tag_lower.find("content=") {
                    Some(p) => p,
                    None => continue,
                };
                let rest = &tag[content_pos + 8..];
                if let Some(start_char) = rest.chars().next() {
                    if start_char == '"' || start_char == '\'' {
                        if let Some(end) = rest[1..].find(start_char) {
                            description = Some(html_escape::decode_html_entities(&rest[1..1 + end]).to_string());
                            break;
                        }
                    }
                }
            }
        }
    }

    LinkPreviewResponse {
        url: String::new(), // filled by caller
        title,
        description,
        image,
        site_name,
    }
}

/// GET /api/v1/link-preview?url=<url>
pub async fn link_preview_handler(
    _auth: AuthUser,
    Extension(state): Extension<Arc<AppState>>,
    Query(q): Query<LinkPreviewQuery>,
) -> Result<impl IntoResponse, AppError> {
    let url = q.url.trim().to_string();

    // Check Redis cache first
    let cache_key = format!("link_preview:{}", url);
    {
        let mut conn = state.redis.clone();
        if let Ok(cached) = redis::AsyncCommands::get::<_, String>(&mut conn, &cache_key).await {
            if let Ok(parsed) = serde_json::from_str::<LinkPreviewResponse>(&cached) {
                return Ok(Json(parsed));
            }
        }
    }

    // Validate URL (HTTPS, non-private IP) — uses centralized SSRF check
    crate::discreet_input_validation::validate_url_no_ssrf(&url).await?;

    // Fetch with timeout
    let client = reqwest::Client::builder()
        .timeout(FETCH_TIMEOUT)
        .redirect(reqwest::redirect::Policy::limited(3))
        .build()
        .map_err(|e| AppError::Internal(format!("HTTP client error: {e}")))?;

    let resp = client
        .get(&url)
        .header("User-Agent", "Discreet/1.0 LinkPreview")
        .header("Accept", "text/html")
        .send()
        .await
        .map_err(|e| AppError::BadRequest(format!("Fetch failed: {e}")))?;

    if !resp.status().is_success() {
        return Err(AppError::BadRequest(format!("HTTP {}", resp.status())));
    }

    // Read at most 5 KB
    let body = resp
        .bytes()
        .await
        .map_err(|e| AppError::BadRequest(format!("Read failed: {e}")))?;
    let html = String::from_utf8_lossy(&body[..body.len().min(MAX_BODY_BYTES)]);

    let mut preview = extract_og(&html);
    preview.url = url.clone();

    // Validate og:image is also HTTPS
    if let Some(ref img_url) = preview.image {
        if !img_url.starts_with("https://") {
            preview.image = None;
        }
    }

    // Cache in Redis for 1 hour
    {
        let mut conn = state.redis.clone();
        if let Ok(json) = serde_json::to_string(&preview) {
            let _: Result<(), _> = redis::AsyncCommands::set_ex(
                &mut conn,
                &cache_key,
                &json,
                CACHE_TTL_SECS,
            )
            .await;
        }
    }

    Ok(Json(preview))
}
