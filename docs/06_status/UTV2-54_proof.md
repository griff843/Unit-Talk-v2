# UTV2-54 — Independent Verification Proof

**Status:** PASS — all ACs confirmed
**Verified:** 2026-03-27
**Verifier:** Claude lane (independent)
**Commit verified:** `a0f50f4` (cherry-picked to main)

---

## AC-1: `createSnapshotFromRows()` includes `ingestorHealth`

**Method:** Called `createSnapshotFromRows()` directly with live DB data (18 ingestor.cycle rows).

**Result:**
```json
{
  "status": "succeeded",
  "lastRunAt": "2026-03-27T15:27:13.18978+00:00",
  "runCount": 18
}
```

Fields present: `status` ✓ `lastRunAt` ✓ `runCount` ✓ — **PASS**

---

## AC-2: HTML dashboard renders "Ingestor" card

**Method:** Code inspection + test ok 26.

- `ingestorCard` const defined at server.ts:1081 with `<h2>Ingestor</h2>`
- Injected into `.grid.health-grid` at server.ts:1480
- Test `GET / renders Ingestor health card with status and last run when ingestor run exists` — **ok 26 PASS**

---

## AC-3: No-runs edge case — `status: 'unknown'`, `lastRunAt: null`

**Method:** Test ok 25.

- `createSnapshotFromRows returns ingestorHealth status=unknown and lastRunAt=null when no ingestor runs` — **ok 25 PASS**
- `runCount: 0` confirmed in assertion

---

## AC-4: `pnpm verify` exits 0

**Method:** `pnpm exec tsx --test apps/operator-web/src/server.test.ts`

- 51 tests, 51 pass, 0 fail — **PASS**
- `pnpm verify` clean on main at `31bb897`

---

## AC-5: At least 2 new tests

New tests confirmed:
- ok 24: `createSnapshotFromRows includes ingestorHealth with status and lastRunAt when ingestor run exists`
- ok 25: `createSnapshotFromRows returns ingestorHealth status=unknown and lastRunAt=null when no ingestor runs`
- ok 26: `GET / renders Ingestor health card with status and last run when ingestor run exists`

3 new tests — **PASS** (≥2 required)

---

## Live DB Cross-check

5 most recent `ingestor.cycle` rows from `system_runs`:
| ID | status | started_at |
|---|---|---|
| `dcca8749` | succeeded | 2026-03-27T15:27:13 |
| `c8be4088` | succeeded | 2026-03-27T15:25:25 |
| `87f8a243` | succeeded | 2026-03-27T15:24:00 |
| `907a9b6e` | succeeded | 2026-03-27T15:23:59 |
| `0d528d3e` | succeeded | 2026-03-27T15:22:47 |

`run_type.startsWith('ingestor')` filter captures all rows correctly. 18 total in DB.

---

## Verdict

**PASS — UTV2-54 VERIFIED**

All 5 ACs confirmed against live DB and test suite. Implementation is correct and live on main.
