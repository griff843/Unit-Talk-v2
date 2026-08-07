# PROOF: UTV2-1648

MERGE_SHA: 1981cfacf59a501ffdb77423fa7a7c5c4af7aae5

That SHA is the implementation commit on this branch (an ancestor of the PR
head), per `executor-result-validator.yml`'s documented allowance. It is
rebound to the real squash-merge SHA post-merge by `post-merge-lane-close.yml`
via `ops:proof-generate --merge-sha`.

## Summary

Live incident, 2026-08-01: the parked-mode deploy dispatched right after
UTV2-1646 merged failed at the `canary` job's "Authenticate GHCR on remote"
step: `Error response from daemon: Get "https://ghcr.io/v2/": denied: denied`.
The `GHCR_PAT` repository secret (a long-lived PAT used to `docker login` on
the remote Hetzner host) is invalid or lacks registry permission.

No containers were touched -- the failure happened before any
`docker compose pull`/`up`; `.env.production` had already been written
correctly (`SYNDICATE_MACHINE_MODE: parked` confirmed in the job env log).
`promote`/`smoke` correctly never ran as a consequence.

PM decision: do not regenerate/replace the PAT. Remove the standing-credential
dependency entirely.

## Fix

`build` already authenticates to the same registry with the ephemeral,
per-run `secrets.GITHUB_TOKEN` (via `docker/login-action@v3`) to push these
exact images. `canary`/`promote` only need to *pull* what `build` just
pushed, so the same repository-scoped token (`github.token`) is sufficient.

In both `canary` and `promote`:

- Added job-level `permissions: { contents: read, packages: read }`,
  overriding the workflow-level `packages: write` default that only `build`
  needs.
- "Authenticate GHCR on remote" now does
  `printf '%s' "$REGISTRY_TOKEN" | ssh ... "docker login ghcr.io -u ${{ github.actor }} --password-stdin"`
  with `REGISTRY_TOKEN: ${{ github.token }}` passed via `env:` (never inlined
  into the script body), mirroring the exact pattern the retired `GHCR_PAT`
  step used.
- New "Preflight — verify registry auth and resolve all 4 image tags" step,
  inserted after auth and before any container mutation: `docker pull`s each
  of `api`/`worker`/`ingestor`/`discord-bot` at the resolved `IMAGE_TAG` on
  the remote host, and `exit 1`s with no mutation attempted if any fail.

`canary` only ever starts the `api` container (`--no-deps api`), but its
preflight checks all four services up front -- catching an auth/resolution
problem before touching even that one container, rather than discovering it
mid-`promote`. `promote` runs on a fresh runner with its own SSH session, so
it repeats the same preflight independently rather than assuming canary's
auth state carried over.

## Verification

- `pnpm type-check` -- PASS
- `pnpm lint` -- PASS
- YAML validity check -- PASS
- `npx tsx --test scripts/ci/deploy-parked-mode.test.ts` -- 15/15 pass (10 pre-existing + 5 new)
- `pnpm test` (full composite suite) -- 4386/4386 pass, 0 fail

## ASSERTIONS:

- [x] No workflow file references `secrets.GHCR_PAT` or a `GHCR_PAT` env var anywhere.
- [x] `canary` and `promote` both authenticate via `github.token` + `github.actor`, never a hardcoded login or standing secret.
- [x] `canary` and `promote` both declare `permissions: { contents: read, packages: read }` -- scoped down from the workflow-level `packages: write` default.
- [x] A new registry preflight step exists in both jobs, runs after auth and before the container-mutation step, checks all four services, and fails closed (`exit 1`) with no mutation attempted if any image doesn't resolve.
- [x] 5 new adversarial drift tests, each reintroducing one specific piece of the retired pattern, confirm the static audit catches it.
- [x] `pnpm type-check`, `pnpm lint`, and the full `pnpm test` composite suite are all green with zero failures.

## EVIDENCE:

```text
$ npx tsx --test scripts/ci/deploy-parked-mode.test.ts
TAP version 13
ok 1 - deploy workflow has one fail-closed parked-mode contract across every gate
ok 2 - canonical deploy validator accepts parked and active modes with truthful output
ok 3 - canonical deploy validator rejects missing, case-variant, padded, and unknown values
ok 4 - static deploy audit detects canary or production mode drift
ok 5 - static deploy audit detects a hardcoded active-mode receipt
ok 6 - static deploy audit detects a hardcoded UNIT_TALK_INGESTOR_AUTORUN
ok 7 - static deploy audit detects a hardcoded UNIT_TALK_WORKER_AUTORUN
ok 8 - static deploy audit detects UNIT_TALK_ENABLED_TARGETS falling back to best-bets instead of forcing none in parked mode
ok 9 - static deploy audit detects a missing production ingestor/worker container confirmation
ok 10 - static deploy audit detects a missing parked-mode UNIT_TALK_ENABLED_TARGETS container assertion
ok 11 - static deploy audit detects a reintroduced GHCR_PAT secret
ok 12 - static deploy audit detects a hardcoded registry username instead of github.actor
ok 13 - static deploy audit detects canary/production still granted packages: write
ok 14 - static deploy audit detects a missing registry preflight step
ok 15 - static deploy audit detects a registry preflight that does not fail closed
1..15
# tests 15
# pass 15
# fail 0

$ grep -rn "GHCR_PAT" .github/workflows/
(no functional references remain -- only explanatory comments naming the retired secret for context)
```
