#!/usr/bin/env bash
# verify-supervisor.sh — UTV2-1012
# Runs ON the production server (called via SSH from ops-supervisor-status GHA workflow).
# Captures docker service state for all unit-talk containers and writes a JSON result file.
# Exit 0 = PASS (all services running, api healthy, restart counts < 10)
# Exit 1 = FAIL (any service missing, exited, unhealthy, or restart-looping)
set -euo pipefail

DEPLOY_PATH="${DEPLOY_PATH:-/opt/unit-talk}"
OUTPUT_FILE="$DEPLOY_PATH/supervisor-status.json"

SERVICES=(
  unit-talk-api-1
  unit-talk-worker-1
  unit-talk-ingestor-1
  unit-talk-discord-bot-1
)

CHECKED_AT="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
VERDICT="PASS"
FAILURES=()

# ── per-service collection ────────────────────────────────────────────────────
collect_service_data() {
  local svc="$1"
  local state health restarts image started

  state=$(docker inspect "$svc" \
    --format='{{.State.Status}}' 2>/dev/null || echo "missing")
  health=$(docker inspect "$svc" \
    --format='{{if .State.Health}}{{.State.Health.Status}}{{end}}' 2>/dev/null || echo "")
  # Normalise empty health (no healthcheck configured) to "none"
  [[ -z "$health" ]] && health="none"
  restarts=$(docker inspect "$svc" \
    --format='{{.RestartCount}}' 2>/dev/null || echo "-1")
  image=$(docker inspect "$svc" \
    --format='{{.Config.Image}}' 2>/dev/null || echo "unknown")
  started=$(docker inspect "$svc" \
    --format='{{.State.StartedAt}}' 2>/dev/null || echo "unknown")

  printf '%s\t%s\t%s\t%s\t%s\n' "$state" "$health" "$restarts" "$image" "$started"
}

# Store collected data in parallel arrays (bash 3 compat — no assoc arrays needed)
SVC_NAMES=()
SVC_STATES=()
SVC_HEALTHS=()
SVC_RESTARTS=()
SVC_IMAGES=()
SVC_STARTEDS=()

for svc in "${SERVICES[@]}"; do
  IFS=$'\t' read -r state health restarts image started < <(collect_service_data "$svc")
  SVC_NAMES+=("$svc")
  SVC_STATES+=("$state")
  SVC_HEALTHS+=("$health")
  SVC_RESTARTS+=("$restarts")
  SVC_IMAGES+=("$image")
  SVC_STARTEDS+=("$started")
done

# ── verdict logic ─────────────────────────────────────────────────────────────
for i in "${!SVC_NAMES[@]}"; do
  svc="${SVC_NAMES[$i]}"
  state="${SVC_STATES[$i]}"
  health="${SVC_HEALTHS[$i]}"
  restarts="${SVC_RESTARTS[$i]}"

  if [[ "$state" != "running" ]]; then
    FAILURES+=("$svc: state=$state (expected running)")
    VERDICT="FAIL"
  fi

  # api must report docker healthcheck as healthy
  if [[ "$svc" == "unit-talk-api-1" && "$health" != "healthy" ]]; then
    FAILURES+=("$svc: health=$health (expected healthy)")
    VERDICT="FAIL"
  fi

  # restart count >= 10 indicates a crash loop
  if [[ "$restarts" =~ ^[0-9]+$ ]] && (( restarts >= 10 )); then
    FAILURES+=("$svc: restartCount=$restarts (threshold: <10, possible crash loop)")
    VERDICT="FAIL"
  fi
done

# ── human-readable table to stdout ───────────────────────────────────────────
printf '\n%-35s %-10s %-12s %-10s %s\n' "SERVICE" "STATE" "HEALTH" "RESTARTS" "IMAGE"
printf '%0.s-' {1..90}; printf '\n'
for i in "${!SVC_NAMES[@]}"; do
  printf '%-35s %-10s %-12s %-10s %s\n' \
    "${SVC_NAMES[$i]}" \
    "${SVC_STATES[$i]}" \
    "${SVC_HEALTHS[$i]}" \
    "${SVC_RESTARTS[$i]}" \
    "${SVC_IMAGES[$i]}"
done
printf '%0.s-' {1..90}; printf '\n'
printf 'Checked at: %s\n' "$CHECKED_AT"
printf 'Verdict:    %s\n' "$VERDICT"
if (( ${#FAILURES[@]} > 0 )); then
  printf 'Failures:\n'
  for f in "${FAILURES[@]}"; do
    printf '  - %s\n' "$f"
  done
fi
printf '\n'

# ── build JSON using python3 (guarantees valid output) ───────────────────────
mkdir -p "$(dirname "$OUTPUT_FILE")"

# Pass data to python via env to avoid quoting/injection issues
PYTHON_CHECKED_AT="$CHECKED_AT" \
PYTHON_VERDICT="$VERDICT" \
PYTHON_FAILURES="$(IFS=$'\n'; echo "${FAILURES[*]+"${FAILURES[*]}"}")" \
PYTHON_SVC_NAMES="$(IFS=$'\n'; echo "${SVC_NAMES[*]}")" \
PYTHON_SVC_STATES="$(IFS=$'\n'; echo "${SVC_STATES[*]}")" \
PYTHON_SVC_HEALTHS="$(IFS=$'\n'; echo "${SVC_HEALTHS[*]}")" \
PYTHON_SVC_RESTARTS="$(IFS=$'\n'; echo "${SVC_RESTARTS[*]}")" \
PYTHON_SVC_IMAGES="$(IFS=$'\n'; echo "${SVC_IMAGES[*]}")" \
PYTHON_SVC_STARTEDS="$(IFS=$'\n'; echo "${SVC_STARTEDS[*]}")" \
PYTHON_OUTPUT_FILE="$OUTPUT_FILE" \
python3 - <<'PYEOF'
import json, os, sys

def lines(env_key):
    val = os.environ.get(env_key, "")
    return [l for l in val.split("\n") if l] if val else []

names    = lines("PYTHON_SVC_NAMES")
states   = lines("PYTHON_SVC_STATES")
healths  = lines("PYTHON_SVC_HEALTHS")
restarts = lines("PYTHON_SVC_RESTARTS")
images   = lines("PYTHON_SVC_IMAGES")
starteds = lines("PYTHON_SVC_STARTEDS")
failures = lines("PYTHON_FAILURES")

services = {}
for i, name in enumerate(names):
    try:
        rc = int(restarts[i]) if i < len(restarts) else -1
    except (ValueError, IndexError):
        rc = -1
    services[name] = {
        "state":        states[i]   if i < len(states)   else "missing",
        "health":       healths[i]  if i < len(healths)  else "none",
        "restartCount": rc,
        "image":        images[i]   if i < len(images)   else "unknown",
        "startedAt":    starteds[i] if i < len(starteds) else "unknown",
    }

result = {
    "checkedAt": os.environ["PYTHON_CHECKED_AT"],
    "verdict":   os.environ["PYTHON_VERDICT"],
    "services":  services,
    "failures":  failures,
}

output = json.dumps(result, indent=2)
print(output)

out_file = os.environ["PYTHON_OUTPUT_FILE"]
with open(out_file, "w") as fh:
    fh.write(output + "\n")

print(f"\nJSON written to {out_file}", file=sys.stderr)
PYEOF

# ── exit code reflects verdict ────────────────────────────────────────────────
if [[ "$VERDICT" != "PASS" ]]; then
  exit 1
fi
