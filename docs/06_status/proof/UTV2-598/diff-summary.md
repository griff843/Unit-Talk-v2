# UTV2-598 Diff Summary

| Field | Value |
|---|---|
| Issue | UTV2-598 — Resolve stranded awaiting_approval picks |
| PR | #329 |
| Branch | griffadavi/utv2-598-audit-prerequisite-resolve-stranded-awaiting-approval-picks |
| Tier | T2 |

## Files Changed

- `scripts/stranded-picks-cleanup.ts` — new file, 144 lines
- `package.json` — added `"stranded:cleanup": "tsx scripts/stranded-picks-cleanup.ts"` script entry

## Execution Summary

Live execution on 2026-04-15:
- **35 picks voided** (22 system-pick-scanner, 5 alert-agent, 8 model-driven)
- All were pre-quiesce debris from 2026-04-10 before scanner was quiesced at 21:15Z (DEBT-003)
- 0 remaining `awaiting_approval` picks after cleanup
- Cleanup uses service-role update with `awaiting_approval` guard — only voids picks still in that state
