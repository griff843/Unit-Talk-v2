# Diff summary: WORK-2026102805

Implementation source SHA: `23588057b4c33fd2cdfb29a98be7cd17509e1b33` (pre-merge)

| File | Change |
|---|---|
| `apps/smart-form/lib/form-utils.ts` | Adds pure `easternDateIso(now)` using `Intl.DateTimeFormat` in `America/New_York`, with DST-aware calendar conversion and no dependency. |
| `apps/smart-form/app/submit/components/BetForm.tsx` | Evaluates the Eastern game date when form defaults/reset/fallback render, and compares timestamp dates against the Eastern calendar. Submission payload shape, validation, delivery choice, and auth are unchanged. |
| `apps/smart-form/test/form-utils.test.ts` | Adds the requested evening, EST transition, spring-forward, and fall-back boundary assertions. |

## Explicitly untouched

No submission API contract, payload shape, validation rule, Track Only/delivery choice, authentication, or production data path was changed. Capper-entered dates remain the values submitted.

## Runtime boundary

Writable live-DB proof is blocked/deferred: target identity could not be resolved from its URL (`host=unparseable`). The packet requires staging-CI GitHub environment credentials (`CI_SUPABASE_*`) for writable DB verification.

## SHA Binding

Merge SHA: 1f181e702e5a08e9a2e3d9b1a0df57f7529226fc
PR: https://github.com/griff843/Unit-Talk-v2/pull/1797
