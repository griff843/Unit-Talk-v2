# Diff Summary — UTV2-1533

**Issue:** UTV2-1533 — Post-lock concurrency ramp: raise ceiling to 10 active lanes (4 Claude + 6 Codex)
**Tier:** T1 (governance-critical)
**Lane type:** governance

## Files changed

```
docs/governance/CONCURRENCY_CONFIG.json    | 20 ++++-----
docs/governance/LANE_CONCURRENCY_POLICY.md | 66 +++++++++++++++++++-----------
scripts/ops/concurrency-simulation.test.ts |  6 +--
3 files changed, 54 insertions(+), 38 deletions(-)
```

## What changed

1. **`docs/governance/CONCURRENCY_CONFIG.json`**
   - `version`: 2 → 3
   - `total`: 6 → 10
   - `executors.claude`: 2 → 4
   - `executors.codex`: 4 → 6
   - `merge_serialized_max`, `singleton_types`, `forbidden_combinations` unchanged
   - `trial` block: replaced the expired (`allowed_until: 2026-06-26`) 8-lane trial with a **disabled** 14-lane trial (`claude: 5, codex: 9`, `allowed_until: null`), scoped for a future 12–14 lane ramp step that the PM enables only after the 10-lane base wave proves healthy.

2. **`docs/governance/LANE_CONCURRENCY_POLICY.md`**
   - §1 hard-limits table: total 6→10, claude 2→4, codex 4→6.
   - Intro paragraph: added provenance note — the prior 6-lane ceiling was a soft policy number, not a mechanical limit (see audit below).
   - §6: renamed to "Scaling to 10, then 12–14 lanes safely"; added a 10-lane example topology and explicit ramp-discipline language (watch ghost lanes / stale leases / memory pressure / CI+review delay / merge-train drain rate before enabling the 12–14 trial).
   - §10: ratified-standard table updated to 4 Claude / 6 Codex / 10 total; header renamed "10-lane ceiling — ratified and mechanically enforced"; added a note that raising the executor cap alone doesn't guarantee parallelism (references UTV2-1472).
   - §11: renamed to "Trial governor (12–14 lane ceiling)"; JSON example and behavior table updated to the new base (10/4/6) and new trial (14/5/9).

3. **`scripts/ops/concurrency-simulation.test.ts`**
   - Updated the one assertion (`merge_serialized_max is 1 in CONCURRENCY_CONFIG.json` test) that read the real JSON file and hardcoded `total===6`/`claude===2`/`codex===4` → now asserts `10`/`4`/`6`. All other tests use a local fixture `POLICY` object independent of the real JSON and needed no changes.

## Audit rationale (why these numbers, why now)

Full audit is in the UTV2-1533 issue body. Summary: `getEffectiveConfig()` and every consumer (`lane-start.ts`, `execution-state.ts`, `lane-maximizer.ts`, `merge-risk.ts`) read the JSON directly — no code anywhere hardcodes 2/4/6, and no external system (API rate limit, license seats, host process cap) enforces those numbers. The two real mechanical constraints found — merge-train serialization (`merge_serialized_max: 1`) and the WSL2-driven full-verify semaphore (default concurrency 1, decoupled from active-lane count) — are both untouched by this change.

## Not in this diff (deliberately)

- `scripts/ops/execution-state.ts`, `merge-risk.ts`, `lane-maximizer.ts` each have a `?? 2` / `?? 4` fallback default used only if the JSON fails to load (dead code in normal operation). Left unchanged — out of this lane's declared file scope; a config-load failure would currently degrade to the *old* cap rather than the new one, a minor defense-in-depth gap, not a functional bug (config load never actually fails in the read paths exercised by tests).
- `merge_serialized_max` — untouched, real constraint, not a policy number.
- Enabling the 12–14 trial — stays `enabled: false` until the PM authorizes it after watching the 10-lane wave (see UTV2-1533 non-goals).
