# UTV2-1843 — Diff Summary

**Branch:** claude/utv2-1843-smart-form-product-intent
**Tier:** T2 · **Lane type:** governance
MERGE_SHA: pending merge

Documentation and agent-instruction consolidation. No runtime code, no schema, no workflow, no
required check, no label, no gate, no new lane type.

| File | Change |
|---|---|
| `docs/03_product/smart-form/intent.md` | **New.** Consolidated Smart Form product intent: the complete operator journey with each behaviour tied to its implementation and to meaningful verification; the three-tier resolution ladder and what honest fallback means; the contained pilot distinguished from a finished, repeatably usable form; the reconciled contradictions; what counts as verification, stated because every pilot defect merged green with passing tests; and what travels with delegated work. |
| `docs/05_operations/SMART_FORM_V1_OPERATOR_SUBMISSION_CONTRACT.md` | **Two corrections in place.** (1) Both signed-field `Input mode` rows corrected from `numeric`/`decimal` to `text` with a signed pattern — neither keypad has a minus key, making the contract's own negative ranges unenterable on mobile. (2) Acceptance Criterion 11 corrected from "Confidence is not present on the operator form" to the reconciled rule two later ratified contracts require and the code implements. Both carry an inline reason so they are not tidied back. Ranges, steps and every other rule unchanged. |
| `apps/smart-form/CLAUDE.md` | **Rewritten where stale.** "Public-facing" and "No auth header currently" were both false since #1488 and would lead an agent to conclude the surface is unauthenticated and pick identity unresolved. Now states allow-list-gated Auth.js v5, canonical capper identity as persisted pick identity, server-side Track Only pinning, the three-tier resolution ladder, containment, the real 6-file test inventory plus 4 uncovered e2e specs, and why a passing unit test is the weakest evidence here. |
| `apps/api/CLAUDE.md` | Product intent added as required reading for backend work that changes a product surface, with the three rules from it that bind this app directly. |
| `CLAUDE.md` | Product intent registered in Authoritative documents plus a "required reading when you touch a product surface" block covering backend work, with a per-product table. |
| `AGENTS.md` | The same for Codex, under Mission Context, naming the canonical contracts to read alongside each intent and stating that a canonical contract wins over an intent document. |
| `.claude/commands/dispatch.md` | Dispatch packets touching a product surface name the intent document and **quote the applicable acceptance criteria inline** rather than citing them by number. Packet content, not a gate. |
| `docs/05_operations/docs_authority_map.md` | `docs/03_product/*/intent.md` registered as Tier 3 Product, with its authority explicitly subordinate to the canonical contracts it indexes. |
| `docs/06_status/proof/UTV2-1843/.gitkeep` | Deleted — the review packet requires it be declared and CEP-E2 refuses it once declared. |

**Verification:** `pnpm lint`, `pnpm type-check`, `pnpm build` and `pnpm test` (5962 pass, 0 fail)
all exit 0 on the branch. `npx tsx scripts/ci/r-level-check.ts --issue UTV2-1843` returns
Verdict: PASS (rules matched: operator-ui). `pnpm verify` is refused locally at `test:live-db` by
`ci:assert-staging` under containment; CI is the authoritative receipt. Every `file:line` citation
in the new document was re-measured against the branch head and two were corrected. Details and the
expected non-required `Lane authority` failure are in `verification.md`.
