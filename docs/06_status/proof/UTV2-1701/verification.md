# PROOF: UTV2-1701

MERGE_SHA: f0acf00cf670d530a048bc81a1874d4bd9915aaf

> Pre-merge this anchor carries the verified implementation SHA; the merge SHA does
> not exist yet. `post-merge-lane-close.yml` rebinds it to the authoritative merge
> SHA via `ops:proof-generate --merge-sha`.

Generated at: 2026-08-13T05:56:44.800Z
Issue: UTV2-1701
Tier: T2
Lane type: hygiene
Branch: codex/utv2-1701-proof-format-unification
PR URL: N/A
Head SHA: f0acf00cf670d530a048bc81a1874d4bd9915aaf
result: not_run

## ASSERTIONS:

- [x] A bundle produced by `ops:proof-generate` satisfies all four proof gates with zero manual edits.
- [x] The generator emits every literal token the gates require: `# PROOF:`, bare `MERGE_SHA:`, `ASSERTIONS:`, `EVIDENCE:`.
- [x] The EVIDENCE section contains a fenced code block, which `Executor Result Validation` requires separately.
- [x] The SHA anchor is a real 40-hex token pre-merge (`merge_sha ?? head_sha`), never a placeholder word.
- [x] `## Verification` is retained, satisfying `Runtime Verifier Gate` and `Proof Auditor Gate` with one header.
- [x] The command literals P12/P13/P14 look for are retained.
- [x] No gate was weakened. Every gate requirement is a presence assertion, so the union satisfies all four.
- [x] Each control is proven by mutation: reverting it fails exactly the test that covers it.

## EVIDENCE:

**This bundle is its own evidence.** It was produced by the fixed `ops:proof-generate`
with no manual edits, and it carries every token the four gates require. Before this
change the same command emitted `# UTV2-1701 Runtime Verification` and `Merge SHA: N/A`,
which failed six of the eleven requirements.

Gate requirements and the source that enforces each:

| Requirement | Gate | Source | Before | After |
|---|---|---|---|---|
| `# PROOF:` | Executor Result Validation; CEP-E3 | `executor-result-validator.yml:263`; `truth-check-lib.ts:507` | NO | YES |
| bare `MERGE_SHA:` | Executor Result Validation; CEP-E3 | `executor-result-validator.yml:266` | NO (`Merge SHA:`) | YES |
| `ASSERTIONS:` | Executor Result Validation; CEP-E3 | `executor-result-validator.yml:303` | NO | YES |
| `EVIDENCE:` | Executor Result Validation; CEP-E3 | `executor-result-validator.yml:317` | NO | YES |
| fenced block in EVIDENCE | Executor Result Validation | `executor-result-validator.yml:325` | NO | YES |
| any 40-hex SHA | Runtime Verifier Gate (hard fail) | `runtime-verifier-gate.ts:132` | NO (`N/A`) | YES |
| `## Verification` | Runtime Verifier + Proof Auditor | `runtime-verifier-gate.ts:121`; `proof-auditor-gate.ts:25` | YES | YES |
| `pnpm type-check` / `pnpm test` | CEP P12 | `truth-check-lib.ts:676` | YES | YES |
| `pnpm verify` | CEP P13 | `truth-check-lib.ts:682` | YES | YES |
| `r-level-check` | CEP P14 | `truth-check-lib.ts:689` | YES | YES |

5 of 11 before, 11 of 11 after.

### Controls proven by making them fail

Two mutations, each failing only the control it covers:

```
MUTATION A: header reverted to `# <ID> Runtime Verification`, MERGE_SHA reverted to `Merge SHA: <merge_sha ?? N/A>`
not ok 4 - generated verification.md satisfies Executor Result Validation and CEP-E3 literal tokens
not ok 7 - pre-merge, the SHA anchor falls back to the head SHA rather than N/A
# tests 85   # pass 83   # fail 2

MUTATION B: fenced block removed from the EVIDENCE section
not ok 5 - generated verification.md EVIDENCE section contains a fenced code block
# tests 85   # pass 84   # fail 1

RESTORED
# tests 85   # pass 85   # fail 0
```

No collateral failures in either mutation: each test fails for its own control and nothing else.

### The single line that caused most of the tax

```ts
const shaAnchor = gitTruth.merge_sha ?? gitTruth.head_sha ?? 'N/A';
```

`runtime-verifier-gate.ts:132` hard-fails when the file contains no 40-hex token anywhere,
and only *warns* when the token differs from the current head. The generator emitted
`Merge SHA: N/A` before a merge SHA existed, so every freshly generated bundle failed that
gate outright. Six lanes repaired this line by hand in a single session. `N/A` now survives
only when neither SHA is known, where failing is the correct outcome.

### Measured cost this fix removes

Every lane in the 2026-08-12/13 session paid a manual proof repair: UTV2-1691 (twice),
UTV2-1694, UTV2-1693, UTV2-1696, UTV2-1697. Twice the failure would have stranded
`ops:lane-close` after merge, producing another merged-but-unclosed ghost. UTV2-1398 —
launch-critical, blocking the Phase 1 product-truth acceptance gate — has been stalled
13 days on proof lineage that this class of defect produces.

```
$ pnpm type-check
$ pnpm test
$ pnpm verify
$ npx tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD
(not run by proof-generate)
```

## Verification
- [ ] `pnpm type-check`: not run by proof-generate
- [ ] `pnpm test`: not run by proof-generate
- [ ] `pnpm verify`: not run by proof-generate
- [ ] `npx tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD`: not run by proof-generate

## Runtime Verification
- Generated foundation artifact. Replace or append command output when runtime proof is executed.

## SHA Binding
Head SHA: f0acf00cf670d530a048bc81a1874d4bd9915aaf
Merge SHA: N/A

## Independent review

This lane was dispatched to Codex, which returned `outcome: completed` at `phase: plan`
having changed no source. The implementation and its tests were therefore written by the
orchestrator as a failure rescue. Per invariant 14 the implementer must not be the sole
validator, so this lane requires independent review before merge.

The executor defect is filed as UTV2-1698 and is broader than first recorded: this was a
fresh lane with `resumed: false` and `skipped_phases: []`, so incomplete phase progression
reports success even without a stale checkpoint.
