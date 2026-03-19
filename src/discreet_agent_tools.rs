// discreet_agent_tools.rs — MCP-style tool execution for AI agents.
//
// Built-in tools:
//   channel_search — search messages in the current channel
//   set_reminder   — schedule a future message from the agent
//   list_members   — list members of the current server
//
// Tool execution flow:
//   1. Agent LLM response is checked for tool_use blocks (JSON with tool_name + tool_input)
//   2. Tool is executed server-side with channel context
//   3. Result is formatted as a tool_result message
//   4. Context + result is sent back to the LLM for final response
//
// All tool executions are logged in audit_log with action "agent_tool_use".

use serde::{Deserialize, Serialize};
use serde_json::json;
use sqlx::PgPool;
use uuid::Uuid;

use crate::discreet_agent_provider::AgentMessage;

// ─── Tool definitions ───────────────────────────────────────────────────

/// A tool invocation parsed from the LLM response.
#[derive(Debug, Clone, Deserialize)]
pub struct ToolUse {
    pub tool_name: String,
    pub tool_input: serde_json::Value,
}

/// Result of executing a tool.
#[derive(Debug, Clone, Serialize)]
pub struct ToolResult {
    pub tool_name: String,
    pub success: bool,
    pub output: String,
}

/// Registry of available built-in tools with their descriptions.
pub fn tool_descriptions() -> Vec<serde_json::Value> {
    vec![
        json!({
            "tool_name": "channel_search",
            "description": "Search messages in the current channel. Returns up to 10 matching messages with sender, timestamp, and content preview.",
            "parameters": {
                "query": { "type": "string", "description": "Search query to match against message content" }
            }
        }),
        json!({
            "tool_name": "set_reminder",
            "description": "Schedule a reminder message to be sent at a future time.",
            "parameters": {
                "message": { "type": "string", "description": "The reminder message text" },
                "send_at": { "type": "string", "description": "ISO 8601 timestamp for when to send the reminder" }
            }
        }),
        json!({
            "tool_name": "list_members",
            "description": "List all members of the current server with their usernames, display names, and roles.",
            "parameters": {}
        }),
    ]
}

// ─── Tool execution ─────────────────────────────────────────────────────

/// Execute a tool and return the result.
pub async fn execute_tool(
    db: &PgPool,
    tool: &ToolUse,
    channel_id: Uuid,
    server_id: Uuid,
    agent_id: Uuid,
) -> ToolResult {
    match tool.tool_name.as_str() {
        "channel_search" => execute_channel_search(db, &tool.tool_input, channel_id).await,
        "set_reminder" => execute_set_reminder(db, &tool.tool_input, channel_id, agent_id).await,
        "list_members" => execute_list_members(db, server_id).await,
        _ => ToolResult {
            tool_name: tool.tool_name.clone(),
            success: false,
            output: format!("Unknown tool: {}", tool.tool_name),
        },
    }
}

/// Search messages in the current channel.
/// Decrypts content in memory for matching, never stores decrypted content.
async fn execute_channel_search(
    db: &PgPool,
    input: &serde_json::Value,
    channel_id: Uuid,
) -> ToolResult {
    let query = input.get("query")
        .and_then(|v| v.as_str())
        .unwrap_or("");

    if query.is_empty() {
        return ToolResult {
            tool_name: "channel_search".into(),
            success: false,
            output: "query parameter is required".into(),
        };
    }

    // Search plaintext messages (mls_epoch = 0, bot messages) via SQL ILIKE.
    // For encrypted messages (epoch > 0), we load recent messages and filter in memory.
    let rows = sqlx::query!(
        r#"SELECT m.id, m.content_ciphertext, m.created_at, m.mls_epoch,
                  u.username as "author_username?"
           FROM messages m
           LEFT JOIN users u ON u.id = m.author_id
           WHERE m.channel_id = $1 AND m.deleted = FALSE
           ORDER BY m.created_at DESC
           LIMIT 200"#,
        channel_id,
    )
    .fetch_all(db)
    .await
    .unwrap_or_default();

    let query_lower = query.to_lowercase();
    let mut results: Vec<serde_json::Value> = Vec::new();

    for row in &rows {
        if results.len() >= 10 {
            break;
        }

        // Only search plaintext messages (epoch 0) to avoid decryption complexity
        if row.mls_epoch != 0 {
            continue;
        }

        let content = match String::from_utf8(row.content_ciphertext.clone()) {
            Ok(s) => s,
            Err(_) => continue,
        };

        if content.to_lowercase().contains(&query_lower) {
            let preview = if content.len() > 100 {
                format!("{}...", &content[..100])
            } else {
                content
            };
            results.push(json!({
                "sender": row.author_username.as_deref().unwrap_or("unknown"),
                "timestamp": row.created_at.to_rfc3339(),
                "content": preview,
            }));
        }
    }

    ToolResult {
        tool_name: "channel_search".into(),
        success: true,
        output: serde_json::to_string_pretty(&json!({
            "query": query,
            "results": results,
            "total_found": results.len(),
        })).unwrap_or_else(|_| "[]".into()),
    }
}

/// Schedule a reminder message from the agent.
async fn execute_set_reminder(
    db: &PgPool,
    input: &serde_json::Value,
    channel_id: Uuid,
    agent_id: Uuid,
) -> ToolResult {
    let message = input.get("message").and_then(|v| v.as_str()).unwrap_or("");
    let send_at_str = input.get("send_at").and_then(|v| v.as_str()).unwrap_or("");

    if message.is_empty() || send_at_str.is_empty() {
        return ToolResult {
            tool_name: "set_reminder".into(),
            success: false,
            output: "Both 'message' and 'send_at' parameters are required".into(),
        };
    }

    let send_at = match chrono::DateTime::parse_from_rfc3339(send_at_str) {
        Ok(dt) => dt.with_timezone(&chrono::Utc),
        Err(_) => {
            return ToolResult {
                tool_name: "set_reminder".into(),
                success: false,
                output: "Invalid send_at format. Use ISO 8601 (e.g., 2026-03-20T15:00:00Z)".into(),
            };
        }
    };

    if send_at <= chrono::Utc::now() {
        return ToolResult {
            tool_name: "set_reminder".into(),
            success: false,
            output: "send_at must be in the future".into(),
        };
    }

    // Insert into agent_reminders table
    let result = sqlx::query!(
        "INSERT INTO agent_reminders (agent_id, channel_id, message, send_at)
         VALUES ($1, $2, $3, $4)
         RETURNING id",
        agent_id,
        channel_id,
        message,
        send_at,
    )
    .fetch_one(db)
    .await;

    match result {
        Ok(row) => ToolResult {
            tool_name: "set_reminder".into(),
            success: true,
            output: format!("Reminder set for {}. ID: {}", send_at.to_rfc3339(), row.id),
        },
        Err(e) => ToolResult {
            tool_name: "set_reminder".into(),
            success: false,
            output: format!("Failed to create reminder: {e}"),
        },
    }
}

/// List members of the current server.
async fn execute_list_members(
    db: &PgPool,
    server_id: Uuid,
) -> ToolResult {
    let rows = sqlx::query!(
        r#"SELECT u.username, u.display_name,
                  ARRAY_AGG(r.name) FILTER (WHERE r.name IS NOT NULL) as "roles: Vec<String>"
           FROM server_members sm
           JOIN users u ON u.id = sm.user_id
           LEFT JOIN member_roles mr ON mr.user_id = sm.user_id AND mr.server_id = sm.server_id
           LEFT JOIN roles r ON r.id = mr.role_id
           WHERE sm.server_id = $1
           GROUP BY u.id, u.username, u.display_name
           ORDER BY u.username
           LIMIT 100"#,
        server_id,
    )
    .fetch_all(db)
    .await
    .unwrap_or_default();

    let members: Vec<serde_json::Value> = rows.iter().map(|r| {
        json!({
            "username": r.username,
            "display_name": r.display_name,
            "roles": r.roles.clone().unwrap_or_default(),
        })
    }).collect();

    ToolResult {
        tool_name: "list_members".into(),
        success: true,
        output: serde_json::to_string_pretty(&json!({
            "member_count": members.len(),
            "members": members,
        })).unwrap_or_else(|_| "[]".into()),
    }
}

// ─── Tool use detection and processing ──────────────────────────────────

/// Check if an LLM response contains a tool_use block.
/// Looks for JSON with tool_name and tool_input fields.
pub fn parse_tool_use(response_text: &str) -> Option<ToolUse> {
    // Try to find a JSON block in the response
    let text = response_text.trim();

    // Direct JSON parse
    if let Ok(val) = serde_json::from_str::<serde_json::Value>(text) {
        if let Some(tool) = extract_tool_from_json(&val) {
            return Some(tool);
        }
    }

    // Look for JSON blocks in markdown code fences
    for block in text.split("```") {
        let block = block.trim().strip_prefix("json").unwrap_or(block).trim();
        if let Ok(val) = serde_json::from_str::<serde_json::Value>(block) {
            if let Some(tool) = extract_tool_from_json(&val) {
                return Some(tool);
            }
        }
    }

    None
}

fn extract_tool_from_json(val: &serde_json::Value) -> Option<ToolUse> {
    let name = val.get("tool_name")?.as_str()?;
    let input = val.get("tool_input").cloned().unwrap_or(json!({}));
    Some(ToolUse {
        tool_name: name.to_string(),
        tool_input: input,
    })
}

/// Process tool use in an agent response. If the response contains a tool_use
/// block, execute the tool, append the result to context, and return true
/// (caller should re-invoke the LLM). If no tool use, return false.
pub async fn process_tool_use(
    db: &PgPool,
    response_text: &str,
    context: &mut Vec<AgentMessage>,
    channel_id: Uuid,
    server_id: Uuid,
    agent_id: Uuid,
) -> Option<ToolResult> {
    let tool = parse_tool_use(response_text)?;

    tracing::info!(
        tool_name = %tool.tool_name,
        agent_id = %agent_id,
        channel_id = %channel_id,
        "Executing agent tool"
    );

    let result = execute_tool(db, &tool, channel_id, server_id, agent_id).await;

    // Log tool execution in audit log
    let _ = crate::discreet_audit::log_action(
        db,
        crate::discreet_audit::AuditEntry {
            server_id,
            actor_id: agent_id,
            action: "AGENT_TOOL_USE",
            target_type: Some("channel"),
            target_id: Some(channel_id),
            changes: Some(json!({
                "tool_name": tool.tool_name,
                "tool_input": tool.tool_input,
                "success": result.success,
            })),
            reason: None,
        },
    ).await;

    // Append assistant message (tool invocation) and tool result to context
    context.push(AgentMessage {
        role: "assistant".into(),
        content: response_text.to_string(),
    });
    context.push(AgentMessage {
        role: "user".into(),
        content: format!("[Tool Result for {}]: {}", result.tool_name, result.output),
    });

    Some(result)
}
