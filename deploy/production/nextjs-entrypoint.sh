#!/bin/sh
# UTV2-1795 — runtime entrypoint for the shared Next.js production image.
#
# Fails closed before the server ever binds a port. Every check here names a
# condition that would otherwise produce a container that looks healthy while
# being wrong in a way nobody would notice from the outside.
set -eu

: "${APP_DIR:?APP_DIR is not set; the image was built without an app}"
: "${PORT:?PORT is not set; the image was built without a port}"

BUILD_PLACEHOLDER='nextauth-build-only-placeholder-not-a-secret'

if [ "$APP_DIR" = 'apps/smart-form' ]; then
  # A missing secret would throw on the first request instead of at startup; the
  # placeholder would sign sessions with a value published in the Dockerfile.
  if [ -z "${NEXTAUTH_SECRET:-}" ]; then
    echo "FATAL: NEXTAUTH_SECRET is not set. Refusing to start the intake surface." >&2
    exit 1
  fi
  if [ "${NEXTAUTH_SECRET}" = "$BUILD_PLACEHOLDER" ]; then
    echo "FATAL: NEXTAUTH_SECRET is still the build-time placeholder. Refusing to start." >&2
    exit 1
  fi
  # An empty allow-list admits nobody, which is the correct failure, but it is a
  # silent one: sign-in fails for everybody while the container reports healthy.
  # Refuse to start instead, so a misconfigured deploy is visible immediately.
  if [ -z "${ALLOWED_CAPPER_EMAILS:-}" ]; then
    echo "FATAL: ALLOWED_CAPPER_EMAILS is empty. No account could sign in; refusing to start." >&2
    exit 1
  fi
  if [ -z "${GOOGLE_CLIENT_ID:-}" ] || [ -z "${GOOGLE_CLIENT_SECRET:-}" ]; then
    echo "FATAL: Google OAuth credentials are not configured. Refusing to start." >&2
    exit 1
  fi
  if [ -z "${NEXTAUTH_URL:-}" ]; then
    echo "FATAL: NEXTAUTH_URL is not set; the Google callback URI would be wrong. Refusing to start." >&2
    exit 1
  fi
fi

cd "$APP_DIR"
exec pnpm exec next start -p "$PORT" -H 0.0.0.0
