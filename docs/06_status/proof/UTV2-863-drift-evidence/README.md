# UTV2-863 Drift Evidence

UTV2-863 — *Apply model ownership schema live after prerequisite convergence* — is **Blocked Internal**. The `pick_candidates` ownership columns are live, but live scoring writes still skip the ownership trio (`model_registry_id`, `scoring_run_id`, `ownership_timestamp`). This bundle is the pre-fix evidence that documents *the drift itself*.

This directory exists because the drift evidence was first generated under two unrelated paths (`docs/06_status/proof/UTV2-869-runtime-drift/` and a re-run of `docs/06_status/proof/UTV2-854/*` on 2026-05-09). Both lanes were already closed; mutating their proof dirs would violate the proof-immutability policy. Consolidating the evidence under UTV2-863 — the lane the drift actually motivates — is the correct home.

## Contents

### `runtime-drift/`
Originally written into `docs/06_status/proof/UTV2-869-runtime-drift/` during UTV2-869's runtime observability work. The investigation came out of UTV2-869 but the evidence is about UTV2-863's missing ownership write contract:

| File | What it is |
|---|---|
| `evidence.json` | Top-level drift verdict (`runtime_drift_proven: true`, `current_repo_code_deployed: false`). |
| `live-write-trace.json` | Trace of the 2026-05-09 01:34Z 1,000-row write burst — `worker.heartbeat` runs only, no `candidate.scoring` runs. |
| `runtime-path-analysis.md` | Code path comparison: deployed runtime matches pre-UTV2-854 contract (3 fields), repo contract requires ownership trio. |
| `remediation.md` | Remediation options. |

### `UTV2-854-rerun-2026-05-09/`
A rerun of the UTV2-854 ownership-persistence proof scripts on 2026-05-09. Counts moved (`scored_candidates_total: 6978 → 7051`, `null_ownership: 6978 → 7051`, `ownership_write_success_pct: 0`). Documents the drift in raw count form.

UTV2-854's original proof dir at `docs/06_status/proof/UTV2-854/` stays frozen at its merged content (PR #606, merge `2c434a78`).

| File | What it is |
|---|---|
| `evidence.json` | Top-level summary regenerated 2026-05-09T16:40:23Z. |
| `migration-results.json` | Post-migration state probe. |
| `ownership-persistence-summary.json` | Aggregate metrics (`ownership_write_success_pct: 0`). |
| `ownership-write-results.csv` | Raw row-level write attempt outcomes. |
| `ownership-enforcement-results.csv` | Quarantine + enforcement check results. |
| `ownership-quarantine-results.csv` | Per-candidate quarantine reasons. |

## Verdict

- Live scoring runtime is older than `38392b5a` (the UTV2-854 ownership-aware build).
- 7,051 / 7,051 scored `pick_candidates` rows have NULL ownership trio.
- 0 `system_runs` rows of type `candidate.scoring` exist.
- 552 `qualified` unscored candidates exist but **all 552** map to `market_universe.is_stale = true`.

## Cross-references

- **Root cause:** Production host runs a runtime built before UTV2-854 (the migration is live, the deployed binary is not). See `docs/06_status/proof/UTV2-864-milestone-truth-audit.md` §5.
- **Why deploy didn't update:** Deploy job fails at `Validate deploy secrets` (5 missing GitHub Actions secrets). Filed as 🆕 A in the milestone audit.
- **What unblocks UTV2-863:** runtime SHA convergence (🆕 B) + fresh viable candidates (🆕 E) + green `ownership_write_success_pct` rerun.

This evidence is read-only; do not mutate. The fix lives in a future UTV2-863 reopen + fresh proof generated post-deploy.
