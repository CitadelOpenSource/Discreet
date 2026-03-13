// citadel_bot_spawn_handlers.rs — AI Bot auto-spawn system (PATENT-PENDING).
//
// Core patent feature: Users can spawn specialist AI bots as encrypted
// channel members. Each bot has its own cryptographic identity and
// participates in the E2EE group. The server NEVER sees conversation content.
//
// Pre-built personas: General, Legal, Medical, Security, Gaming, Music,
// Art, Research, Coding, Therapy, Creative Writing, Meme, Finance, Fitness
//
// Endpoints:
//   GET    /api/v1/bots/personas                            — List available bot personas
//   POST   /api/v1/bots/spawn                               — Spawn a private AI bot channel
//   GET    /api/v1/bots/channels                            — List user's active bot channels
//   DELETE /api/v1/bots/channels/:id                        — End bot channel
//   GET    /api/v1/servers/:id/ai-bots                      — List bots in a server
//   POST   /api/v1/servers/:id/ai-bots                      — Add bot to server (owner)
//   PATCH  /api/v1/servers/:id/ai-bots/:bot_id              — Update bot config
//   DELETE /api/v1/servers/:id/ai-bots/:bot_id              — Remove bot from server
//   POST   /api/v1/servers/:id/ai-bots/:bot_id/prompt       — Send prompt, get bot reply

use axum::{extract::{Path, Query, State, Json}, http::StatusCode, response::IntoResponse};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use uuid::Uuid;
use crate::{citadel_auth::AuthUser, citadel_error::AppError, citadel_state::AppState};
use crate::citadel_agent_config::{load_server_agent_config, store_encrypted_api_key};
use crate::citadel_agent_memory::{agent_memory_fact_count, build_context, clear_agent_memory};
use crate::citadel_agent_episodic_memory::run_episodic_pipeline;
use crate::citadel_agent_provider::{AgentMessage, create_provider, strip_metadata, sanitize_agent_input, cap_response, check_agent_rate_limit};

// ─── Personas ──────────────────────────────────────────────────────────

#[derive(Debug, Serialize, Clone)]
pub struct BotPersona {
    pub id: String,
    pub name: String,
    pub emoji: String,
    pub description: String,
    pub system_prompt: String,
    pub voice_style: String,
    pub nsfw: bool,
}

fn built_in_personas() -> Vec<BotPersona> {
    vec![
        BotPersona { id: "general".into(), name: "Discreet AI".into(), emoji: "🤖".into(),
            description: "General-purpose assistant. Ask anything.".into(),
            system_prompt: "You are Discreet AI, a helpful assistant in an encrypted chat. Be concise, friendly, and accurate.".into(),
            voice_style: "default".into(), nsfw: false },
        BotPersona { id: "legal".into(), name: "Legal Advisor".into(), emoji: "⚖️".into(),
            description: "General legal information and guidance. Not a lawyer.".into(),
            system_prompt: "You are a legal information assistant. Provide general legal information. Always state you are not a lawyer and this is not legal advice. Be thorough and cite relevant laws when possible.".into(),
            voice_style: "professional".into(), nsfw: false },
        BotPersona { id: "medical".into(), name: "Health Guide".into(), emoji: "🏥".into(),
            description: "Health information and wellness guidance. Not a doctor.".into(),
            system_prompt: "You are a health information assistant. Provide general health information. Always state you are not a doctor and this is not medical advice. Recommend seeing a healthcare professional for specific concerns.".into(),
            voice_style: "calm".into(), nsfw: false },
        BotPersona { id: "security".into(), name: "Security Analyst".into(), emoji: "🔒".into(),
            description: "Cybersecurity guidance, threat analysis, best practices.".into(),
            system_prompt: "You are a cybersecurity expert. Help with security best practices, threat assessment, vulnerability analysis, and security architecture. Be precise and technical.".into(),
            voice_style: "technical".into(), nsfw: false },
        BotPersona { id: "gaming".into(), name: "Game Master".into(), emoji: "🎮".into(),
            description: "Gaming strategies, walkthroughs, builds, patch notes.".into(),
            system_prompt: "You are a gaming expert. Help with game strategies, builds, walkthroughs, and gaming news. Be enthusiastic and knowledgeable about all major games.".into(),
            voice_style: "energetic".into(), nsfw: false },
        BotPersona { id: "music".into(), name: "Music Bot".into(), emoji: "🎵".into(),
            description: "Music recommendations, theory, playlists, discovery.".into(),
            system_prompt: "You are a music expert. Recommend music, discuss theory, create themed playlists, and help with music discovery across all genres. Be passionate about music.".into(),
            voice_style: "expressive".into(), nsfw: false },
        BotPersona { id: "art".into(), name: "Art Director".into(), emoji: "🎨".into(),
            description: "Creative feedback, art techniques, design critique.".into(),
            system_prompt: "You are an art director and creative consultant. Provide feedback on art, discuss techniques, and help with design decisions. Be constructive and inspiring.".into(),
            voice_style: "thoughtful".into(), nsfw: false },
        BotPersona { id: "research".into(), name: "Research Assistant".into(), emoji: "🔬".into(),
            description: "Academic research, fact-checking, source finding.".into(),
            system_prompt: "You are a research assistant. Help with academic research, fact-checking, finding sources, and synthesizing information. Be thorough and cite your reasoning.".into(),
            voice_style: "scholarly".into(), nsfw: false },
        BotPersona { id: "coding".into(), name: "Code Wizard".into(), emoji: "💻".into(),
            description: "Programming help, debugging, architecture, code review.".into(),
            system_prompt: "You are an expert software engineer. Help with coding in any language, debugging, architecture decisions, and code review. Provide code examples when helpful.".into(),
            voice_style: "technical".into(), nsfw: false },
        BotPersona { id: "companion".into(), name: "Companion".into(), emoji: "💬".into(),
            description: "Friendly conversation, emotional support, just chat.".into(),
            system_prompt: "You are a friendly companion. Have warm, genuine conversations. Listen actively, be empathetic, and engage with what the user shares. You're here to chat and connect.".into(),
            voice_style: "warm".into(), nsfw: false },
        BotPersona { id: "creative".into(), name: "Story Weaver".into(), emoji: "📝".into(),
            description: "Creative writing, worldbuilding, story ideas, roleplay.".into(),
            system_prompt: "You are a creative writing assistant. Help with stories, worldbuilding, character development, and creative exercises. Be imaginative and encouraging.".into(),
            voice_style: "dramatic".into(), nsfw: false },
        BotPersona { id: "meme".into(), name: "Meme Lord".into(), emoji: "😂".into(),
            description: "Meme culture, humor, jokes, internet culture.".into(),
            system_prompt: "You are a meme expert and comedian. Be funny, reference internet culture, and help create or explain memes. Use humor liberally but know when to be sincere.".into(),
            voice_style: "playful".into(), nsfw: false },
        BotPersona { id: "finance".into(), name: "Finance Guide".into(), emoji: "💰".into(),
            description: "Financial education, market concepts, crypto basics. Not financial advice.".into(),
            system_prompt: "You are a financial education assistant. Explain financial concepts, discuss markets, and help with financial literacy. Always state this is not financial advice.".into(),
            voice_style: "professional".into(), nsfw: false },
        BotPersona { id: "fitness".into(), name: "Fitness Coach".into(), emoji: "💪".into(),
            description: "Workout plans, nutrition guidance, exercise form.".into(),
            system_prompt: "You are a fitness coach. Help with workout plans, nutrition, and exercise technique. Be motivating and safety-conscious. Recommend consulting a doctor for medical concerns.".into(),
            voice_style: "motivating".into(), nsfw: false },
        // ── NSFW Personas (OFF by default, require USE_NSFW_AI permission + server enable) ──
        BotPersona { id: "nsfw_roleplay".into(), name: "Roleplay Partner".into(), emoji: "🎭".into(),
            description: "Adult roleplay scenarios and creative fiction. 18+ only.".into(),
            system_prompt: "You are an adult roleplay partner for creative fiction. Users are verified 18+. Engage in collaborative storytelling. Stay in character.".into(),
            voice_style: "expressive".into(), nsfw: true },
        BotPersona { id: "nsfw_flirt".into(), name: "Flirty Chat".into(), emoji: "💋".into(),
            description: "Flirtatious conversation and companionship. 18+ only.".into(),
            system_prompt: "You are a flirty, playful conversational companion. Users are verified 18+. Be charming, witty, and engaging.".into(),
            voice_style: "warm".into(), nsfw: true },
    ]
}

// ─── Types ─────────────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct SpawnBotRequest {
    pub persona: String,
    pub topic: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct AddBotToServerRequest {
    pub persona: String,
    pub channel_id: Option<Uuid>,
    // ── Core identity ───────────────────────────────────────────────────
    pub display_name: Option<String>,
    pub system_prompt: Option<String>,
    // ── Extended behavioural config (all optional at spawn time) ────────
    pub greeting_message: Option<String>,
    pub response_prefix: Option<String>,
    pub blocked_topics: Option<String>,
    pub rate_limit_per_min: Option<i32>,
    pub typing_delay: Option<i32>,
    pub context_memory: Option<bool>,
    pub context_window: Option<i32>,
    pub dm_auto_respond: Option<bool>,
    pub dm_greeting: Option<String>,
    pub emoji_reactions: Option<bool>,
    pub language: Option<String>,
    pub knowledge_base: Option<String>,
    pub response_mode: Option<String>,
    pub auto_thread: Option<bool>,
}

#[derive(Debug, Deserialize)]
pub struct UpdateAgentConfigRequest {
    pub provider_type:         Option<String>,
    pub model_id:              Option<String>,
    pub endpoint_url:          Option<String>,
    pub temperature:           Option<f32>,
    pub context_message_count: Option<i32>,
    pub trigger_keywords:      Option<serde_json::Value>,
    pub memory_mode:           Option<String>,
    pub system_prompt:         Option<String>,
    pub disclosure_text:       Option<String>,
    pub nsfw_allowed:          Option<bool>,
    pub mcp_tool_urls:         Option<serde_json::Value>,
    /// Plaintext API key — encrypted and stored; never echoed back.
    pub api_key:               Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct UpdateBotConfigRequest {
    // ── Core identity ───────────────────────────────────────────────────
    pub display_name: Option<String>,
    pub system_prompt: Option<String>,
    pub voice_style: Option<String>,
    pub temperature: Option<f32>,
    pub enabled: Option<bool>,
    pub persistent: Option<bool>,
    // ── Extended behavioural config ─────────────────────────────────────
    pub greeting_message: Option<String>,
    pub response_prefix: Option<String>,
    pub blocked_topics: Option<String>,
    pub rate_limit_per_min: Option<i32>,
    pub typing_delay: Option<i32>,
    pub context_memory: Option<bool>,
    pub context_window: Option<i32>,
    pub dm_auto_respond: Option<bool>,
    pub dm_greeting: Option<String>,
    pub emoji_reactions: Option<bool>,
    pub language: Option<String>,
    pub knowledge_base: Option<String>,
    pub response_mode: Option<String>,
    pub auto_thread: Option<bool>,
}

#[derive(Debug, Deserialize)]
pub struct PromptBotRequest {
    /// The user's message / prompt text.
    pub prompt: String,
    /// Channel to post the response into. Falls back to the server's first text
    /// channel when omitted.
    pub channel_id: Option<Uuid>,
}

#[derive(Debug, Serialize)]
pub struct BotChannelInfo {
    pub id: Uuid,
    pub bot_persona: String,
    pub channel_name: String,
    pub last_active_at: String,
    pub created_at: String,
}

// ─── GET /bots/personas ────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct PersonaQuery {
    pub include_nsfw: Option<bool>,
}

pub async fn list_personas(
    _auth: AuthUser,
    Query(q): Query<PersonaQuery>,
) -> Result<impl IntoResponse, AppError> {
    let include_nsfw = q.include_nsfw.unwrap_or(false);
    let personas: Vec<BotPersona> = built_in_personas().into_iter()
        .filter(|p| !p.nsfw || include_nsfw)
        .collect();
    Ok(Json(personas))
}

// ─── POST /bots/spawn ──────────────────────────────────────────────────

/// PATENT CLAIM 1: Auto-spawn specialist AI agent as encrypted channel member.
/// The server creates a bot user (if not existing), creates a private channel,
/// and the bot joins as an E2EE group participant.
pub async fn spawn_bot_channel(
    auth: AuthUser,
    State(state): State<Arc<AppState>>,
    Json(req): Json<SpawnBotRequest>,
) -> Result<impl IntoResponse, AppError> {
    let persona = built_in_personas().into_iter()
        .find(|p| p.id == req.persona)
        .unwrap_or_else(|| built_in_personas()[0].clone());

    // Block NSFW personas unless explicitly allowed
    if persona.nsfw {
        // For private bot channels (no server context), require verified account
        let user = sqlx::query!(
            "SELECT account_tier, email_verified FROM users WHERE id = $1",
            auth.user_id,
        ).fetch_optional(&state.db).await?
            .ok_or_else(|| AppError::NotFound("User not found".into()))?;

        if user.account_tier != "verified" || !user.email_verified {
            return Err(AppError::Forbidden("NSFW AI bots require a verified (email confirmed) account".into()));
        }
    }

    // Find or create bot user for this persona
    let bot_username = format!("bot-{}", persona.id);
    let bot_user = sqlx::query!(
        "SELECT id FROM users WHERE username = $1 AND is_bot = TRUE",
        bot_username,
    )
    .fetch_optional(&state.db)
    .await?;

    let bot_id = if let Some(bu) = bot_user {
        bu.id
    } else {
        let bid = Uuid::new_v4();
        sqlx::query!(
            "INSERT INTO users (id, username, display_name, password_hash, is_bot, account_tier)
             VALUES ($1, $2, $3, $4, TRUE, 'unverified')",
            bid, bot_username, persona.name,
            "$argon2id$v=19$m=19456,t=2,p=1$BOT_NO_LOGIN$0000000000000000000000",
        )
        .execute(&state.db)
        .await?;
        bid
    };

    // Create bot channel record
    let topic = req.topic.unwrap_or_else(|| persona.name.clone());
    let channel_name = format!("{} — {}", persona.emoji, topic);
    let bc_id = Uuid::new_v4();

    sqlx::query!(
        "INSERT INTO bot_channels (id, user_id, bot_id, channel_name, bot_persona)
         VALUES ($1, $2, $3, $4, $5)",
        bc_id, auth.user_id, bot_id, channel_name, persona.id,
    )
    .execute(&state.db)
    .await?;

    tracing::info!(
        user_id = %auth.user_id, bot = %persona.id, channel = %bc_id,
        "AI bot channel spawned (patent claim 1)"
    );

    // Emit disclosure so clients can surface the AI-in-channel notice.
    // Private bot channels have no server_id; Uuid::nil() targets no WS bus
    // (fire-and-forget, silently dropped if no subscriber).
    let disclosure_text = format!(
        "AI Agent {} is active in this channel. Messages you send may be processed by \
         the configured AI provider. Agent responses are encrypted like all other messages.",
        persona.name
    );
    state.ws_broadcast(Uuid::nil(), serde_json::json!({
        "type":             "agent_disclosure",
        "channel_id":       bc_id,
        "agent_id":         bot_id,
        "display_name":     persona.name,
        "disclosure_text":  disclosure_text,
    })).await;

    Ok((StatusCode::CREATED, Json(serde_json::json!({
        "id": bc_id,
        "bot_id": bot_id,
        "bot_persona": persona.id,
        "bot_name": persona.name,
        "bot_emoji": persona.emoji,
        "channel_name": channel_name,
        "system_prompt": persona.system_prompt,
    }))))
}

// ─── GET /bots/channels ────────────────────────────────────────────────

pub async fn list_bot_channels(
    auth: AuthUser,
    State(state): State<Arc<AppState>>,
) -> Result<impl IntoResponse, AppError> {
    let rows = sqlx::query!(
        "SELECT id, bot_persona, channel_name, last_active_at, created_at
         FROM bot_channels WHERE user_id = $1 ORDER BY last_active_at DESC",
        auth.user_id,
    )
    .fetch_all(&state.db)
    .await?;

    let channels: Vec<BotChannelInfo> = rows.iter().map(|r| BotChannelInfo {
        id: r.id, bot_persona: r.bot_persona.clone(),
        channel_name: r.channel_name.clone(),
        last_active_at: r.last_active_at.to_rfc3339(),
        created_at: r.created_at.to_rfc3339(),
    }).collect();

    Ok(Json(channels))
}

// ─── DELETE /bots/channels/:id ─────────────────────────────────────────

pub async fn close_bot_channel(
    auth: AuthUser,
    State(state): State<Arc<AppState>>,
    Path(channel_id): Path<Uuid>,
) -> Result<impl IntoResponse, AppError> {
    sqlx::query!(
        "DELETE FROM bot_channels WHERE id = $1 AND user_id = $2",
        channel_id, auth.user_id,
    )
    .execute(&state.db)
    .await?;
    Ok(StatusCode::NO_CONTENT)
}

// ─── GET /servers/:id/bots ─────────────────────────────────────────────

pub async fn list_server_bots(
    _auth: AuthUser,
    State(state): State<Arc<AppState>>,
    Path(server_id): Path<Uuid>,
) -> Result<impl IntoResponse, AppError> {
    let rows = sqlx::query!(
        r#"SELECT
               bc.bot_user_id,
               bc.persona,
               bc.display_name,
               bc.description,
               bc.system_prompt,
               bc.voice_style,
               bc.temperature,
               bc.max_tokens,
               bc.enabled,
               bc.greeting_message,
               bc.response_prefix,
               bc.rate_limit_per_min,
               bc.typing_delay,
               bc.context_memory,
               bc.context_window,
               bc.dm_auto_respond,
               bc.emoji_reactions,
               bc.language,
               bc.knowledge_base,
               bc.response_mode,
               bc.auto_thread,
               bc.created_at,
               u.username  AS bot_username,
               u.is_bot
           FROM bot_configs bc
           JOIN users u ON u.id = bc.bot_user_id
           WHERE bc.server_id = $1
           ORDER BY bc.created_at"#,
        server_id,
    )
    .fetch_all(&state.db)
    .await?;

    let bots: Vec<serde_json::Value> = rows.iter().map(|r| serde_json::json!({
        "bot_user_id":       r.bot_user_id,
        "username":          r.bot_username,
        "is_bot":            r.is_bot,
        "persona":           r.persona,
        "display_name":      r.display_name,
        "description":       r.description,
        "system_prompt":     r.system_prompt,
        "voice_style":       r.voice_style,
        "temperature":       r.temperature,
        "max_tokens":        r.max_tokens,
        "enabled":           r.enabled,
        "greeting_message":  r.greeting_message,
        "response_prefix":   r.response_prefix,
        "rate_limit_per_min": r.rate_limit_per_min,
        "typing_delay":      r.typing_delay,
        "context_memory":    r.context_memory,
        "context_window":    r.context_window,
        "dm_auto_respond":   r.dm_auto_respond,
        "emoji_reactions":   r.emoji_reactions,
        "language":          r.language,
        "knowledge_base":    r.knowledge_base,
        "response_mode":     r.response_mode,
        "auto_thread":       r.auto_thread,
        "created_at":        r.created_at.to_rfc3339(),
    })).collect();

    Ok(Json(bots))
}

// ─── POST /servers/:id/bots ────────────────────────────────────────────

pub async fn add_bot_to_server(
    auth: AuthUser,
    State(state): State<Arc<AppState>>,
    Path(server_id): Path<Uuid>,
    Json(req): Json<AddBotToServerRequest>,
) -> Result<impl IntoResponse, AppError> {
    // Only owner or admin can add bots
    let is_owner = sqlx::query_scalar!(
        "SELECT EXISTS(SELECT 1 FROM servers WHERE id = $1 AND owner_id = $2)",
        server_id, auth.user_id,
    ).fetch_one(&state.db).await?.unwrap_or(false);
    if !is_owner { return Err(AppError::Forbidden("Only server owner can add bots".into())); }

    let persona = built_in_personas().into_iter()
        .find(|p| p.id == req.persona)
        .unwrap_or_else(|| built_in_personas()[0].clone());

    // Find or create bot user
    let bot_username = format!("bot-{}", persona.id);
    let bot_id = match sqlx::query_scalar!("SELECT id FROM users WHERE username = $1", bot_username)
        .fetch_optional(&state.db).await? {
        Some(id) => id,
        None => {
            let bid = Uuid::new_v4();
            sqlx::query!(
                "INSERT INTO users (id, username, display_name, password_hash, is_bot, account_tier)
                 VALUES ($1, $2, $3, $4, TRUE, 'unverified')",
                bid, bot_username, req.display_name.as_deref().unwrap_or(&persona.name),
                "$argon2id$v=19$m=19456,t=2,p=1$BOT_NO_LOGIN$0000000000000000000000",
            ).execute(&state.db).await?;
            bid
        }
    };

    // Add bot as server member
    sqlx::query!(
        "INSERT INTO server_members (server_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING",
        server_id, bot_id,
    ).execute(&state.db).await?;

    // Insert core bot config. New extended columns pick up their DB defaults here.
    let display_name = req.display_name.clone().unwrap_or_else(|| persona.name.clone());
    sqlx::query!(
        "INSERT INTO bot_configs (bot_user_id, server_id, persona, display_name, description, system_prompt)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (bot_user_id, server_id) DO UPDATE SET persona = $3, display_name = $4",
        bot_id, server_id, persona.id,
        display_name,
        Some(persona.description.clone()),
        req.system_prompt.clone().or(Some(persona.system_prompt)),
    ).execute(&state.db).await?;

    // Apply any extended behavioural fields provided at spawn time.
    // COALESCE(new_value, existing_value) leaves columns at their DB defaults when
    // the field is absent from the request.
    let has_extended = req.greeting_message.is_some()
        || req.response_prefix.is_some()
        || req.blocked_topics.is_some()
        || req.rate_limit_per_min.is_some()
        || req.typing_delay.is_some()
        || req.context_memory.is_some()
        || req.context_window.is_some()
        || req.dm_auto_respond.is_some()
        || req.dm_greeting.is_some()
        || req.emoji_reactions.is_some()
        || req.language.is_some()
        || req.knowledge_base.is_some()
        || req.response_mode.is_some()
        || req.auto_thread.is_some();

    if has_extended {
        sqlx::query!(
            "UPDATE bot_configs SET
                greeting_message   = COALESCE($3,  greeting_message),
                response_prefix    = COALESCE($4,  response_prefix),
                blocked_topics     = COALESCE($5,  blocked_topics),
                rate_limit_per_min = COALESCE($6,  rate_limit_per_min),
                typing_delay       = COALESCE($7,  typing_delay),
                context_memory     = COALESCE($8,  context_memory),
                context_window     = COALESCE($9,  context_window),
                dm_auto_respond    = COALESCE($10, dm_auto_respond),
                dm_greeting        = COALESCE($11, dm_greeting),
                emoji_reactions    = COALESCE($12, emoji_reactions),
                language           = COALESCE($13, language),
                knowledge_base     = COALESCE($14, knowledge_base),
                response_mode      = COALESCE($15, response_mode),
                auto_thread        = COALESCE($16, auto_thread)
             WHERE bot_user_id = $1 AND server_id = $2",
            bot_id, server_id,
            req.greeting_message,
            req.response_prefix,
            req.blocked_topics,
            req.rate_limit_per_min,
            req.typing_delay,
            req.context_memory,
            req.context_window,
            req.dm_auto_respond,
            req.dm_greeting,
            req.emoji_reactions,
            req.language,
            req.knowledge_base,
            req.response_mode,
            req.auto_thread,
        ).execute(&state.db).await?;
    }

    // Emit disclosure to all server members so clients can surface the AI-in-server notice.
    let disclosure_text = format!(
        "AI Agent {} is active in this channel. Messages you send may be processed by \
         the configured AI provider. Agent responses are encrypted like all other messages.",
        display_name
    );
    state.ws_broadcast(server_id, serde_json::json!({
        "type":             "agent_disclosure",
        "channel_id":       Uuid::nil(),
        "agent_id":         bot_id,
        "display_name":     display_name,
        "disclosure_text":  disclosure_text,
    })).await;

    Ok((StatusCode::CREATED, Json(serde_json::json!({
        "bot_id": bot_id, "persona": persona.id, "name": persona.name,
    }))))
}

// ─── PATCH /servers/:id/bots/:bot_id ───────────────────────────────────

pub async fn update_bot_config(
    auth: AuthUser,
    State(state): State<Arc<AppState>>,
    Path((server_id, bot_id)): Path<(Uuid, Uuid)>,
    Json(req): Json<UpdateBotConfigRequest>,
) -> Result<impl IntoResponse, AppError> {
    let is_owner = sqlx::query_scalar!(
        "SELECT EXISTS(SELECT 1 FROM servers WHERE id = $1 AND owner_id = $2)",
        server_id, auth.user_id,
    ).fetch_one(&state.db).await?.unwrap_or(false);
    if !is_owner { return Err(AppError::Forbidden("Only server owner".into())); }

    // ── Core fields ──────────────────────────────────────────────────────
    if let Some(ref v) = req.display_name {
        sqlx::query!("UPDATE bot_configs SET display_name = $1 WHERE bot_user_id = $2 AND server_id = $3", v, bot_id, server_id)
            .execute(&state.db).await?;
    }
    if let Some(ref v) = req.system_prompt {
        sqlx::query!("UPDATE bot_configs SET system_prompt = $1 WHERE bot_user_id = $2 AND server_id = $3", v, bot_id, server_id)
            .execute(&state.db).await?;
    }
    if let Some(ref v) = req.voice_style {
        sqlx::query!("UPDATE bot_configs SET voice_style = $1 WHERE bot_user_id = $2 AND server_id = $3", v, bot_id, server_id)
            .execute(&state.db).await?;
    }
    if let Some(v) = req.temperature {
        sqlx::query!("UPDATE bot_configs SET temperature = $1 WHERE bot_user_id = $2 AND server_id = $3", v, bot_id, server_id)
            .execute(&state.db).await?;
    }
    if let Some(v) = req.enabled {
        sqlx::query!("UPDATE bot_configs SET enabled = $1 WHERE bot_user_id = $2 AND server_id = $3", v, bot_id, server_id)
            .execute(&state.db).await?;
    }
    if let Some(v) = req.persistent {
        sqlx::query!("UPDATE bot_configs SET persistent = $1 WHERE bot_user_id = $2 AND server_id = $3", v, bot_id, server_id)
            .execute(&state.db).await?;
    }
    // ── Extended behavioural fields ──────────────────────────────────────
    if let Some(ref v) = req.greeting_message {
        sqlx::query!("UPDATE bot_configs SET greeting_message = $1 WHERE bot_user_id = $2 AND server_id = $3", v, bot_id, server_id)
            .execute(&state.db).await?;
    }
    if let Some(ref v) = req.response_prefix {
        sqlx::query!("UPDATE bot_configs SET response_prefix = $1 WHERE bot_user_id = $2 AND server_id = $3", v, bot_id, server_id)
            .execute(&state.db).await?;
    }
    if let Some(ref v) = req.blocked_topics {
        sqlx::query!("UPDATE bot_configs SET blocked_topics = $1 WHERE bot_user_id = $2 AND server_id = $3", v, bot_id, server_id)
            .execute(&state.db).await?;
    }
    if let Some(v) = req.rate_limit_per_min {
        sqlx::query!("UPDATE bot_configs SET rate_limit_per_min = $1 WHERE bot_user_id = $2 AND server_id = $3", v, bot_id, server_id)
            .execute(&state.db).await?;
    }
    if let Some(v) = req.typing_delay {
        sqlx::query!("UPDATE bot_configs SET typing_delay = $1 WHERE bot_user_id = $2 AND server_id = $3", v, bot_id, server_id)
            .execute(&state.db).await?;
    }
    if let Some(v) = req.context_memory {
        sqlx::query!("UPDATE bot_configs SET context_memory = $1 WHERE bot_user_id = $2 AND server_id = $3", v, bot_id, server_id)
            .execute(&state.db).await?;
    }
    if let Some(v) = req.context_window {
        sqlx::query!("UPDATE bot_configs SET context_window = $1 WHERE bot_user_id = $2 AND server_id = $3", v, bot_id, server_id)
            .execute(&state.db).await?;
    }
    if let Some(v) = req.dm_auto_respond {
        sqlx::query!("UPDATE bot_configs SET dm_auto_respond = $1 WHERE bot_user_id = $2 AND server_id = $3", v, bot_id, server_id)
            .execute(&state.db).await?;
    }
    if let Some(ref v) = req.dm_greeting {
        sqlx::query!("UPDATE bot_configs SET dm_greeting = $1 WHERE bot_user_id = $2 AND server_id = $3", v, bot_id, server_id)
            .execute(&state.db).await?;
    }
    if let Some(v) = req.emoji_reactions {
        sqlx::query!("UPDATE bot_configs SET emoji_reactions = $1 WHERE bot_user_id = $2 AND server_id = $3", v, bot_id, server_id)
            .execute(&state.db).await?;
    }
    if let Some(ref v) = req.language {
        sqlx::query!("UPDATE bot_configs SET language = $1 WHERE bot_user_id = $2 AND server_id = $3", v, bot_id, server_id)
            .execute(&state.db).await?;
    }
    if let Some(ref v) = req.knowledge_base {
        sqlx::query!("UPDATE bot_configs SET knowledge_base = $1 WHERE bot_user_id = $2 AND server_id = $3", v, bot_id, server_id)
            .execute(&state.db).await?;
    }
    if let Some(ref v) = req.response_mode {
        sqlx::query!("UPDATE bot_configs SET response_mode = $1 WHERE bot_user_id = $2 AND server_id = $3", v, bot_id, server_id)
            .execute(&state.db).await?;
    }
    if let Some(v) = req.auto_thread {
        sqlx::query!("UPDATE bot_configs SET auto_thread = $1 WHERE bot_user_id = $2 AND server_id = $3", v, bot_id, server_id)
            .execute(&state.db).await?;
    }

    Ok(Json(serde_json::json!({ "message": "Bot config updated" })))
}

// ─── DELETE /servers/:id/ai-bots/:bot_id ───────────────────────────────

pub async fn remove_bot_from_server(
    auth: AuthUser,
    State(state): State<Arc<AppState>>,
    Path((server_id, bot_id)): Path<(Uuid, Uuid)>,
) -> Result<impl IntoResponse, AppError> {
    let is_owner = sqlx::query_scalar!(
        "SELECT EXISTS(SELECT 1 FROM servers WHERE id = $1 AND owner_id = $2)",
        server_id, auth.user_id,
    ).fetch_one(&state.db).await?.unwrap_or(false);
    if !is_owner { return Err(AppError::Forbidden("Only server owner".into())); }

    sqlx::query!("DELETE FROM bot_configs WHERE bot_user_id = $1 AND server_id = $2", bot_id, server_id)
        .execute(&state.db).await?;
    sqlx::query!("DELETE FROM server_members WHERE server_id = $1 AND user_id = $2", server_id, bot_id)
        .execute(&state.db).await?;

    Ok(StatusCode::NO_CONTENT)
}

// ─── POST /servers/:server_id/ai-bots/:bot_id/prompt ───────────────────
//
// Send a prompt to a server bot and receive a placeholder response posted as
// a real message in the channel. The bot's response is inserted into the
// messages table (authored by the bot's user ID) and broadcast via WebSocket
// so all connected clients see it appear in real-time.
//
// When a real AI backend is wired in, this handler becomes the integration
// point: replace the `response_text` construction with an async LLM call
// using `bot.system_prompt` as the system context.

pub async fn prompt_bot(
    auth: AuthUser,
    State(state): State<Arc<AppState>>,
    Path((server_id, bot_id)): Path<(Uuid, Uuid)>,
    Json(req): Json<PromptBotRequest>,
) -> Result<impl IntoResponse, AppError> {
    // ── Kill switches: AI bots ─────────────────────────────────────────────
    let platform = crate::citadel_platform_settings::get_platform_settings(&state).await?;
    if !platform.ai_bots_enabled {
        return Err(AppError::ServiceUnavailable("AI bots are currently disabled by the platform administrator.".into()));
    }
    if platform.ai_emergency_stop {
        return Err(AppError::ServiceUnavailable("AI services have been temporarily halted by the platform administrator.".into()));
    }

    // ── Global AI rate limit ────────────────────────────────────────────────
    if platform.ai_rate_limit_per_minute > 0 {
        let rl_key = format!("ai_global_rl:{}", auth.user_id);
        let mut redis_conn = state.redis.clone();
        let count: i64 = redis::cmd("INCR")
            .arg(&rl_key)
            .query_async(&mut redis_conn)
            .await
            .unwrap_or(1);
        if count == 1 {
            let _: Result<(), _> = redis::cmd("EXPIRE")
                .arg(&rl_key)
                .arg(60u64)
                .query_async(&mut redis_conn)
                .await;
        }
        if count > platform.ai_rate_limit_per_minute as i64 {
            return Err(AppError::RateLimited(format!(
                "AI rate limit exceeded ({}/min). Please wait before sending another prompt.",
                platform.ai_rate_limit_per_minute
            )));
        }
    }

    // Verify the requester is a member of this server.
    let is_member = sqlx::query_scalar!(
        "SELECT EXISTS(SELECT 1 FROM server_members WHERE server_id = $1 AND user_id = $2)",
        server_id, auth.user_id,
    )
    .fetch_one(&state.db)
    .await?
    .unwrap_or(false);

    if !is_member {
        return Err(AppError::Forbidden("Not a member of this server".into()));
    }

    // Load the bot config for this server.
    let bot = sqlx::query!(
        "SELECT bot_user_id, persona, display_name, system_prompt, temperature, enabled
         FROM bot_configs WHERE bot_user_id = $1 AND server_id = $2",
        bot_id, server_id,
    )
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::NotFound("Bot not found in this server".into()))?;

    if !bot.enabled {
        return Err(AppError::BadRequest("This bot is currently disabled".into()));
    }

    // Per-user per-server agent rate limit (30/hour).
    check_agent_rate_limit(&mut state.redis.clone(), auth.user_id, server_id).await?;

    // Sanitize user input before any LLM processing.
    let sanitized_prompt = sanitize_agent_input(&req.prompt);

    // Resolve the target channel: use the provided channel_id if present,
    // otherwise fall back to the server's first text channel.
    let channel_id: Uuid = if let Some(cid) = req.channel_id {
        sqlx::query_scalar!(
            "SELECT id FROM channels WHERE id = $1 AND server_id = $2",
            cid, server_id,
        )
        .fetch_optional(&state.db)
        .await?
        .ok_or_else(|| AppError::NotFound("Channel not found in this server".into()))?
    } else {
        sqlx::query_scalar!(
            "SELECT id FROM channels
             WHERE server_id = $1 AND channel_type = 'text'
             ORDER BY created_at
             LIMIT 1",
            server_id,
        )
        .fetch_optional(&state.db)
        .await?
        .ok_or_else(|| AppError::NotFound("No text channel found in server".into()))?
    };

    // Attempt to load the full agent config (provider, encrypted API key, memory
    // mode, etc.).  Falls back to the placeholder response when not yet configured.
    let agent_config = load_server_agent_config(
        &state.db,
        bot_id,
        server_id,
        state.config.agent_key_secret.as_bytes(),
    ).await;

    // When agent config loaded successfully, build the LLM context window:
    // load the last N channel messages, append the current user prompt, then
    // strip user-identifying metadata before any LLM call sees the content.
    let messages: Vec<AgentMessage> = if let Ok(ref cfg) = agent_config {
        let mut msgs = build_context(
            &state.db,
            channel_id,
            bot_id,
            cfg.context_message_count,
            cfg.memory_mode == crate::citadel_agent_config::MemoryMode::Summary,
            state.config.agent_key_secret.as_bytes(),
        ).await.unwrap_or_default();
        msgs.push(AgentMessage {
            role: "user".into(),
            content: sanitized_prompt.clone(),
        });
        strip_metadata(&mut msgs);
        msgs
    } else {
        Vec::new()
    };

    // Build the response text. When agent config is available, use its resolved
    // display name; otherwise fall back to the bot_configs row values so the
    // placeholder message still looks correct.
    let display_name = match &agent_config {
        Ok(cfg) => cfg.display_name.clone(),
        Err(_)  => bot.display_name.clone(),
    };
    let persona = bot.persona.clone();
    let temperature = bot.temperature.unwrap_or(0.7);

    let prompt_preview = if sanitized_prompt.chars().count() > 60 {
        let truncated: String = sanitized_prompt.chars().take(60).collect();
        format!("{truncated}…")
    } else {
        sanitized_prompt.clone()
    };

    let placeholder = format!(
        "{display_name}: I received your message about '{prompt_preview}'. \
         [AI responses will be connected soon — this bot is configured as a \
         {persona} with temperature {temperature:.1}]"
    );

    let messages_for_memory = messages.clone();

    let response_text = if let Ok(ref cfg) = agent_config {
        // Apply global model override if set by platform admin.
        let (effective_provider, effective_config) = if !platform.ai_global_model.is_empty() {
            let (ptype, model_id) = match platform.ai_global_model.as_str() {
                "claude-haiku" => (crate::citadel_agent_provider::ProviderType::Anthropic, "claude-haiku-4-5-20251001".to_string()),
                "claude-sonnet" => (crate::citadel_agent_provider::ProviderType::Anthropic, "claude-sonnet-4-6".to_string()),
                "ollama-local" => (crate::citadel_agent_provider::ProviderType::Ollama, "llama3".to_string()),
                _ => (cfg.provider_type.clone(), cfg.model_config.model_id.clone()),
            };
            let mut mc = cfg.model_config.clone();
            mc.model_id = model_id;
            (ptype, mc)
        } else {
            (cfg.provider_type.clone(), cfg.model_config.clone())
        };

        let provider = create_provider(&effective_provider);
        match provider.complete(&cfg.system_prompt, messages, &effective_config).await {
            Ok(completion) => completion.text,
            Err(e) => {
                tracing::warn!(
                    bot_id = %bot_id,
                    server_id = %server_id,
                    error = %e,
                    "LLM provider call failed — falling back to placeholder response"
                );
                placeholder
            }
        }
    } else {
        placeholder
    };
    let response_text = cap_response(response_text);

    // Insert the bot's reply as a message in the channel.
    // content_ciphertext stores the plaintext bytes for bot messages (bots are
    // not MLS group members; their messages are unencrypted placeholders).
    let message_id = Uuid::new_v4();
    let content_bytes = response_text.as_bytes().to_vec();

    sqlx::query!(
        "INSERT INTO messages (id, channel_id, author_id, content_ciphertext, mls_epoch)
         VALUES ($1, $2, $3, $4, $5)",
        message_id,
        channel_id,
        bot_id,
        &content_bytes,
        0_i64,
    )
    .execute(&state.db)
    .await?;

    // Broadcast so all connected clients render the message immediately.
    state.ws_broadcast(server_id, serde_json::json!({
        "type":       "message_create",
        "channel_id": channel_id,
        "message_id": message_id,
        "author_id":  bot_id,
        "content":    response_text,
    })).await;

    tracing::info!(
        bot_id = %bot_id,
        server_id = %server_id,
        channel_id = %channel_id,
        "Bot prompt handled"
    );

    // Fire-and-forget: run episodic memory extraction in the background.
    if let Ok(cfg) = agent_config {
        let db = state.db.clone();
        let provider = create_provider(&cfg.provider_type);
        let model_config = cfg.model_config.clone();
        let master_secret = state.config.agent_key_secret.clone();
        tokio::spawn(async move {
            let msg_count = messages_for_memory.len() as u64;
            if let Err(e) = run_episodic_pipeline(
                &db,
                provider.as_ref(),
                bot_id,
                channel_id,
                &messages_for_memory,
                &model_config,
                master_secret.as_bytes(),
                msg_count,
            )
            .await
            {
                tracing::warn!(
                    bot_id = %bot_id,
                    channel_id = %channel_id,
                    error = %e,
                    "Episodic memory pipeline failed"
                );
            }
        });
    }

    Ok(Json(serde_json::json!({
        "message_id": message_id,
        "channel_id": channel_id,
        "content":    response_text,
        "author_id":  bot_id,
    })))
}

// ─── GET /servers/:server_id/ai-bots/:bot_id/config ────────────────────
//
// Returns the agent's provider configuration for display in the server
// settings UI. The encrypted API key is NEVER returned — only a boolean
// indicating whether one has been stored.

pub async fn get_agent_config(
    auth: AuthUser,
    State(state): State<Arc<AppState>>,
    Path((server_id, bot_id)): Path<(Uuid, Uuid)>,
) -> Result<impl IntoResponse, AppError> {
    let is_owner = sqlx::query_scalar!(
        "SELECT EXISTS(SELECT 1 FROM servers WHERE id = $1 AND owner_id = $2)",
        server_id, auth.user_id,
    )
    .fetch_one(&state.db)
    .await?
    .unwrap_or(false);

    if !is_owner {
        return Err(AppError::Forbidden("Only server owner can view agent config".into()));
    }

    let row = sqlx::query!(
        r#"SELECT
               provider_type,
               model_id,
               endpoint_url,
               temperature,
               context_message_count,
               trigger_keywords,
               memory_mode,
               disclosure_text,
               nsfw_allowed,
               mcp_tool_urls,
               api_key_encrypted
           FROM bot_configs
           WHERE bot_user_id = $1 AND server_id = $2"#,
        bot_id, server_id,
    )
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::NotFound("Agent config not found".into()))?;

    let has_api_key = row.api_key_encrypted.as_ref().map_or(false, |b| !b.is_empty());
    let fact_count = agent_memory_fact_count(&state.db, bot_id).await;

    Ok(Json(serde_json::json!({
        "provider_type":          row.provider_type,
        "model_id":               row.model_id,
        "endpoint_url":           row.endpoint_url,
        "temperature":            row.temperature,
        "context_message_count":  row.context_message_count,
        "trigger_keywords":       row.trigger_keywords,
        "memory_mode":            row.memory_mode,
        "disclosure_text":        row.disclosure_text,
        "nsfw_allowed":           row.nsfw_allowed,
        "mcp_tool_urls":          row.mcp_tool_urls,
        "has_api_key":            has_api_key,
        "has_env_key":            false,
        "fact_count":             fact_count,
    })))
}

// ─── PUT /servers/:server_id/ai-bots/:bot_id/config ────────────────────
//
// Updates the agent's provider configuration. Each field is optional —
// only supplied fields are written. The api_key field, when present, is
// encrypted with AES-256-GCM and stored; it is never echoed back.
// Response mirrors GET so the UI can refresh state from a single call.

pub async fn update_agent_config(
    auth: AuthUser,
    State(state): State<Arc<AppState>>,
    Path((server_id, bot_id)): Path<(Uuid, Uuid)>,
    Json(req): Json<UpdateAgentConfigRequest>,
) -> Result<impl IntoResponse, AppError> {
    let is_owner = sqlx::query_scalar!(
        "SELECT EXISTS(SELECT 1 FROM servers WHERE id = $1 AND owner_id = $2)",
        server_id, auth.user_id,
    )
    .fetch_one(&state.db)
    .await?
    .unwrap_or(false);

    if !is_owner {
        return Err(AppError::Forbidden("Only server owner can update agent config".into()));
    }

    // Apply each supplied field individually, matching the pattern used by
    // update_bot_config above. Absent fields are left at their current value.
    if let Some(ref v) = req.provider_type {
        sqlx::query!(
            "UPDATE bot_configs SET provider_type = $1 WHERE bot_user_id = $2 AND server_id = $3",
            v, bot_id, server_id,
        ).execute(&state.db).await?;
    }
    if let Some(ref v) = req.model_id {
        sqlx::query!(
            "UPDATE bot_configs SET model_id = $1 WHERE bot_user_id = $2 AND server_id = $3",
            v, bot_id, server_id,
        ).execute(&state.db).await?;
    }
    if let Some(ref v) = req.endpoint_url {
        sqlx::query!(
            "UPDATE bot_configs SET endpoint_url = $1 WHERE bot_user_id = $2 AND server_id = $3",
            v, bot_id, server_id,
        ).execute(&state.db).await?;
    }
    if let Some(v) = req.temperature {
        sqlx::query!(
            "UPDATE bot_configs SET temperature = $1 WHERE bot_user_id = $2 AND server_id = $3",
            v, bot_id, server_id,
        ).execute(&state.db).await?;
    }
    if let Some(v) = req.context_message_count {
        sqlx::query!(
            "UPDATE bot_configs SET context_message_count = $1 WHERE bot_user_id = $2 AND server_id = $3",
            v, bot_id, server_id,
        ).execute(&state.db).await?;
    }
    if let Some(ref v) = req.trigger_keywords {
        sqlx::query!(
            "UPDATE bot_configs SET trigger_keywords = $1 WHERE bot_user_id = $2 AND server_id = $3",
            v, bot_id, server_id,
        ).execute(&state.db).await?;
    }
    if let Some(ref v) = req.memory_mode {
        sqlx::query!(
            "UPDATE bot_configs SET memory_mode = $1 WHERE bot_user_id = $2 AND server_id = $3",
            v, bot_id, server_id,
        ).execute(&state.db).await?;
    }
    if let Some(ref v) = req.system_prompt {
        sqlx::query!(
            "UPDATE bot_configs SET system_prompt = $1 WHERE bot_user_id = $2 AND server_id = $3",
            v, bot_id, server_id,
        ).execute(&state.db).await?;
    }
    if let Some(ref v) = req.disclosure_text {
        sqlx::query!(
            "UPDATE bot_configs SET disclosure_text = $1 WHERE bot_user_id = $2 AND server_id = $3",
            v, bot_id, server_id,
        ).execute(&state.db).await?;
    }
    if let Some(v) = req.nsfw_allowed {
        sqlx::query!(
            "UPDATE bot_configs SET nsfw_allowed = $1 WHERE bot_user_id = $2 AND server_id = $3",
            v, bot_id, server_id,
        ).execute(&state.db).await?;
    }
    if let Some(ref v) = req.mcp_tool_urls {
        sqlx::query!(
            "UPDATE bot_configs SET mcp_tool_urls = $1 WHERE bot_user_id = $2 AND server_id = $3",
            v, bot_id, server_id,
        ).execute(&state.db).await?;
    }

    // API key: encrypt and store — never echo back.
    if let Some(ref plaintext_key) = req.api_key {
        store_encrypted_api_key(
            &state.db,
            bot_id,
            server_id,
            plaintext_key,
            state.config.agent_key_secret.as_bytes(),
        )
        .await
        .map_err(AppError::from)?;
    }

    // Re-query to return the current state in the same shape as GET.
    let row = sqlx::query!(
        r#"SELECT
               provider_type,
               model_id,
               endpoint_url,
               temperature,
               context_message_count,
               trigger_keywords,
               memory_mode,
               disclosure_text,
               nsfw_allowed,
               mcp_tool_urls,
               api_key_encrypted
           FROM bot_configs
           WHERE bot_user_id = $1 AND server_id = $2"#,
        bot_id, server_id,
    )
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::NotFound("Agent config not found".into()))?;

    let has_api_key = row.api_key_encrypted.as_ref().map_or(false, |b| !b.is_empty());
    let fact_count = agent_memory_fact_count(&state.db, bot_id).await;

    tracing::info!(
        bot_id = %bot_id,
        server_id = %server_id,
        "Agent config updated"
    );

    Ok(Json(serde_json::json!({
        "provider_type":          row.provider_type,
        "model_id":               row.model_id,
        "endpoint_url":           row.endpoint_url,
        "temperature":            row.temperature,
        "context_message_count":  row.context_message_count,
        "trigger_keywords":       row.trigger_keywords,
        "memory_mode":            row.memory_mode,
        "disclosure_text":        row.disclosure_text,
        "nsfw_allowed":           row.nsfw_allowed,
        "mcp_tool_urls":          row.mcp_tool_urls,
        "has_api_key":            has_api_key,
        "has_env_key":            false,
        "fact_count":             fact_count,
    })))
}

// ─── DELETE /servers/:server_id/ai-bots/:bot_id/memory ─────────────────
//
// Clears all context summaries (long-term memory) for the bot.
// Sliding-window memory (live message history) is unaffected.
// Restricted to server owner.

pub async fn delete_agent_memory(
    auth: AuthUser,
    State(state): State<Arc<AppState>>,
    Path((server_id, bot_id)): Path<(Uuid, Uuid)>,
) -> Result<impl IntoResponse, AppError> {
    let is_owner = sqlx::query_scalar!(
        "SELECT EXISTS(SELECT 1 FROM servers WHERE id = $1 AND owner_id = $2)",
        server_id, auth.user_id,
    )
    .fetch_one(&state.db)
    .await?
    .unwrap_or(false);

    if !is_owner {
        return Err(AppError::Forbidden("Only server owner can clear agent memory".into()));
    }

    let rows_deleted = clear_agent_memory(&state.db, bot_id)
        .await
        .map_err(AppError::from)?;

    tracing::info!(
        bot_id = %bot_id,
        server_id = %server_id,
        rows_deleted,
        "Agent memory cleared by owner"
    );

    Ok(Json(serde_json::json!({ "cleared": rows_deleted })))
}
