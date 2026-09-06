# UTV2-1844 — Diff Summary

**Branch:** codex/utv2-1844-smart-form-ui-signed-odds-db-selectors
**Tier:** T2 · **Lane type:** delivery-ui
MERGE_SHA: pending merge

Smart Form frontend only. No API, worker, package, schema, migration or workflow change, and no
containment change.

| File | Change |
|---|---|
| `apps/smart-form/components/SignedNumberInput.tsx` | **New.** Signed entry for American odds and spread/total lines: `type="text"`, `inputMode="text"`, signed `pattern`, with the Zod schema still authoritative for ranges. Exports `nextSignedInputValue`, the pure keystroke rule, so the behaviour can be asserted without a DOM. |
| `apps/smart-form/lib/form-utils.ts` | `manualOverride: boolean` → `identityMode: 'canonical' \| 'structured-fallback' \| 'manual'`. Adds the `canonical-requires-event` guard, so canonical mode can no longer submit without a selected matchup. The two fallback messages name the verified coverage-gap path instead of a "manual participant override". |
| `apps/smart-form/app/submit/components/BetForm.tsx` | Threads the identity mode through matchup, team and player selection, read-only states, and the submission payload; `eventId` is sent only in canonical mode. |
| `apps/smart-form/test/control-plane-boundary.test.ts` | Renders `SignedNumberInput` and asserts the text keypad and signed patterns, including the inversion that `inputmode` is never `numeric`/`decimal`; plus four `nextSignedInputValue` tests covering partial decimals, the preserved leading minus, junk rejection, and that a complete value is still a number. |
| `apps/smart-form/test/form-utils.test.ts` | Identity-mode guard coverage, including manual `canonical-coverage-gap` provenance. |
| `apps/smart-form/test/api-client.test.ts` | Payload shape under the three identity modes. |
| `apps/smart-form/e2e/*.spec.ts` | Updated to the new selectors. **Run by no CI workflow** — see `verification.md`. |

**Verification:** `pnpm lint` and `pnpm type-check` exit 0; `pnpm test` is 5977 pass, 0 fail;
`npx tsx scripts/ci/r-level-check.ts --issue UTV2-1844` returns `Verdict: PASS` (13 changed files,
`operator-ui`). `pnpm verify` is refused locally at `test:live-db` under containment, so CI is the
binding receipt. The keystroke repair is mutation-proven: reverting the round-trip comparison turns
two named tests red.
