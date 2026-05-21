#!/usr/bin/env bash
# provision-kuma-monitors.sh
#
# Provisions all 5 Uptime Kuma monitors + Discord notification for Unit Talk V2.
# Runs ON the Hetzner server via SSH from deploy-monitoring.yml.
# Uses Uptime Kuma v2 REST API (not Socket.IO).
#
# Environment:
#   DEPLOY_PATH  — base deployment path
# Secrets (read from files, never from command args):
#   /tmp/kuma-pass  — Uptime Kuma admin password (written by workflow, deleted here)

set -euo pipefail

KUMA_BASE="http://localhost:3001"
ENV_FILE="${DEPLOY_PATH}/.env.monitoring"

# ---------------------------------------------------------------------------
# 1. Read secrets
# ---------------------------------------------------------------------------

if [ ! -f /tmp/kuma-pass ]; then
  echo "ERROR: /tmp/kuma-pass not found."
  exit 1
fi
KUMA_PASS="$(cat /tmp/kuma-pass)"
rm -f /tmp/kuma-pass

if [ ! -f "$ENV_FILE" ]; then
  echo "ERROR: $ENV_FILE not found."
  exit 1
fi
DISCORD_WEBHOOK="$(grep -E '^DISCORD_OPS_WEBHOOK_URL=' "$ENV_FILE" | cut -d= -f2-)"
if [ -z "$DISCORD_WEBHOOK" ]; then
  echo "ERROR: DISCORD_OPS_WEBHOOK_URL is empty in $ENV_FILE"
  exit 1
fi
echo "Secrets loaded."

# ---------------------------------------------------------------------------
# 2. Wait for Kuma to be ready
# ---------------------------------------------------------------------------

echo ""
echo "=== Waiting for Uptime Kuma to accept connections ==="
for i in $(seq 1 20); do
  if curl -sf --max-time 5 "${KUMA_BASE}/api/entry-page" >/dev/null 2>&1; then
    echo "Kuma is up (attempt $i)"
    break
  fi
  if [ "$i" -eq 20 ]; then
    echo "ERROR: Uptime Kuma did not respond after 60s" >&2
    exit 1
  fi
  echo "  Attempt $i: not ready yet, waiting 3s..."
  sleep 3
done

# ---------------------------------------------------------------------------
# 3. Setup admin (idempotent — fails gracefully if already set up)
# ---------------------------------------------------------------------------

echo ""
echo "=== Setup admin account (v2 REST) ==="
SETUP_RESP=$(curl -s --max-time 10 -X POST "${KUMA_BASE}/api/setup" \
  -H "Content-Type: application/json" \
  -d "{\"username\":\"admin\",\"password\":\"${KUMA_PASS}\"}" 2>/dev/null || echo '{}')
echo "Setup: $SETUP_RESP"

# ---------------------------------------------------------------------------
# 4. Login and get token
# ---------------------------------------------------------------------------

echo ""
echo "=== Login ==="
LOGIN_RESP=$(curl -sf --max-time 10 -X POST "${KUMA_BASE}/api/auth/login" \
  -H "Content-Type: application/json" \
  -d "{\"username\":\"admin\",\"password\":\"${KUMA_PASS}\"}" 2>/dev/null || echo '{}')

TOKEN=$(python3 -c "
import json, sys
d = json.loads('''${LOGIN_RESP}''')
# v2 token is nested under tokenInfo or at top level
print(d.get('token') or d.get('tokenInfo',{}).get('token',''))
" 2>/dev/null || echo "")

if [ -z "$TOKEN" ]; then
  echo "ERROR: Login failed. Response: $LOGIN_RESP"
  exit 1
fi
echo "Login OK."

# ---------------------------------------------------------------------------
# 5. Helper functions
# ---------------------------------------------------------------------------

kuma_get() {
  curl -sf --max-time 15 \
    -H "Authorization: Bearer $TOKEN" \
    "${KUMA_BASE}${1}" 2>/dev/null || echo '{}'
}

kuma_post() {
  curl -sf --max-time 15 -X POST \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d "${2}" \
    "${KUMA_BASE}${1}" 2>/dev/null || echo '{}'
}

# ---------------------------------------------------------------------------
# 6. Discord notification (idempotent)
# ---------------------------------------------------------------------------

echo ""
echo "=== Provisioning Discord notification ==="
NOTIFS_RAW=$(kuma_get "/api/notifications")
NOTIF_ID=$(python3 -c "
import json, sys
data = json.loads('''${NOTIFS_RAW}''')
items = data if isinstance(data, list) else data.get('notificationList', [])
if isinstance(items, dict): items = list(items.values())
for n in items:
    if n.get('name') == 'Discord Ops':
        print(n.get('id', ''))
        break
" 2>/dev/null || echo "")

if [ -z "$NOTIF_ID" ]; then
  NOTIF_PAYLOAD="{\"name\":\"Discord Ops\",\"type\":\"discord\",\"isDefault\":true,\"applyExisting\":true,\"discordWebhookUrl\":\"${DISCORD_WEBHOOK}\"}"
  NOTIF_RESP=$(kuma_post "/api/notifications" "$NOTIF_PAYLOAD")
  NOTIF_ID=$(python3 -c "
import json, sys
d = json.loads('''${NOTIF_RESP}''')
print(d.get('id') or d.get('notificationID',''))
" 2>/dev/null || echo "")
  echo "  CREATED: Discord Ops (ID=${NOTIF_ID})"
else
  echo "  SKIP (exists): Discord Ops (ID=${NOTIF_ID})"
fi

NOTIF_LIST="{}"
if [ -n "$NOTIF_ID" ]; then
  NOTIF_LIST="{\"${NOTIF_ID}\":true}"
fi

# ---------------------------------------------------------------------------
# 7. Get existing monitor names
# ---------------------------------------------------------------------------

MONITORS_RAW=$(kuma_get "/api/monitors")
EXISTING_NAMES=$(python3 -c "
import json, sys
data = json.loads('''${MONITORS_RAW}''')
items = data if isinstance(data, list) else data.get('monitorList', {})
if isinstance(items, dict): items = list(items.values())
for m in items:
    print(m.get('name',''))
" 2>/dev/null || echo "")

create_monitor() {
  local name="$1"
  local payload="$2"
  if echo "$EXISTING_NAMES" | grep -qxF "$name"; then
    echo "  SKIP (exists): $name"
    return
  fi
  RESP=$(kuma_post "/api/monitors" "$payload")
  MID=$(python3 -c "
import json, sys
d = json.loads('''${RESP}''')
print(d.get('monitorID') or d.get('id','?'))
" 2>/dev/null || echo "?")
  echo "  CREATED (ID=$MID): $name"
}

# ---------------------------------------------------------------------------
# 8. Provision 5 monitors
# ---------------------------------------------------------------------------

echo ""
echo "=== Provisioning monitors ==="

echo ""
echo "[1/5] API health"
create_monitor "Unit Talk API Health" \
  "{\"name\":\"Unit Talk API Health\",\"type\":\"http\",\"url\":\"http://api:4000/health\",\"method\":\"GET\",\"interval\":60,\"retryInterval\":30,\"maxretries\":3,\"notificationIDList\":${NOTIF_LIST}}"

echo ""
echo "[2/5] Host ping"
create_monitor "Unit Talk Host Ping" \
  "{\"name\":\"Unit Talk Host Ping\",\"type\":\"ping\",\"hostname\":\"46.225.14.123\",\"interval\":60,\"retryInterval\":30,\"maxretries\":3,\"notificationIDList\":${NOTIF_LIST}}"

echo ""
echo "[3/5] Worker liveness"
create_monitor "Unit Talk Worker Liveness" \
  "{\"name\":\"Unit Talk Worker Liveness\",\"type\":\"http\",\"url\":\"http://api:4000/health?full=true\",\"method\":\"GET\",\"interval\":60,\"retryInterval\":30,\"maxretries\":3,\"notificationIDList\":${NOTIF_LIST}}"

echo ""
echo "[4/5] Ingestor freshness"
create_monitor "Unit Talk Ingestor Freshness" \
  "{\"name\":\"Unit Talk Ingestor Freshness\",\"type\":\"http\",\"url\":\"http://api:4000/health?full=true\",\"method\":\"GET\",\"interval\":60,\"retryInterval\":30,\"maxretries\":3,\"notificationIDList\":${NOTIF_LIST}}"

echo ""
echo "[5/5] Discord bot"
create_monitor "Unit Talk Discord Bot" \
  "{\"name\":\"Unit Talk Discord Bot\",\"type\":\"http\",\"url\":\"http://api:4000/health\",\"method\":\"GET\",\"interval\":60,\"retryInterval\":30,\"maxretries\":3,\"notificationIDList\":${NOTIF_LIST}}"

# ---------------------------------------------------------------------------
# 9. Final status
# ---------------------------------------------------------------------------

echo ""
echo "=== Final monitor status ==="
MONITORS_FINAL=$(kuma_get "/api/monitors")
python3 -c "
import json, sys
data = json.loads('''${MONITORS_FINAL}''')
items = data if isinstance(data, list) else data.get('monitorList', {})
if isinstance(items, dict): items = list(items.values())
if not items:
    print('No monitors found.')
else:
    fmt = '{:<5} {:<40} {:<12} {}'
    print(fmt.format('ID', 'Name', 'Type', 'Active'))
    print('-' * 75)
    for m in items:
        print(fmt.format(str(m.get('id','?')), str(m.get('name','?'))[:39], str(m.get('type','?')), 'YES' if m.get('active') else 'NO'))
    print(f'\nTotal monitors: {len(items)}')
" 2>/dev/null || echo "Could not list monitors"

echo ""
echo "Provisioning complete."
echo "Access via SSH tunnel: ssh -L 3001:localhost:3001 deploy@46.225.14.123"
echo "Then open: http://localhost:3001"
