# Incident Response Plan

This guide walks you through handling any incident affecting Discreet — from a minor bug report to a full security breach. Follow it step by step, even if you're panicking. Especially if you're panicking.

---

## Severity Levels

| Level | Description | Examples | Response Time | Update Cadence |
|-------|-------------|----------|---------------|----------------|
| **P0** | Service down or active security breach | Server unreachable, database compromised, key material leaked, active exploit in progress | **15 minutes** | Every 30 min until resolved |
| **P1** | Major feature broken, data integrity risk | WebSocket disconnects for all users, messages failing to send/decrypt, auth broken, backups failing | **1 hour** | Every 2 hours |
| **P2** | Degraded experience, workaround exists | Voice calls dropping, slow message delivery, single API endpoint failing, one user locked out | **4 hours** | Daily until resolved |
| **P3** | Minor issue, cosmetic, or feature request | UI glitch, typo, non-critical log warning, minor performance regression | **Next business day** | As needed |

### How to determine severity

Ask yourself these questions in order:

1. **Can users send and receive messages?** No → P0
2. **Is there any chance private data has been exposed?** Yes → P0
3. **Is a core feature (auth, messaging, voice) broken for everyone?** Yes → P1
4. **Is a core feature broken for some users?** Yes → P2
5. **Everything else** → P3

When in doubt, **round up**. A P2 that turns out to be a P3 costs you nothing. A P0 you treated as P2 costs you everything.

---

## Escalation Paths

### Solo operator (default for self-hosters)

You're the only responder. That's fine. Here's your checklist:

```
1. Acknowledge the incident (write it down — timestamp, what you know)
2. Determine severity using the table above
3. If P0/P1: send status update IMMEDIATELY (templates below)
4. Investigate and fix
5. Send resolution update
6. Do a post-incident review within 48 hours
```

### If you have a team

| Step | Who | Action |
|------|-----|--------|
| 1. Detection | Anyone | Open an incident channel/thread, ping the on-call person |
| 2. Triage | On-call | Determine severity, assign incident commander (IC) |
| 3. Communication | IC | Post status update using templates below |
| 4. Investigation | IC + engineers | Diagnose root cause, work the fix |
| 5. Resolution | IC | Deploy fix, verify, update status |
| 6. Review | IC | Schedule post-incident review within 48 hours |

### When to get outside help

- **Security breach with user data exposure**: Consult a lawyer before making any public statement (see Legal section below)
- **Can't restore from backup**: If you've exhausted this guide and DISASTER_RECOVERY.md, post in the Discreet community with sanitized details (no secrets, no user data)
- **Suspected law enforcement access**: Contact a lawyer immediately. Do not speculate publicly

---

## Communication Templates

Adapt these to your situation. Replace `[bracketed text]` with specifics. Be honest — users respect transparency far more than spin.

### Status Page / Announcement Channel

**Investigating:**
```
[INVESTIGATING] We're aware of [brief description of the issue] affecting
[who/what is affected]. We're actively investigating and will provide updates
every [cadence from severity table].

Started: [timestamp with timezone]
Severity: [P0/P1/P2/P3]
Impact: [what users will experience]
```

**Update:**
```
[UPDATE] [Brief description of what we've learned and what we're doing about it].
[Expected next update time or resolution ETA if known].

No action is required from users at this time.
(or: Users may need to [specific action, e.g., refresh, re-login].)
```

**Resolved:**
```
[RESOLVED] [Brief description of the issue] has been resolved.
[Root cause in one sentence]. [What we're doing to prevent recurrence].

Duration: [start time] to [end time] ([total duration])
Impact: [summary of what was affected]

We'll publish a full post-incident review within 48 hours.
```

### Twitter / Social Media

**Investigating (keep it short):**
```
We're aware of an issue affecting [service]. Investigating now.
Updates: [link to status page]
```

**Resolved:**
```
The issue affecting [service] has been resolved. [Duration].
Root cause: [one sentence]. Details: [link to post-incident review]
```

### Email (for registered users, P0/P1 only)

**Subject:** `[Discreet] Service incident — [brief description]`

```
Hi,

We're writing to let you know about an incident affecting Discreet.

What happened: [2-3 sentences describing the issue]

What we did: [2-3 sentences describing the fix]

What this means for you:
- [Any action they need to take, or "No action is required"]
- [Any data impact, or "Your encrypted messages were not affected"]

What we're doing to prevent this:
- [Concrete step 1]
- [Concrete step 2]

We take the security and reliability of Discreet seriously. If you have
questions, reply to this email or reach out at [support email].

[Your name]
```

---

## Key Rotation Procedures

If you suspect any secret has been compromised, rotate it immediately. Don't wait to confirm — rotate first, investigate second.

### JWT_SECRET rotation

This will log out all users. That's intentional — if the JWT secret is compromised, all existing sessions must be invalidated.

```bash
# 1. Generate a new secret
NEW_SECRET=$(openssl rand -hex 64)

# 2. Update your .env file
#    Find the line: JWT_SECRET=...
#    Replace with:  JWT_SECRET=<new value>

# 3. Clear all sessions from Redis
docker compose exec redis redis-cli FLUSHDB

# 4. Restart the server
#    If running with systemd:
sudo systemctl restart discreet

#    If running with Docker:
docker compose restart app

# 5. Verify
curl http://localhost:3000/health
# Should return 200 OK

# 6. Notify users
# "We've performed a security rotation. You'll need to log in again."
```

### TOTP_ENCRYPTION_KEY rotation

This is more involved — all stored TOTP secrets are encrypted with this key.

```bash
# 1. THIS WILL BREAK 2FA FOR ALL USERS
#    You need to re-encrypt all TOTP secrets with the new key.
#    If you can't do that, users will need to re-enroll 2FA.

# 2. Generate new key
NEW_TOTP_KEY=$(openssl rand -hex 32)

# 3. Update .env
#    TOTP_ENCRYPTION_KEY=<new value>

# 4. Restart server
sudo systemctl restart discreet

# 5. Notify affected users they need to re-setup 2FA
```

### AGENT_KEY_SECRET rotation

```bash
# 1. Generate new key
NEW_AGENT_KEY=$(openssl rand -hex 32)

# 2. Update .env
#    AGENT_KEY_SECRET=<new value>

# 3. All stored agent API keys will become unreadable.
#    Server operators will need to re-enter API keys for any
#    configured AI agents.

# 4. Restart server
sudo systemctl restart discreet
```

### Database password rotation

```bash
# 1. Update PostgreSQL password
docker compose exec postgres psql -U citadel -c "ALTER USER citadel PASSWORD 'new_password_here';"

# 2. Update DATABASE_URL in .env
#    DATABASE_URL=postgresql://citadel:new_password_here@localhost:5432/citadel

# 3. Restart the server
sudo systemctl restart discreet

# 4. Verify database connectivity
curl http://localhost:3000/health
```

### TLS certificate rotation

```bash
# If using Let's Encrypt with certbot:
sudo certbot renew --force-renewal

# If using a reverse proxy (nginx/caddy), reload it:
sudo systemctl reload nginx
# or
sudo systemctl reload caddy
```

---

## Post-Incident Review Template

Complete this within 48 hours of resolution. Be blameless — the goal is to improve systems, not assign fault.

```markdown
# Post-Incident Review: [Title]

**Date:** [YYYY-MM-DD]
**Severity:** [P0/P1/P2/P3]
**Duration:** [start time] to [end time] ([total minutes/hours])
**Author:** [your name]

## Summary
[2-3 sentences: what happened, what was the impact, how was it resolved]

## Timeline (all times in UTC)
| Time | Event |
|------|-------|
| HH:MM | [First sign of the issue] |
| HH:MM | [Issue detected / alert fired / user report] |
| HH:MM | [Investigation started] |
| HH:MM | [Root cause identified] |
| HH:MM | [Fix deployed] |
| HH:MM | [Service restored and verified] |

## Root Cause
[What actually broke and why. Be specific. "The server crashed" is not a
root cause. "PostgreSQL ran out of connections because the connection pool
max was set to 10 and a burst of 50 WebSocket reconnections each opened
a new connection" is a root cause.]

## Impact
- Users affected: [number or "all"]
- Messages lost: [number or "none — E2EE means messages are on client devices"]
- Data exposed: [description or "none"]
- Duration of impact: [minutes/hours]

## What Went Well
- [Thing that helped, e.g., "backups were recent and restore worked first try"]
- [Thing that helped, e.g., "health check endpoint made it easy to verify fix"]

## What Went Poorly
- [Thing that hurt, e.g., "no alerting — found out from user report 2 hours late"]
- [Thing that hurt, e.g., "had to look up restore procedure during the incident"]

## Action Items
| Action | Owner | Due Date | Status |
|--------|-------|----------|--------|
| [Concrete improvement, e.g., "Add disk space monitoring"] | [name] | [date] | Open |
| [Concrete improvement, e.g., "Automate backup verification"] | [name] | [date] | Open |

## Lessons Learned
[What would you tell past-you to prevent or reduce this incident?]
```

---

## Legal Notification Requirements for Data Breaches

**Important:** Discreet's zero-knowledge architecture means the server never holds plaintext message content. However, the server does store metadata that may constitute personal data under privacy laws:

- Usernames and email addresses
- IP addresses (in logs)
- Server membership lists
- Message timestamps and sender/recipient IDs
- Any uploaded files (encrypted, but still "data")

### When you must notify

If any of the above data is accessed by an unauthorized party, you likely have a legal obligation to notify affected users and possibly regulators, depending on where your users are.

### Notification timelines by jurisdiction

| Jurisdiction | Law | Notification Deadline | Who to Notify |
|---|---|---|---|
| EU/EEA | GDPR (Art. 33-34) | 72 hours to supervisory authority; "without undue delay" to users if high risk | Supervisory authority + affected users |
| California, US | CCPA/CPRA | "In the most expedient time possible" (typically interpreted as 72 hours) | Affected users + CA Attorney General (if >500 residents) |
| Other US states | Varies | Varies (30-90 days typical) | Affected users + state AG |
| Canada | PIPEDA | "As soon as feasible" | Privacy Commissioner + affected users |
| UK | UK GDPR | 72 hours to ICO | ICO + affected users if high risk |

### Step-by-step breach response

```
1. STOP THE BLEEDING
   - Revoke compromised credentials immediately (see Key Rotation above)
   - Take affected systems offline if needed
   - Preserve evidence (don't wipe logs yet)

2. ASSESS THE SCOPE (within first 2 hours)
   - What data was accessed?
   - How many users are affected?
   - How did the attacker get in?
   - Is the vulnerability still open?

3. DOCUMENT EVERYTHING
   Start a log immediately. Write down:
   - When you discovered the breach
   - How you discovered it
   - What you've done so far
   - What data you believe was accessed
   Keep this log — you'll need it for regulators

4. LEGAL CONSULTATION (within first 24 hours)
   - If you have users in the EU: you have 72 hours. Get a lawyer NOW.
   - If you're unsure about jurisdiction: assume the strictest applies
   - Do NOT make public statements until you've consulted legal counsel

5. NOTIFY USERS (per legal advice and timelines above)
   Include in your notification:
   - What happened (factual, no speculation)
   - What data was involved
   - What you've done about it
   - What users should do (change passwords, revoke sessions, etc.)
   - How to contact you with questions

6. NOTIFY REGULATORS (if required by applicable law)
   - EU: Your lead supervisory authority
   - US: State attorney general(s) as applicable
   - Use the regulator's official breach notification form if one exists

7. POST-INCIDENT
   - Complete the post-incident review (template above)
   - Implement action items
   - Consider engaging a third-party security audit
   - Update this document with lessons learned
```

### What Discreet's zero-knowledge design protects you from

Even in a full database compromise:
- **Message content**: Cannot be read. Stored as ciphertext, keys are client-side only.
- **Voice/video content**: Not stored on server at all.
- **MLS key material**: Group keys rotate; compromising stored key packages doesn't decrypt past messages (forward secrecy).

What IS exposed in a database compromise:
- User accounts (usernames, emails, hashed passwords)
- Server/channel structure and membership
- Message metadata (who sent what, when, to which channel)
- Encrypted blobs (useless without client keys, but still "personal data" legally)
