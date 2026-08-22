# PROOF: UTV2-1732

MERGE_SHA: ca1723b5c337643dd3e1dd6ec32b15d5323d322c

> Pre-merge this anchor is the verified substantive implementation SHA. Post-merge closeout must rebind it to the authoritative merge SHA.

Issue: UTV2-1732

Tier: T1

Lane type: governance

PR: https://github.com/griff843/Unit-Talk-v2/pull/1437

Verified source SHA: `ca1723b5c337643dd3e1dd6ec32b15d5323d322c`

Generated: 2026-08-22T06:06:39Z

## EVIDENCE:

## Verification

- PASS — `pnpm type-check`
- PASS — `pnpm lint`
- PASS — `pnpm verify:static`
- PASS — `pnpm test` as exercised by `pnpm verify:static`; the root aggregate reported 2,340 passing tests with zero failures, followed by all package verification suites.
- PASS — focused issue suite:

  ```text
  $ pnpm exec tsx --test 'scripts/ops/claude-exec.test.ts' 'scripts/ops/codex-exec.test.ts' 'scripts/ops/execution-checkpoint.test.ts' 'scripts/ops/execution-packet.test.ts' 'scripts/ops/lane-start.test.ts'
  1..144
  # tests 144
  # pass 144
  # fail 0
  # skipped 0
  ```

- PASS — `npx tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD`

  ```text
  Verdict: PASS
  Changed files: 16
  Rules matched: (none) — no R-level artifacts required for this diff
  ```

- DEFERRED — `pnpm test:db` / writable live-DB proof. Writable live-DB proof is blocked/deferred: target identity could not be resolved from its URL (host=unparseable). Writable DB verification requires `xskgrzbteyqdufktjrjx`. Run it through the `staging-ci` GitHub environment with `CI_SUPABASE_*` credentials.

## ASSERTIONS:

- PASS — lane admission captures objective, acceptance criteria, guardrails, non-goals, required evidence, exit criteria, and the exact Linear source snapshot before executor spawn.
- PASS — missing objective or acceptance criteria fails task-contract construction; missing or tampered contracts fail packet generation.
- PASS — a closed completed/rejected checkpoint accepts one operator correction brief, seals its exact content, and supplies original task plus unresolved findings and corrections to rework.
- PASS — task-contract SHA-256 and correction SHA-256 are bound to the execution epoch; resume/rework refuses mismatched contract identity.
- PASS — Claude and Codex render the same `TaskContract` through the shared prompt renderer.
- PENDING POST-MERGE — end-to-end UTV2-1729 re-dispatch and substantive changes to its two target files. Those files are deliberately outside this lane and the issue forbids folding UTV2-1729 implementation into UTV2-1732.
- PENDING POST-MERGE — independent UTV2-1729 review, UTV2-1383 recovery, and UTV2-1667 regeneration. These are downstream orchestration exit criteria, not authorable changes in this lane.

## Runtime Verification

The 144-test focused suite exercises contract capture, pre-spawn refusal, tamper refusal, prompt parity, closed-checkpoint correction admission, exact correction rendering, epoch hash binding, checkpoint-directory propagation, and legacy executor behavior. Writable database proof is deferred to staging CI as stated above; this governance-lane implementation does not change application or database runtime paths.

## Independent Review

Independent adversarial review remains mandatory and is intentionally not self-attested in author evidence. It must review the exact PR head before T1 approval.

## SHA Binding

Verified source SHA: `ca1723b5c337643dd3e1dd6ec32b15d5323d322c`

Merge SHA: not available pre-merge; post-merge closeout must rebind this artifact.

## Migration for lanes that predate the task contract

This contract is required at dispatch, so every lane admitted before it needs a
one-time migration. Both populations were recounted from the live system at this
head after an earlier revision of this section stated them wrongly.

**Sync records.** 0 of 471 `.ops/sync/*.yml` files on `main` carry a
`task_contract`. (An earlier revision said 471 was 475; 475 is the local
working-tree count, which includes lanes not yet on `main`.) No lane is
permanently stranded: re-running `pnpm ops:lane-start <ID>` captures the
contract from Linear and binds `task_packet_hash` into the manifest. Heading
conventions are not required — obligations are derived structurally, so issues
written before the convention (`UTV2-1667` is the reference case) admit
normally.

**Live checkpoints split into two populations, and they need different
commands.** An earlier revision of this section claimed all 14 carried the
pre-contract `objective_identity` scheme and that `retire` was sufficient for
all of them. That was wrong, and it pointed operators at the one command that
cannot touch 8 of the 14.

| Population | Count | Lanes | Recovery |
| -- | -- | -- | -- |
| Has an `epoch` object, pre-contract identity | 6 | `UTV2-1611`, `UTV2-1690`, `UTV2-1720`, `UTV2-1722`, `UTV2-1729`, `UTV2-1732` | `retire`, then re-dispatch |
| No `epoch` object at all | 8 | `UTV2-1647`, `UTV2-1649`, `UTV2-1651`, `UTV2-1680`, `UTV2-1682`, `UTV2-1694`, `UTV2-1705`, `UTV2-1711` | `clear`, then re-dispatch |
| No checkpoint | — | `UTV2-1667` | `lane-start` re-run only |

Verified by execution against a copy of the real `UTV2-1649` file:
`retire` returns `ok:false / execution_checkpoint_missing`, because `isCheckpoint`
rejects a record with no epoch and `readCheckpointState` reports it unavailable.
`clear` succeeds on the same file. The earlier claim that "`clear` is not
required and is not recommended" was therefore exactly backwards for this
population.

**Ordered recovery:**

```
# epoch present (6 lanes)
pnpm ops:exec-checkpoint retire --issue <ID> --authority <operator> \
  --reason "epoch predates task contracts"

# no epoch (8 lanes) — retire cannot read these
pnpm ops:exec-checkpoint clear --issue <ID>

# both populations, then:
pnpm ops:lane-start <ID> ...        # captures the contract, binds the hash
pnpm ops:codex-exec --issue <ID>    # dispatches against the bound contract
```

For the 6 with an epoch, `retire` is preferred over `clear` because it preserves
the record: the superseded `objective_identity` stays readable and the epoch
gains `retired_at` / `retired_by`. Retiring also archives that epoch's completed
phases and findings into `prior_epochs` and clears them from the active record,
because they were concluded against an objective that no longer applies and the
resume brief would otherwise present them as authoritative. A retired epoch is
never resumed or reworked in place — the next dispatch mints a fresh epoch bound
to the current contract, which is what keeps `retired_at` from permanently
disabling the contract-hash gate.

**Not automated deliberately.** A bulk sweep would re-capture hundreds of
contracts from Linear in one pass and bind hashes for lanes nobody is about to
dispatch, turning a per-lane, reviewable step into a mass mutation of
orchestration state. Migration happens when a lane is next dispatched.

**Known limitation.** New lane admission requires `LINEAR_API_TOKEN` and a
reachable Linear API, because the contract must come from an authoritative
source. Already-bound lanes are unaffected: they read the contract from the sync
record and never contact Linear. An earlier review characterised this as
blocking every lane-start repo-wide; that is overstated and is corrected here.
