# UTV2-643 Diff Summary

| Field | Value |
|---|---|
| Issue | UTV2-643 — Build proof freshness CLI |
| PR | #326 |
| Merge SHA | `1094e775b175af1923d58a971428382da0e05e11` |
| Tier | T2 |
| Branch | griffadavi/utv2-643-build-proof-freshness-cli-that-detects-stale-or-missing |

## Files Changed

- `scripts/proof-check.ts` — new file, 265 lines
- `package.json` — added `"proof:check": "tsx scripts/proof-check.ts"` script entry

## Summary

Implements `pnpm proof:check` CLI that detects stale or missing readiness evidence artifacts across active lanes. 4 signals: Lane Heartbeat, Expected Proof Completeness, Proof File Age, Orphaned Proof Dirs. Supports `--json` flag; exits 1 on any RED critical.
