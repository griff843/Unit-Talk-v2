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
# Uses uptime-kuma-api Python library (Socket.IO — Kuma has no REST API).

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
# 2. Ensure uptime-kuma-api Python library is available
# ---------------------------------------------------------------------------

echo ""
echo "=== Setting up Python venv with uptime-kuma-api ==="
KUMA_VENV=/tmp/kuma-venv
if [ ! -f "$KUMA_VENV/bin/python3" ]; then
  echo "  Creating venv at $KUMA_VENV..."
  python3 -m venv "$KUMA_VENV"
fi
if ! "$KUMA_VENV/bin/python3" -c "import uptime_kuma_api" 2>/dev/null; then
  echo "  Installing uptime-kuma-api into venv..."
  "$KUMA_VENV/bin/pip" install --quiet uptime-kuma-api
  echo "  Installed."
else
  echo "  uptime-kuma-api already present in venv."
fi
PYTHON3="$KUMA_VENV/bin/python3"

# ---------------------------------------------------------------------------
# 3. Wait for Kuma to be ready (Socket.IO connect can fail if not fully up)
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
# 4. Provision via Python + uptime-kuma-api (Socket.IO)
# ---------------------------------------------------------------------------

echo ""
echo "=== Provisioning monitors via uptime-kuma-api ==="

"$PYTHON3" - "$KUMA_BASE" "$KUMA_PASS" "$DISCORD_WEBHOOK" <<'PYEOF'
import sys
import time

try:
    from uptime_kuma_api import UptimeKumaApi, MonitorType, NotificationType
except ImportError as e:
    print(f"ERROR: uptime_kuma_api not installed: {e}")
    sys.exit(1)

kuma_url, kuma_pass, discord_webhook = sys.argv[1], sys.argv[2], sys.argv[3]

print(f"Connecting to {kuma_url} ...")
with UptimeKumaApi(kuma_url) as api:
    # --- Admin setup (idempotent) ---
    try:
        api.setup("admin", kuma_pass)
        print("Admin account created.")
    except Exception as e:
        if "already" in str(e).lower() or "exist" in str(e).lower() or "setup" in str(e).lower():
            print(f"Admin already exists (OK): {e}")
        else:
            print(f"Setup response (may be OK): {e}")

    # --- Login ---
    api.login("admin", kuma_pass)
    print("Login: OK")

    # --- Discord notification (idempotent) ---
    print("")
    print("=== Provisioning Discord notification ===")
    existing_notifs = api.get_notifications()
    notif_id = None
    for n in existing_notifs:
        if n.get("name") == "Discord Ops":
            notif_id = n.get("id")
            print(f"  SKIP (already exists): Discord Ops (ID={notif_id})")
            break

    if notif_id is None:
        result = api.add_notification(
            name="Discord Ops",
            type=NotificationType.DISCORD,
            isDefault=True,
            applyExisting=True,
            discordWebhookUrl=discord_webhook,
        )
        notif_id = result.get("id") or result.get("notificationID")
        print(f"  CREATED: Discord Ops (ID={notif_id})")

    notif_list = [notif_id] if notif_id else []

    # --- Existing monitors ---
    existing_monitors = api.get_monitors()
    existing_names = {m.get("name") for m in existing_monitors}

    def create_if_missing(name, **kwargs):
        if name in existing_names:
            print(f"  SKIP (already exists): {name}")
            return
        result = api.add_monitor(name=name, **kwargs)
        mid = result.get("monitorID") or result.get("id", "?")
        print(f"  CREATED (ID={mid}): {name}")

    print("")
    print("=== Provisioning monitors ===")

    print("")
    print("[1/5] API health")
    create_if_missing(
        "Unit Talk API Health",
        type=MonitorType.HTTP,
        url="http://api:4000/health",
        method="GET",
        interval=60,
        retryInterval=30,
        maxretries=3,
        notificationIDList=notif_list,
    )

    print("")
    print("[2/5] Host ping")
    create_if_missing(
        "Unit Talk Host Ping",
        type=MonitorType.PING,
        hostname="46.225.14.123",
        interval=60,
        retryInterval=30,
        maxretries=3,
        notificationIDList=notif_list,
    )

    print("")
    print("[3/5] Worker liveness (via API full-health)")
    create_if_missing(
        "Unit Talk Worker Liveness",
        type=MonitorType.HTTP,
        url="http://api:4000/health?full=true",
        method="GET",
        interval=60,
        retryInterval=30,
        maxretries=3,
        notificationIDList=notif_list,
    )

    print("")
    print("[4/5] Ingestor freshness (via API full-health)")
    create_if_missing(
        "Unit Talk Ingestor Freshness",
        type=MonitorType.HTTP,
        url="http://api:4000/health?full=true",
        method="GET",
        interval=60,
        retryInterval=30,
        maxretries=3,
        notificationIDList=notif_list,
    )

    print("")
    print("[5/5] Discord bot container")
    try:
        create_if_missing(
            "Unit Talk Discord Bot",
            type=MonitorType.DOCKER,
            docker_container="unit-talk-discord-bot",
            docker_host=1,
            interval=60,
            retryInterval=30,
            maxretries=3,
            notificationIDList=notif_list,
        )
    except Exception as e:
        print(f"  Docker monitor failed ({e}), falling back to HTTP")
        if "Unit Talk Discord Bot" not in existing_names:
            create_if_missing(
                "Unit Talk Discord Bot",
                type=MonitorType.HTTP,
                url="http://api:4000/health",
                method="GET",
                interval=60,
                retryInterval=30,
                maxretries=3,
                notificationIDList=notif_list,
            )

    # --- Final status ---
    print("")
    print("=== Final monitor status ===")
    monitors = api.get_monitors()
    if not monitors:
        print("No monitors found.")
    else:
        fmt = "{:<5} {:<40} {:<12} {}"
        print(fmt.format("ID", "Name", "Type", "Active"))
        print("-" * 75)
        for m in monitors:
            print(fmt.format(
                str(m.get("id", "?")),
                (m.get("name") or "?")[:39],
                m.get("type") or "?",
                "YES" if m.get("active") else "NO",
            ))
        print(f"\nTotal monitors: {len(monitors)}")

print("")
print("Provisioning complete.")
print("Access via SSH tunnel: ssh -L 3001:localhost:3001 deploy@46.225.14.123")
print("Then open: http://localhost:3001")
PYEOF
