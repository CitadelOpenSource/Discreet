// discreet_translate_handlers.rs — /translate command and sticker pack endpoints.
//
// Endpoints:
//   POST /api/v1/channels/:channel_id/translate    — Translate a message via AI agent.
//   POST /api/v1/sticker-packs                     — Create a sticker pack.
//   GET  /api/v1/sticker-packs                     — List available sticker packs.
//   POST /api/v1/sticker-packs/:pack_id/stickers   — Upload a sticker image.
//   GET  /api/v1/sticker-packs/:pack_id/stickers   — List stickers in a pack.

use std::sync::Arc;

use axum::{
    extract::{Json, Multipart, Path, State},
    http::StatusCode,
    response::IntoResponse,
};
use serde::Deserialize;
use serde_json::json;
use uuid::Uuid;

use base64::Engine;

use crate::discreet_auth::AuthUser;
use crate::discreet_error::AppError;
use crate::discreet_permissions::{require_permission, Permission};
use crate::discreet_state::AppState;

// ─── POST /channels/:channel_id/translate ───────────────────────────────

#[derive(Debug, Deserialize)]
pub struct TranslateRequest {
    /// The message ID to translate.
    pub message_id: Uuid,
    /// Target language (e.g., "Spanish", "French", "Japanese").
    pub language: String,
}

/// Translate a message using the server's AI agent.
/// Decrypts the source message, sends to LLM with translator prompt,
/// inserts the translation as a new message linked to the original.
pub async fn translate_message(
    auth: AuthUser,
    State(state): State<Arc<AppState>>,
    Path(channel_id): Path<Uuid>,
    Json(req): Json<TranslateRequest>,
) -> Result<impl IntoResponse, AppError> {
    let language = req.language.trim().to_string();
    if language.is_empty() || language.len() > 50 {
        return Err(AppError::BadRequest("Language must be 1-50 characters".into()));
    }

    // Look up channel and verify membership
    let channel = sqlx::query!(
        "SELECT server_id FROM channels WHERE id = $1",
        channel_id,
    )
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::NotFound("Channel not found".into()))?;

    require_permission(&state, channel.server_id, auth.user_id, Permission::SEND_MESSAGES).await?;

    // Fetch the source message
    let msg = sqlx::query!(
        "SELECT content_ciphertext, mls_epoch FROM messages WHERE id = $1 AND channel_id = $2 AND deleted = FALSE",
        req.message_id,
        channel_id,
    )
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::NotFound("Message not found".into()))?;

    // Decrypt content (epoch 0 = plaintext)
    let source_text = if msg.mls_epoch == 0 {
        String::from_utf8(msg.content_ciphertext)
            .map_err(|_| AppError::BadRequest("Message content is not valid text".into()))?
    } else {
        return Err(AppError::BadRequest(
            "Cannot translate encrypted messages. Only plaintext messages (from bots or legacy) are supported.".into(),
        ));
    };

    if source_text.is_empty() {
        return Err(AppError::BadRequest("Source message is empty".into()));
    }

    // Find an enabled agent config for this server
    let agent = sqlx::query!(
        r#"SELECT id, provider_type, model, endpoint_url, encrypted_api_key IS NOT NULL as "has_key!"
           FROM agent_configs
           WHERE server_id = $1 AND enabled = TRUE
           ORDER BY created_at ASC
           LIMIT 1"#,
        channel.server_id,
    )
    .fetch_optional(&state.db)
    .await?;

    let translation = if let Some(ac) = agent {
        // Use the server's agent to translate
        let provider_type: crate::discreet_agent_provider::ProviderType = ac.provider_type
            .parse()
            .unwrap_or(crate::discreet_agent_provider::ProviderType::OpenAi);
        let provider = crate::discreet_agent_provider::create_provider(&provider_type);

        // Decrypt API key if available
        let api_key: Option<String> = if ac.has_key {
            match sqlx::query_scalar!(
                "SELECT encrypted_api_key FROM agent_configs WHERE id = $1",
                ac.id,
            )
            .fetch_optional(&state.db)
            .await
            {
                Ok(Some(Some(blob))) if blob.len() > 12 => {
                    crate::discreet_agent_config::decrypt_api_key(
                        &blob[12..], &blob[..12],
                        state.config.agent_key_secret.as_bytes(), &ac.id,
                    ).ok()
                }
                _ => None,
            }
        } else {
            None
        };

        let model_config = crate::discreet_agent_provider::AgentModelConfig {
            model_id: ac.model.unwrap_or_default(),
            api_key,
            endpoint_url: ac.endpoint_url.unwrap_or_else(|| "https://api.openai.com".into()),
            max_tokens: 2000,
            temperature: 0.3, // Low temperature for accurate translation
            timeout_secs: 30,
            ..Default::default()
        };

        let system_prompt = format!(
            "You are a translator. Translate the following text to {language}. Return only the translation with no explanation."
        );

        let messages = vec![crate::discreet_agent_provider::AgentMessage {
            role: "user".into(),
            content: source_text.clone(),
        }];

        match provider.complete(&system_prompt, messages, &model_config).await {
            Ok(result) => result.text,
            Err(e) => {
                return Err(AppError::Internal(format!("Translation failed: {e}")));
            }
        }
    } else {
        return Err(AppError::BadRequest(
            "No AI agent is configured for this server. Add an agent in server settings to use /translate.".into(),
        ));
    };

    // Insert translation as a new message
    let translation_id = Uuid::new_v4();
    let content_bytes = translation.as_bytes().to_vec();

    sqlx::query!(
        "INSERT INTO messages (id, channel_id, author_id, content_ciphertext, mls_epoch, is_translation, original_message_id, translation_language)
         VALUES ($1, $2, $3, $4, 0, TRUE, $5, $6)",
        translation_id,
        channel_id,
        auth.user_id,
        &content_bytes,
        req.message_id,
        language,
    )
    .execute(&state.db)
    .await?;

    // Broadcast
    state.ws_broadcast(channel.server_id, json!({
        "type": "message_create",
        "channel_id": channel_id,
        "message_id": translation_id,
        "author_id": auth.user_id,
        "is_translation": true,
        "original_message_id": req.message_id,
        "translation_language": language,
    })).await;

    Ok((StatusCode::CREATED, Json(json!({
        "id": translation_id,
        "translation": translation,
        "language": language,
        "original_message_id": req.message_id,
    }))))
}

// ─── Sticker Pack Endpoints ─────────────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct CreateStickerPackRequest {
    pub name: String,
    pub server_id: Option<Uuid>,
}

/// Create a new sticker pack.
pub async fn create_sticker_pack(
    auth: AuthUser,
    State(state): State<Arc<AppState>>,
    Json(req): Json<CreateStickerPackRequest>,
) -> Result<impl IntoResponse, AppError> {
    let name = req.name.trim().to_string();
    if name.is_empty() || name.len() > 100 {
        return Err(AppError::BadRequest("Pack name must be 1-100 characters".into()));
    }

    let row = sqlx::query!(
        "INSERT INTO sticker_packs (name, server_id, creator_id) VALUES ($1, $2, $3) RETURNING id, created_at",
        name,
        req.server_id,
        auth.user_id,
    )
    .fetch_one(&state.db)
    .await?;

    Ok((StatusCode::CREATED, Json(json!({
        "id": row.id,
        "name": name,
        "server_id": req.server_id,
        "creator_id": auth.user_id,
        "created_at": row.created_at.to_rfc3339(),
    }))))
}

/// List available sticker packs (global + user's server packs).
pub async fn list_sticker_packs(
    auth: AuthUser,
    State(state): State<Arc<AppState>>,
) -> Result<impl IntoResponse, AppError> {
    let rows = sqlx::query!(
        r#"SELECT sp.id, sp.name, sp.server_id, sp.creator_id, sp.created_at,
                  COUNT(s.id) as "sticker_count!"
           FROM sticker_packs sp
           LEFT JOIN stickers s ON s.pack_id = sp.id
           WHERE sp.server_id IS NULL
              OR sp.server_id IN (SELECT server_id FROM server_members WHERE user_id = $1)
           GROUP BY sp.id
           ORDER BY sp.created_at ASC"#,
        auth.user_id,
    )
    .fetch_all(&state.db)
    .await?;

    let packs: Vec<serde_json::Value> = rows.iter().map(|r| json!({
        "id": r.id,
        "name": r.name,
        "server_id": r.server_id,
        "creator_id": r.creator_id,
        "sticker_count": r.sticker_count,
        "created_at": r.created_at.to_rfc3339(),
    })).collect();

    Ok(Json(json!({ "packs": packs })))
}

/// Upload a sticker image to a pack (PNG/WebP, max 512KB, 128-512px).
pub async fn upload_sticker(
    auth: AuthUser,
    State(state): State<Arc<AppState>>,
    Path(pack_id): Path<Uuid>,
    mut multipart: Multipart,
) -> Result<impl IntoResponse, AppError> {
    // Verify pack exists and user is the creator
    let pack = sqlx::query!(
        "SELECT creator_id FROM sticker_packs WHERE id = $1",
        pack_id,
    )
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::NotFound("Sticker pack not found".into()))?;

    if pack.creator_id != auth.user_id {
        return Err(AppError::Forbidden("Only the pack creator can upload stickers".into()));
    }

    let mut name: Option<String> = None;
    let mut image_data: Option<Vec<u8>> = None;
    let mut mime: Option<String> = None;

    while let Some(field) = multipart
        .next_field()
        .await
        .map_err(|e| AppError::BadRequest(format!("Multipart error: {e}")))?
    {
        let field_name = field.name().unwrap_or("").to_string();
        match field_name.as_str() {
            "name" => {
                name = Some(field.text().await
                    .map_err(|e| AppError::BadRequest(format!("Failed to read name: {e}")))?);
            }
            "image" => {
                mime = field.content_type().map(|s| s.to_string());
                let bytes = field.bytes().await
                    .map_err(|e| AppError::BadRequest(format!("Failed to read image: {e}")))?;
                image_data = Some(bytes.to_vec());
            }
            _ => {}
        }
    }

    let name = name.ok_or_else(|| AppError::BadRequest("name field is required".into()))?;
    let name = name.trim().to_string();
    if name.is_empty() || name.len() > 50 {
        return Err(AppError::BadRequest("Sticker name must be 1-50 characters".into()));
    }

    let image = image_data.ok_or_else(|| AppError::BadRequest("image field is required".into()))?;

    // Validate size (max 512KB)
    if image.len() > 512 * 1024 {
        return Err(AppError::PayloadTooLarge("Sticker image must be under 512KB".into()));
    }
    if image.is_empty() {
        return Err(AppError::BadRequest("Image data cannot be empty".into()));
    }

    // Validate MIME type
    let mime_str = mime.as_deref().unwrap_or("");
    let mime_base = mime_str.split(';').next().unwrap_or(mime_str).trim();
    if mime_base != "image/png" && mime_base != "image/webp" {
        return Err(AppError::BadRequest("Sticker must be PNG or WebP format".into()));
    }

    // Store image (as base64 data URI for simplicity)
    let _ext = if mime_base == "image/webp" { "webp" } else { "png" };
    let b64 = base64::engine::general_purpose::STANDARD.encode(&image);
    let image_url = format!("data:{mime_base};base64,{b64}");

    let row = sqlx::query!(
        "INSERT INTO stickers (pack_id, name, image_url) VALUES ($1, $2, $3) RETURNING id, created_at",
        pack_id,
        name,
        image_url,
    )
    .fetch_one(&state.db)
    .await?;

    tracing::info!(pack_id = %pack_id, sticker_id = %row.id, name = %name, "Sticker uploaded");

    Ok((StatusCode::CREATED, Json(json!({
        "id": row.id,
        "pack_id": pack_id,
        "name": name,
        "image_url": image_url,
        "created_at": row.created_at.to_rfc3339(),
    }))))
}

/// List stickers in a pack.
pub async fn list_stickers(
    _auth: AuthUser,
    State(state): State<Arc<AppState>>,
    Path(pack_id): Path<Uuid>,
) -> Result<impl IntoResponse, AppError> {
    let rows = sqlx::query!(
        "SELECT id, name, image_url, created_at FROM stickers WHERE pack_id = $1 ORDER BY created_at ASC",
        pack_id,
    )
    .fetch_all(&state.db)
    .await?;

    let stickers: Vec<serde_json::Value> = rows.iter().map(|r| json!({
        "id": r.id,
        "name": r.name,
        "image_url": r.image_url,
        "created_at": r.created_at.to_rfc3339(),
    })).collect();

    Ok(Json(json!({ "stickers": stickers })))
}
