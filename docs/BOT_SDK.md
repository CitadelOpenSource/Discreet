# Discreet Bot SDK

Build bots and integrations for Discreet servers using the REST API and
WebSocket events. Bots authenticate with developer tokens and interact
through the same channels as human users.

---

## Table of Contents

1. [Authentication](#authentication)
2. [REST API Reference](#rest-api-reference)
3. [WebSocket Events](#websocket-events)
4. [Rate Limits](#rate-limits)
5. [Python Example Bot](#python-example-bot)

---

## Authentication

Bots authenticate using **Developer API Tokens** (prefix `dsk_`).

### Creating a Token

Tokens are created by platform admins via the REST API or Settings UI.

```
POST /api/v1/dev/tokens
Authorization: Bearer <admin_jwt>
Content-Type: application/json

{
  "name": "my-bot-token"
}
```

Response (201):
```json
{
  "id": "uuid",
  "token": "dsk_a1b2c3d4e5f6...",
  "token_prefix": "dsk_a1b2",
  "name": "my-bot-token",
  "created_at": "2026-03-20T10:00:00Z"
}
```

> **The full token is returned only once.** Store it securely. Only the
> SHA-256 hash is kept in the database.

### Using a Token

Include the token in the `Authorization` header on every request:

```
Authorization: Bearer dsk_a1b2c3d4e5f6...
```

### Managing Tokens

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/v1/dev/tokens` | List your tokens (prefix + name only) |
| `DELETE` | `/api/v1/dev/tokens/:id` | Revoke a token |

---

## REST API Reference

All endpoints are under `/api/v1/`. Requests and responses use JSON.
Errors return `{ "error": { "code": "...", "message": "..." } }`.

### Servers

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/servers/:sid/channels` | List channels in a server |
| `GET` | `/servers/:sid/members` | List server members |

### Messages

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/channels/:cid/messages` | Send a message |
| `GET` | `/channels/:cid/messages` | Get message history |
| `PATCH` | `/messages/:id` | Edit a message |
| `DELETE` | `/messages/:id` | Delete a message |

#### Send a Message

```
POST /api/v1/channels/:channel_id/messages
Authorization: Bearer dsk_...
Content-Type: application/json

{
  "content_ciphertext": "<base64-encoded ciphertext>",
  "mls_epoch": 0
}
```

Response (201):
```json
{
  "id": "uuid",
  "channel_id": "uuid",
  "author_id": "uuid",
  "created_at": "2026-03-20T12:34:56Z"
}
```

> **Note:** For non-E2EE bot messages, encode the plaintext as base64 and
> set `mls_epoch: 0`. For full E2EE, the bot must participate in the
> channel's MLS group (see the WASM crypto module).

#### Get Message History

```
GET /api/v1/channels/:channel_id/messages?limit=50&before=<message_id>
```

Response (200):
```json
[
  {
    "id": "uuid",
    "channel_id": "uuid",
    "author_id": "uuid",
    "content_ciphertext": "<base64>",
    "mls_epoch": 0,
    "created_at": "2026-03-20T12:34:56Z"
  }
]
```

### Bots

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/servers/:sid/bots` | Create a bot in a server |
| `GET` | `/servers/:sid/bots` | List server bots |
| `PATCH` | `/servers/:sid/ai-bots/:bid` | Update bot configuration |
| `DELETE` | `/servers/:sid/ai-bots/:bid` | Remove bot from server |
| `GET` | `/servers/:sid/ai-bots/:bid/config` | Get bot provider config |
| `PUT` | `/servers/:sid/ai-bots/:bid/config` | Update bot provider config |
| `DELETE` | `/servers/:sid/ai-bots/:bid/memory` | Clear bot memory |

#### Create a Bot

```
POST /api/v1/servers/:server_id/bots
Content-Type: application/json

{
  "username": "my-bot",
  "display_name": "My Bot",
  "persona": "general",
  "trigger_mode": "mention"
}
```

Response (201):
```json
{
  "user_id": "uuid",
  "username": "my-bot#a1b2",
  "display_name": "My Bot",
  "persona": "general",
  "trigger_mode": "mention"
}
```

#### Update Bot Config

```
PATCH /api/v1/servers/:server_id/ai-bots/:bot_id
Content-Type: application/json

{
  "display_name": "Updated Bot",
  "system_prompt": "You are a helpful assistant.",
  "temperature": 0.8,
  "max_tokens": 2048,
  "enabled": true,
  "context_memory": true,
  "context_window": 20
}
```

All fields are optional. Full list of configurable fields:

| Field | Type | Description |
|-------|------|-------------|
| `display_name` | string | Bot display name |
| `system_prompt` | string | System prompt for LLM |
| `voice_style` | string | Response tone (`default`, `professional`, `casual`) |
| `temperature` | float | LLM temperature (0.0-2.0) |
| `max_tokens` | int | Max response tokens |
| `enabled` | bool | Enable/disable the bot |
| `greeting_message` | string | Auto-sent on first interaction |
| `response_prefix` | string | Prepended to every response |
| `rate_limit_per_min` | int | Per-user rate limit |
| `typing_delay` | int | Milliseconds of simulated typing |
| `context_memory` | bool | Remember conversation context |
| `context_window` | int | Number of past messages to include |
| `language` | string | Response language code |

### Agent Configs

Custom LLM provider configurations for servers.

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/servers/:sid/agents` | Create agent config |
| `GET` | `/servers/:sid/agents` | List agent configs |
| `PUT` | `/servers/:sid/agents/:aid` | Update agent config |
| `DELETE` | `/servers/:sid/agents/:aid` | Delete agent config |

#### Create Agent Config

```
POST /api/v1/servers/:server_id/agents
Content-Type: application/json

{
  "name": "Claude Agent",
  "provider_type": "anthropic",
  "model": "claude-opus",
  "api_key": "sk-ant-...",
  "system_prompt": "You are a helpful assistant.",
  "temperature": 0.7,
  "max_tokens": 2048
}
```

Supported `provider_type` values:

| Provider | Description |
|----------|-------------|
| `anthropic` | Anthropic API (Claude models) |
| `openai` | OpenAI API (GPT models) |
| `ollama` | Local Ollama instance |
| `vllm` | vLLM inference server |
| `custom` | Any OpenAI-compatible endpoint |

> **API keys are encrypted** at rest with AES-256-GCM using HKDF salt
> `discreet-agent-v1`. They are never stored in plaintext.

### Auto-Spawn Agents

Discreet can auto-provision specialist AI agents on demand.

```
POST /api/v1/agents/search
Content-Type: application/json

{
  "query": "immigration lawyer",
  "server_id": "uuid",
  "auto_spawn": true
}
```

If a matching agent exists, it is returned. Otherwise with `auto_spawn: true`,
a new agent channel is provisioned. Poll the spawn status:

```
GET /api/v1/agents/spawn/:request_id/status
```

Response:
```json
{
  "request_id": "uuid",
  "status": "ready",
  "channel_id": "uuid",
  "agent_id": "uuid",
  "progress_percent": 100
}
```

Status values: `provisioning`, `generating_keys`, `uploading_keypackages`,
`joining_group`, `ready`, `failed`.

### Reactions

| Method | Endpoint | Description |
|--------|----------|-------------|
| `PUT` | `/channels/:cid/messages/:mid/reactions/:emoji` | Add reaction |
| `DELETE` | `/channels/:cid/messages/:mid/reactions/:emoji` | Remove reaction |

### Pins

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/servers/:sid/channels/:cid/pins/:mid?category=important` | Pin message |
| `DELETE` | `/servers/:sid/channels/:cid/pins/:mid` | Unpin message |
| `GET` | `/servers/:sid/channels/:cid/pins` | List pinned messages |

Pin categories: `important`, `action_required`, `reference`.

### Webhooks

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/servers/:sid/webhooks` | Create webhook |
| `GET` | `/servers/:sid/webhooks` | List webhooks |
| `PUT` | `/webhooks/:wid` | Update webhook |
| `DELETE` | `/webhooks/:wid` | Delete webhook |

Webhook payloads are signed with HMAC-SHA256. Verify using the
`X-Discreet-Signature` header (format: `sha256=<hex>`).

---

## WebSocket Events

Connect to the WebSocket for real-time events:

```
GET /ws?server_id=<uuid>
```

### Authentication

Pass the token via the `Sec-WebSocket-Protocol` header (recommended)
or `Authorization: Bearer dsk_...` header.

### Event Format

All events are JSON objects with a `type` field:

```json
{ "type": "event_type", ...payload }
```

### Event Types

| Type | Direction | Description |
|------|-----------|-------------|
| `message_create` | Server -> Client | New message in a channel |
| `message_update` | Server -> Client | Message edited |
| `message_delete` | Server -> Client | Message deleted |
| `message_pin` | Server -> Client | Message pinned |
| `message_unpin` | Server -> Client | Message unpinned |
| `member_join` | Server -> Client | User joined the server |
| `member_leave` | Server -> Client | User left the server |
| `typing_start` | Server -> Client | User started typing |
| `channel_update` | Server -> Client | Channel settings changed |
| `presence_update` | Server -> Client | User online/offline status |

### Example: message_create

```json
{
  "type": "message_create",
  "channel_id": "uuid",
  "message": {
    "id": "uuid",
    "author_id": "uuid",
    "content_ciphertext": "<base64>",
    "mls_epoch": 0,
    "created_at": "2026-03-20T12:34:56Z"
  }
}
```

---

## Rate Limits

| Scope | Limit | Window |
|-------|-------|--------|
| Global API | 120 requests | per minute |
| Auth endpoints | 30 requests | per minute |
| WebSocket messages | 120 messages | per minute |
| WebSocket bandwidth | 1 MiB | per minute |
| Agent prompts | 30 requests | per hour per server |
| Bot config changes | 20 requests | per minute |

When rate-limited, the API returns `429 Too Many Requests`:

```json
{
  "error": {
    "code": "rate_limited",
    "message": "Too many requests. Try again later."
  }
}
```

Rate limiting is Redis-backed and **fail-closed** — if Redis is
unavailable, requests proceed (documented alpha-stage tradeoff).

---

## Python Example Bot

A minimal bot that listens for messages and responds to `!ping`:

```python
"""
Discreet Bot — minimal example.

Requirements:
    pip install websockets httpx

Usage:
    export DISCREET_TOKEN="dsk_..."
    export DISCREET_URL="https://your-instance.com"
    export DISCREET_SERVER_ID="uuid"
    python bot.py
"""

import asyncio
import json
import os
from base64 import b64encode, b64decode

import httpx
import websockets

TOKEN = os.environ["DISCREET_TOKEN"]
BASE = os.environ["DISCREET_URL"].rstrip("/")
API = f"{BASE}/api/v1"
SERVER_ID = os.environ["DISCREET_SERVER_ID"]

HEADERS = {
    "Authorization": f"Bearer {TOKEN}",
    "Content-Type": "application/json",
}


async def send_message(channel_id: str, text: str) -> dict:
    """Send a plaintext message (epoch 0) to a channel."""
    payload = {
        "content_ciphertext": b64encode(text.encode()).decode(),
        "mls_epoch": 0,
    }
    async with httpx.AsyncClient() as client:
        r = await client.post(
            f"{API}/channels/{channel_id}/messages",
            headers=HEADERS,
            json=payload,
            timeout=10,
        )
        r.raise_for_status()
        return r.json()


async def get_bot_user_id() -> str:
    """Fetch the bot's own user ID."""
    async with httpx.AsyncClient() as client:
        r = await client.get(f"{API}/users/@me", headers=HEADERS, timeout=10)
        r.raise_for_status()
        return r.json()["id"]


async def listen():
    """Connect to WebSocket and handle events."""
    bot_id = await get_bot_user_id()
    print(f"Bot user ID: {bot_id}")

    ws_url = BASE.replace("https://", "wss://").replace("http://", "ws://")
    ws_url = f"{ws_url}/ws?server_id={SERVER_ID}"

    async for ws in websockets.connect(
        ws_url,
        additional_headers={"Authorization": f"Bearer {TOKEN}"},
    ):
        print("Connected to WebSocket")
        try:
            async for raw in ws:
                event = json.loads(raw)
                await handle_event(event, bot_id)
        except websockets.ConnectionClosed:
            print("Disconnected, reconnecting in 5s...")
            await asyncio.sleep(5)


async def handle_event(event: dict, bot_id: str):
    """Process a single WebSocket event."""
    if event.get("type") != "message_create":
        return

    msg = event.get("message", event)
    author = msg.get("author_id", "")
    channel = msg.get("channel_id", "")

    # Ignore own messages to avoid loops.
    if author == bot_id:
        return

    # Decode message text (epoch 0 = base64 plaintext).
    try:
        text = b64decode(msg.get("content_ciphertext", "")).decode()
    except Exception:
        return

    # Respond to !ping command.
    if text.strip().lower() == "!ping":
        print(f"Ping from {author} in {channel}")
        await send_message(channel, "Pong! 🏓")

    # Respond to !help command.
    elif text.strip().lower() == "!help":
        await send_message(
            channel,
            "Available commands:\n"
            "• `!ping` — Check if I'm alive\n"
            "• `!help` — Show this message",
        )


if __name__ == "__main__":
    asyncio.run(listen())
```

### Running the Bot

```bash
pip install websockets httpx

export DISCREET_TOKEN="dsk_a1b2c3d4..."
export DISCREET_URL="https://discreetai.net"
export DISCREET_SERVER_ID="your-server-uuid"

python bot.py
```

### Key Points

- **Token in env, never in code** — follows Discreet's security model.
- **Base64 plaintext at epoch 0** — suitable for bots that don't need E2EE.
- **Ignore own messages** — prevents infinite response loops.
- **Auto-reconnect** — the `async for ws in websockets.connect(...)` loop
  handles reconnection automatically.
- **Rate limit awareness** — keep below 120 req/min. Add backoff on 429.

---

## Security Considerations

1. **Never commit tokens.** Use environment variables or a secrets manager.
2. **HTTPS only.** All API calls must use TLS. WebSocket uses `wss://`.
3. **Validate webhook signatures.** Use HMAC-SHA256 with your webhook secret
   to verify `X-Discreet-Signature` on incoming payloads.
4. **Scope tokens narrowly.** Create separate tokens per bot. Revoke unused
   tokens promptly.
5. **Bot messages are visible.** Bots interact through normal channels.
   Anything a bot sends is visible to channel members.

---

## License

Discreet is licensed under AGPL-3.0-or-later. Bots that interact via the
public API are not derivative works and may use any license. Bots that
link against Discreet's Rust/WASM libraries must comply with AGPL-3.0.

Copyright (C) 2024-2026 Discreet contributors.
