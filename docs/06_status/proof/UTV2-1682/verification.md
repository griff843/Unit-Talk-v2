# UTV2-1682 Verification Evidence

## Verification

| Check | Result | Evidence |
|---|---|---|
| `pnpm exec tsx --test 'scripts/ops/concurrency-rules.test.ts' 'scripts/ops/shared.test.ts'` | PASS | 84 tests passed; 0 failed |
| `pnpm type-check` | PASS | TypeScript project-reference checks completed with exit code 0 |
| `pnpm lint` | PASS | ESLint completed with exit code 0 |
| `pnpm test` | PASS | Root test aggregate completed within `pnpm verify:static` with exit code 0 |
| `pnpm verify:static` | PASS | DB-client boundary, sync/alignment checks, env check, lint, type-check, build, root tests, Smart Form verification, and command checks completed with exit code 0 |
| Live read-only active-lane resolution | PASS | Canonical discovery found 10 visible lanes, including three parked lanes with zero capacity in every dimension |

### Issue-specific assertions

- Two parked governance lanes do not breach executor, total, or governance-type caps configured at one.
- Recursive local discovery includes a manifest under `docs/06_status/lanes/parked/`.
- PR-head discovery checks `docs/06_status/lanes/<issue>.json`, then `docs/06_status/lanes/parked/<issue>.json` only after confirmed absence.
- The same parked manifest is `visible_uncounted` at either sanctioned location.
- Parked manifests continue to produce file-scope conflicts at either location.
- Unreadable local and PR-head populations throw a fail-closed discovery error.

### Read-only repository proof

The live repository discovery command resolved 10 canonical visible lanes. Its parked results were:

```text
UTV2-1570  open_pr_head  lanes_root    visible_uncounted  executor=false total=false laneType=false
UTV2-1577  open_pr_head  lanes_parked  visible_uncounted  executor=false total=false laneType=false
UTV2-1578  open_pr_head  lanes_parked  visible_uncounted  executor=false total=false laneType=false
```

This demonstrates that lifecycle status, not manifest location, determines parked capacity while both sanctioned locations remain visible.

### Database verification

Writable live-DB proof is blocked/deferred: target identity could not be resolved from its URL (host=unparseable). Writable DB verification requires xskgrzbteyqdufktjrjx. Run it through the staging-ci GitHub environment with CI_SUPABASE_* credentials.

This lane changes repository governance scripts only and performs no database writes.

### R-level compliance

`npx tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD` passed against the committed proof bundle:

```text
Verdict: PASS
Changed files: 9
Rules matched: (none) — no R-level artifacts required for this diff
```

The changed implementation paths under `scripts/ops/**` trigger no path-mapped rule in `docs/05_operations/r1-r5-rules.json`.
