# Diff summary: UTV2-1968

| File                                         | Change                                                                                                                                                                                                                                                                                                                  |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.github/workflows/deploy.yml`               | Replaces registration inside the live 128 MiB bot with a disposable `docker compose run --rm --no-deps -T` container. A trapped temporary override preserves the promoted production service image/env/network, selects the hardened registrar as its entrypoint, and gives only the one-off container a 256 MiB limit. |
| `scripts/ci/deploy-discord-commands.test.ts` | Executes the extracted remote shell against a fake Docker harness and proves isolation, exact image/tag propagation, bounded memory, explicit registrar entrypoint, cleanup, refusal of stale release/image state, and exact registrar failure propagation.                                                             |

No bot source, package, production Compose manifest, role, delivery, or database files changed.

## SHA Binding

Verified implementation source: `b6246af0bd0b0c280e9608889356d9ad91309e85`

Authoritative merge SHA and PR binding are appended only by post-merge closeout.

PR: https://github.com/griff843/Unit-Talk-v2/pull/1713
