# Architecture Diagrams

Visual reference for Discreet's core flows. All diagrams render natively on GitHub.

---

## System Overview

```mermaid
flowchart LR
    subgraph Internet
        CF[Cloudflare\nDDoS · CDN · DNS]
    end

    subgraph Host["Host (Oracle VM / Raspberry Pi)"]
        CA[Caddy\nReverse Proxy\nAuto TLS]

        subgraph App["Rust / Axum"]
            MW[Middleware Stack\nCORS · Rate Limit\nSecurity Headers\nTracing · Compression]
            REST[REST Handlers\n184 endpoints]
            WS[WebSocket\nPer-server broadcast bus]
            AG[Agent Subsystem\nProvider · Memory · Episodic]
        end

        PG[(PostgreSQL\nUsers · Messages\nServers · Channels\nAgent state)]
        RD[(Redis\nJWT sessions\nRevocation sets\nRate-limit counters\nAuth cache TTL 5s)]
    end

    subgraph Client["Client (Browser / Mobile / Desktop)"]
        RC[React 18 + Vite\nor React Native\nor Tauri]
        CR[discreet-crypto WASM\nMLS · Signal · SFrame]
    end

    RC <-->|"HTTPS / WSS\n(ciphertext only)"| CF
    CF <-->|"Proxy"| CA
    CA <-->|"HTTP / WS"| MW
    MW --> REST
    MW --> WS
    REST --> AG
    REST --> PG
    REST --> RD
    WS --> PG
    WS --> RD
    AG --> PG

    RC <--> CR

    style CF fill:#f59e0b,color:#000
    style CA fill:#22c55e,color:#000
    style PG fill:#3b82f6,color:#fff
    style RD fill:#ef4444,color:#fff
    style CR fill:#8b5cf6,color:#fff
```

**Key principle:** The server only ever sees ciphertext. All encryption and decryption happens inside `discreet-crypto` on the client device. The server is a blind relay.

---

## 1. Authentication Flow

```mermaid
sequenceDiagram
    autonumber
    participant B as Browser
    participant S as Axum Server
    participant PG as PostgreSQL
    participant RD as Redis

    B->>S: POST /auth/register<br/>{username, password, email}

    Note over S: Validate username uniqueness

    S->>S: Hash password with Argon2id<br/>(random salt, memory-hard)

    S->>S: Generate user UUID<br/>(check for collisions with deleted accounts)

    S->>PG: INSERT INTO users<br/>(id, username, password_hash, email, ...)

    S->>PG: INSERT INTO sessions<br/>(id, user_id, user_agent, ip, expires_at)

    S->>S: Sign JWT access token<br/>(sub=user_id, sid=session_id, exp=15min)

    S->>S: Sign refresh token<br/>(exp=7 days)

    S->>RD: Store SHA-256(refresh_token)<br/>with session metadata

    S-->>B: 200 OK<br/>{access_token, refresh_token}<br/>+ Set-Cookie (HttpOnly)

    Note over B: Store access token in memory<br/>Store refresh token in cookie

    opt Email provided
        S->>B: Send verification code
    end
```

### Login with 2FA

```mermaid
sequenceDiagram
    autonumber
    participant B as Browser
    participant S as Axum Server
    participant RD as Redis

    B->>S: POST /auth/login<br/>{username, password}

    S->>S: Verify password against Argon2id hash

    alt 2FA not enabled
        S-->>B: 200 OK {access_token, refresh_token}
    else 2FA enabled
        S->>RD: Store pending session token<br/>(random key, TTL 5 min)
        S-->>B: 200 OK {requires_2fa: true, session_token}
        B->>S: POST /auth/2fa/verify<br/>{session_token, totp_code}
        S->>RD: Validate + consume session token
        S->>S: Verify TOTP code against<br/>AES-256-GCM decrypted secret
        S-->>B: 200 OK {access_token, refresh_token}
    end
```

---

## 2. Message Flow

```mermaid
sequenceDiagram
    autonumber
    participant B as Browser
    participant CR as discreet-crypto<br/>(WASM)
    participant S as Axum Server
    participant AM as AutoMod
    participant PG as PostgreSQL
    participant WS as WebSocket Bus
    participant R as Other Clients

    Note over B,CR: Client-side encryption

    B->>CR: Encrypt plaintext message
    CR->>CR: MLS ApplicationMessage<br/>(group epoch key)
    CR-->>B: Base64-encoded ciphertext

    B->>S: POST /channels/{id}/messages<br/>{content_ciphertext, mls_epoch}

    Note over S: Validate JWT · check permissions<br/>PERM_SEND_MESSAGES

    S->>S: Validate ciphertext<br/>(non-empty, ≤256 KB)

    alt Server channel (not DM)
        S->>AM: AutoMod check
        alt Rule violation
            AM-->>S: Delete → 403 Forbidden
        else Warning
            AM-->>S: Allow + emit warning event
        else Clean
            AM-->>S: Allow
        end
    end

    S->>PG: INSERT INTO messages<br/>(id, channel_id, author_id,<br/>content_ciphertext, mls_epoch)

    S->>WS: Broadcast to server bus<br/>{type: message_create,<br/>channel_id, message_id, author_id}

    WS-->>R: WebSocket event<br/>(all connected members)

    R->>S: GET /channels/{id}/messages<br/>(fetch ciphertext)
    S-->>R: {content_ciphertext, mls_epoch}

    R->>CR: Decrypt ciphertext
    CR->>CR: MLS decrypt with<br/>local leaf key
    CR-->>R: Plaintext message

    Note over R: Display in UI
```

### Message broadcast detail

```mermaid
flowchart TD
    MSG[New message inserted] --> BUS["tokio::broadcast::Sender&lt;String&gt;\n(one per server)"]
    BUS --> WS1[WebSocket client 1]
    BUS --> WS2[WebSocket client 2]
    BUS --> WS3[WebSocket client N]
    BUS -.->|zero receivers?| DROP[Silently dropped\nnormal behavior]

    style BUS fill:#3b82f6,color:#fff
    style DROP fill:#6b7280,color:#fff
```

---

## 3. AI Agent Flow

```mermaid
sequenceDiagram
    autonumber
    participant U as User
    participant S as Axum Server
    participant PG as PostgreSQL
    participant MEM as Memory Module
    participant P as Provider API<br/>(Anthropic / OpenAI / Ollama)
    participant WS as WebSocket Bus

    U->>S: Message mentioning @BotName<br/>(or trigger keyword, or DM)

    S->>S: should_agent_respond()<br/>Check name / UUID / keywords / DM

    alt No match
        Note over S: Normal message flow only
    else Match found
        S->>S: Spawn async background task<br/>(non-blocking)

        rect rgb(30, 35, 50)
            Note over S,P: Background task (does not block sender)

            S->>PG: Load agent config<br/>(provider, model, system prompt)
            S->>S: Decrypt API key<br/>AES-256-GCM with derived key

            S->>MEM: Load context

            alt SlidingWindow mode (default)
                MEM->>PG: Last N messages (default 20, max 100)<br/>Cap 4,000 chars/msg, 100K total
            else Summary mode
                MEM->>PG: Last N messages + stored summary
            else None mode
                Note over MEM: No context loaded
            end

            MEM->>MEM: Anonymize users → "User 1", "User 2"
            MEM->>MEM: Label roles (user / assistant)
            MEM->>MEM: Merge consecutive same-role messages

            opt Episodic memory available
                MEM->>PG: Load encrypted facts<br/>(max 200 per agent-channel)
                MEM->>MEM: Decrypt facts with derived key<br/>Inject as system message (≤8K chars)
            end

            MEM-->>S: Formatted messages array

            S->>P: POST /v1/messages<br/>{system prompt + safety preamble,<br/>messages, model, temp=0.7,<br/>max_tokens=1024}

            P-->>S: LLM response text

            S->>S: Sanitize response<br/>• Enforce safety preamble rules<br/>• Cap at 1,024 tokens<br/>• Add AI disclosure text

            S->>PG: INSERT INTO messages<br/>(author_id=bot_user_id,<br/>mls_epoch=0)

            S->>WS: Broadcast message_create

            opt Every K messages (default 10)
                S->>P: Episodic memory extraction prompt
                P-->>S: JSON array of facts<br/>{category, content, confidence}
                S->>S: Encrypt each fact<br/>AES-256-GCM per agent-channel key
                S->>PG: Upsert agent_episodic_facts<br/>(evict oldest if >200)
            end
        end
    end
```

### Agent provider architecture

```mermaid
flowchart TD
    subgraph Trigger
        MENTION["@BotName mention"]
        KEYWORD[Trigger keyword]
        DM[Direct message]
    end

    MENTION --> EVAL{should_agent_respond?}
    KEYWORD --> EVAL
    DM --> EVAL

    EVAL -->|Yes| CTX[Build Context]

    CTX --> SW[SlidingWindow\nLast N messages]
    CTX --> SUM[Summary\nWindow + compressed history]
    CTX --> NONE[None\nStateless]

    SW --> ANON[Anonymize + format]
    SUM --> ANON
    NONE --> ANON

    ANON --> EPIS{Episodic memory?}
    EPIS -->|Yes| INJECT[Inject decrypted facts\nas system message]
    EPIS -->|No| CALL

    INJECT --> CALL

    CALL --> PROV{Provider}
    PROV --> ANTH[Anthropic\nclaude-haiku-4-5]
    PROV --> OAI[OpenAI\ngpt-4o-mini]
    PROV --> OLL[Ollama\nllama3 local]
    PROV --> MCP[MCP Server]
    PROV --> CUST[Custom endpoint]

    ANTH --> RESP[Sanitize + post response]
    OAI --> RESP
    OLL --> RESP
    MCP --> RESP
    CUST --> RESP

    RESP --> BROADCAST[Broadcast via WebSocket]
    RESP --> EXTRACT[Episodic memory extraction\nevery K messages]

    style EVAL fill:#f59e0b,color:#000
    style PROV fill:#3b82f6,color:#fff
    style RESP fill:#22c55e,color:#000
    style EXTRACT fill:#8b5cf6,color:#fff
```

---

## 4. Session Lifecycle

```mermaid
stateDiagram-v2
    [*] --> Login: POST /auth/login

    Login --> TwoFA: 2FA enabled
    Login --> Active: 2FA disabled

    TwoFA --> Active: TOTP verified\n(5 min window)
    TwoFA --> [*]: Timeout / invalid code

    Active --> Active: Silent refresh\nPOST /auth/refresh\n(before 15 min expiry)

    Active --> Reauth: Sensitive operation\n(password change, 2FA, sessions)
    Reauth --> Active: POST /auth/verify-password\n(single-use token, 5 min TTL)

    Active --> Revoked: Logout\nPOST /auth/logout
    Active --> Revoked: Password changed\n(all other sessions)
    Active --> Revoked: Admin ban
    Active --> Expired: JWT expires\n+ refresh expires

    Revoked --> [*]
    Expired --> [*]
```

### Session validation on every request

```mermaid
flowchart TD
    REQ[Incoming request\nwith JWT] --> PARSE[Parse & verify JWT\nsub, sid, exp]

    PARSE -->|Invalid / expired| R401[401 Unauthorized\nClient triggers refresh]

    PARSE -->|Valid| REDIS{Redis:\nSISMEMBER\nrevoked_sessions:user_id\nsid}

    REDIS -->|Revoked| R401

    REDIS -->|Not revoked| DB{PostgreSQL:\nSELECT sessions\nWHERE id=sid\nAND revoked_at IS NULL\nAND expires_at > NOW}

    DB -->|Not found| R401

    DB -->|Found| CACHE{Redis cache:\nauth_user:user_id\nTTL 5s}

    CACHE -->|Hit| LOAD[Load cached user state\ntier, verified, banned]
    CACHE -->|Miss| DBUSER[Query users table\nCache result 5s]

    DBUSER --> BANNED{is_banned?}
    LOAD --> BANNED

    BANNED -->|Yes| R403[403 Forbidden]
    BANNED -->|No| OK[Request proceeds\nAuthUser extractor populated]

    style R401 fill:#ef4444,color:#fff
    style R403 fill:#ef4444,color:#fff
    style OK fill:#22c55e,color:#000
```

### Token timeline

```mermaid
gantt
    title Session Token Lifecycle
    dateFormat HH:mm
    axisFormat %H:%M

    section Access Token
    JWT valid (15 min)          :active, jwt1, 00:00, 15min
    Refresh → new JWT           :crit, r1, after jwt1, 1min
    JWT valid (15 min)          :active, jwt2, after r1, 15min
    Refresh → new JWT           :crit, r2, after jwt2, 1min
    JWT valid (15 min)          :active, jwt3, after r2, 15min

    section Refresh Token
    Refresh token valid (7 days) :done, ref, 00:00, 168h

    section Device Session
    Session record in DB         :done, sess, 00:00, 168h
```

---

## Encryption Layers

```mermaid
flowchart TD
    subgraph Transport["Transport Layer"]
        TLS["TLS 1.3\n(Cloudflare → Caddy)"]
    end

    subgraph Application["Application Layer (per channel type)"]
        MLS["MLS (RFC 9420)\nGroup channels\nTreeKEM key agreement\nO(log n) rotation"]
        SIG["Signal Protocol\nDirect messages\nX3DH + Double Ratchet"]
        SF["SFrame (RFC 9605)\nVoice / Video\nPer-frame encryption"]
    end

    subgraph AtRest["At Rest"]
        AES["AES-256-GCM\nTOTP secrets\nAgent API keys\nEpisodic memory facts"]
        ARG["Argon2id\nPassword hashes"]
    end

    subgraph Future["Post-Quantum (feature flag)"]
        MLKEM["ML-KEM (FIPS 203)\nKey encapsulation"]
        MLDSA["ML-DSA (FIPS 204)\nDigital signatures"]
    end

    TLS --> MLS
    TLS --> SIG
    TLS --> SF

    style Transport fill:#f59e0b,color:#000
    style MLS fill:#3b82f6,color:#fff
    style SIG fill:#3b82f6,color:#fff
    style SF fill:#3b82f6,color:#fff
    style AES fill:#22c55e,color:#000
    style ARG fill:#22c55e,color:#000
    style MLKEM fill:#8b5cf6,color:#fff
    style MLDSA fill:#8b5cf6,color:#fff
```

---

## Database Schema (simplified)

```mermaid
erDiagram
    users ||--o{ sessions : has
    users ||--o{ members : joins
    users ||--o{ messages : writes
    servers ||--o{ channels : contains
    servers ||--o{ members : has
    channels ||--o{ messages : contains
    users ||--o{ bot_configs : configures
    bot_configs ||--o{ agent_episodic_facts : learns
    bot_configs ||--o{ agent_context_summaries : summarizes

    users {
        uuid id PK
        string username
        string password_hash
        string email
        string account_tier
        bool email_verified
    }

    sessions {
        uuid id PK
        uuid user_id FK
        string user_agent
        string ip_address
        timestamp expires_at
        timestamp revoked_at
    }

    servers {
        uuid id PK
        string name
        uuid owner_id FK
    }

    channels {
        uuid id PK
        uuid server_id FK
        string name
        string channel_type
    }

    messages {
        uuid id PK
        uuid channel_id FK
        uuid author_id FK
        bytes content_ciphertext
        int mls_epoch
        timestamp created_at
    }

    members {
        uuid user_id FK
        uuid server_id FK
        bigint permissions
    }

    bot_configs {
        uuid id PK
        uuid server_id FK
        string provider_type
        bytes api_key_encrypted
        string memory_mode
    }

    agent_episodic_facts {
        uuid id PK
        uuid agent_id FK
        uuid channel_id FK
        string category
        bytes encrypted_fact_data
    }

    agent_context_summaries {
        uuid agent_id FK
        uuid channel_id FK
        text summary
    }
```
