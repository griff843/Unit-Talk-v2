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

if [ "$APP_DIR" = 'apps/command-center' ]; then
  # UTV2-1918. Before this branch existed a third app started with NO startup
  # validation at all, because the guard above is keyed on smart-form alone.
  #
  # Every check here mirrors an assertion the application itself already makes,
  # deliberately rather than inventing a second policy: the app would throw on
  # the first request that reached the relevant code path, which is a container
  # that passes its healthcheck (`/api/health` answers before auth) while being
  # unusable. This is defence in depth and never a substitute for those asserts.

  # assertCommandCenterAuthConfig (src/lib/server-api.ts): a PARTIAL basic-auth
  # pair is its own error, checked before the has-any-credential check, because
  # "username set, password missing" is a misconfiguration that must not silently
  # fall back to the token branch.
  if [ -n "${COMMAND_CENTER_AUTH_USERNAME:-}" ] && [ -z "${COMMAND_CENTER_AUTH_PASSWORD:-}" ]; then
    echo "FATAL: COMMAND_CENTER_AUTH_USERNAME is set without COMMAND_CENTER_AUTH_PASSWORD. Refusing to start." >&2
    exit 1
  fi
  if [ -z "${COMMAND_CENTER_AUTH_USERNAME:-}" ] && [ -n "${COMMAND_CENTER_AUTH_PASSWORD:-}" ]; then
    echo "FATAL: COMMAND_CENTER_AUTH_PASSWORD is set without COMMAND_CENTER_AUTH_USERNAME. Refusing to start." >&2
    exit 1
  fi
  if [ -z "${COMMAND_CENTER_AUTH_TOKEN:-}" ] \
    && { [ -z "${COMMAND_CENTER_AUTH_USERNAME:-}" ] || [ -z "${COMMAND_CENTER_AUTH_PASSWORD:-}" ]; }; then
    echo "FATAL: Command Center auth is not configured. Set COMMAND_CENTER_AUTH_TOKEN or COMMAND_CENTER_AUTH_USERNAME/PASSWORD. Refusing to start." >&2
    exit 1
  fi

  # assertCommandCenterApiKeyConfig (same module): privileged API actions refuse
  # without it, so a Command Center without it is a read-only shell that looks
  # whole until an operator tries to act.
  if [ -z "${UNIT_TALK_CC_API_KEY:-}" ]; then
    echo "FATAL: UNIT_TALK_CC_API_KEY is not set; privileged Command Center actions would fail. Refusing to start." >&2
    exit 1
  fi

  # getDataClient (src/lib/data/client.ts) opens a SERVICE-ROLE Supabase client.
  # Both halves are required; the anon key is not a substitute and is not used.
  if [ -z "${SUPABASE_URL:-}" ] || [ -z "${SUPABASE_SERVICE_ROLE_KEY:-}" ]; then
    echo "FATAL: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are both required by the Command Center data client. Refusing to start." >&2
    exit 1
  fi

  # isCommandCenterAuthRequired treats development environments as a positive
  # allow-list and an unrecognised value falls through to "auth required", so an
  # unset value is not itself unsafe. Assert it anyway: a production container
  # whose environment does not say production is a deploy defect, and the value
  # also selects which configuration layers the app loads.
  if [ "${UNIT_TALK_APP_ENV:-}" != 'production' ]; then
    echo "FATAL: UNIT_TALK_APP_ENV must be 'production' in the deployed Command Center (got '${UNIT_TALK_APP_ENV:-<unset>}'). Refusing to start." >&2
    exit 1
  fi
fi

cd "$APP_DIR"
exec pnpm exec next start -p "$PORT" -H 0.0.0.0
