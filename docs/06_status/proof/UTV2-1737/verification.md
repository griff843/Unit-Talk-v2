# PROOF: UTV2-1737

MERGE_SHA: N/A

Verified source SHA: `set-at-push` (see evidence.json sha_binding)

Repairs the executor packet transport so a lane's full Linear work order reaches
the executor prompt. Without it, a dispatched Codex lane receives a file list and
a URL — no objective, no acceptance tests, no stop conditions, no mutation
boundary — which is what produced prior lanes of polished proof and no
implementation.

## Provenance

Implementation is **inherited, not re-derived**: 1,118 insertions across 8 script
files from preserved branch head `0f5a533d`, rebased onto current main. Authored
here: **51 insertions in one file, zero deletions** — the two authorized
bootstrap corrections only.

## Bootstrap override — recorded, not hidden

Admitted via `ops:lane-start --force-unsafe-substrate`, one logged bootstrap
admission for this lane only. The dispatcher defect prevents Codex from
receiving this lane's own objective, so Claude implemented the two corrections
under an explicit PM exception that ends when this lane merges.

Exact guard refusal at the time of override:

```text
board_hard_fail:MERGED_PR_ACTIVE_LANE  ["UTV2-1743"]
  Branch "claude/utv2-1743-parked-tier-c" already has a merged PR but lane remains in_review
board_hard_fail:TIER_C_CONFLICT        ["UTV2-1729","UTV2-1743"]
  Both executing lanes touch Tier C paths
```

All six preconditions verified by evidence: 1743 merged and idle, 1729 preserved
and idle, 1736 admitted but not executing (0 codex processes, 0 exec artifacts),
1737 scope intersects 1736 in **nothing**, 1729 overlap expected because this
lane is its blocker, and no production path touched.

## ASSERTIONS:

- [x] No description content is lost. **60 live issues inspected, 60 zero-loss, 0 refused.**
- [x] Pre-heading preamble is preserved. Reverting the fix loses content on 5 issues and **drops a prohibition line from UTV2-1577**.
- [x] UTV2-1577 and UTV2-1578 retain **2/2 and 2/2** prohibitions.
- [x] Stale contracts refuse structurally, never as a bare `TypeError`.
- [x] Malformed, identity-mismatched and hash-mismatched contracts all refuse structurally.
- [x] Contract-less lanes capture fresh from Linear with **no bulk migration and no silent degradation**.
- [x] Dry-run launches no executor and mutates no lane state, for **both** executors. An earlier revision fixed only the Codex path and claimed this unqualified; the Claude path resolved the packet — a live Linear call plus a git-tracked sync write — before its dry-run branch. Now guarded identically.
- [x] UTV2-1736's rendered packet carries its objective, constraints, proof contract and production-DDL stop boundary.

## EVIDENCE:

```text
verify:static: PASS (exit 0)
focused suites: 111 passed, 0 failed (34 + 32 + 11 + 34)
live sweep: INSPECTED=60 ZERO_LOSS=60 REFUSED=0 LOSSY=0
  UTV2-1577 prohibitions 2/2   UTV2-1578 prohibitions 2/2
inverted (preamble reverted): LOSSY=5, UTV2-1577 loses a prohibition
```

## Dry-run purity

Every surface compared before and after a real `codex-exec --dry-run`:

```text
lease                  UNCHANGED (sha256 match)
manifest               UNCHANGED (sha256 match)
worktree HEAD          UNCHANGED
dirty files            0 -> 0
worktree count         45 -> 45
codex-exec artifacts   0 -> 0
Linear state           In Codex -> In Codex
real codex processes   0
```

Process counts were verified **per-PID**. Raw `grep` counts returned non-zero
four times during this lane; every instance was the grep pipeline matching
itself. A false positive here would have implied the dry run launched an
executor.

## Structured refusals

```text
null / string / empty object      structured, names the contract
missing acceptance_criteria       structured
blank objective                   structured
identity mismatch                 "task contract identity mismatch for UTV2-9999"
source hash mismatch              "source hash verification failed"
stale (no unmapped_sections)      TaskContractError code stale_contract_missing_unmapped_sections
```

None is a bare `TypeError`. The hash-mismatch case was confirmed by recomputing
the SHA-256 and asserting it differs from the bound value.

## UTV2-1736 rendered packet

All twelve probes present: objective, production-critical rationale, measured
evidence, forward horizon, idempotent provisioning, reversible migration,
pre-expiry alert, no-DEFAULT-partition, no-retention-deletion, production-DDL
stop boundary, decision-to-surface, and issue identity (packet header). 7,531
characters, source SHA-256 bound.

## Non-blocking follow-up — observed, not implemented

`unmapped_sections` joins lines with a space, collapsing list structure in the
rendered residue. Content is retained — normalized comparison shows zero loss —
but formatting degrades. A fix was written and then **reverted**, because it is
outside this lane's accepted contract. Recorded for a future lane.

## Verification

| Check | Result | Evidence |
|---|---|---|
| `pnpm verify:static` | PASS | Exit 0. |
| `pnpm type-check` | PASS | Stage of `pnpm verify:static`. |
| `pnpm test` | PASS | Stage of `pnpm verify:static`. |
| Focused suites | PASS | 111 passed, 0 failed (34 + 32 + 11 + 34). |
| Live description sweep | PASS | 60/60 zero loss. |
| `pnpm test:db` | N/A | No runtime or database path is touched. |
