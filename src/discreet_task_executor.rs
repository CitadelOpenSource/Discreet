// discreet_task_executor.rs — Background heartbeat that executes scheduled tasks.
//
// Runs every 60 seconds, queries enabled tasks due for execution,
// dispatches each by task_type, and updates last_run / next_run.
//
// Channel monitor sub-types (config.monitor_type):
//   - action_items:    scan recent messages for TODO/action phrases, post summary
//   - thread_summary:  summarize threads with 20+ messages
//   - inactive_alert:  notify admin after X days of channel silence

use sqlx::PgPool;
use std::sync::Arc;
use uuid::Uuid;

use crate::discreet_state::AppState;

/// Trigger phrases that indicate an action item.
const ACTION_PHRASES: &[&str] = &[
    "todo",
    "to do",
    "action item",
    "follow up",
    "follow-up",
    "please do",
    "need to",
    "needs to",
    "should do",
    "must do",
    "assigned to",
    "deadline",
    "by eod",
    "by end of day",
    "asap",
    "urgent",
    "reminder:",
    "task:",
    "[ ]",
    "[]",
];

/// The main executor loop — spawn this from main.rs.
pub async fn task_executor_loop(db: PgPool, state: Arc<AppState>) {
    let mut interval = tokio::time::interval(std::time::Duration::from_secs(60));
    loop {
        interval.tick().await;

        // Atomically claim tasks that are due (or have never run).
        // next_run IS NULL catches newly created tasks.
        let due_tasks = match sqlx::query!(
            r#"UPDATE scheduled_tasks
               SET last_run = NOW()
               WHERE id IN (
                   SELECT id FROM scheduled_tasks
                   WHERE enabled = TRUE
                     AND (next_run IS NULL OR next_run <= NOW())
                   LIMIT 50
               )
               RETURNING id, server_id, channel_id, created_by, task_type,
                         config, cron_expr"#,
        )
        .fetch_all(&db)
        .await
        {
            Ok(rows) => rows,
            Err(e) => {
                tracing::warn!("Task executor query error: {}", e);
                continue;
            }
        };

        if due_tasks.is_empty() {
            continue;
        }

        tracing::info!("Executing {} scheduled tasks", due_tasks.len());

        for task in &due_tasks {
            let result = match task.task_type.as_str() {
                "channel_monitor" => {
                    execute_channel_monitor(
                        &db,
                        &state,
                        task.server_id,
                        task.channel_id,
                        task.created_by,
                        &task.config,
                    )
                    .await
                }
                "announcement" => {
                    execute_announcement(
                        &db,
                        &state,
                        task.server_id,
                        task.channel_id,
                        &task.config,
                    )
                    .await
                }
                _ => {
                    tracing::debug!(task_type = %task.task_type, "Unhandled task type — skipping");
                    Ok(())
                }
            };

            if let Err(e) = result {
                tracing::warn!(
                    task_id = %task.id,
                    task_type = %task.task_type,
                    error = %e,
                    "Task execution failed"
                );
            }

            // Advance next_run. Simple approach: add the cron interval.
            // For production, a proper cron parser would compute the exact next time.
            // Here we use a heuristic: re-run after 60 minutes (tasks are also gated
            // by the cron check in future iterations).
            let next = chrono::Utc::now() + chrono::Duration::minutes(60);
            let _ = sqlx::query!(
                "UPDATE scheduled_tasks SET next_run = $1 WHERE id = $2",
                next,
                task.id,
            )
            .execute(&db)
            .await;
        }

        // ── Urgent message reminder check ────────────────────────────────
        // Re-notify unacked users every 5 min for urgent messages up to 30 min old.
        if let Ok(urgent_msgs) = sqlx::query!(
            r#"SELECT m.id, m.channel_id, m.author_id, c.server_id
               FROM messages m
               JOIN channels c ON c.id = m.channel_id
               WHERE m.priority = 'urgent'
                 AND m.created_at > NOW() - INTERVAL '30 minutes'
                 AND m.created_at < NOW() - INTERVAL '5 minutes'"#,
        )
        .fetch_all(&db)
        .await
        {
            for msg in &urgent_msgs {
                // Get members who haven't acked
                let unacked: Vec<Uuid> = sqlx::query_scalar!(
                    "SELECT sm.user_id FROM server_members sm
                     WHERE sm.server_id = $1
                       AND sm.user_id != $2
                       AND sm.user_id NOT IN (
                           SELECT user_id FROM message_acknowledgements WHERE message_id = $3
                       )",
                    msg.server_id,
                    msg.author_id,
                    msg.id,
                )
                .fetch_all(&db)
                .await
                .unwrap_or_default();

                if unacked.is_empty() {
                    continue;
                }

                // Broadcast a reminder to the server
                state.ws_broadcast(msg.server_id, serde_json::json!({
                    "type": "urgent_reminder",
                    "message_id": msg.id,
                    "channel_id": msg.channel_id,
                    "unacked_count": unacked.len(),
                    "target_user_ids": unacked,
                })).await;
            }
        }
    }
}

// ─── Channel Monitor ────────────────────────────────────────────────────

async fn execute_channel_monitor(
    db: &PgPool,
    state: &Arc<AppState>,
    server_id: Uuid,
    channel_id: Option<Uuid>,
    created_by: Uuid,
    config: &serde_json::Value,
) -> Result<(), String> {
    let channel_id = channel_id.ok_or("channel_monitor requires a channel_id")?;
    let monitor_type = config
        .get("monitor_type")
        .and_then(|v| v.as_str())
        .unwrap_or("action_items");

    match monitor_type {
        "action_items" => {
            execute_action_items(db, state, server_id, channel_id).await
        }
        "thread_summary" => {
            execute_thread_summary(db, state, server_id, channel_id, config).await
        }
        "inactive_alert" => {
            execute_inactive_alert(db, state, server_id, channel_id, created_by, config).await
        }
        other => {
            tracing::debug!(monitor_type = %other, "Unknown channel monitor type");
            Ok(())
        }
    }
}

/// Scan last 10 messages for action phrases. If any found, post a summary.
async fn execute_action_items(
    db: &PgPool,
    state: &Arc<AppState>,
    server_id: Uuid,
    channel_id: Uuid,
) -> Result<(), String> {
    // Fetch last 10 messages
    let messages = sqlx::query!(
        "SELECT id, author_id, content_ciphertext, created_at
         FROM messages
         WHERE channel_id = $1
         ORDER BY created_at DESC
         LIMIT 10",
        channel_id,
    )
    .fetch_all(db)
    .await
    .map_err(|e| format!("DB error: {e}"))?;

    if messages.is_empty() {
        return Ok(());
    }

    // Extract action items
    let mut items: Vec<String> = Vec::new();
    for msg in &messages {
        // Bot messages store plaintext in content_ciphertext bytes
        let text = String::from_utf8_lossy(&msg.content_ciphertext).to_string();
        let lower = text.to_lowercase();

        for phrase in ACTION_PHRASES {
            if lower.contains(phrase) {
                // Truncate long messages
                let preview = if text.len() > 120 {
                    format!("{}...", &text[..120])
                } else {
                    text.clone()
                };
                items.push(preview);
                break; // one match per message
            }
        }
    }

    if items.is_empty() {
        return Ok(());
    }

    // Build summary message
    let mut summary = String::from("📋 **Action Items Detected**\n\n");
    for (i, item) in items.iter().enumerate() {
        summary.push_str(&format!("{}. {}\n", i + 1, item));
    }
    summary.push_str(&format!("\n_Found {} action item(s) in last 10 messages._", items.len()));

    // Post the summary as a system-style message
    post_task_message(db, state, server_id, channel_id, &summary).await
}

/// Summarize threads with 20+ messages by posting a notification.
async fn execute_thread_summary(
    db: &PgPool,
    state: &Arc<AppState>,
    server_id: Uuid,
    channel_id: Uuid,
    config: &serde_json::Value,
) -> Result<(), String> {
    let threshold = config
        .get("min_messages")
        .and_then(|v| v.as_i64())
        .unwrap_or(20);

    // Find threads (messages with replies) exceeding the threshold
    let threads = sqlx::query!(
        "SELECT parent_message_id, COUNT(*) as reply_count
         FROM messages
         WHERE channel_id = $1
           AND parent_message_id IS NOT NULL
         GROUP BY parent_message_id
         HAVING COUNT(*) >= $2
         ORDER BY COUNT(*) DESC
         LIMIT 5",
        channel_id,
        threshold,
    )
    .fetch_all(db)
    .await
    .map_err(|e| format!("DB error: {e}"))?;

    if threads.is_empty() {
        return Ok(());
    }

    let mut summary = String::from("🧵 **Active Threads Summary**\n\n");
    for t in &threads {
        if let Some(pid) = t.parent_message_id {
            let count = t.reply_count.unwrap_or(0);
            summary.push_str(&format!("• Thread `{}` — {} replies\n", &pid.to_string()[..8], count));
        }
    }
    summary.push_str(&format!("\n_{} active thread(s) with {}+ messages._", threads.len(), threshold));

    post_task_message(db, state, server_id, channel_id, &summary).await
}

/// Alert admin if channel has been silent for X days.
async fn execute_inactive_alert(
    db: &PgPool,
    state: &Arc<AppState>,
    server_id: Uuid,
    channel_id: Uuid,
    created_by: Uuid,
    config: &serde_json::Value,
) -> Result<(), String> {
    let days = config
        .get("inactive_days")
        .and_then(|v| v.as_i64())
        .unwrap_or(7);

    let threshold = chrono::Utc::now() - chrono::Duration::days(days);

    // Check if any message exists after the threshold
    let has_recent = sqlx::query_scalar!(
        r#"SELECT EXISTS(
            SELECT 1 FROM messages
            WHERE channel_id = $1 AND created_at > $2
        ) as "exists!""#,
        channel_id,
        threshold,
    )
    .fetch_one(db)
    .await
    .map_err(|e| format!("DB error: {e}"))?;

    if has_recent {
        return Ok(()); // Channel is active — no alert needed
    }

    // Get channel name for the alert message
    let channel_name = sqlx::query_scalar!(
        "SELECT name FROM channels WHERE id = $1",
        channel_id,
    )
    .fetch_optional(db)
    .await
    .map_err(|e| format!("DB error: {e}"))?
    .unwrap_or_else(|| "unknown".to_string());

    let alert = format!(
        "⚠️ **Inactive Channel Alert**\n\n\
         #{channel_name} has had no activity for {days}+ days.\n\
         Consider archiving it or posting an update."
    );

    // Send as a notification to the task creator
    let _ = crate::discreet_notification_handlers::create_notification(
        db,
        state,
        crate::discreet_notification_handlers::CreateNotification {
            user_id: created_by,
            notification_type: "channel_inactive".to_string(),
            title: format!("#{channel_name} is inactive"),
            body: Some(format!("No messages for {days}+ days")),
            action_url: None,
            server_id: Some(server_id),
        },
    )
    .await;

    // Also post in channel if configured to do so
    if config.get("post_in_channel").and_then(|v| v.as_bool()).unwrap_or(false) {
        post_task_message(db, state, server_id, channel_id, &alert).await?;
    }

    Ok(())
}

// ─── Announcement task ──────────────────────────────────────────────────

async fn execute_announcement(
    db: &PgPool,
    state: &Arc<AppState>,
    server_id: Uuid,
    channel_id: Option<Uuid>,
    config: &serde_json::Value,
) -> Result<(), String> {
    let channel_id = channel_id.ok_or("announcement requires a channel_id")?;
    let message = config
        .get("message")
        .and_then(|v| v.as_str())
        .unwrap_or("📢 Scheduled announcement");

    post_task_message(db, state, server_id, channel_id, message).await
}

// ─── Shared helper: post a message from the system ──────────────────────

/// Insert a system message into a channel and broadcast via WebSocket.
/// Uses a zero UUID as the author to indicate system/automated origin.
async fn post_task_message(
    db: &PgPool,
    state: &Arc<AppState>,
    server_id: Uuid,
    channel_id: Uuid,
    text: &str,
) -> Result<(), String> {
    let message_id = Uuid::new_v4();
    let content_bytes = text.as_bytes().to_vec();
    // System bot user ID (zeroed UUID signals automated message)
    let system_author = Uuid::nil();

    sqlx::query!(
        "INSERT INTO messages (id, channel_id, author_id, content_ciphertext, mls_epoch)
         VALUES ($1, $2, $3, $4, $5)",
        message_id,
        channel_id,
        system_author,
        &content_bytes,
        0_i64,
    )
    .execute(db)
    .await
    .map_err(|e| format!("Failed to insert task message: {e}"))?;

    state
        .ws_broadcast(
            server_id,
            serde_json::json!({
                "type":       "message_create",
                "channel_id": channel_id,
                "message_id": message_id,
                "author_id":  system_author,
                "content":    text,
                "is_system":  true,
            }),
        )
        .await;

    Ok(())
}
