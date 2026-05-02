#!/usr/bin/env bash
set -euo pipefail

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

for env_name in R2_BUCKET R2_ENDPOINT R2_ACCOUNT_ID R2_ACCESS_KEY_ID R2_SECRET_ACCESS_KEY GPG_BACKUP_KEY_ID; do
  require_env "$env_name"
done

command -v gpg >/dev/null 2>&1 || { log "ERROR: gpg is required"; exit 1; }
command -v rclone >/dev/null 2>&1 || { log "ERROR: rclone is required"; exit 1; }
command -v tar >/dev/null 2>&1 || { log "ERROR: tar is required"; exit 1; }

TMP_DIR="$(mktemp -d)"
trap cleanup EXIT

TIMESTAMP="$(date -u '+%Y%m%d%H%M%S')"
DAY_PATH="$(date -u '+%Y/%m/%d')"
ARCHIVE_FILE="${TMP_DIR}/configs-${TIMESTAMP}.tar.gz"
ENCRYPTED_FILE="${TMP_DIR}/configs-${TIMESTAMP}.tar.gz.gpg"
OBJECT_KEY="config-backups/${DAY_PATH}/configs-${TIMESTAMP}.tar.gz.gpg"
RCLONE_CONFIG="${TMP_DIR}/rclone.conf"

INCLUDE_PATHS=()
shopt -s nullglob
for compose_file in docker-compose*.yml; do
  INCLUDE_PATHS+=("$compose_file")
done
for nginx_path in nginx conf/nginx config/nginx configs/nginx deploy/nginx infrastructure/nginx infra/nginx; do
  if [[ -e "$nginx_path" ]]; then
    INCLUDE_PATHS+=("$nginx_path")
  fi
done
if [[ -d docs/ops ]]; then
  INCLUDE_PATHS+=("docs/ops")
fi
if [[ -f scripts/deploy.sh ]]; then
  INCLUDE_PATHS+=("scripts/deploy.sh")
fi
shopt -u nullglob

if (( ${#INCLUDE_PATHS[@]} == 0 )); then
  log "ERROR: no configuration paths found to archive"
  exit 1
fi

cat >"$RCLONE_CONFIG" <<RCLONE_CONFIG_EOF
[r2]
type = s3
provider = Cloudflare
access_key_id = ${R2_ACCESS_KEY_ID}
secret_access_key = ${R2_SECRET_ACCESS_KEY}
endpoint = ${R2_ENDPOINT}
acl = private
RCLONE_CONFIG_EOF

log "Creating configuration archive"
tar \
  --exclude='*.env' \
  --exclude='*.pem' \
  --exclude='*.key' \
  --exclude='local.env' \
  --exclude='.env.*' \
  --exclude='.env' \
  -czf "$ARCHIVE_FILE" \
  "${INCLUDE_PATHS[@]}"

log "Encrypting configuration archive for GPG recipient ${GPG_BACKUP_KEY_ID}"
gpg --batch --yes --trust-model always --recipient "$GPG_BACKUP_KEY_ID" --encrypt --output "$ENCRYPTED_FILE" "$ARCHIVE_FILE"

log "Uploading encrypted configuration archive to r2:${R2_BUCKET}/${OBJECT_KEY}"
rclone --config "$RCLONE_CONFIG" copyto "$ENCRYPTED_FILE" "r2:${R2_BUCKET}/${OBJECT_KEY}" --s3-no-check-bucket

log "R2 configuration backup complete: ${OBJECT_KEY}"

