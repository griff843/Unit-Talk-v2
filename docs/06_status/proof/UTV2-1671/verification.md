# PROOF: UTV2-1671

MERGE_SHA: 66d7fa65dfff6bb6ec727165a1c206060238157c

> Pre-merge the merge anchor carries the verified implementation identity; the
> Execution SHA row below repeats it. `post-merge-lane-close.yml` rebinds merge
> authority only after GitHub supplies the merged-PR attestation.

Issue: UTV2-1671
Tier: T1
Lane type: governance
Proof profile: static
Branch: claude/utv2-1671-admit-contract-paths
Head SHA: 66d7fa65dfff6bb6ec727165a1c206060238157c
Diff base: 249da64b1108815f1bde07e82414535e64fe4382
result: pass

## Summary

Admission correction to `.lane/lanes/runtime.yml`: two exact contract paths
added to `allowed_path_globs`. Verified by a before/after control set run
against the real lane definition on disk, not a synthetic fixture. The
baseline column is produced by restoring the file to its `origin/main`
content in place and re-running the identical commands, so the difference
between the two columns is attributable to this change alone.

## ASSERTIONS:

- [x] **P1** `lane:check --lane runtime --file packages/contracts/src/smart-form.ts`
      is refused at `origin/main` (exit 1, `outside_allowed_paths`) and
      admitted at HEAD (exit 0).
- [x] **P2** `lane:check --lane runtime --file packages/contracts/src/index.ts`
      is refused at `origin/main` (exit 1, `outside_allowed_paths`) and
      admitted at HEAD (exit 0).
- [x] **N1** `packages/contracts/src/submission.ts` is refused at HEAD with the
      same `outside_allowed_paths` code it had at baseline. This is the
      load-bearing negative control: it shares the refusal class of the two
      admitted paths, so it would have been unblocked by any glob widening.
- [x] **N2** `packages/contracts/src/distribution.ts` is refused at HEAD,
      unchanged from baseline.
- [x] **N3** `packages/contracts/src/picks.ts` is refused at HEAD, unchanged
      from baseline.
- [x] **N4** `packages/domain/src/**` remains `forbidden_path` for the runtime
      lane at HEAD.
- [x] **N5** `supabase/migrations/**` remains `forbidden_path` and still
      reports `migration_lane_required` at HEAD.
- [x] **N6** `packages/db/src/database.types.ts` remains `forbidden_path` and
      still reports `migration_lane_required` at HEAD.
- [x] **Exhaustive non-broadening control** (path-admission sense; see the
      independent review finding below for the limit of this claim): every on-disk module in
      `packages/contracts/src/` was checked against lane `runtime` at HEAD.
      Exactly 2 are admitted -- `index.ts` (this change) and `promotion.ts`
      (pre-existing) -- and 16 are refused. `smart-form.ts` does not yet exist
      on disk and is covered by P1 above.
- [x] **Governance self-check**: `lane:check --lane governance` passes on this
      lane's own complete file set (6 files), confirming the lane carrying this
      change is itself authorized to carry it.
- [x] **R-level**: `r-level-check --base origin/main --head HEAD` returns
      `PASS`, no rules matched, no R-level artifacts required.
- [x] **Scope**: the only non-apparatus file changed is
      `.lane/lanes/runtime.yml`; no entry removed, no
      `forbidden_path_globs` entry touched, no other lane definition edited.
- [x] `pnpm verify:static` exits 0 on this branch, 98 suites, 0 failures,
      0 cancelled, 0 skipped (output below). The `test:live-db` half is
      produced by the required `verify` CI job in the `staging-ci`
      environment; it cannot run locally by design.

## Verification

### Commands executed

| Command | Result |
|---|---|
| `pnpm lane:check --lane runtime --file <8 paths>` at `origin/main` and at HEAD | pass -- see EVIDENCE |
| `pnpm lane:check --lane runtime` over all 18 on-disk contracts modules | pass -- 2 admitted / 16 refused |
| `pnpm lane:check --lane governance --file <this lane's 6 files>` | pass |
| `pnpm exec tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD` | PASS, no rules matched |
| `pnpm type-check` (standalone) | exit 0, no diagnostics |
| `pnpm test` (standalone) | exit 0, 97 suites, 5193 assertions, 0 fail/skip/cancel |
| `pnpm verify:static` | exit 0 -- see EVIDENCE. The full `pnpm verify` is `verify:static && test:live-db`; its `test:live-db` half is refused locally by `ci:assert-staging` and is produced by the required `verify` CI job instead. |

### Why these controls are sufficient

A path-admission change can fail in exactly two ways: it can fail to admit
what it claims to admit, or it can admit more than it claims. The positive
controls close the first. The negative controls close the second, and they are
chosen to be capable of failing: N1-N3 sit in the same directory and carry the
same refusal code as the admitted paths, so a `packages/contracts/src/**`
glob -- the obvious wrong implementation -- would flip all three to pass. The
exhaustive control makes that guarantee total rather than sampled.

N4-N6 are a weaker class by construction: they are refused by
`forbidden_path_globs`, which an `allowed_path_globs` addition structurally
cannot override. They are reported for completeness, not as the proof of
non-broadening.

### `pnpm type-check` and `pnpm test` -- run standalone, exit 0

`verify:static` runs both as constituent steps, but CEP-E4/P12 requires them
named directly, so both were also executed standalone with their own exit codes
captured from the `pnpm` process.

```text
$ pnpm type-check; echo "TYPE_CHECK_EXIT=$?"

> @unit-talk/v2@0.1.0 type-check
> pnpm exec tsc -b tsconfig.json

TYPE_CHECK_EXIT=0
```

`tsc -b` emitted no diagnostics.

```text
$ pnpm test; echo "TEST_EXIT=$?"

  aggregate over 97 node:test suites
  # pass       5193
  # fail       0
  # skipped    0
  # cancelled  0
  occurrences of "not ok" / "# fail <n>0" / ELIFECYCLE: 0

TEST_EXIT=0
```

## Runtime Verification

Not applicable. This is a `governance` lane under the `static` proof profile
(`proof-schema.ts` `STATIC_LANE_TYPES`). The change is a YAML path allowlist
consumed by the `Lane authority` CI check; it executes no application code,
reaches no database, and mutates no production state. The mechanical
verification of a path allowlist is the lane-check matcher itself, which is
what the controls above exercise directly.

No production mutation, member delivery, ingestion unpark, or direct-main work
was performed by this lane.

## EVIDENCE:

```text
Captured 2026-08-30T21:39:43Z   HEAD=66d7fa65dfff6bb6ec727165a1c206060238157c   base=249da64b1108815f1bde07e82414535e64fe4382

==============================================================
BASELINE -- .lane/lanes/runtime.yml as it stands on origin/main
==============================================================
$ pnpm lane:check --lane runtime --file packages/contracts/src/smart-form.ts
  lane:check FAIL lane=runtime
  - outside_allowed_paths: packages/contracts/src/smart-form.ts is outside allowed paths for lane runtime
  exit=1
$ pnpm lane:check --lane runtime --file packages/contracts/src/index.ts
  lane:check FAIL lane=runtime
  - outside_allowed_paths: packages/contracts/src/index.ts is outside allowed paths for lane runtime
  exit=1
$ pnpm lane:check --lane runtime --file packages/contracts/src/submission.ts
  lane:check FAIL lane=runtime
  - outside_allowed_paths: packages/contracts/src/submission.ts is outside allowed paths for lane runtime
  exit=1
$ pnpm lane:check --lane runtime --file packages/contracts/src/distribution.ts
  lane:check FAIL lane=runtime
  - outside_allowed_paths: packages/contracts/src/distribution.ts is outside allowed paths for lane runtime
  exit=1
$ pnpm lane:check --lane runtime --file packages/contracts/src/picks.ts
  lane:check FAIL lane=runtime
  - outside_allowed_paths: packages/contracts/src/picks.ts is outside allowed paths for lane runtime
  exit=1
$ pnpm lane:check --lane runtime --file packages/domain/src/clv-weight-tuner.ts
  lane:check FAIL lane=runtime
  - forbidden_path: packages/domain/src/clv-weight-tuner.ts is forbidden for lane runtime
  exit=1
$ pnpm lane:check --lane runtime --file supabase/migrations/20260803230000_utv2_1540_command_center_ledger_repair.sql
  lane:check FAIL lane=runtime
  - forbidden_path: supabase/migrations/20260803230000_utv2_1540_command_center_ledger_repair.sql is forbidden for lane runtime
  - migration_lane_required: supabase/migrations/20260803230000_utv2_1540_command_center_ledger_repair.sql requires lane_type=migration
  exit=1
$ pnpm lane:check --lane runtime --file packages/db/src/database.types.ts
  lane:check FAIL lane=runtime
  - forbidden_path: packages/db/src/database.types.ts is forbidden for lane runtime
  - migration_lane_required: packages/db/src/database.types.ts requires lane_type=migration
  exit=1

==============================================================
AT HEAD -- admission correction applied
==============================================================
$ pnpm lane:check --lane runtime --file packages/contracts/src/smart-form.ts
  lane:check PASS lane=runtime files=1
  exit=0
$ pnpm lane:check --lane runtime --file packages/contracts/src/index.ts
  lane:check PASS lane=runtime files=1
  exit=0
$ pnpm lane:check --lane runtime --file packages/contracts/src/submission.ts
  lane:check FAIL lane=runtime
  - outside_allowed_paths: packages/contracts/src/submission.ts is outside allowed paths for lane runtime
  exit=1
$ pnpm lane:check --lane runtime --file packages/contracts/src/distribution.ts
  lane:check FAIL lane=runtime
  - outside_allowed_paths: packages/contracts/src/distribution.ts is outside allowed paths for lane runtime
  exit=1
$ pnpm lane:check --lane runtime --file packages/contracts/src/picks.ts
  lane:check FAIL lane=runtime
  - outside_allowed_paths: packages/contracts/src/picks.ts is outside allowed paths for lane runtime
  exit=1
$ pnpm lane:check --lane runtime --file packages/domain/src/clv-weight-tuner.ts
  lane:check FAIL lane=runtime
  - forbidden_path: packages/domain/src/clv-weight-tuner.ts is forbidden for lane runtime
  exit=1
$ pnpm lane:check --lane runtime --file supabase/migrations/20260803230000_utv2_1540_command_center_ledger_repair.sql
  lane:check FAIL lane=runtime
  - forbidden_path: supabase/migrations/20260803230000_utv2_1540_command_center_ledger_repair.sql is forbidden for lane runtime
  - migration_lane_required: supabase/migrations/20260803230000_utv2_1540_command_center_ledger_repair.sql requires lane_type=migration
  exit=1
$ pnpm lane:check --lane runtime --file packages/db/src/database.types.ts
  lane:check FAIL lane=runtime
  - forbidden_path: packages/db/src/database.types.ts is forbidden for lane runtime
  - migration_lane_required: packages/db/src/database.types.ts requires lane_type=migration
  exit=1

==============================================================
EXHAUSTIVE NON-BROADENING CONTROL (every on-disk contracts module)
==============================================================
$ for f in packages/contracts/src/*.ts; do pnpm lane:check --lane runtime --file $f; done
  admitted: 2   refused: 16
    ADMITTED packages/contracts/src/index.ts
    ADMITTED packages/contracts/src/promotion.ts

==============================================================
GOVERNANCE SELF-CHECK -- this lane's own file set
==============================================================
  lane:check PASS lane=governance files=6

==============================================================
R-LEVEL
==============================================================
$ pnpm exec tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD
  Verdict: PASS
  Changed files: 4
  Rules matched: (none) — no R-level artifacts required for this diff
```

### `pnpm verify:static` -- exit 0

`verify` is `pnpm verify:static && pnpm test:live-db`. `test:live-db` begins
with `ci:assert-staging`, which refuses any target that is not the staging ref
`xskgrzbteyqdufktjrjx`; outside the `staging-ci` GitHub environment it is
structurally unrunnable, and `verify:local` is defined as `verify:static` for
exactly this reason. The required `verify` CI job on this PR head is the
authoritative producer of the live-DB half.

Steps executed and passed, in order: `ci:db-client-boundary`, `ops:sync-check`,
`ops:system-alignment-check`, `ops:automation-coverage-check`, `env:check`,
`lint`, `type-check`, `build`, `test`, `@unit-talk/smart-form verify`,
`verify:commands`.

```text
$ pnpm verify:static; echo "VERIFY_STATIC_EXIT=$?"

  aggregate over 98 node:test suites
  # pass       5307
  # fail       0
  # cancelled  0
  # skipped    0
  ELIFECYCLE / ERR_ occurrences: 0


> @unit-talk/discord-bot@0.1.0 command-manifest:check /home/griff843/code/Unit-Talk-v2/.out/worktrees/claude__utv2-1671-admit-contract-paths/apps/discord-bot
> tsx scripts/sync-command-manifest.ts --check

[command-manifest] Verified 14 command definition(s) against /home/griff843/code/Unit-Talk-v2/.out/worktrees/claude__utv2-1671-admit-contract-paths/apps/discord-bot/command-manifest.json
[check-migration-versions] 7 migration file(s) verified — no duplicate versions.
[lint-migrations] Skipping schema baseline replay-root 00000000000000_baseline_live_schema.sql (snapshot, not a forward migration; fidelity verified by Live Schema Parity).
[lint-migrations] 6 migration file(s) checked — no findings.
VERIFY_STATIC_EXIT=0
```

The exit code is captured directly from the `pnpm` process, not from a pipeline
tail -- a piped invocation reports the exit status of the last stage and can
mask a failing verify.

## Independent review finding -- recorded, not silently absorbed

An independent adversarial review of this PR was asked specifically to falsify
the non-broadening claim. It confirmed the literal path-level claim byte for
byte, and it also identified a real limitation in what these controls can
prove. Both are recorded here rather than only the favourable half.

**The claim these controls actually establish** is *path-admission*
non-broadening: no glob was widened, no `forbidden_path_globs` entry was
weakened, and exactly two paths became admissible. That is what the controls
test and it holds.

**What they do not establish** is *semantic capability* non-broadening.
`scripts/lane-contract.ts` matches changed file paths only -- it never inspects
file content or the import graph. `packages/contracts/src/index.ts` is not a
passive shim: it declares governance-relevant literals (`memberTiers`,
`canonicalWriter`, `writerRoles`) and carries 13 `export * from` lines. A
runtime lane that can edit it can therefore alter those literals, and can
change the public surface of contract modules it cannot edit directly, without
lane-check observing it. No control in this bundle detects that, and none
could, because the check being verified is itself path-only.

**Why the admission is still the minimal one available.** The obvious narrower
alternative -- have `apps/api` deep-import the module and leave `index.ts`
alone -- is not available. `packages/contracts/package.json` declares
`"exports": { ".": "./src/index.ts" }` with no subpath entries, and all 65
`@unit-talk/contracts` imports in `apps/api/src` use the bare specifier. Adding
a subpath export would require admitting `packages/contracts/package.json`,
which is strictly worse on two counts: any `package.json` change is on the
`DELEGATION_POLICY.md` always-escalate list, and that file governs the entire
package's public surface rather than one module. Admitting `index.ts` is the
smaller of the two available admissions.

**Severity context.** The capability described above is not created by this
change. `packages/contracts/src/**` -- the full glob, `index.ts` included -- is
already granted to the `hygiene` lane (`.lane/lanes/hygiene.yml:22`) and the
`data-canonical` lane (`.lane/lanes/data-canonical.yml:19`). This change gives
the runtime lane strictly less than what two lane types already hold. It is an
incremental extension of a pre-existing structural gap, admitted in the
narrowest form available, not a new hole.

**Unstaffed follow-up.** That lane authority is path-only, and so cannot see a
barrel file re-exporting or redefining content from modules the lane may not
touch, is a governance gap worth its own issue. It is outside this lane's
authorized scope -- the objective in `.ops/sync/UTV2-1671.yml` restricts this
lane to path admission and excludes any executor-policy or delegation-policy
amendment -- so it is reported for PM triage rather than fixed here.

## Merge SHA Binding

Merge SHA: pending merge
PR: pending
Approved PR head: pending merge
Execution SHA: 66d7fa65dfff6bb6ec727165a1c206060238157c
