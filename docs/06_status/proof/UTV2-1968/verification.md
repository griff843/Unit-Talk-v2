# PROOF: UTV2-1968

MERGE_SHA: pending merge

Issue: UTV2-1968
Tier: T1
Result: READY_FOR_REVIEW_WITH_STAGING_DB_DEFERRED
Verified implementation source: `b6246af0bd0b0c280e9608889356d9ad91309e85`

## ASSERTIONS:

- [x] Production registration never uses `docker compose exec` against the live bot.
- [x] The registrar runs through `docker compose run --rm --no-deps -T` with no published ports or dependency starts.
- [x] The one-off container inherits the promoted production `discord-bot` image, env file, and network while a temporary override supplies a 256 MiB bound and the unchanged hardened registrar entrypoint.
- [x] The release record and running bot image must both match the requested promoted tag before registration starts.
- [x] The temporary override is removed on success and registrar failure; the one-off container uses `--rm`.
- [x] Registrar exit status 17 reaches the remote shell unchanged, so promotion and downstream smoke fail visibly.
- [x] Registration remains production-only, after containment confirmation and before image cleanup.

## EVIDENCE:

Focused executable regression at the implementation source:

```text
$ pnpm exec tsx --test 'scripts/ci/deploy-discord-commands.test.ts'
1..7
# tests 7
# pass 7
# fail 0
```

The extracted shell harness captured this isolated invocation shape:

```text
docker compose -f docker-compose.yml -f .discord-registration.<random>.yml run --rm --no-deps -T discord-bot
```

The parsed override asserted `mem_limit: 256m`, matching
`deploy.resources.limits.memory: 256m`, the exact registrar entrypoint, and an
empty command. The harness also asserted no `compose exec`, `up`, `restart`,
`--service-ports`, or `--publish` invocation.

## Verification

- `pnpm type-check` — PASS (exit 0).
- `pnpm test` — PASS (exit 0).
- `pnpm verify:static` — PASS (exit 0), including lint, type-check, build, full tests, Smart Form verification, command-manifest verification, and migration checks.
- `pnpm verify` — static stages PASS; final live-DB stage REFUSED (exit 1) before any DB test or write because the local target was `host=127.0.0.1 ref=unidentified`, not staging project `xskgrzbteyqdufktjrjx`.
- `pnpm test:db` — REFUSED (exit 1) by `ci:assert-staging` before `database-smoke.test.ts` executed.
- `pnpm exec tsx --test 'scripts/ci/deploy-discord-commands.test.ts'` — PASS, 7/7.

Writable live-DB proof is blocked/deferred: target identity could not be resolved
from its URL (host=unparseable). Writable DB verification requires
`xskgrzbteyqdufktjrjx`. Run it through the `staging-ci` GitHub environment with
`CI_SUPABASE_*` credentials. The measured local detail was
`host=127.0.0.1 ref=unidentified`; no writable test ran.

R-level and exact-head CI results are recorded after the proof commit/PR exists;
they are not predeclared here.

## Merge SHA Binding

No merge authority is claimed pre-merge. Post-merge lane finalization appends the
authoritative merge SHA and PR URL.

Merge SHA: pending merge
PR: awaiting GitHub assignment
