// lib.rs — Discreet server library root.
//
// Each module is a self-contained file with a unique name.
// No ambiguous mod.rs files. Every file is identifiable at a glance.

pub mod citadel_agent_config;
pub mod citadel_agent_handlers;
pub mod citadel_agent_memory;
pub mod citadel_agent_provider;
pub mod citadel_agent_types;
pub mod citadel_audit;
pub mod citadel_auth;
pub mod citadel_auth_handlers;
pub mod citadel_ban_handlers;
pub mod citadel_bot_spawn_handlers;
pub mod citadel_channel_handlers;
pub mod citadel_category_handlers;
pub mod citadel_config;
pub mod citadel_csrf;
pub mod citadel_dev_token_handlers;
pub mod citadel_discovery_handlers;
pub mod citadel_dm_handlers;
pub mod citadel_email_handlers;
pub mod citadel_emoji_handlers;
pub mod citadel_error;
pub mod citadel_event_handlers;
pub mod citadel_federation;
pub mod citadel_file_handlers;
pub mod citadel_forum_handlers;
pub mod citadel_friend_handlers;
pub mod citadel_group_dm_handlers;
pub mod citadel_health;
pub mod citadel_meeting_handlers;
pub mod citadel_message_handlers;
pub mod citadel_mls_handlers;
pub mod citadel_permissions;
pub mod citadel_platform_admin_handlers;
pub mod citadel_platform_permissions;
pub mod citadel_pin_handlers;
pub mod citadel_poll_handlers;
pub mod citadel_post_quantum;
pub mod citadel_rate_limit;
pub mod citadel_reaction_handlers;
pub mod citadel_role_handlers;
pub mod citadel_security_headers;
pub mod citadel_server_handlers;
pub mod citadel_settings_handlers;
pub mod citadel_soundboard_handlers;
pub mod citadel_state;
pub mod citadel_stream_handlers;
pub mod citadel_typing;
pub mod citadel_user_handlers;
pub mod citadel_waitlist;
pub mod citadel_websocket;
