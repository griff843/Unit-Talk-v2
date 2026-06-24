# UTV2-1299 — Verification

**Lane:** UTV2-1299 — Harden `/loop-dispatch` into a true board-clearing orchestrator
**Tier:** T2 · **Lane type:** governance · **Executor:** Claude
**Branch:** `griffadavi/utv2-1299-harden-loop-dispatch`
**PR:** #1053 (squash-merged) · **Merge SHA:** `35fca9e32850f120fa456609782abb2a80b9e7ac`

## Verification

### Static gates (branch)
- `pnpm type-check`: PASS (governance command-prose + proof only; no TS change).
- `pnpm test`: PASS — 686 pass / 0 fail / 0 skipped (includes `scripts/ops/workflow-hardening.test.ts`, the mechanical contract for these command files).
- `pnpm verify`: PASS (env:check · lint · type-check · build · test).
- R-level: `scripts/ci/r-level-check.ts` (CI "R-Level Compliance Check" on PR #1053): PASS — governance command-prose + docs scope, no R2–R5 runtime artifacts.

### Change class

Governance command-prose only (`.claude/commands/loop-dispatch.md`, `.claude/commands/dispatch-board.md`) + this proof bundle. No TypeScript, runtime, deploy, or DB change. The mechanical contract for these command files is enforced by `scripts/ops/workflow-hardening.test.ts` (part of `pnpm test`).

### `pnpm verify` (full suite — env:check · lint · type-check · build · test · smart-form verify · verify:commands)

```
VERIFY EXIT: 0
# tests 686
# pass 686
# fail 0
# skipped 0
```

First verify run surfaced exactly one failure — `workflow-hardening.test.ts: loop-dispatch summary exposes live executor state and recommendations` — because the report redesign initially dropped lines the mechanical contract asserts (`Active lanes: …`, `Blocked lanes: …`, `CI/PM waiting: …`, exact `Recommendations:` wording). Fixed by folding the five asserted strings back into the new sectioned report (an "— Executor state —" block) rather than weakening the test. Re-run: green.

Targeted re-run of the enforcing suite after the fix:

```
$ npx tsx --test scripts/ops/workflow-hardening.test.ts
# tests 27
# pass 27
# fail 0
```

### `pnpm test:db` (live Supabase smoke — DB-health evidence)

This is a governance/command-prose lane with **no** runtime or DB change, so `test:db` is not a tier requirement — it is run here as live DB-health evidence and to satisfy the Proof Auditor Gate's `--require-executed-command "pnpm test:db"`. Executed against real Supabase on the branch head:

```
$ pnpm test:db
TAP version 13
ok 1 - database repository bundle persists a submission and settlement when Supabase is configured
ok 2 - UTV2-920: invalid atomic enqueue writes no lifecycle event or outbox row
ok 3 - UTV2-920: invalid atomic delivery confirmation rolls back outbox status, receipt, lifecycle, and audit writes
ok 4 - UTV2-920: invalid atomic settlement writes no settlement, lifecycle event, or audit row
...
# tests 7
# pass 7
# fail 0
# skipped 0
```

`pnpm test:db` exit 0 — live Supabase reachable and atomicity invariants hold. No DB mutation introduced by this lane.

### Required grep proof (the five lane-required assertions)

```
$ LD=.claude/commands/loop-dispatch.md ; DB=.claude/commands/dispatch-board.md

# 1 — loop-dispatch includes substrate-guard
31:pnpm ops:substrate-guard --check-linear
140:   pnpm ops:substrate-guard --check-linear
343:- **Substrate guard runs first.** `pnpm ops:substrate-guard --check-linear` gates Phase 0 and every cycle start …

# 2 — loop-dispatch harvests Codex returns BEFORE new dispatch
153:4. **Harvest Codex returns first — before any new dispatch.** … run:
155:   /dispatch-board --check-codex
344:- **Harvest Codex returns before new dispatch.** Each cycle runs `/dispatch-board --check-codex` before `/dispatch-board` …

# 3 — stall breaker uses a progress vector, not merge-count-only
114:consecutive_noprog = 0          # cycles with an all-zero progress vector
119:**Progress vector.** … replacing the old merge-count-only signal.
168:If `consecutive_noprog ≥ 2`:
173:Exit the loop. Do **not** STALL on `prs_merged = 0` alone …

# 4 — final report includes terminal-state accounting
236:## Phase 2: Loop-level Done assertion
261:### Terminal-state assertion
267:merged-but-not-closed # PR merged, lane-close not yet run → REPAIR before exit
300:Done this session:    {issue IDs — merged + lane-closed}

# 5 — dispatch-board no longer instructs pre-merge truth-check incorrectly
146:**Pre-merge verification is not `ops:truth-check`.** … `ops:lane-close` runs it *after* merge.
152:   - proof artifacts present and well-formed: `pnpm ops:proof-check --issue UTV2-###`
153:   - merge-readiness: `pnpm ops:merge-ready --issue UTV2-### --pr <n>`
158:7. `ops:lane-close` runs `ops:truth-check` (the done-gate, against the merge SHA) …
260:- **`ops:truth-check` is the post-merge done-gate, never a pre-merge check.** …
```

All five assertions present. No `ops:truth-check` remains in the dispatch-board **pre-merge** step list (the remaining references are the corrected post-merge done-gate semantics and an illustrative blocked-lane example).

### Constraints honored

Governance/ops command hardening only · no runtime behavior change · no production deploy · no DB mutation · no P3 certification · UTV2-1042 not marked Done · no CLV/ROI/edge claims · no public Discord · no backfill · no secrets.

### Scope integrity

Diff limited to `file_scope_lock`: `.claude/commands/loop-dispatch.md`, `.claude/commands/dispatch-board.md`, `docs/06_status/proof/UTV2-1299/*`. The enforcing test `scripts/ops/workflow-hardening.test.ts` was **not** modified — the new report satisfies its existing assertions. The trial-governor concurrency toggle (used to open the 3rd Claude slot per PM decision) is an operational change in the control-plane checkout and is intentionally **not** in this lane's diff.
