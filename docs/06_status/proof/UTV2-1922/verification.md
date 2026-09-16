# PROOF: UTV2-1922

MERGE_SHA: pending merge

> Pre-merge the merge row is intentionally the placeholder; the Execution SHA row carries
> the verified implementation identity. `post-merge-lane-close.yml` rebinds merge
> authority only after GitHub supplies the merged-PR attestation.

Generated at: 2026-09-16T17:31:16.971Z
Issue: UTV2-1922
Tier: T1
Lane type: runtime
Branch: claude/utv2-1922-deploy-promotion-transaction
PR URL: https://github.com/griff843/Unit-Talk-v2/pull/1591
Head SHA: 84411a21bea3e3f99b92b35340f59f3bb3a250b2
result: pass

## ASSERTIONS:

- [x] Every value the Command Center env file interpolates is mapped into the writing step, in both the canary and promote copies — the vacuity the 2026-09-16 outage exploited, where the pre-existing tests read only the printf text and were blind to whether the values existed.
- [x] An empty required Command Center value refuses the write and fails the deploy, instead of silently producing an env file that cannot resolve.
- [x] A deploy with the Command Center disabled removes any stale `.env.command-center` rather than leaving a 0600 file holding a service-role key on the host.
- [x] The resolved compose configuration is validated, read-only, immediately before the mutating step in both the canary and the promote job; the validation step starts nothing.
- [x] No mutation step advances `.unit-talk-release` or clears `.unit-talk-deploy-inflight` before activation has actually succeeded.
- [x] The public edge is removed only on a failure whose text proves a port conflict, and is restored on any other failure or a failed retry — so a configuration error can no longer leave the edge unserved.
- [x] `deploy/rollback.sh` restores `.env.edge`, restores `.env.command-center` when a snapshot exists and removes it when none does, and advances the release record only after activation.
- [x] Every control above was mutation-proven: 11 mutations applied, 11 caught by the assertion each was designed to target, 0 escaped, with baseline-green and restore-green both asserted.
- [x] No containment change: `SYNDICATE_MACHINE_MODE` semantics untouched, the Command Center stays internal-only behind its compose profile and `UNIT_TALK_COMMAND_CENTER_ENABLED`, no public Caddy exposure added, no secret value printed.

## EVIDENCE:

```
$ tsx --test scripts/ci/deploy-config-rollback.test.ts scripts/ci/deploy-parked-mode.test.ts scripts/ci/nextjs-deploy-wiring.test.ts
# tests 78
# pass 78
# fail 0
(baseline on origin/main for the same three files: 64 tests, 0 fail)

$ tsx scripts/deploy-check.ts
not ok: 0

$ pnpm type-check
(clean — run inside pnpm verify below)

$ pnpm test
(clean — run inside pnpm verify below; 0 `not ok` across the TAP stream)

$ pnpm verify
not ok: 0
exit code 1 at ci:assert-staging:
  [assert-staging] host=127.0.0.1 ref=unidentified expected=xskgrzbteyqdufktjrjx
  [assert-staging] REFUSED: target identity could not be resolved from its URL.
  Writable DB verification requires xskgrzbteyqdufktjrjx. Run it through the
  staging-ci GitHub environment with CI_SUPABASE_* credentials.
This refusal is by design outside the staging-ci environment and is not a test failure.
CI's required `verify` check on this head is the binding authority.

$ npx tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD
Verdict: PASS
Changed files: 7
Rules matched: (none) - no R-level artifacts required for this diff

$ mutation battery (11 cases, M1-M11)
applied: 11  caught: 11  escaped: 0
baseline green asserted: yes   restore green asserted: yes
M1  drop CC_ENABLED from the env: mapping                  -> CAUGHT
M2  remove the fail-closed required-value loop             -> CAUGHT
M3  disabled branch stops removing .env.command-center     -> CAUGHT
M4  promote job loses its preflight validation step        -> CAUGHT
M5  validation step moved after the mutation step          -> CAUGHT
M6  promote advances .unit-talk-release before activation  -> CAUGHT
M7  canary advances markers before activation              -> CAUGHT
M8  caddy removed unconditionally, not on a proven conflict-> CAUGHT
M9  generic failure path no longer calls restore_edge      -> CAUGHT
M10 rollback.sh drops .env.edge from the restore loop      -> CAUGHT
M11 rollback.sh advances the release record before activation -> CAUGHT
```

## Verification
- [x] `pnpm type-check`: clean, run inside `pnpm verify`
- [x] `pnpm test`: 0 `not ok`, run inside `pnpm verify`
- [x] `pnpm verify`: 0 `not ok`; exits 1 only at `ci:assert-staging`, which refuses by design outside the staging-ci GitHub environment
- [x] `npx tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD`: Verdict PASS, no R-level artifacts required for this diff

## Runtime Verification

The runtime surface this lane changes is the production deploy workflow itself, which is
`workflow_dispatch`-only and whose dispatch is a reserved decision. It is therefore not executed by
this lane. Runtime proof is supplied in two parts:

1. **Behavioural execution of the real changed code.** Five of the new cases extract the actual
   `PROMOTE_REMOTE` heredoc from `.github/workflows/deploy.yml` and execute it against a bash
   `docker` stub in a temporary directory, asserting the resulting release markers and edge state:
   a successful promotion advances both markers and never touches the edge; a configuration failure
   cannot leave the edge unserved; a failed activation leaves release metadata describing reality;
   a genuine port conflict is still recovered; and a port conflict whose retry fails still restores
   the edge.
2. **The live DB receipt**, harvested by CI against the merge SHA at closeout
   (`ci_db_proof_harvest`), which this bundle records as `pending merge` pre-merge.

Incident binding: Deploy run `35114935565` is the failure this repairs; run `35119502596` is the
positive control in which the same workflow succeeds because the configuration resolves.

## Merge SHA Binding

Merge SHA: pending merge
PR: https://github.com/griff843/Unit-Talk-v2/pull/1591
Approved PR head: pending merge
Execution SHA: 84411a21bea3e3f99b92b35340f59f3bb3a250b2
