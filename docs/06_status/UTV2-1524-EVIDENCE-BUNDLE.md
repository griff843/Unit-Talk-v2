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
| Date | 2026-07-12 |
| Verifier Identity | claude/utv2-1524-scope-override-parser-fix |
| Commit SHA(s) | 0225e6fb + follow-on fix commit |
| Related PRs | (opened after this bundle) |

---

## Scope

**Files changed:**
- `.github/workflows/file-scope-lock-check.yml` — rewrote the scope-override comment field extractor to walk the full comment body instead of only lines before `Paths:`
- `scripts/ci/scope-override-comment-parser.ts` (new) — extracted, unit-testable mirror of the workflow's parser logic
- `scripts/ci/scope-override-comment-parser.test.ts` (new) — regression tests for both field orders
- `scripts/ci/file-scope-guard.ts` — `findOwnManifest()` falls back to an issue-ID match (via `ISSUE_BRANCH_PATTERN`) when no exact branch match exists; the conflict-check loop in `evaluateFileScopeGuard()` now also excludes the resolved `ownManifest`, not just an exact branch-string match
- `scripts/ci/file-scope-guard.test.ts` — 2 new regression tests for the continuation-branch fallback
- `docs/06_status/KNOWN_DEBT.md` — DEBT-027 closed, documenting both bugs and the fix
- `package.json` — registered the new test file in `test:ops`

**Claims:**
- A `scope-override/v1` comment authored in the schema doc's own documented field order (`Reason:` after `Paths:`) now parses correctly and is no longer silently rejected.
- A continuation PR for an already-merged-but-unclosed lane, opened from a different branch name than the original, is now recognized as "its own lane" via issue-ID fallback, and does not spuriously trigger a scope-conflict against itself.
- All pre-existing `file-scope-guard.test.ts` behavior (self-authored/stale/wrong-issue/wrong-PR override rejection, cross-lane isolation) is unchanged and still passes.

**Does NOT claim:**
- Any change to the schema doc's documented field order (both orders are now valid).
- Any change to other OS v1 mechanism issues (duplicate Merge Gate check-runs, two incompatible proof formats, T2 self-approval mechanics) — out of scope per this issue's description.

---

## Assertions

| # | Assertion | Evidence Type | Source | Result | Evidence Ref |
|---|---|---|---|---|---|
| 1 | A scope-override comment with `Reason:` after `Paths:` (schema doc's documented order) now parses with a non-empty reason | test-output | `scripts/ci/scope-override-comment-parser.test.ts` | PASS | [E1](#e1-parser-fix-reason-after-paths) |
| 2 | A scope-override comment with `Reason:` before `Paths:` still parses correctly (no regression) | test-output | `scripts/ci/scope-override-comment-parser.test.ts` | PASS | [E2](#e2-parser-fix-reason-before-paths) |
| 3 | `findOwnManifest` resolves a continuation PR's own lane by issue ID when the branch name differs from the manifest's recorded branch | test-output | `scripts/ci/file-scope-guard.test.ts` | PASS | [E3](#e3-findownmanifest-fix) |
| 4 | A valid scope-override still authorizes its listed paths through the issue-ID fallback path | test-output | `scripts/ci/file-scope-guard.test.ts` | PASS | [E4](#e4-findownmanifest-fix-override) |
| 5 | Full repo test suite passes with no regressions | test-output | `pnpm test` | PASS | [E5](#e5-full-suite) |
| 6 | Type-check and lint pass | command-output | `pnpm type-check`, `pnpm lint` | PASS | [E6](#e6-type-check-and-lint) |
| 7 | Runtime DB smoke test passes against live Supabase | db-query | `pnpm test:db` against `zfzdnfwdarxucxtaojxm` | PASS | [E7](#e7-test-db) |

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

### E3 findOwnManifest fix

**Test-output evidence**
```text
$ npx tsx --test scripts/ci/file-scope-guard.test.ts
ok 20 - own manifest resolution (UTV2-1524 regression): a continuation PR from a renamed branch still finds its own lane by issue ID
# tests 21
# pass 21
# fail 0
```

### E4 findOwnManifest fix (override still applies)

**Test-output evidence**
```text
$ npx tsx --test scripts/ci/file-scope-guard.test.ts
ok 21 - own manifest resolution (UTV2-1524 regression): a valid scope-override still applies through the issue-ID fallback
# tests 21
# pass 21
# fail 0
```

### E5 Full suite

**Command-output evidence**
```text
$ pnpm test
(all suites pass across the full repo test run, 0 failures)
```

### E6 Type-check and lint

**Command-output evidence**
```text
$ pnpm type-check
(0 errors)

$ pnpm lint
(0 errors)
```

### E7 test:db

**DB-query evidence**
Project ref: `zfzdnfwdarxucxtaojxm`
Run at: 2026-07-12
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
This is a CI-tooling-only change (no DB schema or data-path touch); `test:db` is run as the standard T1 runtime-proof gate, not because this change itself performs DB writes.

---

## Acceptance Criteria Mapping

| Acceptance Criterion (verbatim from Linear) | Assertion # |
|---|---|
| Bug 1: fix so a comment in the schema doc's documented field order (Reason after Paths) parses with a non-empty reason | 1, 2 |
| Bug 1: add a regression test/fixture covering a comment in the schema doc's documented field order | 1, 2 |
| Bug 2: `findOwnManifest` false-fail on the trusted-override authority path is fixed or proven non-blocking | 3, 4 |
| No regression to existing self-authored/stale/wrong-issue/wrong-PR override rejection or cross-lane isolation | 5 |

---

## Stop Conditions Encountered

None. Scope was deliberately kept to exactly the two bugs named in the issue (plus the directly-dependent conflict-check-loop fix discovered while testing bug 2, which is the same exact-branch-match defect manifesting a second time in the same function).

---

## Sign-off

**Verifier:** claude/utv2-1524-scope-override-parser-fix — 2026-07-12
**PM acceptance:** pending
