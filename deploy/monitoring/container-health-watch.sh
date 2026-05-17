#!/usr/bin/env bash
# Run via cron every 2 minutes. Posts to Discord when a critical container is
# not running. Cooldown: 10 minutes per container to prevent spam.
set -euo pipefail

ENV_FILE=/opt/unit-talk/.env.monitoring
# shellcheck source=/dev/null
[[ -f "$ENV_FILE" ]] && source "$ENV_FILE"

WEBHOOK_URL="${DISCORD_OPS_WEBHOOK_URL:-}"
[[ -z "$WEBHOOK_URL" ]] && exit 0

CRITICAL_CONTAINERS=(
  "unit-talk-api-1"
  "unit-talk-worker-1"
  "unit-talk-ingestor-1"
  "unit-talk-discord-bot-1"
  "uptime-kuma"
)

COOLDOWN_DIR="/tmp/unit-talk-alert-cooldown"
COOLDOWN_SECONDS=600
mkdir -p "$COOLDOWN_DIR"

send_alert() {
  local container="$1"
  local status="$2"
  local timestamp
  timestamp=$(date -u "+%Y-%m-%dT%H:%M:%SZ")
  local hostname_val
  hostname_val=$(hostname -f 2>/dev/null || hostname)

  local payload
  payload=$(python3 -c "
import json, sys
msg = '🚨 **Production Alert** | \`{}\` is **{}** | host: \`{}\` | {}'.format(
    sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4])
print(json.dumps({'content': msg}))
" "$container" "$status" "$hostname_val" "$timestamp")

  curl -sf -X POST "$WEBHOOK_URL" \
    -H "Content-Type: application/json" \
    --data "$payload" \
    --max-time 10 \
    --silent
}

for container in "${CRITICAL_CONTAINERS[@]}"; do
  raw_status=$(docker inspect --format='{{.State.Status}}' "$container" 2>/dev/null || echo "missing")

  # For containers with a health check, also check Health.Status
  if [[ "$raw_status" == "running" ]]; then
    health=$(docker inspect --format='{{if .State.Health}}{{.State.Health.Status}}{{end}}' "$container" 2>/dev/null || echo "")
    if [[ "$health" == "unhealthy" ]]; then
      raw_status="unhealthy"
    fi
  fi

  safe_name="${container//[^a-zA-Z0-9]/_}"
  cooldown_file="$COOLDOWN_DIR/${safe_name}.last"

  if [[ "$raw_status" == "running" ]]; then
    # Container is healthy — clear cooldown so next failure triggers fresh alert
    rm -f "$cooldown_file"
    continue
  fi

  # Check cooldown
  now=$(date +%s)
  if [[ -f "$cooldown_file" ]]; then
    last=$(cat "$cooldown_file" 2>/dev/null || echo 0)
    elapsed=$(( now - last ))
    if [[ $elapsed -lt $COOLDOWN_SECONDS ]]; then
      continue
    fi
  fi

  # Send and record cooldown timestamp
  if send_alert "$container" "$raw_status"; then
    echo "$now" > "$cooldown_file"
  fi
done
