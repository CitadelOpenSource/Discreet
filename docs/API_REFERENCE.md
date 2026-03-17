# Discreet API Reference

Base URL: `http://localhost:3000/api/v1`

Authentication for protected HTTP endpoints uses:

```http
Authorization: Bearer <access_token>
```

Error envelope for `AppError` responses:

```json
{
  "error": {
    "code": "BAD_REQUEST|UNAUTHORIZED|FORBIDDEN|NOT_FOUND|CONFLICT|RATE_LIMITED|...",
    "message": "Human-readable message"
  }
}
```

---

## Quick Start

### 1) Register a user

```bash
curl -X POST http://localhost:3000/api/v1/auth/register \
  -H 'Content-Type: application/json' \
  -d '{
    "username": "alice",
    "email": "alice@example.com",
    "password": "correct-horse-battery-staple",
    "display_name": "Alice",
    "device_name": "Firefox on Linux"
  }'
```

### 2) Login

```bash
curl -X POST http://localhost:3000/api/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"login":"alice","password":"correct-horse-battery-staple","device_name":"Firefox on Linux"}'
```

### 3) Create a server

```bash
curl -X POST http://localhost:3000/api/v1/servers \
  -H 'Authorization: Bearer <access_token>' \
  -H 'Content-Type: application/json' \
  -d '{"name":"Discreet HQ","description":"Main workspace","icon_url":null}'
```

### 4) Create a channel

```bash
curl -X POST http://localhost:3000/api/v1/servers/<server_id>/channels \
  -H 'Authorization: Bearer <access_token>' \
  -H 'Content-Type: application/json' \
  -d '{"name":"general-chat","topic":"Team updates","channel_type":"text"}'
```

### 5) Send a message

```bash
curl -X POST http://localhost:3000/api/v1/channels/<channel_id>/messages \
  -H 'Authorization: Bearer <access_token>' \
  -H 'Content-Type: application/json' \
  -d '{
    "content_ciphertext":"U2FtcGxlLWJhc2U2NC1jaXBoZXJ0ZXh0",
    "mls_epoch":1,
    "attachment_blob_id":null
  }'
```

---

## 1) Authentication

### POST `/auth/register`
- Description: Create a user account and initial session.
- Auth required: **No**
- Request body:
```json
{
  "username": "string (3-32, alnum + _)",
  "email": "string|null",
  "password": "string (8-128)",
  "display_name": "string|null",
  "device_name": "string|null"
}
```
- Response `201`:
```json
{
  "user": {"id":"uuid","username":"alice","display_name":"Alice","email":"alice@example.com","created_at":"RFC3339"},
  "access_token":"jwt",
  "refresh_token":"string",
  "expires_in":3600
}
```
- Errors: `400` invalid username/password/email, `409` duplicate username/email.
- curl:
```bash
curl -X POST http://localhost:3000/api/v1/auth/register -H 'Content-Type: application/json' -d '{"username":"alice","password":"correct-horse-battery-staple"}'
```

### POST `/auth/login`
- Description: Authenticate with username or email and issue session tokens.
- Auth required: **No**
- Request body:
```json
{"login":"alice or alice@example.com","password":"string","device_name":"string|null"}
```
- Response `200`: same schema as register response.
- Errors: `401` invalid credentials.
- curl:
```bash
curl -X POST http://localhost:3000/api/v1/auth/login -H 'Content-Type: application/json' -d '{"login":"alice","password":"correct-horse-battery-staple"}'
```

### POST `/auth/refresh`
- Description: Exchange refresh token for new access token.
- Auth required: **No**
- Request body:
```json
{"refresh_token":"string"}
```
- Response `200`:
```json
{"access_token":"jwt","expires_in":3600}
```
- Errors: `401` invalid/revoked/expired refresh token.
- curl:
```bash
curl -X POST http://localhost:3000/api/v1/auth/refresh -H 'Content-Type: application/json' -d '{"refresh_token":"<refresh_token>"}'
```

### POST `/auth/logout`
- Description: Revoke current session.
- Auth required: **Yes**
- Request body: none.
- Response `204`: no body.
- Errors: `404` session already revoked/not found.
- curl:
```bash
curl -X POST http://localhost:3000/api/v1/auth/logout -H 'Authorization: Bearer <access_token>'
```

### GET `/auth/sessions`
- Description: List active sessions for current user.
- Auth required: **Yes**
- Query params: none.
- Response `200`:
```json
[
  {"id":"uuid","device_name":"Firefox","ip_address":"127.0.0.1","created_at":"RFC3339","expires_at":"RFC3339","current":true}
]
```
- Errors: standard auth errors.
- curl:
```bash
curl http://localhost:3000/api/v1/auth/sessions -H 'Authorization: Bearer <access_token>'
```

### DELETE `/auth/sessions/:id`
- Description: Revoke a specific active session belonging to caller.
- Auth required: **Yes**
- Path params: `id` (session UUID)
- Response `204`: no body.
- Errors: `404` session not found/already revoked.
- curl:
```bash
curl -X DELETE http://localhost:3000/api/v1/auth/sessions/<session_id> -H 'Authorization: Bearer <access_token>'
```

## 2) Users

### GET `/users/@me`
- Description: Get full profile of current user.
- Auth required: **Yes**
- Response `200`:
```json
{"id":"uuid","username":"alice","display_name":"Alice","email":"alice@example.com","avatar_url":null,"created_at":"RFC3339"}
```
- Errors: `404` user not found.

### PATCH `/users/@me`
- Description: Update own display name/avatar URL.
- Auth required: **Yes**
- Request body:
```json
{"display_name":"string|null","avatar_url":"string|null"}
```
- Response `200`: same as GET `/users/@me`.
- Errors: `400` invalid field lengths.

### GET `/users/:id`
- Description: Get another user profile (or own profile if same ID).
- Auth required: **Yes**
- Response `200` public profile (or own full profile):
```json
{"id":"uuid","username":"bob","display_name":"Bob","avatar_url":null}
```
- Errors: `404` user not found/not share a server.

### GET `/users/@me/servers`
- Description: List servers current user belongs to.
- Auth required: **Yes**
- Response `200`:
```json
{"servers":[{"id":"uuid","name":"Discreet HQ","description":null,"icon_url":null,"owner_id":"uuid","joined_at":"RFC3339","member_count":1}]}
```

### GET `/users/search?q=...`
- Description: User search by username substring.
- Auth required: **Yes**
- Query params: `q` (min length 2)
- Response `200`:
```json
[{"id":"uuid","username":"alice","display_name":"Alice","avatar_url":null}]
```
- Errors: `400` query too short.

## 3) Friends

### POST `/friends/request`
- Description: Send friend request by username (auto-accepts opposite pending request).
- Auth required: **Yes**
- Request body:
```json
{"username":"target_username"}
```
- Response `201` or `200`:
```json
{"message":"Friend request sent","friendship_id":"uuid","status":"pending"}
```
- Errors: `400` invalid/self/already friends/blocked, `404` user missing.

### GET `/friends`
- Description: List accepted friends.
- Auth required: **Yes**
- Response `200`:
```json
[{"friendship_id":"uuid","user_id":"uuid","username":"bob","display_name":"Bob","avatar_url":null,"status":"accepted","since":"RFC3339"}]
```

### GET `/friends/requests`
- Description: List incoming pending requests.
- Auth required: **Yes**
- Response `200`: same object shape as friends list, `status:"pending"`.

### GET `/friends/outgoing`
- Description: List outgoing pending requests.
- Auth required: **Yes**
- Response `200`: same object shape, `status:"pending_outgoing"`.

### POST `/friends/:id/accept`
- Description: Accept incoming request by friendship id.
- Auth required: **Yes**
- Response `200`:
```json
{"message":"Friend request accepted"}
```
- Errors: `404` no pending request found.

### POST `/friends/:id/decline`
- Description: Decline incoming request by friendship id.
- Auth required: **Yes**
- Response `200`:
```json
{"message":"Friend request declined"}
```

### DELETE `/friends/:id`
- Description: Remove accepted friendship.
- Auth required: **Yes**
- Response `200`:
```json
{"message":"Friend removed"}
```
- Errors: `404` friendship missing.

### POST `/users/:id/block`
- Description: Block user; removes existing friendship/request first.
- Auth required: **Yes**
- Response `200`:
```json
{"message":"User blocked"}
```
- Errors: `400` cannot block self.

### DELETE `/users/:id/block`
- Description: Unblock previously blocked user.
- Auth required: **Yes**
- Response `200`:
```json
{"message":"User unblocked"}
```
- Errors: `404` block not found.

## 4) Servers

### POST `/servers`
- Description: Create server; auto-add owner member, `general` channel, `@everyone` role.
- Auth required: **Yes**
- Request body:
```json
{"name":"string(1-128)","description":"string|null","icon_url":"string|null"}
```
- Response `201`:
```json
{"id":"uuid","name":"Discreet HQ","description":null,"icon_url":null,"owner_id":"uuid","member_count":1,"created_at":"RFC3339"}
```

### GET `/servers`
- Description: List servers user is a member of.
- Auth required: **Yes**
- Response `200`: array of `ServerInfo` (same fields as above).

### GET `/servers/:server_id`
- Description: Get server details.
- Auth required: **Yes** (membership required)
- Response `200`: `ServerInfo`
- Errors: `403` not member, `404` missing server.

### PATCH `/servers/:server_id`
- Description: Update server metadata (owner only).
- Auth required: **Yes**
- Request body:
```json
{"name":"string|null","description":"string|null","icon_url":"string|null"}
```
- Response `200`: `ServerInfo`
- Errors: `403` not owner, `400` invalid name.

### DELETE `/servers/:server_id`
- Description: Delete server (owner only).
- Auth required: **Yes**
- Response `204`.

### POST `/servers/:server_id/join`
- Description: Join server using invite code.
- Auth required: **Yes**
- Request body:
```json
{"invite_code":"string"}
```
- Response `204`.
- Errors: `403` banned, `404` invalid invite, `400` expired/maxed invite, `409` already member.

### POST `/servers/:server_id/leave`
- Description: Leave server (non-owner only).
- Auth required: **Yes**
- Response `204`.
- Errors: `400` owner cannot leave, `404` not a member.

### GET `/servers/:server_id/members`
- Description: List server members.
- Auth required: **Yes** (membership required)
- Query params: `limit` default 100 max 500, `offset` default 0
- Response `200`:
```json
[{"user_id":"uuid","username":"alice","display_name":"Alice","nickname":null,"joined_at":"RFC3339"}]
```

### POST `/servers/:server_id/invites`
- Description: Create invite.
- Auth required: **Yes** (membership required)
- Request body:
```json
{"max_uses":"int|null","expires_in_hours":"int|null"}
```
- Response `201`:
```json
{"code":"Ab3D9kLm","max_uses":null,"expires_at":null}
```

### GET `/servers/:server_id/invites`
- Description: List invites (owner only).
- Auth required: **Yes**
- Response `200`:
```json
[{"id":"uuid","code":"Ab3D9kLm","created_by":"uuid","max_uses":null,"use_count":0,"expires_at":null,"created_at":"RFC3339"}]
```

## 5) Channels

### POST `/servers/:server_id/channels`
- Description: Create channel (`text|voice|announcement`).
- Auth required: **Yes** (`MANAGE_CHANNELS`)
- Request body:
```json
{"name":"string","topic":"string|null","channel_type":"text|voice|announcement"}
```
- Response `201`: `ChannelInfo` `{id,server_id,name,topic,channel_type,position,created_at}`

### GET `/servers/:server_id/channels`
- Description: List channels in server.
- Auth required: **Yes** (`VIEW_CHANNEL`)
- Response `200`: array of `ChannelInfo`.

### GET `/channels/:channel_id`
- Description: Get single channel.
- Auth required: **Yes** (`VIEW_CHANNEL`)
- Response `200`: `ChannelInfo`
- Errors: `404` channel missing.

### PATCH `/channels/:channel_id`
- Description: Update channel name/topic/position.
- Auth required: **Yes** (`MANAGE_CHANNELS`)
- Request body:
```json
{"name":"string|null","topic":"string|null","position":"int|null"}
```
- Response `200`: updated `ChannelInfo`.

### DELETE `/channels/:channel_id`
- Description: Delete channel.
- Auth required: **Yes** (`MANAGE_CHANNELS`)
- Response `204`.
- Errors: `400` last channel cannot be deleted.

## 6) Categories

### POST `/servers/:server_id/categories`
- Description: Create channel category.
- Auth required: **Yes** (`MANAGE_CHANNELS`)
- Request body:
```json
{"name":"string","position":"int|null"}
```
- Response `201`:
```json
{"id":"uuid","server_id":"uuid","name":"Operations","position":1,"created_at":"RFC3339"}
```

### GET `/servers/:server_id/categories`
- Description: List categories plus uncategorized channels.
- Auth required: **Yes** (`VIEW_CHANNEL`)
- Response `200`:
```json
{"categories":[{"category":{"id":"uuid","server_id":"uuid","name":"Operations","position":1,"created_at":"RFC3339"},"channels":[]}],"uncategorized_channels":[]}
```

### PATCH `/servers/:server_id/categories/:id`
- Description: Update category name and/or position.
- Auth required: **Yes** (`MANAGE_CHANNELS`)
- Request body:
```json
{"name":"string|null","position":"int|null"}
```
- Response `200`: category object.

### DELETE `/servers/:server_id/categories/:id`
- Description: Delete category.
- Auth required: **Yes** (`MANAGE_CHANNELS`)
- Response `204`.

### PATCH `/servers/:server_id/channels/:id/move`
- Description: Move channel into (or out of) category and reorder.
- Auth required: **Yes** (`MANAGE_CHANNELS`)
- Request body:
```json
{"category_id":"uuid|null","position":"int|null"}
```
- Response `200` channel object with `category_id`.

## 7) Messages

### POST `/channels/:channel_id/messages`
- Description: Send encrypted channel message.
- Auth required: **Yes** (`SEND_MESSAGES`; also `ATTACH_FILES` if attachment present)
- Request body:
```json
{"content_ciphertext":"base64","mls_epoch":1,"attachment_blob_id":"uuid|null"}
```
- Response `201`:
```json
{"id":"uuid","channel_id":"uuid","author_id":"uuid","content_ciphertext":"base64","mls_epoch":1,"attachment_blob_id":null,"edited_at":null,"deleted":false,"created_at":"RFC3339"}
```
- Errors: `400` empty/invalid/too-large ciphertext, `404` channel not found, `403` missing permission.

### GET `/channels/:channel_id/messages`
- Description: Get paginated message history (newest first).
- Auth required: **Yes** (`VIEW_CHANNEL`)
- Query params: `limit` (default 50 max 100), `before` (message UUID cursor)
- Response `200`: array of `MessageInfo`.

### PATCH `/messages/:id`
- Description: Edit own message ciphertext.
- Auth required: **Yes**
- Request body:
```json
{"content_ciphertext":"base64","mls_epoch":2}
```
- Response `204`.
- Errors: `404` message missing, `403` not author, `400` deleted/invalid/too-large payload.

### DELETE `/messages/:id`
- Description: Soft-delete message (author or moderator with `MANAGE_MESSAGES`).
- Auth required: **Yes**
- Response `204`.
- Errors: `404` message missing, `403` no moderation permission.

### POST `/channels/:channel_id/typing`
- Description: Broadcast typing indicator (ephemeral, cooldown throttled).
- Auth required: **Yes**
- Request body: none.
- Response `204`.
- Errors: `403` not a server member for channel.

## 8) Pins

### POST `/servers/:server_id/channels/:channel_id/pins/:message_id`
- Description: Pin message in channel.
- Auth required: **Yes** (`MANAGE_MESSAGES`)
- Response `204`.
- Errors: `404` channel/message missing, `400` pin limit (50), `409` already pinned.

### DELETE `/servers/:server_id/channels/:channel_id/pins/:message_id`
- Description: Unpin message.
- Auth required: **Yes** (`MANAGE_MESSAGES`)
- Response `204`.
- Errors: `404` pin not found.

### GET `/servers/:server_id/channels/:channel_id/pins`
- Description: List pinned messages.
- Auth required: **Yes** (`VIEW_CHANNEL`)
- Response `200`:
```json
[{"id":"uuid","content_ciphertext":"base64","author_id":"uuid","created_at":"RFC3339","pinned_by":"uuid","pinned_at":"RFC3339"}]
```

## 9) Direct Messages

### POST `/dms`
- Description: Create (or return existing) DM channel with recipient.
- Auth required: **Yes**
- Request body:
```json
{"recipient_id":"uuid"}
```
- Response `201` (created) or `200` (existing):
```json
{"id":"uuid","other_user_id":"uuid","other_username":"bob","other_display_name":"Bob","other_avatar_url":null,"created_at":"RFC3339","last_message_at":null}
```
- Errors: `400` cannot DM self, `404` recipient missing.

### GET `/dms`
- Description: List DM channels for current user.
- Auth required: **Yes**
- Response `200`:
```json
{"channels":[{"id":"uuid","other_user_id":"uuid","other_username":"bob","other_display_name":"Bob","other_avatar_url":null,"created_at":"RFC3339","last_message_at":"RFC3339|null"}]}
```

### POST `/dms/:id/messages`
- Description: Send encrypted DM.
- Auth required: **Yes** (must be DM participant)
- Request body:
```json
{"content_ciphertext":"base64"}
```
- Response `201`:
```json
{"id":"uuid","dm_channel_id":"uuid","sender_id":"uuid","content_ciphertext":"base64","created_at":"RFC3339"}
```
- Errors: `404` DM missing, `403` not participant, `400` empty/invalid/too-large ciphertext.

### GET `/dms/:id/messages`
- Description: List DM history (newest first).
- Auth required: **Yes**
- Query params: `limit` (default 50 max 100), `before` (message UUID)
- Response `200`: array of `DmMessageInfo`.

## 10) Roles

### POST `/servers/:server_id/roles`
- Description: Create role.
- Auth required: **Yes** (`MANAGE_ROLES`)
- Request body:
```json
{"name":"string","color":"#RRGGBB|null","permissions":"int64|null"}
```
- Response `201`: `RoleInfo` `{id,server_id,name,color,permissions,position,created_at}`.

### GET `/servers/:server_id/roles`
- Description: List server roles.
- Auth required: **Yes** (membership required)
- Response `200`: array of `RoleInfo`.

### PATCH `/roles/:role_id`
- Description: Update role metadata/permissions/position.
- Auth required: **Yes** (`MANAGE_ROLES`)
- Request body:
```json
{"name":"string|null","color":"string|null","permissions":"int64|null","position":"int|null"}
```
- Response `200`: `RoleInfo`.
- Errors: `400` invalid operations (`@everyone` constraints), `404` role missing.

### DELETE `/roles/:role_id`
- Description: Delete role.
- Auth required: **Yes** (`MANAGE_ROLES`)
- Response `204`.
- Errors: `400` cannot delete `@everyone`.

### PUT `/servers/:server_id/members/:user_id/roles/:role_id`
- Description: Assign role to member.
- Auth required: **Yes** (`MANAGE_ROLES`)
- Response `204`.
- Errors: `404` role/member missing.

### DELETE `/servers/:server_id/members/:user_id/roles/:role_id`
- Description: Unassign role from member.
- Auth required: **Yes** (`MANAGE_ROLES`)
- Response `204`.
- Errors: `404` assignment missing.

### GET `/servers/:server_id/members/:user_id/roles`
- Description: List a member’s roles.
- Auth required: **Yes** (membership required)
- Response `200`: array of `RoleInfo`.

## 11) Bans

### POST `/servers/:server_id/bans`
- Description: Ban member from server.
- Auth required: **Yes** (`BAN_MEMBERS`)
- Request body:
```json
{"user_id":"uuid","reason":"string|null"}
```
- Response `201`:
```json
{"id":"uuid","server_id":"uuid","user_id":"uuid","banned_by":"uuid","reason":"optional"}
```
- Errors: `400` cannot ban owner, `404` user not a member, `409` already banned.

### DELETE `/servers/:server_id/bans/:user_id`
- Description: Unban user.
- Auth required: **Yes** (`BAN_MEMBERS`)
- Response `204`.
- Errors: `404` user not banned.

### GET `/servers/:server_id/bans`
- Description: List bans.
- Auth required: **Yes** (`BAN_MEMBERS`)
- Response `200`:
```json
[{"id":"uuid","user_id":"uuid","username":"bob","banned_by":"uuid","reason":"optional","created_at":"RFC3339"}]
```

## 12) Reactions

### PUT `/channels/:channel_id/messages/:msg_id/reactions/:emoji`
- Description: Add reaction (idempotent).
- Auth required: **Yes** (server membership for channel)
- Request body: none.
- Response `204`.
- Errors: `400` invalid emoji, `403` not member, `404` message not found.

### DELETE `/channels/:channel_id/messages/:msg_id/reactions/:emoji`
- Description: Remove own reaction.
- Auth required: **Yes**
- Response `204`.
- Errors: `404` reaction missing.

### GET `/channels/:channel_id/messages/:msg_id/reactions`
- Description: List reaction aggregates for message.
- Auth required: **Yes**
- Response `200`:
```json
[{"emoji":"👍","count":2,"me":true,"users":["uuid","uuid"]}]
```

## 13) Files

### POST `/channels/:channel_id/files`
- Description: Upload encrypted blob (JSON/base64, max 10 MiB decoded).
- Auth required: **Yes** (server membership)
- Request body:
```json
{"encrypted_blob":"base64","mime_type_hint":"string|null"}
```
- Response `201`:
```json
{"id":"uuid","size_bytes":1024,"mime_type_hint":"image/png","created_at":"RFC3339"}
```
- Errors: `400` empty/invalid/too large blob, `404` channel missing, `403` not member.

### GET `/files/:id`
- Description: Download encrypted blob by file ID (authenticated alpha access model).
- Auth required: **Yes**
- Response `200`:
```json
{"id":"uuid","encrypted_blob":"base64","size_bytes":1024,"mime_type_hint":"image/png","created_at":"RFC3339"}
```
- Errors: `404` file missing.

## 14) Agents

### POST `/agents/search`
- Description: Search existing agent channels by query; optionally auto-spawn new agent.
- Auth required: **Yes** (`PERM_USE_AGENTS` on target server)
- Request body:
```json
{"query":"immigration lawyer","server_id":"uuid","auto_spawn":true}
```
- Response `200`:
```json
{
  "existing": false,
  "channel": null,
  "spawn": {
    "request_id": "uuid",
    "status": "provisioning",
    "inferred_specialization": "Legal",
    "confidence": 0.91,
    "estimated_ready_secs": 8
  },
  "suggestions": []
}
```
- Errors: `429` spawn rate limit (30s), `400` low confidence query.

### GET `/agents/spawn/:id/status`
- Description: Poll agent spawn request status for requesting user.
- Auth required: **Yes**
- Response `200`:
```json
{"id":"uuid","status":"ready|failed|...","specialization":{},"confidence":0.91,"agent_id":"uuid|null","channel_id":"uuid|null","error":null,"created_at":"timestamp","completed_at":"timestamp|null"}
```
- Errors: `404` not found/not owned by caller.

### GET `/servers/:server_id/agents`
- Description: List active agents bound to server channels.
- Auth required: **Yes** (current implementation does not enforce membership in handler; upstream auth still required)
- Response `200`:
```json
[{"id":"uuid","display_name":"Discreet Legal — visas","specialization":{},"status":"active","fingerprint":"hex","created_at":"timestamp","channel_count":1}]
```

## 15) WebSocket

### GET `/ws?server_id=<uuid>`
- Description: Upgrade to WebSocket stream for real-time server events.
- Auth required: **Yes** (Bearer JWT in `Authorization` header + valid non-revoked session + server membership)
- Query params: `server_id` UUID
- Request body: none.
- Successful handshake: HTTP `101 Switching Protocols`.
- Initial event example:
```json
{"type":"connected","server_id":"uuid","user_id":"uuid"}
```
- Other event examples:
```json
{"type":"message_create","channel_id":"uuid","message_id":"uuid","author_id":"uuid"}
{"type":"message_update","channel_id":"uuid","message_id":"uuid"}
{"type":"message_delete","channel_id":"uuid","message_id":"uuid"}
{"type":"message_pin","channel_id":"uuid","message_id":"uuid","pinned_by":"uuid"}
{"type":"message_unpin","channel_id":"uuid","message_id":"uuid","unpinned_by":"uuid"}
{"type":"REACTION_ADD","channel_id":"uuid","message_id":"uuid","user_id":"uuid","emoji":"👍"}
{"type":"REACTION_REMOVE","channel_id":"uuid","message_id":"uuid","user_id":"uuid","emoji":"👍"}
{"type":"TYPING_START","channel_id":"uuid","user_id":"uuid","timestamp":"RFC3339"}
{"type":"agent_channel_created","channel_id":"uuid","agent":{"id":"uuid","display_name":"Discreet Legal"},"topic":"immigration law"}
{"type":"MEMBER_BANNED","server_id":"uuid","user_id":"uuid","banned_by":"uuid"}
{"type":"MEMBER_UNBANNED","server_id":"uuid","user_id":"uuid","unbanned_by":"uuid"}
{"type":"lagged","missed":42}
```
- Errors (HTTP before upgrade): `401` missing/invalid token/session, `403` not a member, `400` invalid query.
- curl (handshake test):
```bash
curl -i -N http://localhost:3000/ws?server_id=<server_id> -H 'Connection: Upgrade' -H 'Upgrade: websocket' -H 'Authorization: Bearer <access_token>'
```

---

## Additional System Endpoints

### GET `/health`
- Description: Lightweight health check.
- Auth required: **No**
- Response `200` plain text: `OK`

### GET `/api/v1/info`
- Description: Server info, feature flags, dependency connectivity, limits.
- Auth required: **No**
- Response `200` example:
```json
{
  "name":"discreet-server",
  "version":"0.x.y",
  "architecture":"zero-knowledge",
  "features":{"agents":true,"federation":false,"post_quantum":true,"rate_limiting":true,"reactions":true,"typing_indicators":true},
  "connectivity":{"database":true,"redis":true},
  "endpoints":{"api_version":"v1","websocket":"/ws?server_id={uuid}","docs":"https://github.com/CitadelOpenSource/Discreet"},
  "limits":{"rate_limit_per_minute":120,"auth_rate_limit_per_minute":30}
}
```

---

## Proximity Endpoints (Planned)

These endpoints will be used for syncing proximity messages to the server.

### POST /api/v1/proximity/sync
Upload messages created during offline proximity sessions.
```json
{
  "messages": [
    {
      "recipient_id": "uuid",
      "content_encrypted": "base64",
      "timestamp": "2026-03-07T23:31:54Z",
      "proximity_session_id": "uuid"
    }
  ]
}
```
Response: `{ "synced": 5, "conflicts": 0 }`

### GET /api/v1/proximity/missed?since=timestamp
Retrieve messages that arrived while the user was offline.
Response: Array of messages missed since the given timestamp.

### POST /api/v1/proximity/beacon
Register a proximity beacon for server-assisted discovery (optional — for users who want server-mediated proximity discovery as a faster alternative to BLE scanning).
```json
{
  "pseudonymous_id": "sha256_hash",
  "latitude": 40.7128,
  "longitude": -74.0060,
  "accuracy": 50
}
```
Note: Location data is optional and encrypted. Server-assisted discovery is opt-in only.
