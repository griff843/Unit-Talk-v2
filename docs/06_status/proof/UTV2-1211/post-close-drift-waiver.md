---
type: pm-waiver
issue: UTV2-1211
recorded_at: 2026-06-06
recorded_by: pm
---

## Post-Close Truth-Check Drift Waiver

### Authoritative run

**Run 1 — 2026-06-06T14:50:20** — verdict: PASS  
Failures: G1-infra_error (GITHUB_TOKEN absent). Waiver PE3 in preflight token. All other checks pass.

### Post-close runs (not authoritative)

**Runs 2 + 3 — 2026-06-06T15:17:05 / T15:17:13** — verdict: FAIL  
Triggered by post-close heartbeat. GITHUB_TOKEN was available by this point.

Failures and root causes:

| Check | Root cause | Real gap? |
|---|---|---|
| G2 | `manifest.commit_sha = "e21b6999"` (short 8-char); GitHub API returns full 40-char SHA. Strict string comparison fails. | No — merge is correct |
| C3 | Same as G2 — `prMergeSha !== mergeSha` due to short vs full format | No — same root cause |
| P10 | `evidence.json` lacks `verifier.identity` field. PM was verifier per Linear stateHistory. | Schema gap only |
| R1 | `runtime_proof.queries[]` not present — evidence used `{pnpm_test_db: "pass"}` format | Schema gap only — test ran |
| R2 | `runtime_proof.row_counts[]` not present — same simplified format | Schema gap only — test ran |
| R3 | `verifier.identity` not set — same as P10 | Schema gap only |

### PM disposition

WAIVED. Implementation, tests, `pnpm test:db`, and CI sentinels all passed at lane-close time. Post-close failures are harness artifacts: short SHA format (tracked as infra follow-up), evidence schema gaps (tracked as infra follow-up), post-close heartbeat guard (tracked as infra follow-up). Lane remains Done.
