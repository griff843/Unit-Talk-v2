# PROOF: UTV2-1838

MERGE_SHA: pending merge
Execution SHA: 80b955acd77a721a1c52f825342cc384c1011e3d

Closeout safe to repeat — unmask the finalize ENOENT halt without unmasking the
`--force` JSON overwrite, and stop main-checkout pollution.

## Merge SHA Binding

Merge SHA: pending merge
PR: https://github.com/griff843/Unit-Talk-v2/pull/1517

`sha_binding.merge_sha` is `null` pre-merge. `verified_source_sha` is
`80b955acd77a721a1c52f825342cc384c1011e3d`, the last non-proof commit on the branch.
The binding is written after merge by `ops:proof-generate --merge-sha`; no manual append is
made here.

## Verification

ASSERTIONS:

- [x] **A1 — A non-Markdown declared proof path is never written, with or without `--force`.**
  `generateT2ProofBundle` refuses it before the force check and records it in `refused_paths`.
  Asserted on the file's *content*, not on an exit code: a pre-existing `evidence.json` is
  byte-identical after a forced run.
- [x] **A2 — The refusal is what produces A1.** Mutation: delete the
  `!isMarkdownProofPath(proofPath)` branch. Two tests fail, including the content assertion.
- [x] **A3 — `readOptionalFile` returns `''` for an absent path rather than throwing**, and
  resolves against the caller's root rather than the module-level `ROOT`. This is the ENOENT
  that halted `ops:lane-finalize` on every static-proof lane (UTV2-1835, UTV2-1836).
- [x] **A4 — The existence guard is what produces A3.** Mutation: delete it. One test fails.
- [x] **A5 — `lane-finalize` names the file `ops:proof-generate` actually writes.**
  `--verification-log` is now `docs/06_status/proof/<ID>/verification.md`;
  `STANDARD_PROOF_FILES` (`proof-generate.ts:197`) is `['diff-summary.md', 'verification.md']`
  and has never contained `runtime-verification.md`.
- [x] **A6 — A plain `ops:lane-close` from a checkout on `main` is refused**, with an
  actionable remediation naming the lane worktree and the direct-main policy.
- [x] **A7 — The refusal does not over-fire.** A lane worktree passes, and the trusted
  post-merge automation is exempt, exactly as it is exempt from the repair guard.
- [x] **A8 — The main-checkout guard is what produces A6.** Mutation: make
  `guardCloseAgainstMainCheckout` return `null` unconditionally. One test fails.
- [x] **A9 — `rebindRepairedLaneProof` now calls both evidence harvesters**, so a
  `workflow_dispatch` replay populates `static_proof`/`runtime_proof` the way a push does.
  Both calls are wrapped, never fatal, matching the contract they carry in `proof-generate`.
- [x] **A10 — No workflow file is touched.** `verify`, `Executor Result Validation`,
  `Merge Gate` and `P0 Protocol` are unchanged by this diff.
- [x] **A11 — Scope items 5 and 6 are not implemented and are not claimed.**
  `truth-check-lib.ts` and `lease-registry.ts` are outside this lane's `file_scope_lock`;
  both are recorded in `docs/mission/plan.md` with their file:line and required repair.

r-level-check: R-Level Compliance evaluated in CI on this branch.

## Runtime Verification

Runtime result: not_run — this is a static-proof T2 governance lane. It changes ops scripts
only; it touches no database, no HTTP surface and no runtime container.

EVIDENCE:

```text
$ pnpm exec tsc --noEmit -p tsconfig.json
(no output — clean)

$ pnpm exec tsx --test scripts/ops/t2-proof-bundle.test.ts scripts/ops/lane-close.test.ts scripts/ops/lane-finalize.test.ts
# tests 219
# pass 219
# fail 0
```

Acceptance criterion 3, measured rather than implemented. The issue asserts that
`truth_check_history` grows on every non-`done` run and that an infra-error early
return records a `fail` for a token blip. **That defect does not exist**, and the
line numbers the issue cites for it (`truth-check-lib.ts:1860-1864`, `:986`,
`:1045`, `:1062`) point at unrelated code on current `main`. Measured by calling
`finalizeWithManifest` with its injectable `writeManifestFn` and counting writes:

```text
AC3: second close on a done lane (exit 0)               writes=0
AC3: second close on a done lane (exit 1)               writes=0
infra_error on a live lane (exit 3)                     writes=0
ineligible on a live lane (exit 2)                      writes=0
genuine fail on a live lane (exit 1)  [expect a write]  writes=1 history=2
```

The last row is the control: without it, five zeroes would be indistinguishable
from a probe that cannot observe a write at all. Every `infra_error` path uses
`exitCode: 3` (`:919`, `:938`, `:955`, `:1097`, `:1595`) and
`finalizeWithManifest:1898` returns before any write on exit 2 or 3. `git log -S`
dates that guard to `4c029b006` (2026-04-11) and the `done` guard to `7bcc642d7`
(UTV2-1224, 2026-06-06) — both predate the issue, so this was not recently fixed.
Criterion 3 therefore holds on `main` and needed no change here. What is missing
is a regression test locking it, and `scripts/ops/truth-check-lib.test.ts` is
outside this lane's `file_scope_lock`.

Mutation runs. Each mutation was applied in place, the suite run, and the file restored:

```text
# Mutation 1 — remove the isMarkdownProofPath refusal from generateT2ProofBundle
not ok 6 - force never overwrites a non-Markdown declared proof artifact
not ok 7 - a non-Markdown path is refused even without force
# tests 8
# pass 6
# fail 2

# Mutation 2 — remove the existence guard from readOptionalFile
not ok 9 - readOptionalFile returns empty for an absent path instead of throwing
# tests 9
# pass 8
# fail 1

# Mutation 3 — guardCloseAgainstMainCheckout returns null unconditionally
not ok 181 - guardCloseAgainstMainCheckout refuses a plain close from a checkout on main
# tests 183
# pass 182
# fail 1
```

Full-tree verification. `pnpm verify` was run to completion on this branch.
**It exits 1, and the exit code is not a test result** — it is a fail-closed
environment refusal, and the distinction is the whole point of recording it.

Measured on the completed run: **zero `not ok` lines in the entire log**, and
**101 suite blocks each reporting `# fail 0`**. Every stage passed — `env:check`,
`lint`, `type-check`, `build`, all of `test` (apps, command-center, smart-form,
verification, seven domain suites, qa-agent, ut-cli, ops, t1-proof:local) and
`verify:commands`. The run then reached `test:live-db` → `test:db` →
`ci:assert-staging`, which refused:

    [assert-staging] host=127.0.0.1 ref=unidentified expected=xskgrzbteyqdufktjrjx
    [assert-staging] REFUSED: target identity could not be resolved from its URL
    (host=127.0.0.1). Writable DB verification requires xskgrzbteyqdufktjrjx. Run it
    through the staging-ci GitHub environment with CI_SUPABASE_* credentials.

That guard exists to stop writable DB verification pointing anywhere but staging,
so **`pnpm verify` cannot exit 0 on a developer machine without staging
credentials** — the local exit code is structurally unavailable, not merely
missing on this run. An earlier attempt was additionally killed by the host's OOM
reaper inside `test:ops`; that suite was re-run standalone and is recorded below.
**CI's `verify` on this PR, which runs inside the staging-ci environment, is the
authoritative full-tree result, and no local PASS is claimed anywhere in this
bundle.**

```text
$ pnpm verify
> env:check        Environment files passed validation.
> lint             (clean)
> type-check       pnpm exec tsc -b tsconfig.json   (clean)
> build            pnpm exec tsc -b tsconfig.json   (clean)
> test             101 suite blocks, every one "# fail 0"; 0 "not ok" lines
> verify:commands  14 command definitions verified; 135 migrations, no findings
> test:live-db     REFUSED by ci:assert-staging (host=127.0.0.1, not staging)
EXIT=1

$ pnpm test:ops
# tests 2963
# pass 2963
# fail 0
exit 0
```

## Summary

The two repairs in the coupled pair had to land in this order and this is why: the ENOENT
crash in `readOptionalFile` was thrown while evaluating a *function argument*, so it fired
before `generateT2ProofBundle` ever ran. `lane-finalize.ts` always passes `--force`, and with
`--force` the writer put the same Markdown blob into every entry of `expected_proof_paths` —
and 27 T2-eligible manifests on `main` declare `evidence.json` or `model-routing.json` there.
Repairing the crash alone would have converted a halt into silent destruction of machine-read
proof artifacts. The overwrite guard is therefore first in the diff and first in the
assertions, and its inversion asserts bytes rather than an exit code.

Verification commands run for this bundle: `pnpm verify`, `pnpm type-check`, `pnpm test`.
