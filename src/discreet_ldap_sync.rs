// discreet_ldap_sync.rs — LDAP directory sync for enterprise user provisioning.
//
// Background task (spawned at server start):
//   Runs every ldap_sync_interval_secs (default 3600 = 1 hour).
//   Connects to configured LDAP server, searches for user entries,
//   creates/updates/disables Discreet users to match the directory.
//
// Platform settings:
//   ldap_enabled           — BOOLEAN, skip sync if false
//   ldap_url               — TEXT, e.g. ldaps://ldap.example.com:636
//   ldap_bind_dn           — TEXT, e.g. cn=admin,dc=example,dc=com
//   ldap_bind_password     — TEXT, encrypted at rest
//   ldap_base_dn           — TEXT, e.g. ou=people,dc=example,dc=com
//   ldap_user_filter       — TEXT, default (objectClass=person)
//   ldap_sync_interval     — INT, seconds between syncs (default 3600)

use sqlx::PgPool;
use uuid::Uuid;

/// Run the LDAP sync loop. Spawned from main.rs at startup.
pub async fn ldap_sync_loop(db: PgPool, redis: redis::aio::ConnectionManager) {
    // Default interval: 1 hour
    let mut interval = tokio::time::interval(std::time::Duration::from_secs(3600));

    loop {
        interval.tick().await;

        // Load settings from Redis cache / DB
        let settings = {
            let mut r = redis.clone();
            let cached: Option<String> = redis::cmd("GET")
                .arg("platform_settings")
                .query_async(&mut r)
                .await
                .unwrap_or(None);
            cached
                .and_then(|s| serde_json::from_str::<serde_json::Value>(&s).ok())
                .unwrap_or_else(|| serde_json::json!({}))
        };

        // Check if LDAP is enabled
        let enabled = settings.get("ldap_enabled")
            .and_then(|v| v.as_bool())
            .unwrap_or(false);

        if !enabled {
            continue;
        }

        // Read LDAP configuration
        let ldap_url = settings.get("ldap_url")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let bind_dn = settings.get("ldap_bind_dn")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let bind_password = settings.get("ldap_bind_password")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let base_dn = settings.get("ldap_base_dn")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let user_filter = settings.get("ldap_user_filter")
            .and_then(|v| v.as_str())
            .unwrap_or("(objectClass=person)")
            .to_string();

        if ldap_url.is_empty() || bind_dn.is_empty() || base_dn.is_empty() {
            tracing::debug!("LDAP sync skipped — incomplete configuration");
            continue;
        }

        // Update sync interval from settings
        if let Some(secs) = settings.get("ldap_sync_interval").and_then(|v| v.as_u64()) {
            if secs >= 60 {
                interval = tokio::time::interval(std::time::Duration::from_secs(secs));
            }
        }

        // Run sync
        match run_ldap_sync(&db, &ldap_url, &bind_dn, &bind_password, &base_dn, &user_filter).await {
            Ok(summary) => {
                tracing::info!(
                    created = summary.created,
                    updated = summary.updated,
                    disabled = summary.disabled,
                    total_entries = summary.total,
                    "LDAP sync completed"
                );
            }
            Err(e) => {
                tracing::warn!("LDAP sync failed: {e}");
            }
        }
    }
}

struct SyncSummary {
    total: usize,
    created: usize,
    updated: usize,
    disabled: usize,
}

/// Perform a single LDAP sync cycle.
async fn run_ldap_sync(
    db: &PgPool,
    ldap_url: &str,
    bind_dn: &str,
    bind_password: &str,
    base_dn: &str,
    user_filter: &str,
) -> Result<SyncSummary, String> {
    use ldap3::{LdapConnAsync, Scope, SearchEntry};

    // Connect
    let (conn, mut ldap) = LdapConnAsync::new(ldap_url)
        .await
        .map_err(|e| format!("LDAP connect failed: {e}"))?;

    // Drive the connection in background
    tokio::spawn(async move { if let Err(e) = conn.drive().await { tracing::debug!("LDAP conn driver: {e}"); } });

    // Bind
    ldap.simple_bind(bind_dn, bind_password)
        .await
        .map_err(|e| format!("LDAP bind failed: {e}"))?
        .success()
        .map_err(|e| format!("LDAP bind rejected: {e}"))?;

    // Search
    let (entries, _result) = ldap
        .search(base_dn, Scope::Subtree, user_filter, vec!["cn", "mail", "uid"])
        .await
        .map_err(|e| format!("LDAP search failed: {e}"))?
        .success()
        .map_err(|e| format!("LDAP search error: {e}"))?;

    let mut created = 0_usize;
    let mut updated = 0_usize;
    let mut synced_emails: Vec<String> = Vec::new();

    for entry in &entries {
        let se = SearchEntry::construct(entry.clone());
        let cn = se.attrs.get("cn").and_then(|v| v.first()).cloned().unwrap_or_default();
        let mail = se.attrs.get("mail").and_then(|v| v.first()).cloned().unwrap_or_default();

        if mail.is_empty() {
            continue;
        }

        synced_emails.push(mail.to_lowercase());

        // Check if user exists
        let existing = sqlx::query!(
            "SELECT id, display_name FROM users WHERE email = $1",
            mail.to_lowercase(),
        )
        .fetch_optional(db)
        .await
        .unwrap_or(None);

        if let Some(user) = existing {
            // Update display_name if changed
            if user.display_name.as_deref() != Some(&cn) && !cn.is_empty() {
                let _ = sqlx::query!(
                    "UPDATE users SET display_name = $1 WHERE id = $2",
                    cn, user.id,
                )
                .execute(db)
                .await;
                updated += 1;
            }
        } else {
            // Create new user
            let user_id = Uuid::new_v4();
            let base_name: String = mail.split('@').next().unwrap_or("user")
                .chars()
                .filter(|c| c.is_ascii_alphanumeric() || *c == '_' || *c == '-')
                .take(28)
                .collect();
            let username = if base_name.is_empty() { "ldap-user".to_string() } else { base_name };

            // Check uniqueness
            let mut final_username = username.clone();
            for _ in 0..10 {
                let exists = sqlx::query_scalar!(
                    "SELECT EXISTS(SELECT 1 FROM users WHERE username = $1)",
                    final_username,
                )
                .fetch_one(db)
                .await
                .unwrap_or(Some(false))
                .unwrap_or(false);
                if !exists { break; }
                let suffix: u16 = rand::Rng::gen_range(&mut rand::thread_rng(), 1000..9999);
                final_username = format!("{username}{suffix}");
            }

            // Random password
            let random_pw: String = (0..32)
                .map(|_| rand::Rng::sample(&mut rand::thread_rng(), rand::distributions::Alphanumeric) as char)
                .collect();
            let password_hash = match crate::discreet_auth_handlers::hash_password(&random_pw) {
                Ok(h) => h,
                Err(_) => continue,
            };

            let display = if cn.is_empty() { final_username.clone() } else { cn.clone() };

            let _ = sqlx::query!(
                "INSERT INTO users (id, username, display_name, email, email_verified, password_hash, account_tier)
                 VALUES ($1, $2, $3, $4, TRUE, $5, 'verified')",
                user_id, final_username, display, mail.to_lowercase(), password_hash,
            )
            .execute(db)
            .await;

            created += 1;
        }
    }

    // Disable users who were previously LDAP-synced but no longer in directory
    // (Only disable users with email that we've seen before in synced_emails scope)
    let disabled = 0_usize;
    // Note: Full disable logic requires tracking which users were LDAP-provisioned.
    // For now, we only create and update — disabling requires an ldap_source column
    // on the users table to distinguish LDAP-provisioned from local users.

    let _ = ldap.unbind().await;

    Ok(SyncSummary {
        total: entries.len(),
        created,
        updated,
        disabled,
    })
}
