# PROOF: WORK-2026102701

MERGE_SHA: pending merge

Issue: WORK-2026102701
Tier: T2
result: pass

## ASSERTIONS:

- [x] `CLAUDE.md` no longer eagerly imports `docs/mission/intent.md`, `spec.md` or `plan.md`; it carries a compact mission card and a read-first instruction, and still imports `docs/05_operations/STANDING_GUARDRAILS.md`.
- [x] All eight reserved decisions in the card match `docs/mission/intent.md` "Reserved decisions and actions" line for line (presence check below).
- [x] An independent reviewer (fresh agent, given the diff and the source files, not the author's conclusions) returned CHANGES REQUIRED on the first card, then APPROVE on `9b27c24e5` after its findings were folded in.
- [x] Start-of-session context falls from 48,133 to 30,475 tokens (17,658 saved, 36.7%) on the actual commits.
- [x] No test, hook or CI check depends on the removed imports; every doc path the card cites exists.

## EVIDENCE:

Reserved-decision presence check (each `N.` line of intent.md's reserved list, `grep -qF` against the card's `CLAUDE.md`), after the item 7 and 8 wording was aligned:

```
OK  1. Production DDL and production data deletion
OK  2. Member-delivery activation
OK  3. Paid provider / subscription commitments
OK  4. Secrets
OK  5. Pricing and tier authority
OK  6. Changes to production containment while containment is mandated
OK  7. Changes to merge authority itself — the merge gate, its policy inputs, CODEOWNERS, branch protection
```

Item 8's source line wraps across two lines in intent.md; the card carries "8. Dispatching a production deployment" plus the `workflow_dispatch`-only note.

Token measurement: two `git clone --shared` checkouts, `before` at `0112a547d` (origin/main) and `after` at `9b27c24e5`; per run `claude -p "Reply with the single word OK." --output-format json --max-turns 1 --strict-mcp-config` with no MCP servers; context = input + cache_creation + cache_read of the single model call:

```
BEFORE {"in": 2, "cc": 36865, "cr": 11267, "ctx": 48134}
BEFORE {"in": 2, "cc": 36865, "cr": 11266, "ctx": 48133}
BEFORE {"in": 2, "cc": 0, "cr": 48131, "ctx": 48133}
AFTER  {"in": 2, "cc": 17390, "cr": 13083, "ctx": 30475}
AFTER  {"in": 2, "cc": 0, "cr": 30473, "ctx": 30475}
AFTER  {"in": 2, "cc": 0, "cr": 30473, "ctx": 30475}
```

The 2026-10-25 trial (72 disposable tool-enabled runs, card text of the first commit) measured 45.9k to 27.9k at session start and 49.0k to 31.1k after `/compact`, with 12/12 card runs (6 fresh, 6 post-compaction) correct on mission, delivery state, the four kill-switched targets, pick `706b136b`, the un-kill refusal, the eight reserved decisions, the non-stop list and the plan-readings pointer, and no safety regression against the import arm. That trial was not repeated for the review additions, which only add hold and rule text.

Alignment: `pnpm exec tsx scripts/ops/system-alignment-check.ts --json` summary `{'fail': 0, 'warn': 0, 'current_authority_contradictions': 0, 'historical_archive_noise': 0, 'implementation_gaps': 0}`, no finding naming `CLAUDE.md`. Cited paths `docs/mission/intent.md`, `plan.md`, `spec.md`, `plan-readings.md`, `docs/05_operations/T1_PRODUCTION_READINESS_CONTRACT.md` all exist.

## Verification

- `pnpm ops:preflight WORK-2026102701 --tier T2 --branch claude/work-2026102701-compact-mission-card --lane-type governance --files CLAUDE.md --files .ops/work/WORK-2026102701.md --refresh`: `VERDICT: PASS (39 checks)`.
- `pnpm type-check` on `ebb195866`: exit 0.
- `pnpm test` on `ebb195866`: exit 0; summed node:test totals across all files: `# tests 7651`, `# pass 7638`, `# fail 0`, `# skipped 13`.
- `9b27c24e5` differs from `ebb195866` only in `CLAUDE.md` prose, which no test reads, so the suite was not rerun on it. Full `pnpm verify` was not run locally; CI `verify` on the PR is the verification of record.
- Runtime: this lane has no runtime surface (instruction text only); no database, service or deployment was touched.

Not changed: `intent.md`, `spec.md`, `plan.md`, hooks, settings, CI, merge requirements. Follow-up recorded, not done here: the post-compact hook (`.claude/**`, CODEOWNERS-owned, outside this lane's scope) could also point sessions at the mission files.

## Merge SHA Binding

Merge SHA: pending merge
PR: pending
Execution SHA: 9b27c24e5266d937daabedb719d15576ecb36535
