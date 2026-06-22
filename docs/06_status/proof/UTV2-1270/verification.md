# UTV2-1270 — Verification

**Lane:** UTV2-1270 — Command Center provider-truth validation panel (requirements + data contract)
**Tier:** T2 · **Lane type:** governance · **Executor:** Claude
**Change class:** documentation only (one requirements/data-contract doc + lane bookkeeping + proof)

## Verification

### Static + build + tests (`pnpm verify`)

`pnpm verify` (env:check + lint + type-check + build + test) run in the lane worktree — **PASS** (exit 0).

```
# tests 7   # pass 7   # fail 0   # skipped 0
# tests 4   # pass 4   # fail 0   # skipped 0
# tests 4   # pass 4   # fail 0   # skipped 0
# tests 1   # pass 1   # fail 0   # skipped 0
# tests 113 # pass 113 # fail 0   # skipped 0
VERIFY_EXIT=0
```

Note: an initial run hit 2 transient failures in the live-DB suite
(`Could not query the database for the schema cache. Retrying.`) — a known Supabase schema-cache
degradation flake, unrelated to this docs-only change (it touches no code path). A clean re-run passed
all suites (0 failures), confirming the flake was environmental.

### R-level compliance

`tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD` → **PASS**. Rules matched: none — no
R-level artifacts required for a docs-only diff.

### Issue-specific (T2)

This is a requirements/data-contract lane. The deliverable is reviewed against the issue's required
panel concepts, data buckets, and guardrails:

- All required per-row panel concepts are specified in the data contract (§4), with exact field names,
  types, and sources grounded in `apps/api/src/scripts/sgo-provider-truth-audit.ts`.
- All six required data buckets are defined (§3).
- Verdict + reason-code vocabulary reproduced verbatim from the classifier (§5).
- `provider_truth_verified` semantics stated: `db_signal_only` is never provider-truth verified.
- Forward-flow vs backfill provenance defined (§4.4).
- UTV2-1042 eligibility specified as advisory display-only (§4.5).
- Upstream dependencies / net-new gaps enumerated (§6).

### Guardrail compliance

- No implementation (no UI/API/schema/runtime). No CLV/ROI/edge claims. No P3 certification.
- No UTV2-1042 Done. No public Discord changes. No threshold/freshness changes. No write path.

## Verdict

Documentation deliverable complete and verified; `pnpm verify` green on the branch (re-run after a
transient Supabase flake). Ready for T2 review.
