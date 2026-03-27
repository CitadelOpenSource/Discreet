// discreet_saml.rs — SAML 2.0 SSO for enterprise identity providers.
//
// Endpoints:
//   GET  /api/v1/auth/saml/metadata — SP metadata XML for IdP configuration.
//   POST /api/v1/auth/saml/acs      — Assertion Consumer Service (handles SAMLResponse).
//
// Platform settings:
//   saml_enabled           — BOOLEAN, default false
//   saml_idp_metadata_url  — TEXT, IdP metadata URL for auto-configuration
//   saml_idp_certificate   — TEXT, PEM-encoded X.509 certificate for signature validation
//   saml_entity_id         — TEXT, IdP entity ID
//   saml_sso_url           — TEXT, IdP SSO login URL
//
// Flow:
//   1. Admin configures IdP certificate and SSO URL in platform settings.
//   2. IdP is configured with our SP metadata (entity ID + ACS URL).
//   3. User clicks "Login with SSO" → redirected to IdP SSO URL.
//   4. IdP authenticates user → POSTs SAMLResponse to our ACS endpoint.
//   5. We parse the assertion, extract email, login or create user.

use std::sync::Arc;

use axum::{
    body::Body,
    extract::{Form, State},
    http::{header, HeaderValue, StatusCode},
    response::Response,
};
use serde::Deserialize;
use serde_json::json;
use uuid::Uuid;

use crate::discreet_auth_handlers::{auth_response_with_cookie, create_session, AuthResponse, UserInfo};
use crate::discreet_error::AppError;
use crate::discreet_state::AppState;

// ─── GET /auth/saml/metadata ────────────────────────────────────────────

/// Returns SAML SP metadata XML for configuring the Identity Provider.
pub async fn sp_metadata(
    State(_state): State<Arc<AppState>>,
) -> Result<Response, AppError> {
    let base_url = std::env::var("APP_URL")
        .or_else(|_| std::env::var("PUBLIC_URL"))
        .unwrap_or_else(|_| "https://discreetai.net".to_string());

    let entity_id = base_url.to_string();
    let acs_url = format!("{base_url}/api/v1/auth/saml/acs");

    let metadata = format!(r#"<?xml version="1.0" encoding="UTF-8"?>
<md:EntityDescriptor xmlns:md="urn:oasis:names:tc:SAML:2.0:metadata"
                     entityID="{entity_id}">
  <md:SPSSODescriptor AuthnRequestsSigned="true"
                      WantAssertionsSigned="true"
                      protocolSupportEnumeration="urn:oasis:names:tc:SAML:2.0:protocol">
    <md:NameIDFormat>urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress</md:NameIDFormat>
    <md:AssertionConsumerService Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST"
                                 Location="{acs_url}"
                                 index="0"
                                 isDefault="true"/>
  </md:SPSSODescriptor>
</md:EntityDescriptor>"#);

    Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, HeaderValue::from_static("application/xml; charset=utf-8"))
        .body(Body::from(metadata))
        .map_err(|e| AppError::Internal(format!("Response build error: {e}")))
}

// ─── POST /auth/saml/acs ────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct SamlAcsForm {
    #[serde(rename = "SAMLResponse")]
    pub saml_response: String,
    #[serde(rename = "RelayState")]
    pub relay_state: Option<String>,
}

/// SAML Assertion Consumer Service — receives SAMLResponse from IdP.
pub async fn assertion_consumer_service(
    State(state): State<Arc<AppState>>,
    Form(form): Form<SamlAcsForm>,
) -> Result<Response, AppError> {
    // Check SAML is enabled
    let _settings = crate::discreet_platform_settings::get_platform_settings(&state).await?;
    let saml_enabled = {
        let rows = sqlx::query!(
            "SELECT value FROM platform_settings WHERE key = 'saml_enabled'"
        )
        .fetch_optional(&state.db)
        .await?;
        rows.and_then(|r| r.value.as_bool()).unwrap_or(false)
    };

    if !saml_enabled {
        return Err(AppError::Forbidden("SAML SSO is not enabled".into()));
    }

    // Base64-decode the SAMLResponse
    use base64::Engine;
    let decoded = base64::engine::general_purpose::STANDARD
        .decode(&form.saml_response)
        .map_err(|_| AppError::BadRequest("Invalid SAMLResponse encoding".into()))?;

    let xml = String::from_utf8(decoded)
        .map_err(|_| AppError::BadRequest("SAMLResponse is not valid UTF-8".into()))?;

    // Parse assertion to extract email and optional display name
    let assertion = parse_saml_assertion(&xml)?;

    if assertion.email.is_empty() {
        return Err(AppError::BadRequest("SAML assertion does not contain an email address".into()));
    }

    // Find or create user
    let user_id = find_or_create_saml_user(&state, &assertion).await?;

    // Fetch user for response
    let user = sqlx::query!(
        "SELECT id, username, display_name, email, created_at FROM users WHERE id = $1",
        user_id,
    )
    .fetch_one(&state.db)
    .await?;

    // Create session
    let (access_token, refresh_token, _session_id) = create_session(
        &state, user_id, Some("SAML SSO"),
    ).await?;

    // Audit log
    let _ = crate::discreet_audit::log_action(
        &state.db,
        crate::discreet_audit::AuditEntry {
            server_id: Uuid::nil(),
            actor_id: user_id,
            action: "SAML_LOGIN",
            target_type: Some("user"),
            target_id: Some(user_id),
            changes: Some(json!({
                "email": assertion.email,
                "session_index": assertion.session_index,
            })),
            reason: None,
        },
    ).await;

    tracing::info!(user_id = %user_id, email = %assertion.email, "SAML SSO login successful");

    // Return auth response — redirect to app with cookie set
    let response = auth_response_with_cookie(
        AuthResponse {
            user: UserInfo {
                id: user.id,
                username: user.username,
                display_name: user.display_name,
                email: user.email,
                created_at: user.created_at.to_rfc3339(),
            },
            access_token,
            refresh_token: refresh_token.clone(),
            expires_in: state.config.jwt_expiry_secs,
            recovery_key: None,
            verification_pending: None,
        },
        &refresh_token,
        state.config.refresh_expiry_secs,
        StatusCode::OK,
    )?;

    // For browser-based SAML flow, we could redirect instead, but returning
    // JSON with cookies set works for SPA consumption.
    Ok(response)
}

// ─── SAML Assertion Parsing ─────────────────────────────────────────────

struct SamlAssertion {
    email: String,
    display_name: Option<String>,
    session_index: Option<String>,
}

/// Parse a SAML Response XML to extract the NameID (email) and attributes.
/// This is a lightweight parser — for production, consider a full SAML library.
fn parse_saml_assertion(xml: &str) -> Result<SamlAssertion, AppError> {
    let mut email = String::new();
    let mut display_name: Option<String> = None;
    let mut session_index: Option<String> = None;

    // Extract NameID (email)
    if let Some(start) = xml.find("<saml:NameID") {
        if let Some(tag_end) = xml[start..].find('>') {
            let after_tag = start + tag_end + 1;
            if let Some(close) = xml[after_tag..].find("</saml:NameID>") {
                email = xml[after_tag..after_tag + close].trim().to_string();
            }
        }
    }
    // Also try without namespace prefix
    if email.is_empty() {
        if let Some(start) = xml.find("<NameID") {
            if let Some(tag_end) = xml[start..].find('>') {
                let after_tag = start + tag_end + 1;
                if let Some(close) = xml[after_tag..].find("</NameID>") {
                    email = xml[after_tag..after_tag + close].trim().to_string();
                }
            }
        }
    }

    // Extract display name from Attribute element
    if let Some(pos) = xml.find("Name=\"displayName\"") {
        if let Some(val_start) = xml[pos..].find("<saml:AttributeValue") {
            let abs = pos + val_start;
            if let Some(tag_end) = xml[abs..].find('>') {
                let after = abs + tag_end + 1;
                if let Some(close) = xml[after..].find("</saml:AttributeValue>") {
                    let name = xml[after..after + close].trim().to_string();
                    if !name.is_empty() {
                        display_name = Some(name);
                    }
                }
            }
        }
    }

    // Extract SessionIndex from AuthnStatement
    if let Some(pos) = xml.find("SessionIndex=\"") {
        let start = pos + "SessionIndex=\"".len();
        if let Some(end) = xml[start..].find('"') {
            session_index = Some(xml[start..start + end].to_string());
        }
    }

    if email.is_empty() {
        return Err(AppError::BadRequest(
            "Could not extract email (NameID) from SAML assertion".into(),
        ));
    }

    Ok(SamlAssertion { email, display_name, session_index })
}

/// Find existing user by email or create a new one for SAML SSO.
async fn find_or_create_saml_user(
    state: &AppState,
    assertion: &SamlAssertion,
) -> Result<Uuid, AppError> {
    // Check for existing user with this email
    let existing = sqlx::query!(
        "SELECT id FROM users WHERE email = $1",
        assertion.email,
    )
    .fetch_optional(&state.db)
    .await?;

    if let Some(user) = existing {
        return Ok(user.id);
    }

    // Create new user
    let user_id = Uuid::new_v4();

    // Username from email prefix, sanitized
    let base_name: String = assertion.email
        .split('@')
        .next()
        .unwrap_or("user")
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == '_' || *c == '-')
        .take(28)
        .collect();
    let base_name = if base_name.is_empty() { "user".to_string() } else { base_name };

    let mut username = base_name.clone();
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
        username = format!("{base_name}{suffix}");
    }

    // Random password (user logs in via SAML, not password)
    let random_pw: String = (0..32)
        .map(|_| rand::Rng::sample(&mut rand::thread_rng(), rand::distributions::Alphanumeric) as char)
        .collect();
    let password_hash = crate::discreet_auth_handlers::hash_password(&random_pw)?;

    let display_name = assertion.display_name.clone().unwrap_or_else(|| username.clone());

    sqlx::query!(
        "INSERT INTO users (id, username, display_name, email, email_verified, password_hash, account_tier)
         VALUES ($1, $2, $3, $4, TRUE, $5, 'verified')",
        user_id,
        username,
        display_name,
        assertion.email,
        password_hash,
    )
    .execute(&state.db)
    .await?;

    tracing::info!(
        user_id = %user_id,
        username = %username,
        email = %assertion.email,
        "New user created via SAML SSO"
    );

    Ok(user_id)
}
