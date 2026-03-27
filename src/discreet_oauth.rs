// discreet_oauth.rs — OAuth 2.0 social login (Google, GitHub, Apple, Discord).
//
// Endpoints:
//   GET /api/v1/auth/oauth/providers              — List enabled OAuth providers.
//   GET /api/v1/auth/oauth/:provider/authorize    — Start OAuth flow (returns auth_url).
//   GET /api/v1/auth/oauth/:provider/callback     — Handle OAuth callback (code + state).
//   DELETE /api/v1/auth/oauth/:provider           — Unlink OAuth account.
//
// Security:
//   - PKCE (S256) on all flows — prevents authorization code interception.
//   - CSRF state token stored in Redis with 600s TTL.
//   - Client secrets encrypted at rest (never returned in API responses).
//   - Rate limited: 10 per IP per 10 minutes.

use std::sync::Arc;

use axum::{
    extract::{ConnectInfo, Path, Query, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use oauth2::{
    basic::BasicClient, AuthUrl, AuthorizationCode, ClientId, ClientSecret, CsrfToken,
    PkceCodeChallenge, PkceCodeVerifier, RedirectUrl, Scope, TokenResponse, TokenUrl,
};
use serde::{Deserialize, Serialize};
use serde_json::json;
use uuid::Uuid;

use crate::discreet_auth::AuthUser;
use crate::discreet_auth_handlers::{auth_response_with_cookie, create_session, AuthResponse, UserInfo};
use crate::discreet_error::AppError;
use crate::discreet_state::AppState;

// ─── Provider definitions ───────────────────────────────────────────────

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum OAuthProvider {
    Google,
    GitHub,
    Apple,
    Discord,
}

impl std::fmt::Display for OAuthProvider {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Google => write!(f, "google"),
            Self::GitHub => write!(f, "github"),
            Self::Apple => write!(f, "apple"),
            Self::Discord => write!(f, "discord"),
        }
    }
}

impl std::str::FromStr for OAuthProvider {
    type Err = AppError;
    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s.to_lowercase().as_str() {
            "google" => Ok(Self::Google),
            "github" => Ok(Self::GitHub),
            "apple" => Ok(Self::Apple),
            "discord" => Ok(Self::Discord),
            _ => Err(AppError::BadRequest(format!("Unknown OAuth provider: {s}"))),
        }
    }
}

/// Public info about an enabled provider (never includes secrets).
#[derive(Debug, Serialize)]
pub struct OAuthProviderInfo {
    pub provider: String,
    pub client_id: String,
    pub enabled: bool,
}

struct ProviderEndpoints {
    auth_url: &'static str,
    token_url: &'static str,
    scopes: &'static [&'static str],
}

fn endpoints(provider: OAuthProvider) -> ProviderEndpoints {
    match provider {
        OAuthProvider::Google => ProviderEndpoints {
            auth_url: "https://accounts.google.com/o/oauth2/v2/auth",
            token_url: "https://oauth2.googleapis.com/token",
            scopes: &["openid", "email", "profile"],
        },
        OAuthProvider::GitHub => ProviderEndpoints {
            auth_url: "https://github.com/login/oauth/authorize",
            token_url: "https://github.com/login/oauth/access_token",
            scopes: &["user:email"],
        },
        OAuthProvider::Apple => ProviderEndpoints {
            auth_url: "https://appleid.apple.com/auth/authorize",
            token_url: "https://appleid.apple.com/auth/token",
            scopes: &["name", "email"],
        },
        OAuthProvider::Discord => ProviderEndpoints {
            auth_url: "https://discord.com/oauth2/authorize",
            token_url: "https://discord.com/api/oauth2/token",
            scopes: &["identify", "email"],
        },
    }
}

// ─── Platform settings helpers ──────────────────────────────────────────

/// Read enabled OAuth providers from platform_settings.
/// Keys: oauth_{provider}_client_id, oauth_{provider}_enabled
pub async fn get_enabled_providers(
    db: &sqlx::PgPool,
) -> Result<Vec<OAuthProviderInfo>, AppError> {
    let rows = sqlx::query!(
        "SELECT key, value FROM platform_settings WHERE key LIKE 'oauth_%'"
    )
    .fetch_all(db)
    .await?;

    let providers = ["google", "github", "apple", "discord"];
    let mut result = Vec::new();

    for name in providers {
        let enabled_key = format!("oauth_{name}_enabled");
        let client_id_key = format!("oauth_{name}_client_id");

        let enabled = rows.iter()
            .find(|r| r.key == enabled_key)
            .and_then(|r| r.value.as_bool())
            .unwrap_or(false);

        let client_id = rows.iter()
            .find(|r| r.key == client_id_key)
            .and_then(|r| r.value.as_str().map(|s| s.to_string()))
            .unwrap_or_default();

        if enabled && !client_id.is_empty() {
            result.push(OAuthProviderInfo {
                provider: name.to_string(),
                client_id,
                enabled: true,
            });
        }
    }

    Ok(result)
}

/// Read client secret for a provider from platform_settings.
fn get_client_secret(
    rows: &[crate::discreet_platform_settings::PlatformSettingRow],
    provider: &str,
) -> Option<String> {
    let key = format!("oauth_{provider}_client_secret");
    rows.iter()
        .find(|r| r.key == key)
        .and_then(|r| r.value.as_str().map(|s| s.to_string()))
}

// ─── GET /auth/oauth/providers ──────────────────────────────────────────

/// List enabled OAuth providers (public endpoint, no auth required).
pub async fn list_providers(
    State(state): State<Arc<AppState>>,
) -> Result<impl IntoResponse, AppError> {
    let providers = get_enabled_providers(&state.db).await?;
    Ok(Json(json!({ "providers": providers })))
}

// ─── GET /auth/oauth/:provider/authorize ────────────────────────────────

/// Start the OAuth authorization flow.
/// Returns { auth_url, state } — the client redirects the user to auth_url.
pub async fn authorize(
    State(state): State<Arc<AppState>>,
    Path(provider_str): Path<String>,
    ConnectInfo(addr): ConnectInfo<std::net::SocketAddr>,
) -> Result<impl IntoResponse, AppError> {
    let provider: OAuthProvider = provider_str.parse()?;

    // Rate limit: 10 per IP per 10 minutes
    let ip = addr.ip().to_string();
    let rate_key = format!("oauth_auth:{ip}");
    let mut redis_conn = state.redis.clone();

    let count: i64 = crate::discreet_error::redis_or_503(
        redis::cmd("INCR")
            .arg(&rate_key)
            .query_async::<Option<i64>>(&mut redis_conn)
            .await,
    )?
    .unwrap_or(1);

    if count == 1 {
        let _: Result<bool, _> = redis::cmd("EXPIRE")
            .arg(&rate_key)
            .arg(600_i64)
            .query_async(&mut redis_conn)
            .await;
    }

    if count > 10 {
        return Err(AppError::RateLimited(
            "Too many OAuth requests. Try again in a few minutes.".into(),
        ));
    }

    // Load provider config from platform_settings
    let settings_rows = sqlx::query_as!(
        crate::discreet_platform_settings::PlatformSettingRow,
        "SELECT key, value FROM platform_settings WHERE key LIKE 'oauth_%'"
    )
    .fetch_all(&state.db)
    .await?;

    let provider_name = provider.to_string();
    let client_id_key = format!("oauth_{provider_name}_client_id");
    let enabled_key = format!("oauth_{provider_name}_enabled");

    let enabled = settings_rows.iter()
        .find(|r| r.key == enabled_key)
        .and_then(|r| r.value.as_bool())
        .unwrap_or(false);

    if !enabled {
        return Err(AppError::BadRequest(format!("{provider_name} OAuth is not enabled")));
    }

    let client_id = settings_rows.iter()
        .find(|r| r.key == client_id_key)
        .and_then(|r| r.value.as_str().map(|s| s.to_string()))
        .ok_or_else(|| AppError::BadRequest(format!("{provider_name} client_id not configured")))?;

    let client_secret = get_client_secret(&settings_rows, &provider_name)
        .ok_or_else(|| AppError::BadRequest(format!("{provider_name} client_secret not configured")))?;

    // Build OAuth2 client
    let ep = endpoints(provider);

    let base_url = std::env::var("APP_URL")
        .or_else(|_| std::env::var("PUBLIC_URL"))
        .unwrap_or_else(|_| "https://discreetai.net".to_string());

    let redirect_url = format!("{base_url}/auth/callback/{provider_name}");

    let oauth_client = BasicClient::new(ClientId::new(client_id))
        .set_client_secret(ClientSecret::new(client_secret))
        .set_auth_uri(AuthUrl::new(ep.auth_url.to_string())
            .map_err(|e| AppError::Internal(format!("Invalid auth URL: {e}")))?)
        .set_token_uri(TokenUrl::new(ep.token_url.to_string())
            .map_err(|e| AppError::Internal(format!("Invalid token URL: {e}")))?)
        .set_redirect_uri(RedirectUrl::new(redirect_url)
            .map_err(|e| AppError::Internal(format!("Invalid redirect URL: {e}")))?);

    // Generate PKCE challenge
    let (pkce_challenge, pkce_verifier) = PkceCodeChallenge::new_random_sha256();

    // Build authorization URL with scopes
    let mut auth_request = oauth_client
        .authorize_url(CsrfToken::new_random);

    for scope in ep.scopes {
        auth_request = auth_request.add_scope(Scope::new(scope.to_string()));
    }

    let (auth_url, csrf_state) = auth_request
        .set_pkce_challenge(pkce_challenge)
        .url();

    // Store PKCE verifier + provider in Redis keyed by state (600s TTL)
    let state_data = json!({
        "pkce_verifier": pkce_verifier.secret(),
        "provider": provider_name,
    });

    let state_key = format!("oauth_state:{}", csrf_state.secret());
    let set_result: Result<String, _> = redis::cmd("SET")
        .arg(&state_key)
        .arg(state_data.to_string())
        .arg("EX")
        .arg(600_i64)
        .query_async(&mut redis_conn)
        .await;
    if let Err(e) = set_result {
        tracing::debug!("OAuth state SET failed: {e}");
    }

    tracing::info!(
        provider = %provider_name,
        ip = %ip,
        "OAuth authorization URL generated"
    );

    Ok(Json(json!({
        "auth_url": auth_url.to_string(),
        "state": csrf_state.secret(),
    })))
}

// ─── GET /auth/oauth/:provider/callback ─────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct OAuthCallbackQuery {
    pub code: String,
    pub state: String,
}

/// OAuth provider user profile.
struct OAuthUserProfile {
    provider_user_id: String,
    email: Option<String>,
    display_name: Option<String>,
}

/// Handle OAuth callback — exchange code for token, fetch profile, login or register.
pub async fn oauth_callback(
    State(state): State<Arc<AppState>>,
    Path(provider_str): Path<String>,
    Query(params): Query<OAuthCallbackQuery>,
) -> Result<Response, AppError> {
    // Step 1: Lookup and validate state from Redis
    let state_key = format!("oauth_state:{}", params.state);
    let mut redis_conn = state.redis.clone();

    let stored: Option<String> = crate::discreet_error::redis_or_503(
        redis::cmd("GET")
            .arg(&state_key)
            .query_async(&mut redis_conn)
            .await,
    )?;

    let state_data = stored.ok_or_else(|| {
        AppError::BadRequest("Invalid or expired OAuth state. Please try again.".into())
    })?;

    // Delete immediately to prevent replay
    let _: Result<i64, _> = redis::cmd("DEL")
        .arg(&state_key)
        .query_async(&mut redis_conn)
        .await;

    let state_json: serde_json::Value = serde_json::from_str(&state_data)
        .map_err(|_| AppError::Internal("Corrupt OAuth state data".into()))?;

    let pkce_verifier_secret = state_json.get("pkce_verifier")
        .and_then(|v| v.as_str())
        .ok_or_else(|| AppError::Internal("Missing PKCE verifier in state".into()))?;

    let stored_provider = state_json.get("provider")
        .and_then(|v| v.as_str())
        .unwrap_or("");

    if stored_provider != provider_str {
        return Err(AppError::BadRequest("Provider mismatch in OAuth state".into()));
    }

    let provider: OAuthProvider = provider_str.parse()?;
    let provider_name = provider.to_string();

    // Load provider config
    let settings_rows = sqlx::query_as!(
        crate::discreet_platform_settings::PlatformSettingRow,
        "SELECT key, value FROM platform_settings WHERE key LIKE 'oauth_%'"
    )
    .fetch_all(&state.db)
    .await?;

    let client_id = settings_rows.iter()
        .find(|r| r.key == format!("oauth_{provider_name}_client_id"))
        .and_then(|r| r.value.as_str().map(|s| s.to_string()))
        .ok_or_else(|| AppError::Internal("OAuth client_id not found".into()))?;

    let client_secret = get_client_secret(&settings_rows, &provider_name)
        .ok_or_else(|| AppError::Internal("OAuth client_secret not found".into()))?;

    // Step 2: Exchange authorization code for access token
    let ep = endpoints(provider);
    let base_url = std::env::var("APP_URL")
        .or_else(|_| std::env::var("PUBLIC_URL"))
        .unwrap_or_else(|_| "https://discreetai.net".to_string());
    let redirect_url = format!("{base_url}/auth/callback/{provider_name}");

    let oauth_client = BasicClient::new(ClientId::new(client_id))
        .set_client_secret(ClientSecret::new(client_secret))
        .set_auth_uri(AuthUrl::new(ep.auth_url.to_string())
            .map_err(|e| AppError::Internal(format!("Invalid auth URL: {e}")))?)
        .set_token_uri(TokenUrl::new(ep.token_url.to_string())
            .map_err(|e| AppError::Internal(format!("Invalid token URL: {e}")))?)
        .set_redirect_uri(RedirectUrl::new(redirect_url)
            .map_err(|e| AppError::Internal(format!("Invalid redirect URL: {e}")))?);

    let http_client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|e| AppError::Internal(format!("HTTP client error: {e}")))?;

    let token_result = oauth_client
        .exchange_code(AuthorizationCode::new(params.code))
        .set_pkce_verifier(PkceCodeVerifier::new(pkce_verifier_secret.to_string()))
        .request_async(&http_client)
        .await
        .map_err(|e| AppError::Internal(format!("OAuth token exchange failed: {e}")))?;

    let access_token = token_result.access_token().secret().to_string();

    // Step 3: Fetch user profile from provider
    let profile = fetch_user_profile(provider, &access_token).await?;

    // Step 4: Login or register
    // Case A: Existing OAuth link
    let existing_oauth = sqlx::query!(
        "SELECT user_id FROM oauth_accounts WHERE provider = $1 AND provider_user_id = $2",
        provider_name,
        profile.provider_user_id,
    )
    .fetch_optional(&state.db)
    .await?;

    let user_id = if let Some(row) = existing_oauth {
        // Case A: Known OAuth account — login
        row.user_id
    } else if let Some(ref email) = profile.email {
        // Check if a user with this email exists
        let existing_user = sqlx::query!(
            "SELECT id FROM users WHERE email = $1",
            email,
        )
        .fetch_optional(&state.db)
        .await?;

        if let Some(user_row) = existing_user {
            // Case B: Email matches existing user — link and login
            sqlx::query!(
                "INSERT INTO oauth_accounts (user_id, provider, provider_user_id, provider_email) VALUES ($1, $2, $3, $4)",
                user_row.id, provider_name, profile.provider_user_id, profile.email,
            )
            .execute(&state.db)
            .await?;
            user_row.id
        } else {
            // Case C: New user — register
            create_oauth_user(&state, &provider_name, &profile).await?
        }
    } else {
        // No email from provider — create new user
        create_oauth_user(&state, &provider_name, &profile).await?
    };

    // Fetch user for auth response
    let user = sqlx::query!(
        "SELECT id, username, display_name, email, created_at FROM users WHERE id = $1",
        user_id,
    )
    .fetch_one(&state.db)
    .await?;

    // Create session
    let (access_token_jwt, refresh_token, _session_id) = create_session(
        &state, user_id, Some("OAuth login"),
    ).await?;

    // Audit log
    let _ = crate::discreet_audit::log_action(
        &state.db,
        crate::discreet_audit::AuditEntry {
            server_id: Uuid::nil(),
            actor_id: user_id,
            action: "OAUTH_LOGIN",
            target_type: Some("user"),
            target_id: Some(user_id),
            changes: Some(json!({ "provider": provider_name })),
            reason: None,
        },
    ).await;

    tracing::info!(user_id = %user_id, provider = %provider_name, "OAuth login successful");

    auth_response_with_cookie(
        AuthResponse {
            user: UserInfo {
                id: user.id,
                username: user.username,
                display_name: user.display_name,
                email: user.email,
                created_at: user.created_at.to_rfc3339(),
            },
            access_token: access_token_jwt,
            refresh_token: refresh_token.clone(),
            expires_in: state.config.jwt_expiry_secs,
            recovery_key: None,
            verification_pending: None,
        },
        &refresh_token,
        state.config.refresh_expiry_secs,
        StatusCode::OK,
    )
}

/// Fetch user profile from OAuth provider using the access token.
async fn fetch_user_profile(provider: OAuthProvider, token: &str) -> Result<OAuthUserProfile, AppError> {
    let client = reqwest::Client::new();

    match provider {
        OAuthProvider::Google => {
            let resp: serde_json::Value = client
                .get("https://www.googleapis.com/oauth2/v2/userinfo")
                .bearer_auth(token)
                .send().await
                .map_err(|e| AppError::Internal(format!("Google profile fetch failed: {e}")))?
                .json().await
                .map_err(|e| AppError::Internal(format!("Google profile parse failed: {e}")))?;

            Ok(OAuthUserProfile {
                provider_user_id: resp["id"].as_str().unwrap_or("").to_string(),
                email: resp["email"].as_str().map(|s| s.to_string()),
                display_name: resp["name"].as_str().map(|s| s.to_string()),
            })
        }
        OAuthProvider::GitHub => {
            let user_resp: serde_json::Value = client
                .get("https://api.github.com/user")
                .bearer_auth(token)
                .header("User-Agent", "DiscreetApp")
                .send().await
                .map_err(|e| AppError::Internal(format!("GitHub user fetch failed: {e}")))?
                .json().await
                .map_err(|e| AppError::Internal(format!("GitHub user parse failed: {e}")))?;

            let login = user_resp["login"].as_str().unwrap_or("").to_string();
            let gh_id = user_resp["id"].as_u64().map(|n| n.to_string()).unwrap_or_default();

            // Fetch verified primary email
            let emails: Vec<serde_json::Value> = client
                .get("https://api.github.com/user/emails")
                .bearer_auth(token)
                .header("User-Agent", "DiscreetApp")
                .send().await
                .map_err(|e| AppError::Internal(format!("GitHub emails fetch failed: {e}")))?
                .json().await
                .unwrap_or_default();

            let primary_email = emails.iter()
                .find(|e| e["primary"].as_bool() == Some(true) && e["verified"].as_bool() == Some(true))
                .and_then(|e| e["email"].as_str().map(|s| s.to_string()));

            Ok(OAuthUserProfile {
                provider_user_id: gh_id,
                email: primary_email,
                display_name: Some(login),
            })
        }
        OAuthProvider::Discord => {
            let resp: serde_json::Value = client
                .get("https://discord.com/api/users/@me")
                .bearer_auth(token)
                .send().await
                .map_err(|e| AppError::Internal(format!("Discord profile fetch failed: {e}")))?
                .json().await
                .map_err(|e| AppError::Internal(format!("Discord profile parse failed: {e}")))?;

            Ok(OAuthUserProfile {
                provider_user_id: resp["id"].as_str().unwrap_or("").to_string(),
                email: resp["email"].as_str().map(|s| s.to_string()),
                display_name: resp["username"].as_str().map(|s| s.to_string()),
            })
        }
        OAuthProvider::Apple => {
            // Apple returns user info in the ID token (JWT), not a profile endpoint.
            // For now, return the token subject as the provider_user_id.
            Err(AppError::BadRequest("Apple OAuth callback not yet implemented".into()))
        }
    }
}

/// Create a new Discreet user from OAuth profile.
async fn create_oauth_user(
    state: &AppState,
    provider_name: &str,
    profile: &OAuthUserProfile,
) -> Result<Uuid, AppError> {
    // Generate username from email prefix or display name
    let base_name = profile.email.as_deref()
        .and_then(|e| e.split('@').next())
        .or(profile.display_name.as_deref())
        .unwrap_or("user");

    // Sanitize: only alphanumeric, _, -
    let clean: String = base_name.chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == '_' || *c == '-')
        .take(28)
        .collect();
    let clean = if clean.is_empty() { "user".to_string() } else { clean };

    // Check if username is taken, append random digits if so
    let mut username = clean.clone();
    for _ in 0..10 {
        let exists = sqlx::query_scalar!(
            "SELECT EXISTS(SELECT 1 FROM users WHERE username = $1)",
            username,
        )
        .fetch_one(&state.db)
        .await?
        .unwrap_or(false);

        if !exists { break; }
        let suffix: u16 = rand::Rng::gen_range(&mut rand::thread_rng(), 1000..9999);
        username = format!("{clean}{suffix}");
    }

    // Generate random password hash (user will login via OAuth, not password)
    let random_pw: String = (0..32).map(|_| rand::Rng::sample(&mut rand::thread_rng(), rand::distributions::Alphanumeric) as char).collect();
    let password_hash = crate::discreet_auth_handlers::hash_password(&random_pw)?;

    let user_id = Uuid::new_v4();
    let display_name = profile.display_name.clone().unwrap_or_else(|| username.clone());

    sqlx::query!(
        "INSERT INTO users (id, username, display_name, email, email_verified, password_hash, account_tier)
         VALUES ($1, $2, $3, $4, TRUE, $5, 'verified')",
        user_id,
        username,
        display_name,
        profile.email,
        password_hash,
    )
    .execute(&state.db)
    .await?;

    // Link OAuth account
    sqlx::query!(
        "INSERT INTO oauth_accounts (user_id, provider, provider_user_id, provider_email) VALUES ($1, $2, $3, $4)",
        user_id, provider_name, profile.provider_user_id, profile.email,
    )
    .execute(&state.db)
    .await?;

    tracing::info!(user_id = %user_id, username = %username, provider = %provider_name, "New user created via OAuth");

    Ok(user_id)
}

// ─── DELETE /auth/oauth/:provider ───────────────────────────────────────

/// Unlink an OAuth provider from the authenticated user's account.
pub async fn unlink_provider(
    auth: AuthUser,
    State(state): State<Arc<AppState>>,
    Path(provider_str): Path<String>,
) -> Result<impl IntoResponse, AppError> {
    let provider: OAuthProvider = provider_str.parse()?;
    let provider_name = provider.to_string();

    let result = sqlx::query!(
        "DELETE FROM oauth_accounts WHERE user_id = $1 AND provider = $2",
        auth.user_id,
        provider_name,
    )
    .execute(&state.db)
    .await?;

    if result.rows_affected() == 0 {
        return Err(AppError::NotFound("No linked OAuth account found for this provider".into()));
    }

    tracing::info!(user_id = %auth.user_id, provider = %provider_name, "OAuth provider unlinked");

    Ok(StatusCode::NO_CONTENT)
}
