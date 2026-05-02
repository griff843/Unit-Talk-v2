#!/usr/bin/env bash
set -euo pipefail

# UTV2-792 safe deployment sequence
# Usage: ./scripts/deploy.sh [--migrate] [--rollback <service> <old-tag>]

COMPOSE_FILES=(-f docker-compose.yml -f docker-compose.prod.yml)
MIGRATE=false
ROLLBACK_SERVICE=""
ROLLBACK_TAG=""
OUTCOME="failure"

usage() {
  echo "Usage: ./scripts/deploy.sh [--migrate] [--rollback <service> <old-tag>]"
}

audit_log() {
  local outcome="$1"
  local services="$2"
  local operator="${USER:-unknown}"
  local sha="unknown"
  sha="$(git rev-parse HEAD 2>/dev/null || echo unknown)"
  printf '%s operator=%s sha=%s services=%s outcome=%s\n' \
    "$(date -u +"%Y-%m-%dT%H:%M:%SZ")" "$operator" "$sha" "$services" "$outcome" >> deploy.log
}

on_exit() {
  local status=$?
  if [[ "$OUTCOME" != "success" ]]; then
    if [[ -n "$ROLLBACK_SERVICE" ]]; then
      audit_log "failure" "rollback:$ROLLBACK_SERVICE"
    else
      audit_log "failure" "api,worker,ingestor,discord-bot,scanner,command-center"
    fi
  fi
  exit "$status"
}

trap on_exit EXIT

while [[ $# -gt 0 ]]; do
  case "$1" in
    --migrate)
      MIGRATE=true
      shift
      ;;
    --rollback)
      if [[ $# -lt 3 ]]; then
        usage
        exit 1
      fi
      ROLLBACK_SERVICE="$2"
      ROLLBACK_TAG="$3"
      shift 3
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      usage
      echo "Unknown argument: $1"
      exit 1
      ;;
  esac
done

tag_var_for_service() {
  case "$1" in
    api) echo "API_IMAGE_TAG" ;;
    worker) echo "WORKER_IMAGE_TAG" ;;
    ingestor) echo "INGESTOR_IMAGE_TAG" ;;
    discord-bot) echo "DISCORD_BOT_IMAGE_TAG" ;;
    scanner) echo "SCANNER_IMAGE_TAG" ;;
    command-center) echo "COMMAND_CENTER_IMAGE_TAG" ;;
    *)
      echo "Unsupported rollback service: $1" >&2
      exit 1
      ;;
  esac
}

compose() {
  docker compose "${COMPOSE_FILES[@]}" "$@"
}

check_container_service() {
  local service="$1"
  local container_id
  local state
  local health
  container_id="$(compose ps -q "$service" 2>/dev/null || true)"

  if [[ -z "$container_id" ]]; then
    return 1
  fi

  state="$(docker inspect --format '{{.State.Status}}' "$container_id" 2>/dev/null || true)"
  health="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{end}}' "$container_id" 2>/dev/null || true)"

  if [[ "$health" == "healthy" ]]; then
    return 0
  fi

  if [[ -z "$health" && "$state" == "running" ]]; then
    return 0
  fi

  return 1
}

poll_health() {
  local deadline=$((SECONDS + 60))
  local api_health_url="${UNIT_TALK_DEPLOY_HEALTH_URL:-http://localhost:4001/health}"
  local services=(worker ingestor discord-bot)

  while (( SECONDS < deadline )); do
    local healthy=true

    if ! curl -fsS "$api_health_url" >/dev/null 2>&1; then
      healthy=false
    fi

    for service in "${services[@]}"; do
      if ! check_container_service "$service"; then
        healthy=false
      fi
    done

    if compose ps -q scanner >/dev/null 2>&1; then
      if [[ -n "$(compose ps -q scanner 2>/dev/null || true)" ]] && ! check_container_service scanner; then
        healthy=false
      fi
    fi

    if compose ps -q command-center >/dev/null 2>&1; then
      if [[ -n "$(compose ps -q command-center 2>/dev/null || true)" ]] && ! check_container_service command-center; then
        healthy=false
      fi
    fi

    if [[ "$healthy" == true ]]; then
      return 0
    fi

    sleep 5
  done

  echo "Health polling failed after 60 seconds." >&2
  compose ps >&2 || true
  return 1
}

echo "Running preflight deploy check..."
if ! node scripts/deploy-check.ts; then
  echo "Preflight deploy check failed." >&2
  exit 1
fi

if [[ -n "$ROLLBACK_SERVICE" ]]; then
  tag_var="$(tag_var_for_service "$ROLLBACK_SERVICE")"
  export "$tag_var=$ROLLBACK_TAG"
  echo "Rolling back $ROLLBACK_SERVICE to image tag $ROLLBACK_TAG..."
  compose up -d --no-deps "$ROLLBACK_SERVICE"
  OUTCOME="success"
  audit_log "rollback" "rollback:$ROLLBACK_SERVICE"
  exit 0
fi

if [[ -n "${BACKUP_HOOK:-}" ]]; then
  echo "Running BACKUP_HOOK before deploy..."
  "$BACKUP_HOOK"
else
  echo "BACKUP_HOOK is not set. Confirm a pre-deploy backup before continuing."
fi

echo "Pulling production images..."
compose pull

if [[ "$MIGRATE" == true ]]; then
  echo "Running database migrations..."
  pnpm supabase db push
fi

echo "Deploying production stack..."
compose up -d

echo "Polling service health..."
poll_health

OUTCOME="success"
audit_log "success" "api,worker,ingestor,discord-bot,scanner,command-center"
echo "Deployment completed successfully."

