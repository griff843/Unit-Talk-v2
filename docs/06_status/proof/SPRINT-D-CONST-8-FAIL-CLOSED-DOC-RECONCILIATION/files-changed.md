# Files Changed — SPRINT-D-CONST-8

## Modified Files (documentation only)

| File | Change Type | What Changed |
|---|---|---|
| `packages/db/CLAUDE.md` | Edit | Removed "fail-open" claim; corrected to "fail-closed"; added Fail-Closed Invariants section; clarified InMemory fallback is test-only |
| `packages/contracts/CLAUDE.md` | Edit | Added Fail-Closed Authority Contract section to Core Concepts |
| `docs/00_constitution/CERTIFICATION_GAP_REGISTER.md` | Edit | D-CONST-8 status: OPEN → RESOLVED; added resolution details |
| `docs/00_constitution/CONSTITUTIONAL_DRIFT_AUDIT.md` | Edit | D-CONST-8 row updated to RESOLVED |
| `docs/00_constitution/CONSTITUTION_IMPLEMENTATION_MATRIX.md` | Edit | §8 note updated: "fail-open doc lines wrong" → "D-CONST-8 RESOLVED" |
| `docs/06_status/proof/SPRINT-D-CONST-8-FAIL-CLOSED-DOC-RECONCILIATION/executive-summary.md` | New | Proof bundle executive summary |
| `docs/06_status/proof/SPRINT-D-CONST-8-FAIL-CLOSED-DOC-RECONCILIATION/stale-language-audit.md` | New | Stale language search results |
| `docs/06_status/proof/SPRINT-D-CONST-8-FAIL-CLOSED-DOC-RECONCILIATION/files-changed.md` | New | This file |
| `docs/06_status/proof/SPRINT-D-CONST-8-FAIL-CLOSED-DOC-RECONCILIATION/verification-results.md` | New | Verification command outputs |
| `docs/06_status/proof/SPRINT-D-CONST-8-FAIL-CLOSED-DOC-RECONCILIATION/next-actions.md` | New | Remaining D-CONST gaps |
| `docs/06_status/lanes/UTV2-1199.json` | New | Lane manifest |
| `.ops/sync/UTV2-1199.yml` | New | Per-issue sync file |

## Files NOT Changed (confirmed in scope)

- `packages/db/src/writer-authority.ts` — NOT changed (code was already correct)
- `packages/db/src/database.types.ts` — NOT changed (D-CONST-7 scope, handled by a separate migration lane)
- `supabase/migrations/**` — NOT changed
- Any scoring, promotion, CLV, or runtime product code — NOT changed
- Any CI workflows or proof gate scripts — NOT changed
- Any certification state files — NOT changed
