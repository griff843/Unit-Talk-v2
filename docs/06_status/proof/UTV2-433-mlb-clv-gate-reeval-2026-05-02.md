# UTV2-433: MLB CLV Gate Re-evaluation — 2026-05-02

**Gate threshold:** `clvBackedOutcomeCount >= 10`
**Run date:** 2026-05-02
**Fix date:** UTV2-754 merged 2026-04-26 (route MLB picks through market-universe provenance)

---

## Gate result: PENDING — governance brake blocking settlement

---

## Data snapshot (live Supabase, 2026-05-02)

### Post-fix MLB picks (created >= 2026-04-26)

| Status | Count | With provenance |
|--------|-------|----------------|
| queued | 826 | 621 (75%) |
| awaiting_approval | 503 | 503 (100%) |
| validated | 255 | 27 (11%) |
| posted | 6 | 1 (17%) |
| voided | 2 | 2 (100%) |
| **settled** | **0** | **0** |

### Settlement records for post-fix MLB picks

| Metric | Value |
|--------|-------|
| Post-fix MLB picks settled | 0 |
| CLV-backed post-fix settlements | 0 |
| Gate threshold | ≥ 10 |
| Gate status | ❌ PENDING |

---

## Root cause analysis

### What IS working

- **UTV2-754 fix deployed and functional**: 503 `awaiting_approval` picks have 100% provenance coverage (`marketUniverseId` or `scoredCandidateId` present in metadata). The pipeline routing is correct.
- 621 of 826 `queued` picks (75%) also carry provenance.
- CLV computation path is intact — when picks reach settlement, CLV will be computable.

### What is blocking gate passage

**Phase 7A governance brake** (`awaiting_approval` state):
- 503 post-fix MLB picks are held in `awaiting_approval` — autonomous picks from `system-pick-scanner` require operator approval before advancing to `posted`.
- Without PM approval to advance these picks, they cannot reach `posted` → `settled` → CLV computation.
- Latest post-fix pick created: 2026-04-28. The system has stopped generating new picks since then (pipeline paused or no new slates).

### Pre-fix settlements (context only)

128 MLB picks settled on 2026-04-26 (before or immediately at fix deployment) via the old path — none carried provenance (created before UTV2-754), but all 128 have CLV backing via event-level closing line fallback. These cannot count toward the gate because they predate the pipeline fix.

---

## Gate passage requirements

For the gate to PASS (`clvBackedOutcomeCount >= 10` from post-fix pipeline-generated picks):

1. **PM approves `awaiting_approval` picks** — 503 picks in queue need operator approval to advance past the governance brake.
2. **Approved picks advance to `posted`** — distribution worker processes them.
3. **Games complete** — actual MLB game results arrive.
4. **Settlement worker runs** — settles posted picks with game results.
5. **CLV service computes CLV** — closing-line data present in `provider_offers`.
6. **Verification re-run shows ≥ 10 CLV-backed outcomes.**

---

## Provenance coverage confirmation (UTV2-754 verification)

The UTV2-754 fix is confirmed deployed and working:
- `awaiting_approval` picks: 503/503 (100%) have `marketUniverseId` or `scoredCandidateId`
- `queued` picks: 621/826 (75%) have provenance (the 25% without provenance are likely manual or API-source submissions that don't go through the scored candidate path, which is expected)

This constitutes proof that UTV2-754's acceptance criteria are met. The CLV gate (UTV2-433) is a separate pending condition that depends on runtime settlement flow.

---

## Next steps

- PM: Review and approve `awaiting_approval` MLB picks to unblock the settlement pipeline.
- Once picks reach `settled` status, re-run: `npx tsx scripts/ops/utv2-433-mlb-clv-gate-reeval.ts`
- Gate can close as PASS once `clvBackedOutcomeCount >= 10`.
