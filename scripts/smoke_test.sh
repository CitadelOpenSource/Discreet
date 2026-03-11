#!/usr/bin/env bash
set -euo pipefail
# ============================================================
# CITADEL SMOKE TEST — Full end-to-end user journey
#
# Tests: register → login → create server → create invite →
#        friend joins → create channel → send encrypted message →
#        get messages → WebSocket → edit → delete → logout
#
# Usage:
#   ./scripts/smoke_test.sh [base_url]
#   ./scripts/smoke_test.sh http://localhost:3000
#
# Prerequisites:
#   - Server running (cargo run)
#   - curl and jq installed
# ============================================================

BASE="${1:-http://localhost:3000}"
API="$BASE/api/v1"
PASS=0
FAIL=0
TOTAL=0

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
CYAN='\033[0;36m'
YELLOW='\033[0;33m'
BOLD='\033[1m'
DIM='\033[2m'
NC='\033[0m'

check() {
    TOTAL=$((TOTAL + 1))
    local name="$1"
    local expected_status="$2"
    local method="$3"
    local url="$4"
    shift 4
    local extra_args=("$@")

    RESPONSE=$(curl -s -w "\n%{http_code}" "${extra_args[@]}" -X "$method" "$url" 2>/dev/null)
    HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
    BODY=$(echo "$RESPONSE" | sed '$d')

    if [ "$HTTP_CODE" = "$expected_status" ]; then
        echo -e "  ${GREEN}✓${NC} ${name} ${DIM}(${HTTP_CODE})${NC}"
        PASS=$((PASS + 1))
    else
        echo -e "  ${RED}✗${NC} ${name} — expected ${expected_status}, got ${HTTP_CODE}"
        echo -e "    ${DIM}${BODY}${NC}" | head -3
        FAIL=$((FAIL + 1))
    fi
}

# Helper: extract JSON field
jq_val() { echo "$BODY" | jq -r "$1" 2>/dev/null; }

echo ""
echo -e "${BOLD}🏰 CITADEL SMOKE TEST${NC}"
echo -e "${DIM}Target: ${BASE}${NC}"
echo ""

# ── 0. HEALTH CHECK ─────────────────────────────────────────
echo -e "${CYAN}[0] Health Check${NC}"
check "GET /health" "200" GET "$BASE/health"

# ── 1. REGISTRATION ─────────────────────────────────────────
echo ""
echo -e "${CYAN}[1] Registration${NC}"

ALICE_USER="alice_$(date +%s)"
ALICE_PASS="StrongPassword123!"
ALICE_EMAIL="${ALICE_USER}@test.citadel.rs"

check "Register Alice" "201" POST "$API/auth/register" \
    -H "Content-Type: application/json" \
    -d "{\"username\":\"${ALICE_USER}\",\"password\":\"${ALICE_PASS}\",\"email\":\"${ALICE_EMAIL}\"}"

ALICE_TOKEN=$(jq_val '.access_token')
ALICE_REFRESH=$(jq_val '.refresh_token')

if [ "$ALICE_TOKEN" = "null" ] || [ -z "$ALICE_TOKEN" ]; then
    echo -e "  ${RED}✗ FATAL: No access token. Cannot continue.${NC}"
    echo -e "    Response: $BODY"
    exit 1
fi
echo -e "  ${DIM}  Token: ${ALICE_TOKEN:0:20}...${NC}"

# Register Bob
BOB_USER="bob_$(date +%s)"
check "Register Bob" "201" POST "$API/auth/register" \
    -H "Content-Type: application/json" \
    -d "{\"username\":\"${BOB_USER}\",\"password\":\"AnotherStrong456!\",\"email\":\"${BOB_USER}@test.citadel.rs\"}"

BOB_TOKEN=$(jq_val '.access_token')

# Duplicate username
check "Reject duplicate username" "409" POST "$API/auth/register" \
    -H "Content-Type: application/json" \
    -d "{\"username\":\"${ALICE_USER}\",\"password\":\"Whatever123!\"}"

# Bad password
check "Reject short password" "400" POST "$API/auth/register" \
    -H "Content-Type: application/json" \
    -d "{\"username\":\"tmp_$(date +%s)\",\"password\":\"short\"}"

# ── 2. LOGIN / LOGOUT / REFRESH ─────────────────────────────
echo ""
echo -e "${CYAN}[2] Auth Flow${NC}"

check "Login Alice (username)" "200" POST "$API/auth/login" \
    -H "Content-Type: application/json" \
    -d "{\"login\":\"${ALICE_USER}\",\"password\":\"${ALICE_PASS}\"}"

ALICE_TOKEN=$(jq_val '.access_token')
ALICE_REFRESH=$(jq_val '.refresh_token')

check "Login Alice (email)" "200" POST "$API/auth/login" \
    -H "Content-Type: application/json" \
    -d "{\"login\":\"${ALICE_EMAIL}\",\"password\":\"${ALICE_PASS}\"}"

check "Wrong password" "401" POST "$API/auth/login" \
    -H "Content-Type: application/json" \
    -d "{\"login\":\"${ALICE_USER}\",\"password\":\"wrong\"}"

check "Refresh token" "200" POST "$API/auth/refresh" \
    -H "Content-Type: application/json" \
    -d "{\"refresh_token\":\"${ALICE_REFRESH}\"}"

ALICE_TOKEN=$(jq_val '.access_token')

check "List sessions" "200" GET "$API/auth/sessions" \
    -H "Authorization: Bearer ${ALICE_TOKEN}"

SESSION_COUNT=$(echo "$BODY" | jq 'length' 2>/dev/null || echo "?")
echo -e "  ${DIM}  Active sessions: ${SESSION_COUNT}${NC}"

# ── 3. SERVER LIFECYCLE ──────────────────────────────────────
echo ""
echo -e "${CYAN}[3] Server CRUD${NC}"

check "Create server" "201" POST "$API/servers" \
    -H "Authorization: Bearer ${ALICE_TOKEN}" \
    -H "Content-Type: application/json" \
    -d '{"name":"Smoke Test Server","description":"Integration test"}'

SERVER_ID=$(jq_val '.id')
echo -e "  ${DIM}  Server: ${SERVER_ID}${NC}"

check "List my servers" "200" GET "$API/servers" \
    -H "Authorization: Bearer ${ALICE_TOKEN}"

check "Get server details" "200" GET "$API/servers/${SERVER_ID}" \
    -H "Authorization: Bearer ${ALICE_TOKEN}"

OWNER_ID=$(jq_val '.owner_id')
echo -e "  ${DIM}  Owner: ${OWNER_ID}${NC}"

check "Update server name" "200" PATCH "$API/servers/${SERVER_ID}" \
    -H "Authorization: Bearer ${ALICE_TOKEN}" \
    -H "Content-Type: application/json" \
    -d '{"name":"Smoke Test Server (updated)"}'

# ── 4. INVITE + JOIN ─────────────────────────────────────────
echo ""
echo -e "${CYAN}[4] Invite & Join${NC}"

check "Create invite" "201" POST "$API/servers/${SERVER_ID}/invites" \
    -H "Authorization: Bearer ${ALICE_TOKEN}" \
    -H "Content-Type: application/json" \
    -d '{"max_uses":5,"expires_in_hours":24}'

INVITE_CODE=$(jq_val '.code')
echo -e "  ${DIM}  Invite code: ${INVITE_CODE}${NC}"

check "List invites (owner)" "200" GET "$API/servers/${SERVER_ID}/invites" \
    -H "Authorization: Bearer ${ALICE_TOKEN}"

check "Bob joins via invite" "204" POST "$API/servers/${SERVER_ID}/join" \
    -H "Authorization: Bearer ${BOB_TOKEN}" \
    -H "Content-Type: application/json" \
    -d "{\"invite_code\":\"${INVITE_CODE}\"}"

check "Bob already a member (conflict)" "409" POST "$API/servers/${SERVER_ID}/join" \
    -H "Authorization: Bearer ${BOB_TOKEN}" \
    -H "Content-Type: application/json" \
    -d "{\"invite_code\":\"${INVITE_CODE}\"}"

check "List server members" "200" GET "$API/servers/${SERVER_ID}/members" \
    -H "Authorization: Bearer ${ALICE_TOKEN}"

MEMBER_COUNT=$(echo "$BODY" | jq 'length' 2>/dev/null || echo "?")
echo -e "  ${DIM}  Members: ${MEMBER_COUNT}${NC}"

# ── 5. CHANNELS ──────────────────────────────────────────────
echo ""
echo -e "${CYAN}[5] Channels${NC}"

check "List channels (auto #general)" "200" GET "$API/servers/${SERVER_ID}/channels" \
    -H "Authorization: Bearer ${ALICE_TOKEN}"

GENERAL_ID=$(echo "$BODY" | jq -r '.[0].id' 2>/dev/null)
echo -e "  ${DIM}  #general: ${GENERAL_ID}${NC}"

check "Create #dev channel" "201" POST "$API/servers/${SERVER_ID}/channels" \
    -H "Authorization: Bearer ${ALICE_TOKEN}" \
    -H "Content-Type: application/json" \
    -d '{"name":"Development","topic":"Code talk","channel_type":"text"}'

DEV_CHANNEL_ID=$(jq_val '.id')
echo -e "  ${DIM}  #development: ${DEV_CHANNEL_ID}${NC}"

check "Get channel details" "200" GET "$API/channels/${DEV_CHANNEL_ID}" \
    -H "Authorization: Bearer ${ALICE_TOKEN}"

check "Update channel topic" "200" PATCH "$API/channels/${DEV_CHANNEL_ID}" \
    -H "Authorization: Bearer ${ALICE_TOKEN}" \
    -H "Content-Type: application/json" \
    -d '{"topic":"Architecture and code review"}'

# ── 6. MESSAGES (ZERO-KNOWLEDGE) ────────────────────────────
echo ""
echo -e "${CYAN}[6] Messages (Zero-Knowledge)${NC}"
echo -e "  ${DIM}  NOTE: In production, ciphertext is MLS ApplicationMessage.${NC}"
echo -e "  ${DIM}  For smoke test, we send base64-encoded test data.${NC}"

# Encode a "fake ciphertext" — the server can't read this.
# In reality, the client encrypts with MLS before sending.
CIPHERTEXT_1=$(echo -n "ENCRYPTED:Hello from Alice! This is E2EE." | base64 | tr -d '\n')
CIPHERTEXT_2=$(echo -n "ENCRYPTED:Bob's reply. Server sees only bytes." | base64 | tr -d '\n')

check "Alice sends message" "201" POST "$API/channels/${GENERAL_ID}/messages" \
    -H "Authorization: Bearer ${ALICE_TOKEN}" \
    -H "Content-Type: application/json" \
    -d "{\"content_ciphertext\":\"${CIPHERTEXT_1}\",\"mls_epoch\":0}"

MSG_ID=$(jq_val '.id')
echo -e "  ${DIM}  Message: ${MSG_ID}${NC}"

check "Bob sends message" "201" POST "$API/channels/${GENERAL_ID}/messages" \
    -H "Authorization: Bearer ${BOB_TOKEN}" \
    -H "Content-Type: application/json" \
    -d "{\"content_ciphertext\":\"${CIPHERTEXT_2}\",\"mls_epoch\":0}"

check "Get message history" "200" GET "$API/channels/${GENERAL_ID}/messages?limit=10" \
    -H "Authorization: Bearer ${ALICE_TOKEN}"

MSG_COUNT=$(echo "$BODY" | jq '.messages | length' 2>/dev/null || echo "?")
echo -e "  ${DIM}  Messages retrieved: ${MSG_COUNT}${NC}"

# Verify server stored ciphertext (not plaintext)
STORED=$(echo "$BODY" | jq -r '.messages[0].content_ciphertext' 2>/dev/null)
if echo "$STORED" | base64 -d 2>/dev/null | grep -q "ENCRYPTED:"; then
    echo -e "  ${YELLOW}⚠${NC}  Server stored base64 blob (expected — no real MLS yet)"
else
    echo -e "  ${GREEN}✓${NC}  Server returned opaque ciphertext"
fi

# Edit
CIPHERTEXT_EDIT=$(echo -n "ENCRYPTED:Edited message from Alice." | base64 | tr -d '\n')
check "Edit message (author)" "204" PATCH "$API/messages/${MSG_ID}" \
    -H "Authorization: Bearer ${ALICE_TOKEN}" \
    -H "Content-Type: application/json" \
    -d "{\"content_ciphertext\":\"${CIPHERTEXT_EDIT}\",\"mls_epoch\":1}"

# Delete
check "Delete message (author)" "204" DELETE "$API/messages/${MSG_ID}" \
    -H "Authorization: Bearer ${ALICE_TOKEN}"

# ── 7. ROLES (RBAC) ─────────────────────────────────────────
echo ""
echo -e "${CYAN}[7] Roles & Permissions${NC}"

check "List roles (includes @everyone)" "200" GET "$API/servers/${SERVER_ID}/roles" \
    -H "Authorization: Bearer ${ALICE_TOKEN}"

ROLE_COUNT=$(echo "$BODY" | jq 'length' 2>/dev/null || echo "?")
echo -e "  ${DIM}  Roles: ${ROLE_COUNT} (should include @everyone)${NC}"

check "Create 'Moderator' role" "201" POST "$API/servers/${SERVER_ID}/roles" \
    -H "Authorization: Bearer ${ALICE_TOKEN}" \
    -H "Content-Type: application/json" \
    -d '{"name":"Moderator","color":"#FF6B81","permissions":7175}'

MOD_ROLE_ID=$(jq_val '.id')

# Get Bob's user_id from the members list
check "Get members for role assignment" "200" GET "$API/servers/${SERVER_ID}/members" \
    -H "Authorization: Bearer ${ALICE_TOKEN}"

BOB_UID=$(echo "$BODY" | jq -r ".[] | select(.username==\"${BOB_USER}\") | .user_id" 2>/dev/null)

if [ -n "$BOB_UID" ] && [ "$BOB_UID" != "null" ]; then
    check "Assign Moderator to Bob" "204" PUT "$API/servers/${SERVER_ID}/members/${BOB_UID}/roles/${MOD_ROLE_ID}" \
        -H "Authorization: Bearer ${ALICE_TOKEN}"

    check "List Bob's roles" "200" GET "$API/servers/${SERVER_ID}/members/${BOB_UID}/roles" \
        -H "Authorization: Bearer ${ALICE_TOKEN}"
else
    echo -e "  ${YELLOW}⚠${NC}  Skipped role assignment (couldn't find Bob's user_id)"
fi

# ── 8. FILE UPLOAD (ENCRYPTED) ──────────────────────────────
echo ""
echo -e "${CYAN}[8] Encrypted File Upload${NC}"

FILE_BLOB=$(echo -n "ENCRYPTED_FILE_CONTENT:This is an encrypted PDF" | base64 | tr -d '\n')

check "Upload encrypted file" "201" POST "$API/channels/${GENERAL_ID}/files" \
    -H "Authorization: Bearer ${ALICE_TOKEN}" \
    -H "Content-Type: application/json" \
    -d "{\"encrypted_blob\":\"${FILE_BLOB}\",\"mime_type_hint\":\"application/pdf\"}"

FILE_ID=$(jq_val '.id')

if [ -n "$FILE_ID" ] && [ "$FILE_ID" != "null" ]; then
    check "Download encrypted file" "200" GET "$API/files/${FILE_ID}" \
        -H "Authorization: Bearer ${ALICE_TOKEN}"
fi

# ── 9. CLEANUP ───────────────────────────────────────────────
echo ""
echo -e "${CYAN}[9] Cleanup${NC}"

check "Bob leaves server" "204" POST "$API/servers/${SERVER_ID}/leave" \
    -H "Authorization: Bearer ${BOB_TOKEN}"

check "Owner cannot leave" "400" POST "$API/servers/${SERVER_ID}/leave" \
    -H "Authorization: Bearer ${ALICE_TOKEN}"

check "Delete channel (not last)" "204" DELETE "$API/channels/${DEV_CHANNEL_ID}" \
    -H "Authorization: Bearer ${ALICE_TOKEN}"

check "Cannot delete last channel" "400" DELETE "$API/channels/${GENERAL_ID}" \
    -H "Authorization: Bearer ${ALICE_TOKEN}"

check "Logout Alice" "204" POST "$API/auth/logout" \
    -H "Authorization: Bearer ${ALICE_TOKEN}"

check "Token rejected after logout" "401" GET "$API/servers" \
    -H "Authorization: Bearer ${ALICE_TOKEN}"

# ── 10. WEBSOCKET (BASIC) ───────────────────────────────────
echo ""
echo -e "${CYAN}[10] WebSocket${NC}"
# Log back in for WS test
curl -s -X POST "$API/auth/login" \
    -H "Content-Type: application/json" \
    -d "{\"login\":\"${BOB_USER}\",\"password\":\"AnotherStrong456!\"}" > /tmp/citadel_ws_login.json

WS_TOKEN=$(jq -r '.access_token' /tmp/citadel_ws_login.json 2>/dev/null)

if command -v websocat >/dev/null 2>&1 && [ -n "$WS_TOKEN" ] && [ "$WS_TOKEN" != "null" ]; then
    # Re-join Bob to the server for WS test
    curl -s -X POST "$API/servers/${SERVER_ID}/join" \
        -H "Authorization: Bearer ${WS_TOKEN}" \
        -H "Content-Type: application/json" \
        -d "{\"invite_code\":\"${INVITE_CODE}\"}" >/dev/null 2>&1

    # Connect WebSocket with timeout
    WS_URL="ws://localhost:3000/ws?server_id=${SERVER_ID}"
    WS_MSG=$(echo "" | timeout 3 websocat -H "Authorization: Bearer ${WS_TOKEN}" "$WS_URL" 2>/dev/null | head -1)

    if echo "$WS_MSG" | jq -e '.type == "connected"' >/dev/null 2>&1; then
        TOTAL=$((TOTAL + 1))
        PASS=$((PASS + 1))
        echo -e "  ${GREEN}✓${NC} WebSocket connected + received welcome"
    else
        TOTAL=$((TOTAL + 1))
        FAIL=$((FAIL + 1))
        echo -e "  ${RED}✗${NC} WebSocket did not return welcome message"
    fi
else
    echo -e "  ${YELLOW}⚠${NC}  Skipped (websocat not installed: cargo install websocat)"
fi

# ── RESULTS ──────────────────────────────────────────────────
echo ""
echo -e "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
if [ "$FAIL" -eq 0 ]; then
    echo -e "${GREEN}${BOLD}  🏰 ALL ${TOTAL} TESTS PASSED${NC}"
else
    echo -e "${RED}${BOLD}  ${FAIL}/${TOTAL} TESTS FAILED${NC}"
fi
echo -e "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Delete test server to clean up
if [ -n "${SERVER_ID:-}" ]; then
    # Re-login Alice
    CLEANUP_TOKEN=$(curl -s -X POST "$API/auth/login" \
        -H "Content-Type: application/json" \
        -d "{\"login\":\"${ALICE_USER}\",\"password\":\"${ALICE_PASS}\"}" | jq -r '.access_token' 2>/dev/null)
    if [ -n "$CLEANUP_TOKEN" ] && [ "$CLEANUP_TOKEN" != "null" ]; then
        curl -s -X DELETE "$API/servers/${SERVER_ID}" \
            -H "Authorization: Bearer ${CLEANUP_TOKEN}" >/dev/null 2>&1
        echo -e "${DIM}Cleaned up test server.${NC}"
    fi
fi

exit $FAIL
