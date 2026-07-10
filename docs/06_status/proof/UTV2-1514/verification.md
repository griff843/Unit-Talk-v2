# UTV2-1514 Verification

## Verification

Commit under verification: `514f19d2a00567dbba98357214c869da63dc8288`.

Commands run:

```bash
pnpm ops:brief
npx tsx --test scripts/ops/tier-classifier.test.ts scripts/ops/merge-risk.test.ts
pnpm type-check
pnpm test
npx tsx scripts/ops/tier-classifier.ts --declared-tier T2 --files scripts/ops/merge-risk.ts,scripts/ops/tier-classifier.ts,scripts/ops/tier-classifier.test.ts
pnpm test:db
pnpm verify
npx tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD
```

Results:

- `pnpm ops:brief`: passed; branch `codex/utv2-1514-mechanical-tier-classifier-implementation`, clean start state, no current PR.
- Focused issue-specific tests: passed, 23 classifier/merge-risk tests.
- `pnpm type-check`: passed.
- `pnpm test`: passed.
- Classifier dry run: advisory-only neutral escalation from declared `T2` to derived `T1` for the governance implementation files.
- `pnpm test:db`: passed.

```text
# pass 7
# fail 0
# skipped 0
```

- `pnpm verify`: passed, including `pnpm test:db` and `test:t1-proof:live`.
- `npx tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD`: passed; changed files: 8; rules matched: none.

## Post-review fixes (2026-07-09)

- `pr-review-packet` CI flagged `scripts/ops/tier-classifier.test.ts` as missing from `package.json`'s `test:ops` script list, meaning the 14 regression tests never executed under `pnpm test`. Fixed by adding the entry alongside the other `scripts/ops/*.test.ts` files; re-ran `npx tsx --test scripts/ops/tier-classifier.test.ts` (14/14 pass) and the full `pnpm test:ops` (764/764 pass, confirmed the new subtests appear in the run). `file_scope_lock` extended to include `package.json`.
- Added the baseline/sweep report required by spec section 3 step 5 (see `sweep-report.md`), and extended `file_scope_lock`/`expected_proof_paths` to include it.

## Advisory CI wiring fix (2026-07-09, post codex-return-review P1 finding)

A Codex-return review inline finding on `scripts/ops/tier-classifier.ts:176` correctly noted the classifier had no workflow invoking it, so Phase 1's own "produces a report/annotation" acceptance criterion never surfaced on normal PRs. PM decision: wire it in this lane (not merge-gate.yml's blocking logic).

Commands run after the fix:
```bash
npx tsx --test scripts/ops/tier-classifier.test.ts scripts/ops/merge-risk.test.ts
pnpm verify
npx tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD
```

Results:
- Focused tests: 25/25 pass (16 tier-classifier + 9 merge-risk; 2 new tests added for `buildAdvisoryCheckRunOutput`).
- `pnpm verify`: passed (`EXIT:0`, zero non-zero `# fail` lines across the full log).
- `npx tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD`: PASS; changed files: 10; rules matched: none.
- Confirmed `git diff --stat main -- .github/workflows/merge-gate.yml` is empty — `authoritativeTier` tier-consumption logic untouched.
- Confirmed branch protection's `required_status_checks` (`verify`, `Executor Result Validation`, `Merge Gate`, `P0 Protocol`) is unchanged — the new `Tier Classifier (advisory)` workflow is not in it.
