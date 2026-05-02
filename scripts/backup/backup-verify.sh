#!/usr/bin/env bash
set -euo pipefail

usage() {
  echo "Usage: $0 [--decrypt-test <object-key>]" >&2
}

log() {
  printf '[%s] %s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$*"
}

require_env() {
  local name="$1"
  if [[ -z "${!name:-}" ]]; then
    log "ERROR: required environment variable ${name} is not set"
    exit 1
  fi
}

cleanup() {
  rm -rf "${TMP_DIR:-}"
}

DECRYPT_OBJECT_KEY=""
if [[ "$#" -eq 2 && "${1:-}" == "--decrypt-test" ]]; then
  DECRYPT_OBJECT_KEY="$2"
elif [[ "$#" -ne 0 ]]; then
  usage
  exit 64
fi

for env_name in R2_BUCKET R2_ENDPOINT R2_ACCOUNT_ID R2_ACCESS_KEY_ID R2_SECRET_ACCESS_KEY; do
  require_env "$env_name"
done

command -v rclone >/dev/null 2>&1 || { log "ERROR: rclone is required"; exit 1; }
command -v gzip >/dev/null 2>&1 || { log "ERROR: gzip is required"; exit 1; }
if [[ -n "$DECRYPT_OBJECT_KEY" ]]; then
  command -v gpg >/dev/null 2>&1 || { log "ERROR: gpg is required for --decrypt-test"; exit 1; }
fi

TMP_DIR="$(mktemp -d)"
trap cleanup EXIT

RCLONE_CONFIG="${TMP_DIR}/rclone.conf"
OBJECT_LIST="${TMP_DIR}/objects.tsv"
NOW_EPOCH="$(date -u '+%s')"
FRESH_CUTOFF="$((NOW_EPOCH - 86400))"
SEVEN_DAY_CUTOFF="$((NOW_EPOCH - 604800))"

to_epoch() {
  local timestamp="$1"
  if date -u -d "$timestamp" '+%s' >/dev/null 2>&1; then
    date -u -d "$timestamp" '+%s'
  else
    date -u -j -f '%Y-%m-%d %H:%M:%S' "${timestamp%%.*}" '+%s'
  fi
}

cat >"$RCLONE_CONFIG" <<RCLONE_CONFIG_EOF
[r2]
type = s3
provider = Cloudflare
access_key_id = ${R2_ACCESS_KEY_ID}
secret_access_key = ${R2_SECRET_ACCESS_KEY}
endpoint = ${R2_ENDPOINT}
acl = private
RCLONE_CONFIG_EOF

log "Listing R2 database backups from the last 7 days"
rclone --config "$RCLONE_CONFIG" lsf "r2:${R2_BUCKET}/db-backups/" --recursive --files-only --format "tsp" --s3-no-check-bucket >"$OBJECT_LIST"

TOTAL_OBJECTS=0
TOTAL_SIZE=0
FRESH_COUNT=0
OLDEST_EPOCH=0
NEWEST_EPOCH=0

while IFS=';' read -r mod_time size path; do
  [[ -n "${path:-}" ]] || continue
  object_epoch="$(to_epoch "$mod_time")"
  if (( object_epoch < SEVEN_DAY_CUTOFF )); then
    continue
  fi

  TOTAL_OBJECTS=$((TOTAL_OBJECTS + 1))
  TOTAL_SIZE=$((TOTAL_SIZE + size))

  if (( object_epoch >= FRESH_CUTOFF )); then
    FRESH_COUNT=$((FRESH_COUNT + 1))
  fi

  if (( OLDEST_EPOCH == 0 || object_epoch < OLDEST_EPOCH )); then
    OLDEST_EPOCH="$object_epoch"
  fi

  if (( object_epoch > NEWEST_EPOCH )); then
    NEWEST_EPOCH="$object_epoch"
  fi
done <"$OBJECT_LIST"

if [[ -n "$DECRYPT_OBJECT_KEY" ]]; then
  ENCRYPTED_FILE="${TMP_DIR}/decrypt-test.sql.gz.gpg"
  DECRYPTED_FILE="${TMP_DIR}/decrypt-test.sql.gz"
  log "Downloading decrypt-test object r2:${R2_BUCKET}/${DECRYPT_OBJECT_KEY}"
  rclone --config "$RCLONE_CONFIG" copyto "r2:${R2_BUCKET}/${DECRYPT_OBJECT_KEY}" "$ENCRYPTED_FILE" --s3-no-check-bucket
  log "Decrypting test object"
  gpg --batch --yes --decrypt --output "$DECRYPTED_FILE" "$ENCRYPTED_FILE"
  log "Validating gzip payload"
  gzip -t "$DECRYPTED_FILE"
fi

if (( TOTAL_OBJECTS == 0 )); then
  OLDEST_AGE="n/a"
  NEWEST_AGE="n/a"
else
  OLDEST_AGE="$(((NOW_EPOCH - OLDEST_EPOCH) / 3600))h"
  NEWEST_AGE="$(((NOW_EPOCH - NEWEST_EPOCH) / 3600))h"
fi

log "Summary: total_objects=${TOTAL_OBJECTS} oldest_age=${OLDEST_AGE} newest_age=${NEWEST_AGE} total_size_bytes=${TOTAL_SIZE}"

if (( FRESH_COUNT < 1 )); then
  log "ERROR: no R2 database backup from the last 24 hours"
  exit 1
fi

log "R2 backup freshness check passed"
