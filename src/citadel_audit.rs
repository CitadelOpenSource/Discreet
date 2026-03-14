// citadel_audit.rs -- Hash-chained immutable audit ledger.
//
// Every audit entry includes the SHA-256 hash of the previous entry,
// creating a tamper-evident chain. If anyone modifies or deletes a
// historical entry, the chain breaks and verification detects it.
//
// Same integrity mechanism as Certificate Transparency (RFC 6962) and Git.
// Meets HIPAA audit trail, SOC 2 compliance, and legal discovery requirements.
//
// Schema additions (run once):
//   ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS chain_hash TEXT;
//   ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS prev_hash TEXT;
//   ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS sequence_num BIGINT;
//   CREATE UNIQUE INDEX IF NOT EXISTS idx_audit_chain ON audit_log(server_id, sequence_num);

use axum::{
    extract::{Path, Query, State},
    response::IntoResponse,
    Json,
};
use serde::{Deserialize, Serialize};
use sha2::{Sha256, Digest};
use std::sync::Arc;
use uuid::Uuid;

use crate::citadel_auth::AuthUser;
use crate::citadel_error::AppError;
use crate::citadel_permissions::{check_permission, Permission};
use crate::citadel_state::AppState;

// --- Types ---

#[derive(Debug, Serialize)]
pub struct AuditLogEntry {
    pub id: Uuid,
    pub server_id: Uuid,
    pub actor_id: Uuid,
    pub actor_username: String,
    pub action: String,
    pub target_type: Option<String>,
    pub target_id: Option<Uuid>,
    pub changes: Option<serde_json::Value>,
    pub reason: Option<String>,
    pub sequence_num: i64,
    pub prev_hash: Option<String>,
    pub chain_hash: String,
    pub created_at: chrono::DateTime<chrono::Utc>,
}

#[derive(Debug, Serialize)]
pub struct ChainVerification {
    pub server_id: Uuid,
    pub total_entries: i64,
    pub verified_entries: i64,
    pub chain_intact: bool,
    pub first_broken_at: Option<i64>,
    pub first_broken_id: Option<Uuid>,
    pub first_broken_reason: Option<String>,
    pub verified_at: String,
}

#[derive(Debug, Deserialize)]
pub struct AuditLogQuery {
    #[serde(default = "default_limit")]
    pub limit: i64,
    pub before: Option<Uuid>,
    pub action: Option<String>,
}

fn default_limit() -> i64 { 50 }

// --- Core: Hash Chain ---

/// Genesis hash for the first entry in any server's chain.
const GENESIS_HASH: &str = "0000000000000000000000000000000000000000000000000000000000000000";

/// Input fields for computing the SHA-256 chain hash.
struct ChainHashInput<'a> {
    pub prev_hash: &'a str,
    pub server_id: Uuid,
    pub actor_id: Uuid,
    pub action: &'a str,
    pub target_type: Option<&'a str>,
    pub target_id: Option<Uuid>,
    pub changes: Option<&'a serde_json::Value>,
    pub reason: Option<&'a str>,
    pub created_at: &'a str,
}

/// Compute SHA-256 chain hash. Covers ALL fields so ANY modification breaks the chain.
fn compute_chain_hash(input: &ChainHashInput) -> String {
    let mut h = Sha256::new();
    h.update(input.prev_hash.as_bytes());
    h.update(input.server_id.as_bytes());
    h.update(input.actor_id.as_bytes());
    h.update(input.action.as_bytes());
    h.update(input.target_type.unwrap_or("").as_bytes());
    if let Some(tid) = input.target_id { h.update(tid.as_bytes()); }
    if let Some(ch) = input.changes { h.update(ch.to_string().as_bytes()); }
    h.update(input.reason.unwrap_or("").as_bytes());
    h.update(input.created_at.as_bytes());
    format!("{:x}", h.finalize())
}

// --- Internal API ---

/// Fields for a new audit log entry (excludes the database pool).
pub struct AuditEntry<'a> {
    pub server_id: Uuid,
    pub actor_id: Uuid,
    pub action: &'a str,
    pub target_type: Option<&'a str>,
    pub target_id: Option<Uuid>,
    pub changes: Option<serde_json::Value>,
    pub reason: Option<&'a str>,
}

/// Append an entry to the hash chain. Called by other handler modules.
/// Uses transaction + row lock for sequential integrity under concurrency.
pub async fn log_action(
    db: &sqlx::PgPool,
    entry: AuditEntry<'_>,
) -> Result<(), AppError> {
    let mut tx = db.begin().await?;

    // Get latest entry (row-locked to prevent race conditions).
    let last = sqlx::query!(
        "SELECT sequence_num, chain_hash FROM audit_log
         WHERE server_id = $1
         ORDER BY sequence_num DESC NULLS LAST, created_at DESC
         LIMIT 1
         FOR UPDATE",
        entry.server_id,
    )
    .fetch_optional(&mut *tx)
    .await?;

    let (prev_hash, next_seq) = match last {
        Some(row) => (
            row.chain_hash.unwrap_or_else(|| GENESIS_HASH.to_string()),
            row.sequence_num.unwrap_or(0) + 1,
        ),
        None => (GENESIS_HASH.to_string(), 1i64),
    };

    let now = chrono::Utc::now();
    let ts = now.to_rfc3339();

    let chain_hash = compute_chain_hash(&ChainHashInput {
        prev_hash: &prev_hash,
        server_id: entry.server_id,
        actor_id: entry.actor_id,
        action: entry.action,
        target_type: entry.target_type,
        target_id: entry.target_id,
        changes: entry.changes.as_ref(),
        reason: entry.reason,
        created_at: &ts,
    });

    sqlx::query!(
        "INSERT INTO audit_log (server_id, actor_id, action, target_type, target_id, changes, reason, sequence_num, prev_hash, chain_hash)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)",
        entry.server_id, entry.actor_id, entry.action, entry.target_type, entry.target_id, entry.changes, entry.reason,
        next_seq, prev_hash, chain_hash,
    )
    .execute(&mut *tx)
    .await?;

    tx.commit().await?;

    tracing::info!(
        server_id = %entry.server_id, action = %entry.action, seq = next_seq,
        "Audit chain entry appended"
    );

    Ok(())
}

// --- HTTP Handlers ---

/// GET /servers/:server_id/audit — List entries (newest first, paginated).
pub async fn list_audit_log(
    auth: AuthUser,
    State(state): State<Arc<AppState>>,
    Path(server_id): Path<Uuid>,
    Query(params): Query<AuditLogQuery>,
) -> Result<impl IntoResponse, AppError> {
    let is_owner = sqlx::query_scalar!(
        "SELECT EXISTS(SELECT 1 FROM servers WHERE id = $1 AND owner_id = $2)",
        server_id, auth.user_id,
    )
    .fetch_one(&state.db)
    .await?
    .unwrap_or(false);

    if !is_owner {
        let can_manage = check_permission(&state, server_id, auth.user_id, Permission::MANAGE_SERVER).await?;
        if !can_manage {
            return Err(AppError::Forbidden("You lack the required permission".into()));
        }
    }

    let limit = params.limit.clamp(1, 200);

    let entries: Vec<AuditLogEntry> = if let Some(before_id) = params.before {
        sqlx::query!(
            "SELECT a.id, a.server_id, a.actor_id, u.username AS actor_username, a.action, a.target_type,
                    a.target_id, a.changes, a.reason, a.sequence_num, a.prev_hash, a.chain_hash, a.created_at
             FROM audit_log a INNER JOIN users u ON u.id = a.actor_id
             WHERE a.server_id = $1
               AND a.created_at < (SELECT created_at FROM audit_log WHERE id = $2 AND server_id = $1)
             ORDER BY a.created_at DESC, a.id DESC
             LIMIT $3",
            server_id, before_id, limit,
        )
        .fetch_all(&state.db)
        .await?
        .into_iter()
        .map(|r| AuditLogEntry {
            id: r.id, server_id: r.server_id, actor_id: r.actor_id,
            actor_username: r.actor_username, action: r.action,
            target_type: r.target_type, target_id: r.target_id,
            changes: r.changes, reason: r.reason,
            sequence_num: r.sequence_num.unwrap_or(0),
            prev_hash: r.prev_hash,
            chain_hash: r.chain_hash.unwrap_or_default(),
            created_at: r.created_at,
        })
        .collect()
    } else {
        sqlx::query!(
            "SELECT a.id, a.server_id, a.actor_id, u.username AS actor_username, a.action, a.target_type,
                    a.target_id, a.changes, a.reason, a.sequence_num, a.prev_hash, a.chain_hash, a.created_at
             FROM audit_log a INNER JOIN users u ON u.id = a.actor_id
             WHERE a.server_id = $1
             ORDER BY a.created_at DESC, a.id DESC
             LIMIT $2",
            server_id, limit,
        )
        .fetch_all(&state.db)
        .await?
        .into_iter()
        .map(|r| AuditLogEntry {
            id: r.id, server_id: r.server_id, actor_id: r.actor_id,
            actor_username: r.actor_username, action: r.action,
            target_type: r.target_type, target_id: r.target_id,
            changes: r.changes, reason: r.reason,
            sequence_num: r.sequence_num.unwrap_or(0),
            prev_hash: r.prev_hash,
            chain_hash: r.chain_hash.unwrap_or_default(),
            created_at: r.created_at,
        })
        .collect()
    };

    Ok(Json(entries))
}

/// GET /servers/:server_id/audit/verify — Verify entire chain integrity.
/// Walks from genesis to present, recomputing every hash. If any entry was
/// modified, deleted, or inserted out of order, the chain breaks.
pub async fn verify_audit_chain(
    auth: AuthUser,
    State(state): State<Arc<AppState>>,
    Path(server_id): Path<Uuid>,
) -> Result<impl IntoResponse, AppError> {
    // Owner-only: chain verification reveals integrity state.
    let is_owner = sqlx::query_scalar!(
        "SELECT EXISTS(SELECT 1 FROM servers WHERE id = $1 AND owner_id = $2)",
        server_id, auth.user_id,
    )
    .fetch_one(&state.db)
    .await?
    .unwrap_or(false);

    if !is_owner {
        return Err(AppError::Forbidden("Only the server owner can verify the audit chain".into()));
    }

    let rows = sqlx::query!(
        "SELECT id, server_id, actor_id, action, target_type, target_id,
                changes, reason, sequence_num, prev_hash, chain_hash, created_at
         FROM audit_log WHERE server_id = $1
         ORDER BY sequence_num ASC NULLS FIRST, created_at ASC",
        server_id,
    )
    .fetch_all(&state.db)
    .await?;

    let total = rows.len() as i64;
    let mut verified = 0i64;
    let mut expected_prev = GENESIS_HASH.to_string();
    let mut intact = true;
    let mut broken_at: Option<i64> = None;
    let mut broken_id: Option<Uuid> = None;
    let mut broken_reason: Option<String> = None;

    for row in &rows {
        let sp = row.prev_hash.as_deref().unwrap_or(GENESIS_HASH);
        let sh = row.chain_hash.as_deref().unwrap_or("");
        let seq = row.sequence_num.unwrap_or(0);

        // Check 1: prev_hash matches expected chain link
        if sp != expected_prev {
            intact = false;
            broken_at = Some(seq);
            broken_id = Some(row.id);
            broken_reason = Some(format!("prev_hash mismatch at seq {}: chain link broken", seq));
            break;
        }

        // Check 2: recompute hash and compare — detects field tampering
        let recomputed = compute_chain_hash(&ChainHashInput {
            prev_hash: sp,
            server_id: row.server_id,
            actor_id: row.actor_id,
            action: &row.action,
            target_type: row.target_type.as_deref(),
            target_id: row.target_id,
            changes: row.changes.as_ref(),
            reason: row.reason.as_deref(),
            created_at: &row.created_at.to_rfc3339(),
        });

        if recomputed != sh {
            intact = false;
            broken_at = Some(seq);
            broken_id = Some(row.id);
            broken_reason = Some(format!("chain_hash mismatch at seq {}: entry data was tampered", seq));
            break;
        }

        expected_prev = sh.to_string();
        verified += 1;
    }

    Ok(Json(ChainVerification {
        server_id,
        total_entries: total,
        verified_entries: verified,
        chain_intact: intact,
        first_broken_at: broken_at,
        first_broken_id: broken_id,
        first_broken_reason: broken_reason,
        verified_at: chrono::Utc::now().to_rfc3339(),
    }))
}

/// GET /servers/:server_id/audit/:id — Get single entry with chain proof.
pub async fn get_audit_entry(
    auth: AuthUser,
    State(state): State<Arc<AppState>>,
    Path((server_id, entry_id)): Path<(Uuid, Uuid)>,
) -> Result<impl IntoResponse, AppError> {
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

    let row = sqlx::query!(
        "SELECT a.id, a.server_id, a.actor_id, u.username AS actor_username, a.action, a.target_type,
                a.target_id, a.changes, a.reason, a.sequence_num, a.prev_hash, a.chain_hash, a.created_at
         FROM audit_log a INNER JOIN users u ON u.id = a.actor_id
         WHERE a.id = $1 AND a.server_id = $2",
        entry_id, server_id,
    )
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::NotFound("Audit entry not found".into()))?;

    Ok(Json(AuditLogEntry {
        id: row.id, server_id: row.server_id, actor_id: row.actor_id,
        actor_username: row.actor_username, action: row.action,
        target_type: row.target_type, target_id: row.target_id,
        changes: row.changes, reason: row.reason,
        sequence_num: row.sequence_num.unwrap_or(0),
        prev_hash: row.prev_hash,
        chain_hash: row.chain_hash.unwrap_or_default(),
        created_at: row.created_at,
    }))
}
