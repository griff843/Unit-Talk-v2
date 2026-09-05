# DIFF SUMMARY: UTV2-1834

MERGE_SHA: 1d76b75e1296871346284c50032b706009416fc6

Execution SHA: 901bce784354ee4b2098611bc0278c04c13209da
Branch: claude/utv2-1834-deploy-config-rollback
Base: 879569a1ba762499fadee24aa0041a216f208391

## Files changed

| File | Change |
|---|---|
| `.github/workflows/deploy.yml` | +82 — a `Snapshot outgoing configuration for rollback` step added to the `canary` and `promote` jobs, between `Install SSH key` and the first env write |
| `deploy/rollback.sh` | +9 — restore the snapshot matching `$TAG` before `docker compose up`; warn and continue when absent |
| `scripts/ci/deploy-config-rollback.test.ts` | +232 — new; 9 tests, structural plus a functional round trip |
| `package.json` | +1 word — the new test added to the `test:ops` list, next to `deploy-parked-mode.test.ts` |
| `docs/05_operations/REQUIRED_SECRETS.md` | 1 line — `ALLOWED_CAPPER_EMAILS` purpose corrected to the current shape |
| `deploy/production/ENV_FILES.md` | 1 line → 4 — same correction |
| `.ops/sync/UTV2-1834.yml`, `docs/06_status/lanes/UTV2-1834.json`, `docs/06_status/proof/UTV2-1834/.gitkeep` | lane control-plane artifacts written by `ops:lane-start` |

## What changed behaviourally

**Before.** `deploy.yml` overwrote `.env.production`, `.env.web` and `.env.smart-form` in
place on every deploy, destroying the previous contents. `deploy/rollback.sh` rewrote
`.unit-talk-release` and re-pulled images, touching no env file. Rolling back therefore
restored the old image against the *new* configuration.

**After.** Each deploy first copies the three env files to `<file>.<outgoing-release-tag>`
at mode 0600, keyed on the tag the host still holds at that moment. A rollback to that tag
restores those exact files before starting the containers that read them.

## Why the ordering is load-bearing

`deploy.yml` advances `.unit-talk-release` only *after* the env writes (canary 579-580,
promote 1064). The snapshot step is therefore inserted **before** the first write, where the
host still holds the outgoing tag — the key a later `rollback.sh --tag <outgoing>` looks up.
A snapshot placed one step later would capture the incoming configuration under the outgoing
name and silently make rollback worse than useless. The test asserts step *index*, not
presence, for exactly this reason, and mutation M1 confirms it refuses the reordering.

## Bounded by design

- No application code, package source, schema or migration is touched.
- No gate, tier, merge-authority surface, CODEOWNERS entry or branch-protection input is
  touched. `merge-gate.yml` is not modified.
- Nothing `deploy.yml` *writes* into any env file is changed; only what is preserved
  beforehand.
- The pre-existing `rollback-dry-run` job's invocation still exits 0.
- Snapshots contain secrets, so each file retains only its five most recent copies.

## Residual risk, stated rather than papered over

The snapshot has not been observed running against the production host, and cannot be
without dispatching a `Deploy` run — a reserved action. What is proven is that the exact
shell bodies the deploy and rollback would send execute correctly against a temp directory
and restore byte-identical contents at mode 0600.
