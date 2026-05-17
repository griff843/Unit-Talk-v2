#!/usr/bin/env bash
set -euo pipefail

DRY_RUN=false
TAG=""
HOST="${UNIT_TALK_DEPLOY_HOST:-}"
USER="${UNIT_TALK_DEPLOY_USER:-}"
DEPLOY_PATH="${UNIT_TALK_DEPLOY_PATH:-}"

usage() {
  cat <<'USAGE'
Usage: deploy/rollback.sh --tag <image-tag> [--host <host>] [--user <user>] [--path <remote-path>] [--dry-run]

Rolls the docker-compose deployment back to a known image tag. In --dry-run mode,
the script validates arguments and prints the remote rollback command without
opening an SSH connection.
USAGE
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --dry-run)
      DRY_RUN=true
      shift
      ;;
    --tag)
      TAG="${2:-}"
      shift 2
      ;;
    --host)
      HOST="${2:-}"
      shift 2
      ;;
    --user)
      USER="${2:-}"
      shift 2
      ;;
    --path)
      DEPLOY_PATH="${2:-}"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

if [ -z "$TAG" ]; then
  echo "Rollback tag is required. Pass --tag <image-tag>." >&2
  exit 2
fi

if [ "$DRY_RUN" = false ]; then
  if [ -z "$HOST" ] || [ -z "$USER" ] || [ -z "$DEPLOY_PATH" ]; then
    echo "Rollback requires --host, --user, and --path unless --dry-run is set." >&2
    exit 2
  fi
fi

REMOTE_COMMAND=$(cat <<EOF
set -eu
cd '$DEPLOY_PATH'
if [ -f .unit-talk-release ]; then cp .unit-talk-release .unit-talk-release.failed; fi
printf '%s\n' '$TAG' > .unit-talk-release
UNIT_TALK_IMAGE_TAG='$TAG' docker compose pull
UNIT_TALK_IMAGE_TAG='$TAG' docker compose up -d --remove-orphans
EOF
)

if [ "$DRY_RUN" = true ]; then
  echo "Rollback dry run passed for tag: $TAG"
  echo "$REMOTE_COMMAND"
  exit 0
fi

ssh "$USER@$HOST" "$REMOTE_COMMAND"
