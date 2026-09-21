#!/usr/bin/env bash
set -euo pipefail

DRY_RUN=false
# UTV2-1922: default false, so a rollback invoked without this flag emits the
# byte-identical compose commands it always has.
COMMAND_CENTER=false
TAG=""
HOST="${UNIT_TALK_DEPLOY_HOST:-}"
USER="${UNIT_TALK_DEPLOY_USER:-}"
DEPLOY_PATH="${UNIT_TALK_DEPLOY_PATH:-}"

usage() {
  cat <<'USAGE'
Usage: deploy/rollback.sh --tag <image-tag> [--host <host>] [--user <user>] [--path <remote-path>] [--command-center] [--dry-run]

--command-center selects the `command-center` compose profile, so a rollback to
a release that ran the Command Center brings it back. Without it the profile is
not selected and the surface stays down, which is the correct default.

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
    --command-center)
      COMMAND_CENTER=true
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

# UTV2-1922: the profile is selected through COMPOSE_PROFILES rather than a
# `--profile` flag spliced into the command. Two consumers make that the right
# shape rather than a stylistic choice:
#   * scripts/deploy-check.ts asserts two literal strings in this file -- the
#     full activation command and `UNIT_TALK_IMAGE_TAG='$TAG'` -- and a flag
#     spliced into the middle of the command breaks the first one silently;
#   * deploy-config-rollback.test.ts scans this file as TEXT and requires the
#     restore loop to appear before the first activation command. Branching into
#     two literal command forms up here -- or even naming that command in a
#     comment above the loop -- puts one on the wrong side of that line.
# An empty COMPOSE_PROFILES selects no profile, which is the pre-UTV2-1922
# behaviour byte for byte.
#
# UTV2-1922 (PM CHANGES_REQUIRED, defect 2): --command-center is now operator
# INTENT, not the decision. The decision is made remotely, from the target
# release's own restored configuration -- see the profile block inside the
# remote script below.

REMOTE_COMMAND=$(cat <<EOF
set -eu
cd '$DEPLOY_PATH'
if [ -f .unit-talk-release ]; then cp .unit-talk-release .unit-talk-release.failed; fi
# UTV2-1922: .env.edge carries the three hostnames Caddy needs to parse its own
# config, so a rollback that skipped it restored an edge configured by the
# release it was rolling away from.
for f in .env.production .env.web .env.smart-form .env.edge; do
  if [ -f "\$f.$TAG" ]; then
    cp -p "\$f.$TAG" "\$f"
    chmod 600 "\$f"
    echo "restored \$f from configuration snapshot $TAG"
  else
    echo "WARNING: no configuration snapshot for $TAG at \$f.$TAG - code rolled back, configuration did not" >&2
  fi
done
# UTV2-1922: .env.command-center is restored the same way, but its ABSENCE
# means something the other files' absence does not. Rolling back to a release
# that did not run the Command Center must leave no Command Center
# configuration behind: a stale 0600 file holding the service-role key and an
# operator credential would otherwise survive the rollback and sit waiting for
# the next profile selection.
if [ -f ".env.command-center.$TAG" ]; then
  cp -p ".env.command-center.$TAG" .env.command-center
  chmod 600 .env.command-center
  echo "restored .env.command-center from configuration snapshot $TAG"
else
  rm -f .env.command-center
  echo "no .env.command-center snapshot for $TAG - removed any stale Command Center configuration"
fi
# UTV2-1922 (PM CHANGES_REQUIRED, defect 2): select the profile from the TARGET
# release's own configuration, never from the operator's flag alone. The block
# above has just made .env.command-center exist if and only if this tag has a
# snapshot of it, so its presence is the capability test. Selecting
# \`command-center\` without it would make compose refuse to resolve the env_file
# it interpolates -- reintroducing, on the recovery path, the exact class of
# failure this lane exists to prevent, at the moment the edge is least able to
# absorb it.
ROLLBACK_PROFILES=''
if [ '$COMMAND_CENTER' = true ]; then
  if [ -f .env.command-center ]; then
    ROLLBACK_PROFILES='command-center'
    echo 'command-center profile selected: $TAG has a Command Center configuration snapshot'
  else
    echo 'WARNING: --command-center was requested, but $TAG has no .env.command-center snapshot - the profile is NOT selected and the rollback proceeds without the Command Center' >&2
  fi
fi
COMPOSE_PROFILES="\$ROLLBACK_PROFILES" UNIT_TALK_IMAGE_TAG='$TAG' docker compose pull
COMPOSE_PROFILES="\$ROLLBACK_PROFILES" UNIT_TALK_IMAGE_TAG='$TAG' docker compose up -d --remove-orphans
# UTV2-1922: the release record is advanced only after the rollback has
# actually activated. It used to be the FIRST thing written, so a rollback that
# failed at `docker compose up` left the host naming a release it had not
# started -- the same false-advance that made the 2026-09-16 outage unreadable
# from the host's own metadata.
printf '%s\n' '$TAG' > .unit-talk-release
EOF
)

if [ "$DRY_RUN" = true ]; then
  echo "Rollback dry run passed for tag: $TAG"
  echo "$REMOTE_COMMAND"
  exit 0
fi

ssh "$USER@$HOST" "$REMOTE_COMMAND"
