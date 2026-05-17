#!/usr/bin/env bash
# Run via cron every hour. Posts to Discord when disk usage on / exceeds 80%.
# Cooldown: 6 hours to prevent alert storms.
set -euo pipefail

ENV_FILE=/opt/unit-talk/.env.monitoring
# shellcheck source=/dev/null
[[ -f "$ENV_FILE" ]] && source "$ENV_FILE"

WEBHOOK_URL="${DISCORD_OPS_WEBHOOK_URL:-}"
[[ -z "$WEBHOOK_URL" ]] && exit 0

THRESHOLD=80
COOLDOWN_SECONDS=21600  # 6 hours
COOLDOWN_FILE="/tmp/unit-talk-disk-alert.last"

usage=$(df / | awk 'NR==2 {gsub(/%/,""); print $5}')

if [[ $usage -le $THRESHOLD ]]; then
  rm -f "$COOLDOWN_FILE"
  exit 0
fi

# Check cooldown
now=$(date +%s)
if [[ -f "$COOLDOWN_FILE" ]]; then
  last=$(cat "$COOLDOWN_FILE" 2>/dev/null || echo 0)
  elapsed=$(( now - last ))
  if [[ $elapsed -lt $COOLDOWN_SECONDS ]]; then
    exit 0
  fi
fi

free=$(df -h / | awk 'NR==2 {print $4}')
total=$(df -h / | awk 'NR==2 {print $2}')
hostname_val=$(hostname -f 2>/dev/null || hostname)
timestamp=$(date -u "+%Y-%m-%dT%H:%M:%SZ")

payload=$(python3 -c "
import json, sys
msg = '⚠️ **Disk Alert** | host: \`{}\` | **{}% used** ({} free of {}) | {}'.format(
    sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4], sys.argv[5])
print(json.dumps({'content': msg}))
" "$hostname_val" "$usage" "$free" "$total" "$timestamp")

if curl -sf -X POST "$WEBHOOK_URL" \
  -H "Content-Type: application/json" \
  --data "$payload" \
  --max-time 10; then
  echo "$now" > "$COOLDOWN_FILE"
fi
