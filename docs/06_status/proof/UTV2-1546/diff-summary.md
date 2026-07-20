# Diff Summary — UTV2-1546

**Pre-merge implementation SHA:** `e9cc7a0e94164c139ae91170965b3bccdcdeb568`

**Issue:** UTV2-1546 — Delegation kill switch: DELEGATION_STATE.json + fail-closed checks at all dispatch/exec entry points
**Tier:** T2
**Branch:** claude/utv2-1546-delegation-kill-switch

## Files Changed

- `docs/05_operations/DELEGATION_STATE.json` (new file — default `delegation: "suspended"`)
- `scripts/ops/delegation-state.ts` (new file — shared strict reader/validator)
- `scripts/ops/delegation-state.test.ts` (new file — 21 unit tests covering all states)
- `scripts/ops/preflight.ts` (modified — delegation check added as the first check in `main()`)
- `scripts/ops/preflight.test.ts` (modified — added wiring/ordering assertion)
- `scripts/ops/lane-start.ts` (modified — delegation check added as the first statement in `main()`'s try block)
- `scripts/ops/lane-start.test.ts` (modified — added wiring/ordering assertions)
- `scripts/ops/codex-exec.ts` (modified — delegation check added immediately before the `codex` spawn)
- `scripts/ops/codex-exec.test.ts` (modified — added wiring/ordering assertion)
- `scripts/ops/claude-exec.ts` (modified — delegation check added immediately before the `claude` spawn)
- `scripts/ops/claude-exec.test.ts` (modified — added wiring/ordering assertion)
- `docs/06_status/proof/UTV2-1546/verification.md` (new — T2 proof bundle)
- `docs/06_status/proof/UTV2-1546/diff-summary.md` (this file)

## Summary

Implements the first mechanical piece of "Delegation & Accountability v1": a kill switch
that other automation (including future lanes) can rely on.

`docs/05_operations/DELEGATION_STATE.json` is a small JSON state file
(`{"delegation": "suspended", ...}`), default-suspended until a human ratifies
activation. `scripts/ops/delegation-state.ts` is a shared, strict reader:
`readDelegationState()` parses and validates the file — missing file, unreadable file,
unparseable JSON, non-object JSON, missing `delegation` field, or any `delegation` value
other than exactly `"active"` or `"suspended"` all resolve to the same fail-closed,
`ok: false` result. There is no default-open code path. `requireDelegationActive(context)`
wraps this with a call-site label for diagnostics, without calling `process.exit` or
throwing itself, so each of the four call sites can keep its own existing exit-code
convention.

The check is wired into all four autonomous dispatch/execution entry points, at the
earliest point before any side effect in each:

- **`preflight.ts`**: the very first check performed in `main()`, before
  `validatePreflightSchemaDependencies()`, before any Linear call, before any baseline
  verify/test run, and before any preflight-token read/write. Recorded under a new check
  id `PK1`; a blocked result produces a `FAIL` verdict and exit code 1.
- **`lane-start.ts`**: the first statement inside `main()`'s try block, before argument
  validation, before the substrate guard, and before `reserveLease`,
  `createBranchAndWorktree`, or `createManifest`. Exits 1 when blocked.
- **`codex-exec.ts`**: immediately before the `spawnSync('codex', codexArgs, ...)` call —
  placed after the `--dry-run` early return so the dry-run preview stays available while
  delegation is suspended. Exits code **2**, matching this file's existing
  `PRECONDITION_FAILED` convention.
- **`claude-exec.ts`**: immediately before the `runner('claude', claudeArgs, ...)` spawn
  call, same dry-run-preserving placement. Returns exit code **2**.

With `delegation: "active"`, all four entry points behave exactly as they did before this
change — verified by the full pre-existing test suites for all four files staying green
alongside the new coverage.

Key design decisions:
- `readDelegationState`/`requireDelegationActive` are side-effect-free (no `process.exit`,
  no throw) so they stay trivially unit-testable and reusable across four call sites with
  four different existing exit-code conventions, instead of forcing one convention onto
  the others.
- Delegation is deliberately documented (in a code comment, not a security claim) as a
  brake on runaway automation, not a security boundary: it cannot stop an actor who
  already holds a valid repo token, since that actor could simply flip the file back or
  bypass the four call sites entirely.
- `STANDING_GUARDRAILS.md` was explicitly left untouched — out of scope per the issue,
  covered by a separate governance-critical contract lane.

## Scope Compliance

File scope lock: the 12 files listed above, exactly as declared by the lane's first
commit (`docs/06_status/lanes/UTV2-1546.json`'s `file_scope_lock`, which
`scripts/ci/file-scope-guard.ts` pins to that first commit — later edits to the manifest
are intentionally ignored, an anti-self-widening protection). `docs/06_status/proof/UTV2-1546/**`
(including `.gitkeep` and `diff-summary.md`) is separately, unconditionally exempted by
the guard's own-lane control-plane allowance, so neither needed to be declared.
`package.json` was deliberately **not** touched by this PR: it is currently locked by
another lane's `file_scope_lock` (a merged-but-not-yet-reconciled "ghost" lane), and even
after that lock clears, `file-scope-guard.ts`'s first-commit pinning means widening scope
for it would require either an authorized scope-override PR comment or a fresh lane —
not something this lane can self-grant. See `verification.md`'s Known Gaps section for
the full explanation and the follow-up this implies for
`scripts/ops/delegation-state.test.ts`'s `package.json` wiring.
