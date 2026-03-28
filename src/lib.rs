// Discreet — Copyright (C) 2026 Citadel Open Source LLC. AGPL-3.0-or-later.

// lib.rs — Discreet server library root.
//
// Each module is a self-contained file with a unique name.
// No ambiguous mod.rs files. Every file is identifiable at a glance.

pub mod discreet_ack_handlers;
pub mod discreet_admin_invite_handlers;
pub mod discreet_announcement_handlers;
pub mod discreet_agent_config;
pub mod discreet_agent_config_handlers;
pub mod discreet_agent_episodic_memory;
pub mod discreet_agent_handlers;
pub mod discreet_agent_memory;
pub mod discreet_agent_provider;
pub mod discreet_agent_tools;
pub mod discreet_agent_types;
pub mod discreet_audit;
pub mod discreet_audit_export;
pub mod discreet_auth;
pub mod discreet_auth_handlers;
pub mod discreet_automod;
pub mod discreet_ban_handlers;
pub mod discreet_billing_handlers;
pub mod discreet_bookmark_handlers;
pub mod discreet_bot_spawn_handlers;
pub mod discreet_bug_report_handlers;
pub mod discreet_category_handlers;
pub mod discreet_channel_category_handlers;
pub mod discreet_channel_handlers;
pub mod discreet_circuit_breaker;
pub mod discreet_config;
pub mod discreet_csrf;
pub mod discreet_dev_token_handlers;
pub mod discreet_disappearing_handlers;
pub mod discreet_discovery_handlers;
pub mod discreet_dm_handlers;
pub mod discreet_email_handlers;
pub mod discreet_emoji_handlers;
pub mod discreet_export_handlers;
pub mod discreet_error;
pub mod discreet_error_telemetry;
pub mod discreet_event_handlers;
// Federation — placeholder for future AT Protocol / Matrix bridge
// pub mod discreet_federation;
pub mod discreet_file_handlers;
pub mod discreet_forum_handlers;
pub mod discreet_friend_handlers;
pub mod discreet_group_dm_handlers;
pub mod discreet_health;
pub mod discreet_import_handlers;
pub mod discreet_input_validation;
pub mod discreet_ldap_sync;
pub mod discreet_link_preview;
pub mod discreet_meeting_handlers;
pub mod discreet_message_handlers;
pub mod discreet_metrics;
pub mod discreet_mls_handlers;
pub mod discreet_notification_handlers;
pub mod discreet_oauth;
pub mod discreet_passkey;
pub mod discreet_permissions;
pub mod discreet_pin_handlers;
pub mod discreet_platform_admin_handlers;
pub mod discreet_platform_permissions;
pub mod discreet_platform_settings;
pub mod discreet_playbook_handlers;
pub mod discreet_poll_handlers;
pub mod discreet_post_quantum;
#[cfg(feature = "pq")]
pub mod discreet_pq_crypto;
pub mod discreet_qr_handlers;
pub mod discreet_premium;
pub mod discreet_rate_limit;
pub mod discreet_reaction_handlers;
pub mod discreet_saml;
pub mod discreet_report_handlers;
pub mod discreet_role_handlers;
pub mod discreet_schedule_handlers;
pub mod discreet_scheduled_task_handlers;
pub mod discreet_security_headers;
pub mod discreet_server_handlers;
pub mod discreet_settings_handlers;
pub mod discreet_soundboard_handlers;
pub mod discreet_state;
pub mod discreet_stream_handlers;
pub mod discreet_task_executor;
pub mod discreet_tier_limits;
pub mod discreet_translate_handlers;
pub mod discreet_turn;
pub mod discreet_typing;
pub mod discreet_user_handlers;
pub mod discreet_voice_handlers;
pub mod discreet_waitlist;
pub mod discreet_webhook_handlers;
pub mod discreet_websocket;
