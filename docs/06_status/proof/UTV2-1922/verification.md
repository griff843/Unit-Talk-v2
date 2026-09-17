# PROOF: UTV2-1922

MERGE_SHA: 3c168746932c4646ee4e5df6b6cda655d658b6e8

> Pre-merge the merge row is intentionally the placeholder; the Execution SHA row carries
> the verified implementation identity. `post-merge-lane-close.yml` rebinds merge
> authority only after GitHub supplies the merged-PR attestation.

Generated at: 2026-09-16T21:55:00.000Z
Issue: UTV2-1922
Tier: T1
Lane type: runtime
Branch: claude/utv2-1922-deploy-promotion-transaction
PR URL: https://github.com/griff843/Unit-Talk-v2/pull/1591
Head SHA: 3e20a5ffa77f8b1215e029fab01d59dd787617b7
result: pass

## ASSERTIONS:

- [x] Every value the Command Center env file interpolates is mapped into the writing step, in both the canary and promote copies — the vacuity the 2026-09-16 outage exploited, where the pre-existing tests read only the printf text and were blind to whether the values existed.
- [x] An empty required Command Center value refuses the write and fails the deploy, instead of silently producing an env file that cannot resolve.
- [x] **PM defect 1.** The deploy-time Command Center auth check mirrors the canonical contract rather than a stricter invention: the canonical token-only configuration remains deployable, a complete username/password pair remains deployable, and a partial pair or no auth at all fails closed. The same six configurations were executed against the real fragment extracted from both env-write steps.
- [x] The deploy-time contract and `deploy/production/nextjs-entrypoint.sh` state the same three refusals, so neither half can drift into accepting a configuration the other refuses.
- [x] A deploy with the Command Center disabled removes any stale `.env.command-center` rather than leaving a 0600 file holding a service-role key on the host.
- [x] The resolved compose configuration is validated, read-only, immediately before the mutating step in both the canary and the promote job; the validation step starts nothing.
- [x] No mutation step advances `.unit-talk-release` or clears `.unit-talk-deploy-inflight` before activation has actually succeeded.
- [x] **PM defect 3.** The public edge is removed only when the failure evidence establishes the edge itself is blocking — a port conflict whose text names port 80 or 443, or a container-name conflict that names the caddy container. An unrelated Docker conflict, and a port conflict on a port the edge does not own, both restore or preserve the edge and fail. The bounded one-retry recovery for a genuine edge conflict is preserved, and a failed retry still restores the edge.
- [x] **PM defect 2.** `deploy/rollback.sh` decides the Command Center compose profile from the target release's own capability: the profile is selected only when `--command-center` was requested *and* the restored snapshot for that release actually contains `.env.command-center`; otherwise the operator is warned and the rollback proceeds without it. Without the flag the profile is never selected, snapshot or not.
- [x] `deploy/rollback.sh` restores `.env.edge`, restores `.env.command-center` when a snapshot exists and removes it when none does, and advances the release record only after activation.
- [x] Every control above was mutation-proven: 21 mutations applied, 21 caught by the assertion each was designed to target, 0 escaped, with baseline-green and restore-green both asserted.
- [x] No containment change: `SYNDICATE_MACHINE_MODE` semantics untouched, the Command Center stays internal-only behind its compose profile and `UNIT_TALK_COMMAND_CENTER_ENABLED`, no public Caddy exposure added, no secret value printed.

## EVIDENCE:

```
$ tsx --test scripts/ci/deploy-config-rollback.test.ts scripts/ci/deploy-parked-mode.test.ts scripts/ci/nextjs-deploy-wiring.test.ts
# tests 87
# pass 87
# fail 0
(43 of the 87 are nextjs-deploy-wiring.test.ts; baseline on origin/main for the same three files: 64 tests, 0 fail)

$ tsx scripts/deploy-check.ts
not ok: 0
  [PASS] staging workflow canary environment gate
  [PASS] staging workflow promotion gate
  [PASS] staging workflow promotion waits for canary
  [PASS] staging workflow validates rollback dry-run

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
Changed files: 10
Rules matched: (none) - no R-level artifacts required for this diff

$ mutation battery v2 (21 cases, M1-M21)
applied: 21  caught: 21  escaped: 0
baseline green asserted: yes   restore green asserted: yes
M1  drop CC_ENABLED from the env: mapping                     -> CAUGHT
M2  remove the fail-closed required-value loop                -> CAUGHT
M3  disabled branch stops removing .env.command-center        -> CAUGHT
M4  promote job loses its preflight validation step           -> CAUGHT
M5  rollback.sh drops .env.command-center handling            -> CAUGHT
M6  rollback.sh advances the release record before activation -> CAUGHT
M7  canary advances markers before activation                 -> CAUGHT
M8  caddy removed unconditionally, not on proven evidence     -> CAUGHT
M9  generic failure path no longer calls restore_edge         -> CAUGHT
M10 promote advances markers before activation                -> CAUGHT
M11 suite unwired from required verify                        -> CAUGHT
M12 the CC auth contract deleted from both env-write steps    -> CAUGHT
M13 token-only made undeployable again (the PM's own defect)  -> CAUGHT
M14 the partial-pair refusal is dropped                       -> CAUGHT
M15 rollback selects the profile from the flag alone          -> CAUGHT
M16 rollback never selects the profile, even when runnable    -> CAUGHT
M17 rollback selects from the snapshot, ignoring intent       -> CAUGHT
M18 a bare container-name Conflict removes the edge again     -> CAUGHT
M19 any port conflict removes the edge, not only 80/443       -> CAUGHT
M20 the stale-caddy bounded recovery is removed               -> CAUGHT
M21 the bounded recovery is disabled entirely                 -> CAUGHT
```

## Verification
- [x] `pnpm type-check`: clean, run inside `pnpm verify`
- [x] `pnpm test`: 0 `not ok`, run inside `pnpm verify`
- [x] `pnpm verify`: 0 `not ok`; exits 1 only at `ci:assert-staging`, which refuses by design outside the staging-ci GitHub environment
- [x] `npx tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD`: Verdict PASS, no R-level artifacts required for this diff
- [x] Resynced onto `main` 37062b2b26d018c84009de88a10ce5c65c0edc39 with `pnpm ops:merge-wrapper git-merge-main`. The merge brought in one file, `docs/06_status/readiness/readiness-score.json`, and nothing else; `.github/workflows/deploy.yml`, `deploy/rollback.sh` and `scripts/ci/nextjs-deploy-wiring.test.ts` are byte-identical across the sync by blob hash (`b6419fbbd91b`, `94d0f6cc7bd7`, `bacf277322f1`). No conflict occurred. The three deploy suites (87 pass, 0 fail) and the full 21-case mutation battery (21 caught, 0 escaped) were re-run on the merged tree.

## Runtime Verification

The runtime surface this lane changes is the production deploy workflow itself, which is
`workflow_dispatch`-only and whose dispatch is a reserved decision. It is therefore not executed by
this lane. Runtime proof is supplied in two parts:

1. **Behavioural execution of the real changed code.** Nothing here reads workflow text and calls it
   proof. The deploy-time auth contract is sliced out of both env-write steps and executed against
   six configurations in a clean environment; the real `PROMOTE_REMOTE` heredoc is extracted from
   `.github/workflows/deploy.yml` and executed against a bash `docker` stub in a temporary directory
   across success, configuration-failure, genuine 80/443 port-conflict, stale-caddy-name-conflict,
   foreign-port-conflict and foreign-name-conflict modes; and `deploy/rollback.sh --dry-run`'s real
   remote command is executed against a stub that refuses the `command-center` profile when
   `.env.command-center` is absent, across the flag × snapshot combinations.
2. **The live DB receipt**, harvested by CI against the merge SHA at closeout
   (`ci_db_proof_harvest`), which this bundle records as `pending merge` pre-merge.

Incident binding: Deploy run `35114935565` is the failure this repairs; run `35119502596` is the
positive control in which the same workflow succeeds because the configuration resolves.

## Merge SHA Binding

Merge SHA: 3c168746932c4646ee4e5df6b6cda655d658b6e8
PR: https://github.com/griff843/Unit-Talk-v2/pull/1591
Approved PR head: pending merge
Execution SHA: 3e20a5ffa77f8b1215e029fab01d59dd787617b7
