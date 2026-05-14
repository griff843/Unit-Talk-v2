#!/usr/bin/env bash
set -euo pipefail

log() {
  printf '[%s] %s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$*"
}

if [[ -f local.env ]]; then
  set -a
  # shellcheck disable=SC1091
  source local.env
  set +a
fi

log "Starting failed delivery replay"
npx tsx apps/worker/src/replay-failed-delivery.ts "$@"
log "Finished failed delivery replay"
