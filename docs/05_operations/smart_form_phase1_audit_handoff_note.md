# Smart Form Phase 1 Audit Handoff Note

> Historical audit note.
> The findings below captured a real audit at the time, but several items have since been fixed during later Smart Form stabilization work.
> Use this note as historical context only, not as the current source of truth for Smart Form runtime state.

## Purpose

This note captures confirmed audit findings from a live review of the current Smart Form runtime so follow-on work does not build on false confidence.

This is a working handoff note for implementation follow-up. It is not a status closeout or sprint truth file.

## Reviewed Surfaces

- Contract: [SMART_FORM_V1_OPERATOR_SUBMISSION_CONTRACT.md](C:/dev/Unit-Talk-v2/docs/05_operations/SMART_FORM_V1_OPERATOR_SUBMISSION_CONTRACT.md)
- Runtime entry: [package.json](C:/dev/Unit-Talk-v2/apps/smart-form/package.json)
- Live app surface:
  - [page.tsx](C:/dev/Unit-Talk-v2/apps/smart-form/app/submit/page.tsx)
  - [BetForm.tsx](C:/dev/Unit-Talk-v2/apps/smart-form/app/submit/components/BetForm.tsx)
  - [MarketTypeGrid.tsx](C:/dev/Unit-Talk-v2/apps/smart-form/app/submit/components/MarketTypeGrid.tsx)
  - [SuccessReceipt.tsx](C:/dev/Unit-Talk-v2/apps/smart-form/app/submit/components/SuccessReceipt.tsx)
  - [api-client.ts](C:/dev/Unit-Talk-v2/apps/smart-form/lib/api-client.ts)
  - [form-utils.ts](C:/dev/Unit-Talk-v2/apps/smart-form/lib/form-utils.ts)
- Legacy surface still present:
  - [server.ts](C:/dev/Unit-Talk-v2/apps/smart-form/src/server.ts)
  - [server.test.ts](C:/dev/Unit-Talk-v2/apps/smart-form/src/server.test.ts)

## Confirmed Facts

### 1. The live Smart Form runtime crashes in a real browser

- Playwright navigation to `http://127.0.0.1:4100/submit` did not produce a usable form.
- The page rendered an application error instead of the submission surface.
- Browser console showed `Invariant: Missing ActionQueueContext` and hydration/client-render failure symptoms.

Implication:
- Smart Form cannot currently be treated as browser-verified.
- A human-like end-to-end submission through the live UI was not honestly provable during this audit.

### 2. The repo currently contains two Smart Form implementations

- Runtime package scripts point to the Next app in [package.json](C:/dev/Unit-Talk-v2/apps/smart-form/package.json).
- The old server implementation remains in [server.ts](C:/dev/Unit-Talk-v2/apps/smart-form/src/server.ts).
- The Smart Form test script still runs [server.test.ts](C:/dev/Unit-Talk-v2/apps/smart-form/src/server.test.ts), not the live Next app.

Implication:
- The tested Smart Form surface is not the live Smart Form surface.
- Current test confidence for Smart Form is partially misaligned with runtime reality.

### 3. The canonical API submission path appears healthy

- API health endpoint returned `persistenceMode: "database"`.
- A direct `POST /api/submissions` call succeeded and returned:
  - a real `submissionId`
  - a real `pickId`
  - `lifecycleState: "validated"`

Implication:
- The backend intake path appears alive.
- The current audit concern is primarily the Smart Form runtime, not obvious API failure.

### 4. Direct DB row proof was not completed in this audit

- Follow-up DB verification attempts hit a local module-resolution issue involving `@supabase/supabase-js`.
- That issue blocked a direct repository query for the returned `pickId`.

Implication:
- It is reasonable to say persistence is strongly indicated.
- It is not yet accurate to say DB persistence was directly proven by this audit.

### 5. There is visible contract drift

- The contract says `SubmissionPayload.source = 'smart-form'`.
- [form-utils.ts](C:/dev/Unit-Talk-v2/apps/smart-form/lib/form-utils.ts) currently sends `source: 'smart-form-v2'`.

Implication:
- Smart Form payload identity is drifting from ratified contract truth.

### 6. There are user-facing encoding defects

Confirmed mojibake appears in:

- [MarketTypeGrid.tsx](C:/dev/Unit-Talk-v2/apps/smart-form/app/submit/components/MarketTypeGrid.tsx)
- [SuccessReceipt.tsx](C:/dev/Unit-Talk-v2/apps/smart-form/app/submit/components/SuccessReceipt.tsx)
- [form-utils.ts](C:/dev/Unit-Talk-v2/apps/smart-form/lib/form-utils.ts)
- [SMART_FORM_V1_OPERATOR_SUBMISSION_CONTRACT.md](C:/dev/Unit-Talk-v2/docs/05_operations/SMART_FORM_V1_OPERATOR_SUBMISSION_CONTRACT.md)

Implication:
- The current surface does not look polished or trustworthy.

### 7. The current success state does not satisfy the full operator loop

- [SuccessReceipt.tsx](C:/dev/Unit-Talk-v2/apps/smart-form/app/submit/components/SuccessReceipt.tsx) shows only a truncated pick ID and lifecycle state.
- The contract expects a stronger loop including review, normalized truth, and enrichment visibility.

Implication:
- Phase 1 may be partially acceptable as a form/validation foundation.
- The current runtime does not satisfy the broader V1 contract experience.

### 8. There appears to be copied UI baggage beyond current runtime needs

- The current form flow imports only a subset of the ported UI library.
- Many copied `components/ui/*` files do not appear to participate in the current Smart Form flow.

Implication:
- The port likely brought over more code than the current runtime needs.
- A keep/prune pass is warranted before further expansion.

## Likely Root Causes

These are informed inferences, not proven facts:

1. The port favored speed and visible UI progress over runtime replacement discipline.
2. The old server-based Smart Form path was not fully retired when the Next surface was introduced.
3. Browser-level proof lagged behind compile/test proof.
4. Contract reconciliation did not fully keep up with implementation details.

## What Should Block Further Feature Work

The following should be treated as blockers before deeper Smart Form expansion:

1. Fix the live Next runtime crash at `/submit`.
2. Decide which Smart Form implementation is authoritative and remove or quarantine the other.
3. Align Smart Form tests with the live runtime surface instead of the legacy server surface.
4. Reconcile `source: 'smart-form-v2'` with the contract.
5. Fix user-facing encoding defects.

## Recommended Fix Order

1. Stabilize the Next runtime so the form renders successfully in a real browser.
2. Choose a single Smart Form truth:
   - keep the Next app and retire or quarantine `src/server.ts`
   - or explicitly reverse course, but do not keep both as if they are equal
3. Add live-surface browser verification for submit flow.
4. Reconcile payload source and any other contract drift.
5. Remove unused copied UI pieces or clearly mark them as intentionally staged for later use.
6. Only then continue with Phase 2 work such as review, confirmation, and enrichment visibility.

## Suggested Framing For Next Work

Smart Form should be treated as a stabilization-first surface right now:

- first: runtime truth
- second: surface simplification
- third: operator-loop completion

It should not be treated as feature-expansion-ready until the live browser surface is working and the repo has one Smart Form implementation truth.
