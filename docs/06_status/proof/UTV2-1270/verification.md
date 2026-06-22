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

### Live-DB smoke (`pnpm test:db`)

`pnpm test:db` run against live Supabase (project `zfzdnfwdarxucxtaojxm`) in the lane worktree — **PASS**
(exit 0). This is a docs-only lane (no DB code path touched); the live-DB run is included as required
proof evidence and confirms the branch does not regress the runtime smoke suite.

```
ok 2 - UTV2-920: invalid atomic enqueue writes no lifecycle event or outbox row
ok 3 - UTV2-920: invalid atomic delivery confirmation rolls back outbox status, receipt, lifecycle, and audit writes
ok 4 - UTV2-920: invalid atomic settlement writes no settlement, lifecycle event, or audit row
ok 5 - UTV2-883: no duplicate participants for the same external_id and sport
ok 6 - UTV2-996: re-settling a settled pick creates correction — no true duplicate base rows
ok 7 - UTV2-996: correction chain is additive — original settlement row is not mutated
# tests 7
# pass 7
# fail 0
# cancelled 0
# skipped 0
# todo 0
```

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

---

# PROOF: UTV2-1270
MERGE_SHA: 1b5c582d3bb1978cf21104bd8b666e0375a3df9d

ASSERTIONS:
- [x] Requirements + per-row data contract authored at `docs/05_operations/CC_PROVIDER_TRUTH_VALIDATION_PANEL.md`, grounded in the existing classifier (exact field names, enums, reason codes, sources).
- [x] All six required data buckets and the verdict/reason-code vocabulary are specified verbatim from `apps/api/src/scripts/sgo-provider-truth-audit.ts`.
- [x] `pnpm verify` PASS (exit 0) and `pnpm test:db` PASS (7/7) on the branch; R-level check PASS (no artifacts required).
- [x] Requirements only — no implementation, no CLV/ROI/edge claims, no P3 certification, no UTV2-1042 state change, no public Discord change.

EVIDENCE:
```text
$ pnpm verify    → exit 0   (# pass 113 # fail 0 # skipped 0, plus 7/4/4/1 suite blocks all green)
$ pnpm test:db   → exit 0
# tests 7
# pass 7
# fail 0
# cancelled 0
# skipped 0
# todo 0
$ tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD
Verdict: PASS — Rules matched: (none) — no R-level artifacts required for this diff
```

> `MERGE_SHA` records the branch head at proof authoring (`1b5c582d`); it is an ancestor of the current
> PR head after this proof commit, as required by the executor-result-validator. The true merge SHA is
> bound post-merge by `post-merge-lane-close.yml`.
