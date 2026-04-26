#!/usr/bin/env bash
# Smoke test: vérifie health, WP auth, et création de session.
# Usage: scripts/smoke.sh [server_url]
set -euo pipefail

SERVER="${1:-http://localhost:3001}"
PASS=0
FAIL=0

check() {
  local name="$1"
  local result="$2"
  if [[ "$result" == "ok" ]]; then
    echo "  ✓ $name"
    PASS=$((PASS+1))
  else
    echo "  ✗ $name — $result"
    FAIL=$((FAIL+1))
  fi
}

echo "→ Smoke test against $SERVER"

# 1. Health
HEALTH=$(curl -fsS "$SERVER/api/health" 2>&1) || HEALTH="$HEALTH (unreachable)"
if echo "$HEALTH" | grep -q '"ok":true'; then
  check "/api/health responds" "ok"
else
  check "/api/health responds" "$HEALTH"
fi

# 2. Anthropic key
if echo "$HEALTH" | grep -q '"anthropicKey":true'; then
  check "ANTHROPIC_API_KEY present" "ok"
else
  check "ANTHROPIC_API_KEY present" "missing in server/.env"
fi

# 3. WP config
if echo "$HEALTH" | grep -q '"wpConfigured":true'; then
  check "WP env vars set" "ok"
else
  check "WP env vars set" "WP_BASE_URL/WP_USER/WP_APP_PASSWORD missing"
fi

# 4. WP auth (only if env present)
if [[ -f server/.env ]] && grep -q "^WP_BASE_URL=" server/.env; then
  WP_URL=$(grep "^WP_BASE_URL=" server/.env | cut -d= -f2- | tr -d '"')
  WP_USER=$(grep "^WP_USER=" server/.env | cut -d= -f2- | tr -d '"')
  WP_PASS=$(grep "^WP_APP_PASSWORD=" server/.env | cut -d= -f2-)
  if curl -fsS -u "$WP_USER:$WP_PASS" "$WP_URL/wp-json/wp/v2/users/me" >/dev/null 2>&1; then
    check "WP API auth" "ok"
  else
    check "WP API auth" "401 or unreachable"
  fi
fi

# 5. Session creation (only if anthropicKey true)
if echo "$HEALTH" | grep -q '"anthropicKey":true'; then
  SESSION=$(curl -fsS -X POST "$SERVER/api/sessions" \
    -H "Content-Type: application/json" \
    -d '{"title":"smoke"}' 2>&1) || SESSION="failed: $SESSION"
  if echo "$SESSION" | grep -q '"id":'; then
    check "POST /api/sessions creates session" "ok"
  else
    check "POST /api/sessions creates session" "$SESSION"
  fi
fi

echo ""
echo "→ $PASS passed, $FAIL failed"
[[ $FAIL -eq 0 ]] || exit 1
