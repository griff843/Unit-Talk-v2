# UTV2-1521 Verification

Generated at: 2026-07-10T23:25:00.000Z
Issue: UTV2-1521
Tier: T1
Lane type: governance
Branch: claude/utv2-1521-authenticate-scope-override
PR URL: https://github.com/griff843/Unit-Talk-v2/pull/1191
Head SHA: 9eae6ded1cacd745c1040539554c73ae43b37e89

## Summary

Removes the manifest-embedded `scope_override` field from `scripts/ci/file-scope-guard.ts` — it lived inside the same JSON the PR's own diff controls, so a well-formed-looking override object proved nothing about actual authorization. Replaces it with an externally-authored PR comment (`scope-override/v1`), authenticated against `AUTHORIZED_REVIEWERS` the same way `merge-gate.yml` authenticates its self-attestation comment schemas. The override binds to issue ID, PR number, and head SHA.

## Verification
- [x] `pnpm env:check`: PASS
- [x] `pnpm lint`: PASS
- [x] `pnpm type-check`: PASS (`pnpm exec tsc -b tsconfig.json`, 0 errors)
- [x] `pnpm build`: PASS
- [x] `pnpm test`: PASS, 3185/3185 tests, 0 failures across all suites
- [x] `npx tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD`: Verdict PASS, Changed files: 9, Rules matched: (none) — no R-level artifacts required for this diff
- [x] `scripts/ci/file-scope-guard.test.ts`: 19/19 PASS (14 existing + 1 regression + 5 new external-override authorization scenarios)
- [x] Manual CLI smoke of `scripts/ci/file-scope-guard.ts`: no-override → FAIL (outside declared scope); matching issue/PR/head-SHA override → PASS; wrong-PR override → FAIL

## Runtime Verification

Required for T1 per the CLAUDE.md verification table regardless of path — this lane touches no application or DB code (pure CI tooling: `file-scope-guard.ts`, `merge-risk.ts`, workflow YAML), so this is a live-Supabase health smoke, not a test of this lane's own change.

Command executed: `pnpm test:db`

```
TAP version 13
# Subtest: database repository bundle persists a submission and settlement when Supabase is configured
ok 1 - database repository bundle persists a submission and settlement when Supabase is configured
# Subtest: UTV2-920: invalid atomic enqueue writes no lifecycle event or outbox row
ok 2 - UTV2-920: invalid atomic enqueue writes no lifecycle event or outbox row
# Subtest: UTV2-920: invalid atomic delivery confirmation rolls back outbox status, receipt, lifecycle, and audit writes
ok 3 - UTV2-920: invalid atomic delivery confirmation rolls back outbox status, receipt, lifecycle, and audit writes
# Subtest: UTV2-920: invalid atomic settlement writes no settlement, lifecycle event, or audit row
ok 4 - UTV2-920: invalid atomic settlement writes no settlement, lifecycle event, or audit row
# Subtest: UTV2-883: no duplicate participants for the same external_id and sport
ok 5 - UTV2-883: no duplicate participants for the same external_id and sport
# Subtest: UTV2-996: re-settling a settled pick creates correction — no true duplicate base rows
ok 6 - UTV2-996: re-settling a settled pick creates correction — no true duplicate base rows
# Subtest: UTV2-996: correction chain is additive — original settlement row is not mutated
ok 7 - UTV2-996: correction chain is additive — original settlement row is not mutated
1..7
# tests 7
# suites 0
# pass 7
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 117575.245344
```

Supabase project: `zfzdnfwdarxucxtaojxm`. No DB writes attributable to this lane's own change set (no lane-specific rows mutated).

## Acceptance criteria mapping
- Manifest-embedded `scope_override` removed and never honored, even if well-formed → `scripts/ci/file-scope-guard.ts` diff removes `ScopeOverride`/`isWellFormedScopeOverride` and the manifest-honoring branch; regression test asserts this.
- Replacement override authenticated against something external to the PR-controlled manifest → `docs/05_operations/schemas/scope-override-v1.md` + `.github/workflows/file-scope-lock-check.yml`: override is read from a PR comment authored by an `AUTHORIZED_REVIEWERS` member, never from the manifest JSON.
- Binds to issue_id, PR number, head SHA (a push invalidates a stale override) → `ExternalScopeOverride` + `resolveApplicableOverride()`.
- Fails closed on any mismatch (wrong issue, wrong PR, stale SHA, self-authored) → 5 new test scenarios, each covering one failure mode, plus a valid-accept case and a cross-lane-leak-prevention case.
- `scripts/ci/file-scope-guard.ts` self-protected as Tier C → `scripts/ops/merge-risk.ts` `TIER_C_EXACT_PATHS`.

## SHA Binding
Head SHA: 9eae6ded1cacd745c1040539554c73ae43b37e89
