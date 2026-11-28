#!/usr/bin/env bash
# Command Center public edge (Caddy site + Google sign-in gate).
#
# Griff, 2026-11-25: Command Center gets a public URL on the production host,
# behind Google sign-in, superseding PM decision 7 (2026-09-24, internal-only).
#
# Two layers stand between the internet and the Command Center:
#   1. oauth2-proxy (compose service `command-center-auth`, profile
#      `command-center-public`). Caddy asks it about EVERY request with
#      forward_auth; only a Google account on COMMAND_CENTER_ALLOWED_EMAILS is
#      let through. Everything else is redirected to Google sign-in.
#   2. The Command Center's own operator sign-in (token or username/password),
#      unchanged.
#
# This script is the single place that writes, or removes, the host-side files
# that make the public edge exist. It is called from both the canary and the
# promote job, so the two can never disagree about whether the edge is on.
#
#   enabled  -> .env.command-center-auth (0600), command-center-auth/allowed-emails.txt,
#               caddy-sites/command-center.caddy (rendered with the hostname)
#   disabled -> all three removed. A Caddy site file with no gate behind it
#               would answer 502 (fail closed), but leaving it is still wrong.
#
# Usage:
#   command-center-edge.sh write   # reads env below, writes or removes over ssh
#   command-center-edge.sh render  # prints what would be written, no ssh, secrets masked
#
# Env: CC_ENABLED, CC_PUBLIC, CC_DOMAIN, CC_ALLOWED_EMAILS, GOOGLE_CLIENT_ID,
#      GOOGLE_CLIENT_SECRET, NEXTAUTH_SECRET, DEPLOY_USER, DEPLOY_HOST, DEPLOY_PATH
set -euo pipefail

MODE="${1:-}"
case "$MODE" in
  write|render) ;;
  *) echo "usage: $0 write|render" >&2; exit 2 ;;
esac

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SITE_TEMPLATE="$SCRIPT_DIR/command-center.caddy"

remote() {
  if [ "$MODE" = render ]; then
    echo "[render] ssh: $1"
    cat >/dev/null
  else
    ssh "$DEPLOY_USER@$DEPLOY_HOST" "$1"
  fi
}

disable() {
  remote "rm -f '$DEPLOY_PATH/.env.command-center-auth' '$DEPLOY_PATH/command-center-auth/allowed-emails.txt' '$DEPLOY_PATH/caddy-sites/command-center.caddy' && mkdir -p '$DEPLOY_PATH/caddy-sites' && echo 'command-center public edge absent'" </dev/null
}

if [ "${CC_PUBLIC:-}" != 'true' ]; then
  disable
  exit 0
fi

if [ "${CC_ENABLED:-}" != 'true' ]; then
  echo "::error::UNIT_TALK_COMMAND_CENTER_PUBLIC is 'true' but UNIT_TALK_COMMAND_CENTER_ENABLED is not. A public edge with no Command Center behind it is refused." >&2
  exit 1
fi

missing=()
for name in CC_DOMAIN CC_ALLOWED_EMAILS GOOGLE_CLIENT_ID GOOGLE_CLIENT_SECRET NEXTAUTH_SECRET; do
  [ -n "${!name:-}" ] || missing+=("$name")
done
if [ ${#missing[@]} -gt 0 ]; then
  echo "::error::Command Center public edge is enabled but these values are empty: ${missing[*]}. Refusing to write a partial configuration." >&2
  exit 1
fi

# The hostname is rendered into a Caddy site file, so it must be a hostname and
# nothing else.
if ! printf '%s' "$CC_DOMAIN" | grep -Eq '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$'; then
  echo "::error::UNIT_TALK_COMMAND_CENTER_DOMAIN is not a lowercase hostname. Refusing to render the Caddy site." >&2
  exit 1
fi

# Allow-list: comma or whitespace separated, one address per line in the file.
# Every entry must look like an email; an empty list admits nobody, which is
# refused here rather than discovered as "nobody can sign in".
emails="$(printf '%s' "$CC_ALLOWED_EMAILS" | tr ',; ' '\n\n\n' | tr -d '\r' | tr 'A-Z' 'a-z' | sed '/^$/d' | sort -u)"
if [ -z "$emails" ]; then
  echo "::error::COMMAND_CENTER_ALLOWED_EMAILS has no entries. Refusing to start a sign-in gate that admits nobody." >&2
  exit 1
fi
while IFS= read -r e; do
  if ! printf '%s' "$e" | grep -Eq '^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$'; then
    echo "::error::COMMAND_CENTER_ALLOWED_EMAILS contains an entry that is not an email address. Refusing." >&2
    exit 1
  fi
done <<<"$emails"

# oauth2-proxy needs a 32-byte cookie secret. It is DERIVED from NEXTAUTH_SECRET
# with a fixed, purpose-specific label (HMAC-SHA256), so no new secret has to be
# provisioned and the value never equals any other key in use. Rotating
# NEXTAUTH_SECRET rotates it too, which signs every operator out: intended.
cookie_secret="$(printf '%s' 'unit-talk/command-center-auth/cookie/v1' \
  | openssl dgst -sha256 -hmac "$NEXTAUTH_SECRET" -binary | base64 | tr '+/' '-_' | tr -d '=\n')"
if [ "${#cookie_secret}" -ne 43 ]; then
  echo "::error::cookie secret derivation produced an unexpected length. Refusing." >&2
  exit 1
fi

env_file="$(printf '%s\n' \
  "OAUTH2_PROXY_PROVIDER=google" \
  "OAUTH2_PROXY_CLIENT_ID=$GOOGLE_CLIENT_ID" \
  "OAUTH2_PROXY_CLIENT_SECRET=$GOOGLE_CLIENT_SECRET" \
  "OAUTH2_PROXY_COOKIE_SECRET=$cookie_secret" \
  "OAUTH2_PROXY_REDIRECT_URL=https://$CC_DOMAIN/oauth2/callback" \
  "OAUTH2_PROXY_WHITELIST_DOMAINS=$CC_DOMAIN" \
  "OAUTH2_PROXY_AUTHENTICATED_EMAILS_FILE=/etc/oauth2-proxy/allowed-emails.txt" \
  "OAUTH2_PROXY_HTTP_ADDRESS=0.0.0.0:4180" \
  "OAUTH2_PROXY_REVERSE_PROXY=true" \
  "OAUTH2_PROXY_UPSTREAMS=static://202" \
  "OAUTH2_PROXY_SET_XAUTHREQUEST=true" \
  "OAUTH2_PROXY_SKIP_PROVIDER_BUTTON=true" \
  "OAUTH2_PROXY_COOKIE_NAME=_ut_cc_sso" \
  "OAUTH2_PROXY_COOKIE_SECURE=true" \
  "OAUTH2_PROXY_COOKIE_HTTPONLY=true" \
  "OAUTH2_PROXY_COOKIE_SAMESITE=lax" \
  "OAUTH2_PROXY_COOKIE_EXPIRE=12h" \
  "OAUTH2_PROXY_SHOW_DEBUG_ON_ERROR=false" \
  "OAUTH2_PROXY_SILENCE_PING_LOGGING=true")"

site="$(sed "s/__COMMAND_CENTER_DOMAIN__/$CC_DOMAIN/g" "$SITE_TEMPLATE")"
if printf '%s' "$site" | grep -q '__COMMAND_CENTER_DOMAIN__'; then
  echo "::error::Caddy site template did not render. Refusing." >&2
  exit 1
fi

if [ "$MODE" = render ]; then
  printf '%s\n' "$env_file" | sed -E 's/^(OAUTH2_PROXY_(CLIENT_SECRET|COOKIE_SECRET|CLIENT_ID))=.*/\1=***/'
  echo '--- allowed-emails.txt'
  printf '%s\n' "$emails" | sed -E 's/^[^@]+/***/'
  echo '--- caddy-sites/command-center.caddy'
  printf '%s\n' "$site"
  exit 0
fi

printf '%s\n' "$env_file" | remote "cat > '$DEPLOY_PATH/.env.command-center-auth' && chmod 600 '$DEPLOY_PATH/.env.command-center-auth' && echo 'env.command-center-auth written'"
# Readable by the proxy's non-root user; it holds addresses, not credentials.
printf '%s\n' "$emails" | remote "mkdir -p '$DEPLOY_PATH/command-center-auth' && cat > '$DEPLOY_PATH/command-center-auth/allowed-emails.txt' && chmod 644 '$DEPLOY_PATH/command-center-auth/allowed-emails.txt' && echo 'command-center allow-list written ($(printf '%s\n' "$emails" | wc -l | tr -d ' ') entries)'"
printf '%s\n' "$site" | remote "mkdir -p '$DEPLOY_PATH/caddy-sites' && cat > '$DEPLOY_PATH/caddy-sites/command-center.caddy' && chmod 644 '$DEPLOY_PATH/caddy-sites/command-center.caddy' && echo 'caddy site command-center.caddy written'"
