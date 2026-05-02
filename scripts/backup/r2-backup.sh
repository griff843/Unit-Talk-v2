#!/usr/bin/env bash
set -euo pipefail

usage() {
  echo "Usage: $0 <dump-file-path>" >&2
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

if [[ "$#" -ne 1 ]]; then
  usage
  exit 64
fi

DUMP_FILE="$1"
if [[ ! -f "$DUMP_FILE" ]]; then
  log "ERROR: dump file not found: ${DUMP_FILE}"
  exit 1
fi

for env_name in R2_BUCKET R2_ENDPOINT R2_ACCOUNT_ID R2_ACCESS_KEY_ID R2_SECRET_ACCESS_KEY GPG_BACKUP_KEY_ID; do
  require_env "$env_name"
done

command -v gpg >/dev/null 2>&1 || { log "ERROR: gpg is required"; exit 1; }
command -v rclone >/dev/null 2>&1 || { log "ERROR: rclone is required"; exit 1; }

TMP_DIR="$(mktemp -d)"
trap cleanup EXIT

TIMESTAMP="$(date -u '+%Y%m%d%H%M%S')"
DAY_PATH="$(date -u '+%Y/%m/%d')"
OBJECT_KEY="db-backups/${DAY_PATH}/dump-${TIMESTAMP}.sql.gz.gpg"
ENCRYPTED_FILE="${TMP_DIR}/dump-${TIMESTAMP}.sql.gz.gpg"
RCLONE_CONFIG="${TMP_DIR}/rclone.conf"

cat >"$RCLONE_CONFIG" <<RCLONE_CONFIG_EOF
[r2]
type = s3
provider = Cloudflare
access_key_id = ${R2_ACCESS_KEY_ID}
secret_access_key = ${R2_SECRET_ACCESS_KEY}
endpoint = ${R2_ENDPOINT}
acl = private
RCLONE_CONFIG_EOF

log "Encrypting ${DUMP_FILE} for GPG recipient ${GPG_BACKUP_KEY_ID}"
gpg --batch --yes --trust-model always --recipient "$GPG_BACKUP_KEY_ID" --encrypt --output "$ENCRYPTED_FILE" "$DUMP_FILE"

LOCAL_SIZE="$(wc -c <"$ENCRYPTED_FILE" | tr -d '[:space:]')"
log "Uploading encrypted dump to r2:${R2_BUCKET}/${OBJECT_KEY}"
rclone --config "$RCLONE_CONFIG" copyto "$ENCRYPTED_FILE" "r2:${R2_BUCKET}/${OBJECT_KEY}" --s3-no-check-bucket

log "Verifying uploaded object exists and size matches"
REMOTE_SIZE="$(rclone --config "$RCLONE_CONFIG" lsf "r2:${R2_BUCKET}/${OBJECT_KEY}" --format s --s3-no-check-bucket | tr -d '[:space:]')"
if [[ -z "$REMOTE_SIZE" ]]; then
  log "ERROR: uploaded object not found: ${OBJECT_KEY}"
  exit 1
fi

if [[ "$LOCAL_SIZE" != "$REMOTE_SIZE" ]]; then
  log "ERROR: size mismatch for ${OBJECT_KEY}; local=${LOCAL_SIZE} remote=${REMOTE_SIZE}"
  exit 1
fi

log "R2 database backup complete: ${OBJECT_KEY} (${REMOTE_SIZE} bytes)"

