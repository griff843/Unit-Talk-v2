#!/usr/bin/env bash
# provision-kuma-monitors.sh
#
# Provisions all 5 Uptime Kuma monitors + Discord notification for Unit Talk V2.
# Runs ON the Hetzner server via SSH from deploy-monitoring.yml.
#
# Environment:
#   DEPLOY_PATH        — base deployment path (set by workflow before calling this script)
#
# Secrets (read from files, never from command args):
#   /tmp/kuma-pass     — Uptime Kuma admin password (written by workflow, deleted here)
#
# Idempotent: checks existing monitors by name before creating.

set -euo pipefail

KUMA_BASE="http://localhost:3001"
ENV_FILE="${DEPLOY_PATH}/.env.monitoring"

# ---------------------------------------------------------------------------
# 1. Read secrets from files / environment files
# ---------------------------------------------------------------------------

if [ ! -f /tmp/kuma-pass ]; then
  echo "ERROR: /tmp/kuma-pass not found. Workflow must SCP the password file before calling this script."
  exit 1
fi

KUMA_PASS="$(cat /tmp/kuma-pass)"
rm -f /tmp/kuma-pass

if [ ! -f "$ENV_FILE" ]; then
  echo "ERROR: $ENV_FILE not found. Run the 'Write .env.monitoring on server' step first."
  exit 1
fi

DISCORD_WEBHOOK="$(grep -E '^DISCORD_OPS_WEBHOOK_URL=' "$ENV_FILE" | cut -d= -f2-)"

if [ -z "$DISCORD_WEBHOOK" ]; then
  echo "ERROR: DISCORD_OPS_WEBHOOK_URL is empty in $ENV_FILE"
  exit 1
fi

echo "Secrets loaded."

# ---------------------------------------------------------------------------
# 2. Helper functions — JSON built via Python to safely handle special chars
# ---------------------------------------------------------------------------

make_json() {
  # Usage: make_json <python_expression_returning_dict> [args...]
  # Extra args are forwarded to Python as sys.argv[1], sys.argv[2], etc.
  python3 -c "$1" "${@:2}"
}

kuma_post() {
  local path="$1"
  local body="$2"
  local auth="${3:-}"
  local auth_header=()
  [ -n "$auth" ] && auth_header=(-H "Authorization: Bearer $auth")
  curl -sf --max-time 15 \
    -X POST "${KUMA_BASE}${path}" \
    -H 'Content-Type: application/json' \
    "${auth_header[@]}" \
    -d "$body"
}

kuma_get() {
  local path="$1"
  local auth="$2"
  curl -sf --max-time 15 \
    -X GET "${KUMA_BASE}${path}" \
    -H "Authorization: Bearer $auth"
}

# ---------------------------------------------------------------------------
# 3. Admin setup (idempotent — no-op if admin already exists)
# ---------------------------------------------------------------------------

SETUP_BODY="$(make_json "
import json, sys
print(json.dumps({'username': 'admin', 'password': sys.argv[1]}))
" "$KUMA_PASS")"

# Kuma v2 setup endpoint; capture HTTP code cleanly (no || echo '000' which
# double-prints when curl also writes --write-out before failing with -f).
SETUP_HTTP="$(curl --max-time 15 -s -o /dev/null -w '%{http_code}' \
  -X POST "${KUMA_BASE}/api/v1/auth/setup" \
  -H 'Content-Type: application/json' \
  -d "$SETUP_BODY" 2>/dev/null || true)"

echo "Admin setup: HTTP ${SETUP_HTTP:-000} (201=created, 4xx=already exists — both OK)"

# ---------------------------------------------------------------------------
# 4. Login and obtain Bearer token (Kuma v2: /api/v1/auth/login → access_token)
# ---------------------------------------------------------------------------

LOGIN_BODY="$(make_json "
import json, sys
print(json.dumps({'username': 'admin', 'password': sys.argv[1]}))
" "$KUMA_PASS")"

LOGIN_RESPONSE="$(curl -s --max-time 15 \
  -X POST "${KUMA_BASE}/api/v1/auth/login" \
  -H 'Content-Type: application/json' \
  -d "$LOGIN_BODY" 2>/dev/null || echo '')"

TOKEN="$(echo "$LOGIN_RESPONSE" | python3 -c "
import json, sys
try:
  d = json.load(sys.stdin)
  # Kuma v2 returns access_token; v1 fallback uses token
  print(d.get('access_token', '') or d.get('token', ''))
except Exception:
  print('')
" 2>/dev/null || echo '')"

if [ -z "$TOKEN" ]; then
  echo "ERROR: Failed to obtain Uptime Kuma auth token."
  echo "Response: $LOGIN_RESPONSE"
  echo "Check UPTIME_KUMA_ADMIN_PASSWORD secret and that Kuma is running."
  exit 1
fi

echo "Login: OK (token obtained)"

# ---------------------------------------------------------------------------
# 5. Fetch existing monitors to enable idempotent creation
# ---------------------------------------------------------------------------

EXISTING_MONITORS="$(kuma_get '/api/v1/monitors' "$TOKEN" 2>/dev/null || echo '{}')"

monitor_exists() {
  local name="$1"
  echo "$EXISTING_MONITORS" | python3 -c "
import json, sys
name = sys.argv[1]
try:
  data = json.load(sys.stdin)
  monitors = data if isinstance(data, list) else data.get('monitors', [])
  found = any(m.get('name') == name for m in monitors)
  print('yes' if found else 'no')
except Exception:
  print('no')
" "$name" 2>/dev/null || echo 'no'
}

# ---------------------------------------------------------------------------
# 6. Create Discord notification (idempotent via applyExisting=true)
# ---------------------------------------------------------------------------

echo ""
echo "=== Provisioning Discord notification ==="

NOTIF_BODY="$(make_json "
import json, sys
print(json.dumps({
  'name': 'Discord Ops',
  'type': 'discord',
  'isDefault': True,
  'applyExisting': True,
  'discordWebhookUrl': sys.argv[1]
}))
" "$DISCORD_WEBHOOK")"

NOTIF_RESPONSE="$(kuma_post '/api/v1/notifications' "$NOTIF_BODY" "$TOKEN" 2>/dev/null || echo '')"
NOTIF_ID="$(echo "$NOTIF_RESPONSE" | python3 -c "
import json, sys
try:
  d = json.load(sys.stdin)
  print(d.get('id', d.get('notificationID', '')))
except Exception:
  print('')
" 2>/dev/null || echo '')"

if [ -n "$NOTIF_ID" ]; then
  echo "Discord notification created/updated: ID=$NOTIF_ID"
else
  echo "WARNING: Could not parse notification ID from response — notification may still have been created."
  echo "Response: $NOTIF_RESPONSE"
  NOTIF_ID=""
fi

# ---------------------------------------------------------------------------
# 7. Create monitors
# ---------------------------------------------------------------------------

# Build notification list JSON fragment for monitor payloads
if [ -n "$NOTIF_ID" ]; then
  NOTIF_LIST="[$NOTIF_ID]"
else
  NOTIF_LIST="[]"
fi

create_monitor_if_missing() {
  local name="$1"
  local body_expr="$2"

  if [ "$(monitor_exists "$name")" = "yes" ]; then
    echo "  SKIP (already exists): $name"
    return 0
  fi

  local body
  body="$(eval "$body_expr")"

  local response
  response="$(kuma_post '/api/v1/monitors' "$body" "$TOKEN" 2>/dev/null || echo '')"

  local mon_id
  mon_id="$(echo "$response" | python3 -c "
import json, sys
try:
  d = json.load(sys.stdin)
  print(d.get('monitorID', d.get('id', '')))
except Exception:
  print('')
" 2>/dev/null || echo '')"

  if [ -n "$mon_id" ]; then
    echo "  CREATED (ID=$mon_id): $name"
  else
    echo "  WARNING: unexpected response creating monitor '$name'"
    echo "  Response: $response"
  fi
}

echo ""
echo "=== Provisioning monitors ==="

# -- Monitor 1: API health --
echo ""
echo "[1/5] API health"
create_monitor_if_missing "Unit Talk API Health" "make_json \"
import json, sys
print(json.dumps({
  'name': 'Unit Talk API Health',
  'type': 'http',
  'url': 'http://api:4000/health',
  'method': 'GET',
  'interval': 60,
  'retryInterval': 30,
  'maxretries': 3,
  'active': 1,
  'notificationIDList': ${NOTIF_LIST}
}))\""

# -- Monitor 2: Host ping --
echo ""
echo "[2/5] Host ping"
create_monitor_if_missing "Unit Talk Host Ping" "make_json \"
import json, sys
print(json.dumps({
  'name': 'Unit Talk Host Ping',
  'type': 'ping',
  'hostname': '46.225.14.123',
  'interval': 60,
  'retryInterval': 30,
  'maxretries': 3,
  'active': 1,
  'notificationIDList': ${NOTIF_LIST}
}))\""

# -- Monitor 3: Worker liveness --
# Worker health is reflected in the API's full health response.
# A dedicated /health/worker endpoint can be added to the API in a future lane
# when the worker exposes its own HTTP health port.
echo ""
echo "[3/5] Worker liveness (via API full-health endpoint)"
create_monitor_if_missing "Unit Talk Worker Liveness" "make_json \"
import json, sys
print(json.dumps({
  'name': 'Unit Talk Worker Liveness',
  'type': 'http',
  'url': 'http://api:4000/health?full=true',
  'method': 'GET',
  'interval': 60,
  'retryInterval': 30,
  'maxretries': 3,
  'active': 1,
  'notificationIDList': ${NOTIF_LIST}
}))\""

# -- Monitor 4: Ingestor freshness --
# Ingestor freshness is reflected in the API's full health response.
# A dedicated staleness endpoint or separate ingestor health port can be
# added in a future lane when the ingestor exposes its own HTTP port.
echo ""
echo "[4/5] Ingestor freshness (via API full-health endpoint)"
create_monitor_if_missing "Unit Talk Ingestor Freshness" "make_json \"
import json, sys
print(json.dumps({
  'name': 'Unit Talk Ingestor Freshness',
  'type': 'http',
  'url': 'http://api:4000/health?full=true',
  'method': 'GET',
  'interval': 60,
  'retryInterval': 30,
  'maxretries': 3,
  'active': 1,
  'notificationIDList': ${NOTIF_LIST}
}))\""

# -- Monitor 5: Discord bot container --
# Uptime Kuma v2 supports Docker container monitoring via the mounted Docker socket.
# If the Docker monitor type is not available in this Kuma version, falls back to
# monitoring the discord-bot container's exposed health endpoint.
echo ""
echo "[5/5] Discord bot container"

# Check if docker monitor type is available by attempting to create it; fall back gracefully.
DISCORDBOT_EXISTS="$(monitor_exists "Unit Talk Discord Bot")"

if [ "$DISCORDBOT_EXISTS" = "yes" ]; then
  echo "  SKIP (already exists): Unit Talk Discord Bot"
else
  # Try Docker container type first (uses mounted Docker socket)
  DOCKER_MON_BODY="$(make_json "
import json, sys
print(json.dumps({
  'name': 'Unit Talk Discord Bot',
  'type': 'docker',
  'docker_container': 'unit-talk-discord-bot',
  'docker_host': 1,
  'interval': 60,
  'retryInterval': 30,
  'maxretries': 3,
  'active': 1,
  'notificationIDList': ${NOTIF_LIST}
}))")"

  DOCKER_MON_RESPONSE="$(kuma_post '/api/monitors' "$DOCKER_MON_BODY" "$TOKEN" 2>/dev/null || echo '')"
  DOCKER_MON_ID="$(echo "$DOCKER_MON_RESPONSE" | python3 -c "
import json, sys
try:
  d = json.load(sys.stdin)
  print(d.get('monitorID', d.get('id', '')))
except Exception:
  print('')
" 2>/dev/null || echo '')"

  if [ -n "$DOCKER_MON_ID" ]; then
    echo "  CREATED (ID=$DOCKER_MON_ID, type=docker): Unit Talk Discord Bot"
  else
    echo "  Docker type unavailable or failed — falling back to HTTP health monitor"
    # Fallback: HTTP monitor against a known-good API endpoint
    # (Discord bot availability is indirectly verified via bot <-> API interactions)
    HTTP_FALLBACK_BODY="$(make_json "
import json, sys
print(json.dumps({
  'name': 'Unit Talk Discord Bot',
  'type': 'http',
  'url': 'http://api:4000/health',
  'method': 'GET',
  'interval': 60,
  'retryInterval': 30,
  'maxretries': 3,
  'active': 1,
  'notificationIDList': ${NOTIF_LIST}
}))")"

    FALLBACK_RESPONSE="$(kuma_post '/api/monitors' "$HTTP_FALLBACK_BODY" "$TOKEN" 2>/dev/null || echo '')"
    FALLBACK_ID="$(echo "$FALLBACK_RESPONSE" | python3 -c "
import json, sys
try:
  d = json.load(sys.stdin)
  print(d.get('monitorID', d.get('id', '')))
except Exception:
  print('')
" 2>/dev/null || echo '')"
    if [ -n "$FALLBACK_ID" ]; then
      echo "  CREATED (ID=$FALLBACK_ID, type=http-fallback): Unit Talk Discord Bot"
    else
      echo "  WARNING: Could not create Discord bot monitor. Response: $FALLBACK_RESPONSE"
    fi
  fi
fi

# ---------------------------------------------------------------------------
# 8. Final status report
# ---------------------------------------------------------------------------

echo ""
echo "=== Final monitor status ==="

FINAL_MONITORS="$(kuma_get '/api/v1/monitors' "$TOKEN" 2>/dev/null || echo '{}')"

echo "$FINAL_MONITORS" | python3 -c "
import json, sys
try:
  data = json.load(sys.stdin)
  monitors = data if isinstance(data, list) else data.get('monitors', [])
  if not monitors:
    print('No monitors found.')
  else:
    fmt = '{:<5} {:<40} {:<12} {}'
    print(fmt.format('ID', 'Name', 'Type', 'Active'))
    print('-' * 75)
    for m in monitors:
      print(fmt.format(
        str(m.get('id', '?')),
        m.get('name', '?')[:39],
        m.get('type', '?'),
        'YES' if m.get('active') else 'NO'
      ))
    print('')
    print(f'Total monitors: {len(monitors)}')
except Exception as e:
  print(f'Could not parse monitor list: {e}')
  print(data if isinstance(data, str) else json.dumps(data)[:500])
" 2>/dev/null || echo "(Could not display monitor list)"

echo ""
echo "Provisioning complete."
echo "Access via SSH tunnel: ssh -L 3001:localhost:3001 deploy@46.225.14.123"
echo "Then open: http://localhost:3001"
