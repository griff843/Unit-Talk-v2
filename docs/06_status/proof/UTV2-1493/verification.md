## Summary

Verification for UTV2-1493 confirms the Break-Glass Merge & PM Continuity Protocol doc satisfies every acceptance criterion in the issue, is internally consistent with `EXECUTION_TRUTH_MODEL.md`, `DELEGATION_POLICY.md`, `three-brain.md` Rule 9, `docs/05_operations/schemas/pm-verdict-v1.md`, and `docs/05_operations/DIRECT_MAIN_BYPASS_POLICY.md`, and passes the full `pnpm verify` battery plus `pnpm test:db` with zero failures. This is a governance/docs-only T1 lane — no runtime or product code path was touched.

## Evidence

Branch: `claude/utv2-1493-break-glass-merge-pm-continuity`
Pre-merge head SHA: `b2418fd75ba6f00fb5feae2b8401cf26f1f2c205`

## Acceptance criteria mapping

| Acceptance criterion (from issue) | Where addressed |
|---|---|
| Define when break-glass may be used | `BREAK_GLASS_PROTOCOL.md` §1 |
| Define who may invoke it | §2 |
| Define required evidence | §3 |
| Define emergency-only merge/approval procedure | §4, §4a |
| Require post-hoc PM review within a fixed window | §5 (48h, with overdue escalation into `ops:digest`) |
| Require incident declaration artifact | §3 (schema), §5 (posted to Linear) |
| No normal-lane bypass | §9, restated explicitly |
| No production deploy authority expansion without PM | §4 (forbidden actions list), §9 |
| No change to branch protection implementation unless separately approved | §4a, §9 — this lane touches none of `merge-gate.yml`/`CODEOWNERS`/branch protection |
| Produce PM decision packet if multiple options exist | §8 — three invoker models (A/B/C) presented explicitly, Option A shipped as operative default without foreclosing PM's choice of B/C |

## PM-approved hard constraints mapping (2026-07-08 decision)

| Constraint | Where addressed |
|---|---|
| Rollback / pause / safe-state only — no roll-forward authority | §4 permitted-actions list is exhaustive and rollback/pause/restore only |
| No merge-new-code authority | §4 forbidden list, first bullet |
| No migration authority | §4 forbidden list, second bullet |
| No delivery enablement authority | §4 forbidden list, third bullet |
| No pricing/payment/customer-facing activation authority | §4 forbidden list, fourth bullet |
| No bypass of post-hoc PM review | §5 — no path skips it; §6 fail-closed rule restates it |
| Must require an incident declaration artifact | §3 |
| Must require PM review after invocation (fixed window) | §5 (48h) |
| Must fail closed | §6 (dedicated section, six explicit fail-closed rules) |
| Multiple valid invocation models presented explicitly | §8 (Options A/B/C), not silently picked |

## Verification

### pnpm verify (full pipeline)

PASS — env:check, lint, type-check, build, and the full `pnpm test` node:test aggregate across the repo all completed with zero failures. Representative tail of the full test run:

```
1..14
# tests 14
# suites 0
# pass 14
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 536.768165
TAP version 13
```

No `not ok` lines anywhere in the full verify output.

### pnpm test:db (T1 live-DB proof, last 30 lines)

```
  duration_ms: 18583.905111
  type: 'test'
  ...
# Subtest: UTV2-883: no duplicate participants for the same external_id and sport
ok 5 - UTV2-883: no duplicate participants for the same external_id and sport
  ---
  duration_ms: 753.801796
  type: 'test'
  ...
# Subtest: UTV2-996: re-settling a settled pick creates correction — no true duplicate base rows
ok 6 - UTV2-996: re-settling a settled pick creates correction — no true duplicate base rows
  ---
  duration_ms: 17980.463109
  type: 'test'
  ...
# Subtest: UTV2-996: correction chain is additive — original settlement row is not mutated
ok 7 - UTV2-996: correction chain is additive — original settlement row is not mutated
  ---
  duration_ms: 18255.231065
  type: 'test'
  ...
1..7
# tests 7
# suites 0
# pass 7
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 118439.269101
```

Ran against live Supabase (`packages/db` real-DB smoke suites), not in-memory repos. This is incidental regression evidence that this docs-only change introduces no runtime regression — UTV2-1493 itself has no runtime code path of its own to exercise, since it adds one governance markdown document.

### R-level compliance

```
tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD
Verdict: PASS
Changed files: 3
Rules matched: (none) — no R-level artifacts required for this diff
```

## Cross-reference consistency check

- `EXECUTION_TRUTH_MODEL.md` §6 (reopen rule) and the truth hierarchy: protocol §5/§7 restate that a break-glass merge is not Done until `ops:truth-check` passes AND post-hoc PM review is Ratified — no contradiction.
- `docs/05_operations/schemas/pm-verdict-v1.md`: unmodified; protocol does not introduce a competing verdict schema for the normal path, only narrows the existing `DIRECT_MAIN_BYPASS_POLICY.md` emergency-exception mechanism for revert-only diffs in §4a.
- `docs/05_operations/DELEGATION_POLICY.md` / `three-brain.md` Rule 9: protocol §7 and §8 explicitly treat a break-glass decision itself as an always-escalate event, consistent with Rule 9's scope-ambiguity and source-of-truth-conflict triggers.
- `docs/05_operations/DIRECT_MAIN_BYPASS_POLICY.md`: protocol §4a explicitly reuses (does not duplicate or contradict) its emergency-exception evidence fields (incident ID, exact diff, why normal PR path is too slow, rollback plan, authorizer).
- CLAUDE.md 11 core invariants: protocol §7 walks through and preserves Invariants 1–6 explicitly (the only invariants relevant to a docs/procedure change); Invariants 7–9 (domain purity, app/package boundaries, outbox) are not implicated since no code is touched.

## Stop conditions encountered

None. No temptation arose to edit `merge-gate.yml`, `CODEOWNERS`, or branch protection — the protocol was drafted entirely within the docs-only file scope declared at lane-start. One deliberate stop-and-present-options point was exercised as designed: §8 presents three invoker models rather than picking one, per the PM's explicit "if multiple valid invocation models exist, present them explicitly" instruction.

## Merge SHA binding

Head SHA: b2418fd75ba6f00fb5feae2b8401cf26f1f2c205
Merge SHA: (populated post-merge by `ops:proof-generate --merge-sha`)
PR URL: (populated below once opened)
