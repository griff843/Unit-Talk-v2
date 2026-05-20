#!/usr/bin/env bash
# rollback-drill.sh — end-to-end rollback path drill
#
# Runs ON the server (called via SSH from ops-rollback-drill.yml).
# Proves the stop-and-restore cycle: health passes → API stopped → health fails →
# docker compose up restores service → health passes again.
#
# Usage:
#   bash deploy/rollback-drill.sh --deploy-path /opt/unit-talk
#
# Exit codes:
#   0  — drill completed and PASS verdict written
#   1  — drill completed but FAIL verdict written (or unrecoverable setup error)
set -euo pipefail

# ─── Defaults ──────────────────────────────────────────────────────────────────
DEPLOY_PATH=""
API_HEALTH_URL="http://localhost:4000/health"
STOP_TIMEOUT_SECS=60
RESTORE_TIMEOUT_SECS=120
POLL_INTERVAL_SECS=5
API_CONTAINER="unit-talk-api-1"

# ─── Argument parsing ──────────────────────────────────────────────────────────
usage() {
  cat <<'USAGE'
Usage: deploy/rollback-drill.sh --deploy-path <path> [options]

Options:
  --deploy-path <path>     Path to the deployment directory on the server (required)
  --health-url <url>       API health endpoint (default: http://localhost:4000/health)
  --api-container <name>   Docker container name for the API (default: unit-talk-api-1)
USAGE
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --deploy-path)
      DEPLOY_PATH="${2:-}"
      shift 2
      ;;
    --health-url)
      API_HEALTH_URL="${2:-}"
      shift 2
      ;;
    --api-container)
      API_CONTAINER="${2:-}"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

if [ -z "$DEPLOY_PATH" ]; then
  echo "ERROR: --deploy-path is required" >&2
  usage >&2
  exit 1
fi

# ─── Result file paths ─────────────────────────────────────────────────────────
RESULT_FILE="$DEPLOY_PATH/rollback-drill-result.json"
PRE_FILE="$DEPLOY_PATH/rollback-drill-pre.json"
DURING_FILE="$DEPLOY_PATH/rollback-drill-during.json"
POST_FILE="$DEPLOY_PATH/rollback-drill-post.json"

# ─── Helpers ───────────────────────────────────────────────────────────────────
now_iso() {
  date -u +"%Y-%m-%dT%H:%M:%SZ"
}

now_epoch() {
  date +%s
}

http_status() {
  curl -so /dev/null -w '%{http_code}' --connect-timeout 5 --max-time 10 "$1" 2>/dev/null || echo "000"
}

health_body() {
  curl -sf --connect-timeout 5 --max-time 10 "$1" 2>/dev/null || echo '{}'
}

write_fail_result() {
  local reason="$1"
  local started_at="${2:-}"
  local completed_at
  completed_at="$(now_iso)"
  local duration=0
  if [ -n "$started_at" ]; then
    duration=$(( $(now_epoch) - DRILL_START_EPOCH ))
  fi
  cat > "$RESULT_FILE" <<EOF
{
  "verdict": "FAIL",
  "fail_reason": "$reason",
  "pre_health_status": "${PRE_STATUS:-unknown}",
  "down_confirmed": ${DOWN_CONFIRMED:-false},
  "post_health_status": "${POST_STATUS:-unknown}",
  "drill_started_at": "${started_at:-unknown}",
  "drill_completed_at": "$completed_at",
  "duration_seconds": $duration
}
EOF
  echo "FAIL: $reason" >&2
}

# ─── State tracking ────────────────────────────────────────────────────────────
PRE_STATUS="unknown"
DOWN_CONFIRMED=false
POST_STATUS="unknown"
DRILL_START_EPOCH=0
DRILL_STARTED_AT=""

# Ensure we always write a result, even on unexpected exit
trap 'if [ ! -f "$RESULT_FILE" ]; then write_fail_result "unexpected_script_exit" "$DRILL_STARTED_AT"; fi' EXIT

# ─── Phase 0: Validate environment ────────────────────────────────────────────
echo "=== UTV2-1031 Rollback Drill ==="
echo "Deploy path : $DEPLOY_PATH"
echo "Health URL  : $API_HEALTH_URL"
echo "Container   : $API_CONTAINER"
echo ""

if [ ! -d "$DEPLOY_PATH" ]; then
  echo "ERROR: DEPLOY_PATH '$DEPLOY_PATH' does not exist" >&2
  write_fail_result "deploy_path_not_found"
  exit 1
fi

cd "$DEPLOY_PATH"

if ! command -v docker &>/dev/null; then
  echo "ERROR: docker not found on PATH" >&2
  write_fail_result "docker_not_found"
  exit 1
fi

# Read current release tag
CURRENT_TAG=""
if [ -f "$DEPLOY_PATH/.unit-talk-release" ]; then
  CURRENT_TAG="$(cat "$DEPLOY_PATH/.unit-talk-release" | tr -d '[:space:]')"
  echo "Current release tag: $CURRENT_TAG"
else
  echo "WARNING: .unit-talk-release not found — will use compose default tag" >&2
fi

DRILL_STARTED_AT="$(now_iso)"
DRILL_START_EPOCH="$(now_epoch)"
echo "Drill started at: $DRILL_STARTED_AT"
echo ""

# ─── Phase 1: Pre-drill health check ──────────────────────────────────────────
echo "=== Phase 1: Pre-drill health ==="
PRE_HTTP_STATUS="$(http_status "$API_HEALTH_URL")"
PRE_STATUS="$PRE_HTTP_STATUS"
PRE_BODY="$(health_body "$API_HEALTH_URL")"

printf '%s\n' "$PRE_BODY" > "$PRE_FILE"
echo "Pre-drill HTTP status: $PRE_HTTP_STATUS"
echo "Pre-drill body saved to: $PRE_FILE"

if [ "$PRE_HTTP_STATUS" != "200" ]; then
  echo "ERROR: Pre-drill health check returned $PRE_HTTP_STATUS — API must be healthy before drill starts" >&2
  write_fail_result "pre_health_check_failed_status_${PRE_HTTP_STATUS}" "$DRILL_STARTED_AT"
  exit 1
fi
echo "Pre-drill health: PASS (200 OK)"
echo ""

# ─── Phase 2: Simulate API failure ────────────────────────────────────────────
echo "=== Phase 2: Simulate API failure (docker stop $API_CONTAINER) ==="
if ! docker stop "$API_CONTAINER"; then
  echo "ERROR: Failed to stop container '$API_CONTAINER'" >&2
  write_fail_result "container_stop_failed" "$DRILL_STARTED_AT"
  exit 1
fi
echo "Container stopped. Waiting for health check to reflect downtime..."

# Poll until API is down (max STOP_TIMEOUT_SECS)
DOWN_CONFIRMED=false
DURING_HTTP_STATUS="000"
for i in $(seq 1 $(( STOP_TIMEOUT_SECS / POLL_INTERVAL_SECS ))); do
  DURING_HTTP_STATUS="$(http_status "$API_HEALTH_URL")"
  echo "  Attempt $i: HTTP $DURING_HTTP_STATUS"
  if [ "$DURING_HTTP_STATUS" != "200" ]; then
    DOWN_CONFIRMED=true
    echo "API is confirmed down (HTTP $DURING_HTTP_STATUS) after $((i * POLL_INTERVAL_SECS))s"
    break
  fi
  sleep "$POLL_INTERVAL_SECS"
done

# Save during-failure snapshot
cat > "$DURING_FILE" <<EOF
{"http_status": "$DURING_HTTP_STATUS", "down_confirmed": $DOWN_CONFIRMED, "checked_at": "$(now_iso)"}
EOF

if [ "$DOWN_CONFIRMED" = "false" ]; then
  # API is still up — this is unexpected but we still need to restore
  echo "WARNING: API did not appear down within ${STOP_TIMEOUT_SECS}s (HTTP $DURING_HTTP_STATUS)" >&2
  # Attempt restore anyway before writing FAIL, so we don't leave the system disrupted
fi
echo ""

# ─── Phase 3: Restore via docker compose up ───────────────────────────────────
echo "=== Phase 3: Restore service via docker compose up ==="
if [ -n "$CURRENT_TAG" ]; then
  echo "Restoring with UNIT_TALK_IMAGE_TAG=$CURRENT_TAG"
  UNIT_TALK_IMAGE_TAG="$CURRENT_TAG" docker compose up -d --no-deps api
else
  echo "Restoring with default compose image tag"
  docker compose up -d --no-deps api
fi
echo "docker compose up -d --no-deps api returned exit 0"
echo ""

# ─── Phase 4: Post-restore health poll ────────────────────────────────────────
echo "=== Phase 4: Post-restore health poll (max ${RESTORE_TIMEOUT_SECS}s) ==="
POST_HTTP_STATUS="000"
RESTORE_CONFIRMED=false
for i in $(seq 1 $(( RESTORE_TIMEOUT_SECS / POLL_INTERVAL_SECS ))); do
  POST_HTTP_STATUS="$(http_status "$API_HEALTH_URL")"
  echo "  Attempt $i: HTTP $POST_HTTP_STATUS"
  if [ "$POST_HTTP_STATUS" = "200" ]; then
    RESTORE_CONFIRMED=true
    echo "API is healthy again after $((i * POLL_INTERVAL_SECS))s"
    break
  fi
  sleep "$POLL_INTERVAL_SECS"
done

POST_STATUS="$POST_HTTP_STATUS"
POST_BODY="$(health_body "$API_HEALTH_URL")"
printf '%s\n' "$POST_BODY" > "$POST_FILE"
echo "Post-restore body saved to: $POST_FILE"
echo ""

# ─── Phase 5: Verdict ─────────────────────────────────────────────────────────
DRILL_COMPLETED_AT="$(now_iso)"
DURATION_SECONDS=$(( $(now_epoch) - DRILL_START_EPOCH ))

echo "=== Phase 5: Verdict ==="
echo "Pre health      : $PRE_STATUS"
echo "Down confirmed  : $DOWN_CONFIRMED"
echo "Post health     : $POST_HTTP_STATUS"
echo "Duration        : ${DURATION_SECONDS}s"

# Determine final verdict
if [ "$DOWN_CONFIRMED" = "true" ] && [ "$RESTORE_CONFIRMED" = "true" ]; then
  FINAL_VERDICT="PASS"
elif [ "$DOWN_CONFIRMED" = "false" ]; then
  FINAL_VERDICT="FAIL"
  echo "FAIL: API downtime was not confirmed within ${STOP_TIMEOUT_SECS}s" >&2
else
  FINAL_VERDICT="FAIL"
  echo "FAIL: API did not restore to healthy within ${RESTORE_TIMEOUT_SECS}s (last status: $POST_HTTP_STATUS)" >&2
fi

# Build fail_reason field (empty string if PASS)
if [ "$FINAL_VERDICT" = "PASS" ]; then
  FAIL_REASON=""
elif [ "$DOWN_CONFIRMED" = "false" ]; then
  FAIL_REASON="down_not_confirmed_within_${STOP_TIMEOUT_SECS}s"
else
  FAIL_REASON="restore_health_not_confirmed_within_${RESTORE_TIMEOUT_SECS}s_last_status_${POST_HTTP_STATUS}"
fi

cat > "$RESULT_FILE" <<EOF
{
  "verdict": "$FINAL_VERDICT",
  "fail_reason": "$FAIL_REASON",
  "pre_health_status": "$PRE_STATUS",
  "down_confirmed": $DOWN_CONFIRMED,
  "post_health_status": "$POST_HTTP_STATUS",
  "drill_started_at": "$DRILL_STARTED_AT",
  "drill_completed_at": "$DRILL_COMPLETED_AT",
  "duration_seconds": $DURATION_SECONDS,
  "current_tag": "${CURRENT_TAG:-unknown}",
  "api_container": "$API_CONTAINER",
  "restore_command": "docker compose up -d --no-deps api"
}
EOF

echo "Result written to: $RESULT_FILE"
echo "VERDICT: $FINAL_VERDICT"

if [ "$FINAL_VERDICT" != "PASS" ]; then
  exit 1
fi
