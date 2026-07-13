# UTV2-1524 — Evidence Bundle

> Generated from `docs/05_operations/EVIDENCE_BUNDLE_TEMPLATE.md` on 2026-07-12.
> Fill in every section. Run `pnpm evidence:validate docs/06_status/UTV2-1524-EVIDENCE-BUNDLE.md` before requesting PM acceptance.

---

## Metadata

| Field | Value |
|---|---|
| Issue ID | UTV2-1524 |
| Tier | T1 |
| Phase / Gate | OS v1 stabilization — scope-override authority path fix |
| Owner | claude (orchestrator) |
| Date | 2026-07-12 / 2026-07-13 (P1 correction) / 2026-07-13 (merged) |
| Verifier Identity | claude/utv2-1524-scope-override-parser-fix |
| Commit SHA(s) | 6cbb43e3 (original fix), 1bebb8ad (P1 correction, PR head) |
| Merge SHA | 60a2a15028aad049e8ff0f3c8c10da5275879ebb |
| Related PRs | https://github.com/griff843/Unit-Talk-v2/pull/1194 (merged) |

---

## Scope

**Files changed:**
- `.github/workflows/file-scope-lock-check.yml` — rewrote the scope-override comment field extractor to walk the full comment body instead of only lines before `Paths:`
- `scripts/ci/scope-override-comment-parser.ts` (new) — extracted, unit-testable mirror of the workflow's parser logic
- `scripts/ci/scope-override-comment-parser.test.ts` (new) — regression tests for both field orders
- `scripts/ci/file-scope-guard.ts` — `findOwnManifest()` falls back to an issue-ID match (via `ISSUE_BRANCH_PATTERN`) when no exact branch match exists, **but only when an externally authorized `scope-override/v1` comment bound to the exact issue, PR number, and head SHA vouches for the continuation** (P1 correction below); `resolveApplicableOverride()` now honors the *last* matching comment for a given head SHA instead of the first; the conflict-check loop in `evaluateFileScopeGuard()` excludes the resolved `ownManifest`, not just an exact branch-string match
- `scripts/ci/file-scope-guard.test.ts` — regression tests for the continuation-branch fallback, both the original fix and the P1 correction
- `docs/06_status/KNOWN_DEBT.md` — DEBT-027 closed, documenting both original bugs and the fix
- `package.json` — registered the new test file in `test:ops`

**Claims:**
- A `scope-override/v1` comment authored in the schema doc's own documented field order (`Reason:` after `Paths:`) now parses correctly and is no longer silently rejected.
- A continuation PR for an already-merged-but-unclosed lane, opened from a different branch name than the original, can be recognized as "its own lane" via issue-ID fallback **only when an externally authorized scope-override comment binds that exact issue, PR number, and head SHA** — an issue ID merely embedded in the branch name is never sufficient by itself.
- An unrelated branch that happens to contain another lane's issue ID cannot inherit that lane's `file_scope_lock`, and that lane is still evaluated as a foreign lane for conflict-detection purposes (the `manifest === ownManifest` skip does not fire for it).
- `resolveApplicableOverride` honors the most recent matching comment when more than one comment targets the same (issue, PR, head SHA) triple, so a corrective follow-up comment is never shadowed by an earlier, incomplete one.
- All pre-existing `file-scope-guard.test.ts` behavior (self-authored/stale/wrong-issue/wrong-PR override rejection, cross-lane isolation, exact-branch-match resolution) is unchanged and still passes.

**Does NOT claim:**
- Any change to the schema doc's documented field order (both orders are now valid).
- Any change to other OS v1 mechanism issues (duplicate Merge Gate check-runs, two incompatible proof formats, T2 self-approval mechanics) — out of scope per this issue's description.

---

## P1 Correction (independent PM review, 2026-07-13)

The original fix (2026-07-12) let `findOwnManifest()` accept an issue-ID match embedded in the branch name **unconditionally** — no authorization check. Codex's P1 review of the resulting diff found this unsafe: an unrelated branch such as `codex/utv2-1524-unrelated` could inherit another lane's `file_scope_lock` purely by including that lane's issue ID in its own branch name, and would additionally be excluded from conflict detection because it resolved to `ownManifest`. An issue ID in a branch name is attacker-controlled (any branch name is), so it is not proof of continuation authority.

**Correction applied:** the issue-ID fallback now requires a trusted continuation binding — a valid, externally authorized `scope-override/v1` PR comment bound to the exact issue ID, PR number, and head SHA (the same GitHub-attested trust anchor already used to widen path scope, per `resolveApplicableOverride`). Without that binding, the fallback returns `null`, the branch is treated as having no own manifest, it fails closed with a "No active lane manifest found" error, and any other active lane's `file_scope_lock` is evaluated normally against it (not skipped).

---

## Assertions

| # | Assertion | Evidence Type | Source | Result | Evidence Ref |
|---|---|---|---|---|---|
| 1 | A scope-override comment with `Reason:` after `Paths:` (schema doc's documented order) now parses with a non-empty reason | test-output | `scripts/ci/scope-override-comment-parser.test.ts` | PASS | [E1](#e1-parser-fix-reason-after-paths) |
| 2 | A scope-override comment with `Reason:` before `Paths:` still parses correctly (no regression) | test-output | `scripts/ci/scope-override-comment-parser.test.ts` | PASS | [E2](#e2-parser-fix-reason-before-paths) |
| 3 | Exact manifest branch match still resolves `ownManifest` with no override required | test-output | `scripts/ci/file-scope-guard.test.ts` | PASS | [E3](#e3-exact-branch-match) |
| 4 | A same-issue continuation branch with NO authorization fails closed (no override present) | test-output | `scripts/ci/file-scope-guard.test.ts` | PASS | [E4](#e4-no-authorization-fails-closed) |
| 5 | An unrelated branch containing another lane's issue ID cannot inherit that lane's scope, and that lane is still evaluated for conflicts (bypass is closed) | test-output | `scripts/ci/file-scope-guard.test.ts` | PASS | [E5](#e5-unrelated-branch-cannot-inherit-or-bypass) |
| 6 | A properly authorized continuation (issue + PR number + head SHA all bound) succeeds | test-output | `scripts/ci/file-scope-guard.test.ts` | PASS | [E6](#e6-authorized-continuation-succeeds) |
| 7 | Stale, wrong-PR, and wrong-issue continuation overrides all fail closed | test-output | `scripts/ci/file-scope-guard.test.ts` | PASS | [E7](#e7-stale-wrong-pr-wrong-issue-fail-closed) |
| 8 | A valid continuation override does not authorize paths beyond its declared scope | test-output | `scripts/ci/file-scope-guard.test.ts` | PASS | [E8](#e8-continuation-override-scope-is-bounded) |
| 9 | `resolveApplicableOverride` honors the last matching comment for a head SHA, not the first | test-output | `scripts/ci/file-scope-guard.test.ts` | PASS | [E9](#e9-last-matching-override-wins) |
| 10 | Full repo test suite passes with no regressions | test-output | `pnpm test` | PASS | [E10](#e10-full-suite) |
| 11 | Type-check and lint pass | command-output | `pnpm type-check`, `pnpm lint` | PASS | [E11](#e11-type-check-and-lint) |
| 12 | Runtime DB smoke test passes against live Supabase | db-query | `pnpm test:db` against `zfzdnfwdarxucxtaojxm` | PASS | [E12](#e12-test-db) |

---

## Evidence Blocks

### E1 Parser fix (Reason after Paths)

**Test-output evidence**
```text
$ npx tsx --test scripts/ci/scope-override-comment-parser.test.ts
ok 2 - parses a well-formed override with Reason after Paths (schema doc documented order)
# tests 5
# pass 5
# fail 0
```

### E2 Parser fix (Reason before Paths)

**Test-output evidence**
```text
$ npx tsx --test scripts/ci/scope-override-comment-parser.test.ts
ok 1 - parses a well-formed override with Reason before Paths
# tests 5
# pass 5
# fail 0
```

### E3 Exact branch match

**Test-output evidence**
```text
$ npx tsx --test scripts/ci/file-scope-guard.test.ts
ok 20 - own manifest resolution: exact branch match still passes with no override needed
# tests 28
# pass 28
# fail 0
```

### E4 No authorization fails closed

**Test-output evidence**
```text
$ npx tsx --test scripts/ci/file-scope-guard.test.ts
ok 21 - own manifest resolution (UTV2-1524 P1 correction): a same-issue continuation with NO authorization fails closed
# tests 28
# pass 28
# fail 0
```

### E5 Unrelated branch cannot inherit or bypass

**Test-output evidence**
```text
$ npx tsx --test scripts/ci/file-scope-guard.test.ts
ok 22 - own manifest resolution (UTV2-1524 P1 correction): an unrelated branch containing the same issue ID cannot inherit the manifest scope, and cannot bypass conflict detection
# tests 28
# pass 28
# fail 0
```

### E6 Authorized continuation succeeds

**Test-output evidence**
```text
$ npx tsx --test scripts/ci/file-scope-guard.test.ts
ok 23 - own manifest resolution (UTV2-1524 P1 correction): a properly authorized, PR-number-bound and head-SHA-bound continuation succeeds
# tests 28
# pass 28
# fail 0
```

### E7 Stale / wrong-PR / wrong-issue fail closed

**Test-output evidence**
```text
$ npx tsx --test scripts/ci/file-scope-guard.test.ts
ok 24 - own manifest resolution (UTV2-1524 P1 correction): a stale continuation override (head SHA no longer matches) fails closed
ok 25 - own manifest resolution (UTV2-1524 P1 correction): a wrong-PR continuation override fails closed
ok 26 - own manifest resolution (UTV2-1524 P1 correction): a wrong-issue continuation override does not authorize a different lane's branch
# tests 28
# pass 28
# fail 0
```

### E8 Continuation override scope is bounded

**Test-output evidence**
```text
$ npx tsx --test scripts/ci/file-scope-guard.test.ts
ok 27 - own manifest resolution (UTV2-1524 P1 correction): a valid continuation override does not authorize paths beyond its declared scope
# tests 28
# pass 28
# fail 0
```

### E9 Last matching override wins

**Test-output evidence**
```text
$ npx tsx --test scripts/ci/file-scope-guard.test.ts
ok 28 - resolveApplicableOverride: when two comments match the same head SHA, the later one wins
# tests 28
# pass 28
# fail 0
```

### E10 Full suite

**Command-output evidence**
```text
$ pnpm test
(all suites pass across the full repo test run, 0 failures)
```

### E11 Type-check and lint

**Command-output evidence**
```text
$ pnpm type-check
(0 errors)

$ pnpm lint
(0 errors)
```

### E12 test:db

**DB-query evidence**
Project ref: `zfzdnfwdarxucxtaojxm`
Run at: 2026-07-13 (P1 correction re-verification)
```text
$ pnpm test:db
TAP version 13
1..7
# tests 7
# pass 7
# fail 0
# cancelled 0
# skipped 0
```
This is a CI-tooling-only change (no DB schema or data-path touch); `test:db` is run as the standard T1 runtime-proof gate, not because this change itself performs DB writes. (Note: an earlier re-run during this same session showed 1 transient failure/6 pass, consistent with known live-Supabase test flakiness — see `feedback-verify-flakes-during-supabase-degradation` — and was superseded by this clean 7/7 run.)

---

## Acceptance Criteria Mapping

| Acceptance Criterion (verbatim from Linear) | Assertion # |
|---|---|
| Bug 1: fix so a comment in the schema doc's documented field order (Reason after Paths) parses with a non-empty reason | 1, 2 |
| Bug 1: add a regression test/fixture covering a comment in the schema doc's documented field order | 1, 2 |
| Bug 2: `findOwnManifest` false-fail on the trusted-override authority path is fixed or proven non-blocking | 3, 6 |
| Bug 2 P1 correction: issue-ID fallback requires a trusted continuation binding, not an unconditional token match | 4, 5, 7, 8 |
| No regression to existing self-authored/stale/wrong-issue/wrong-PR override rejection or cross-lane isolation | 3, 7, 9, 10 |

---

## Stop Conditions Encountered

Independent PM review (2026-07-13) found the original fix's issue-ID fallback unsafe — Codex's P1 review thread on `scripts/ci/file-scope-guard.ts` identified that an unrelated branch could inherit another lane's scope by embedding its issue ID. PM verdict was CHANGES REQUIRED; work stopped, the correction above was implemented and independently re-verified (full suite + type-check + lint + test:db). PM subsequently posted a `pm-verdict/v1` APPROVED comment and PR #1194 merged (squash) as `60a2a15028aad049e8ff0f3c8c10da5275879ebb`.

---

## Sign-off

**Verifier:** claude/utv2-1524-scope-override-parser-fix — 2026-07-13 (P1 correction)
**PM acceptance:** APPROVED (`pm-verdict/v1`, PR #1194) — 2026-07-13
**Merge SHA:** 60a2a15028aad049e8ff0f3c8c10da5275879ebb
