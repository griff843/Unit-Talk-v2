# UTV2-1895 fresh independent code review

Reviewer: Codex subagent `/root/fresh_review`, separate from implementation; no source edits or owner approvals issued.

Reviewed on 2026-09-13:

- Base: `4ac23bad57aa3435fd099cdb24f4d64b722bcefe` (`origin/main` at review).
- Final reviewed head: `e8a2048d22b59652c03ea5672e7db028e05aaf8e`.
- Original full-review head: `3ef0760e519d5c4fd178836a4eba376979c57c62`; the final delta was independently reviewed as described below.
- Scope: cumulative `origin/main...HEAD`, particularly Smart Form manual selection, validation, capper identity, authentication boundary, duplicate prevention, Track Only display, reset/error retention, progressive layout and offline fixture provenance.

## Findings

No introduced actionable correctness or security finding identified in the reviewed cumulative diff. This is independent code review evidence, not merge approval, staging verification, production readiness or proof of real Google authentication.

The original trailing-CR hygiene nit at `apps/smart-form/lib/submission-guard.ts:17` is fixed in the final reviewed head. `git diff --check origin/main...HEAD` now passes, exit 0.

## Final-head delta review

Independently inspected `git diff 3ef0760e519d5c4fd178836a4eba376979c57c62..e8a2048d22b59652c03ea5672e7db028e05aaf8e`. It contains only the guard's final-line CR normalization and the existing lane manifest's PR URL (`#1573`), status (`in_review`) and heartbeat binding. No executable semantics, validation, contracts, workflows or approval authorities changed. The prior cumulative review and 198-test result remain applicable to this final code head; no redundant test rerun was performed. No new findings. This rebind is independent review evidence and does not issue owner or merge approval. A later head requires another delta review.

## Assessment

- The new submission guard admits one synchronous in-flight submission and releases in `finally`. It does not persist pick keys, decide official-pick identity, reject a later intentional retry or add book/date/capper/stake semantics. Authoritative server idempotency is unchanged. Failures retain form values; successful receipt uses the submitted values with effective capper attribution restored when the disabled field is omitted by React Hook Form.
- Existing API authentication remains authoritative. The UI claim is display/payload context, not signature verification. Explicit public environment references make the intended development QA flag available to the client; the existing `NODE_ENV=production` prohibition is retained. The existing session gate remains intact outside QA mode. No auth allowlist, signing implementation, API auth or distribution logic is changed.
- Manual entry is initial and post-success default. Initial progressive sections require a sport. Incomplete-slip guidance derives from the existing schema rather than introducing permissive validation. Canonical participant checks and coverage-gap versus failed-search distinctions still execute before submission.
- Track Only defaults true and is explicitly reset true. Review panel and receipt reflect submitted mode; no delivery-enabling control is added. Backend tests independently cover non-delivery rather than inferring it from UI text.
- The offline NFL tests use clearly synthetic fixture identifiers and `providerKey=staging-fixture`, mock API submission, block non-local requests and block service workers. They are UI/payload evidence only; they do not establish live SGO offers, current NFL coverage, authenticated identity or database persistence.
- Existing signed-number controls, required odds/units/conviction schema and shared offer-to-slip mapping are retained. Updated browser assertions cover visible responsive controls and changed copy rather than suppressing the semantic checks.

## Verification independently executed

Command (local unit/in-memory repositories only):

```sh
pnpm exec tsx --test apps/smart-form/test/submission-guard.test.ts apps/smart-form/test/auth-config.test.ts apps/api/src/submission-service.test.ts apps/api/src/smart-form-validation.test.ts apps/api/src/controllers/submit-pick-controller.test.ts
```

Result: **198 passed, 0 failed, 0 skipped**, exit 0. Log: `fresh-review-tests.log` alongside this report.

Reviewed, but not rerun in this review: `phase-one.spec.ts` connected local submission assertions, `offline-offer-slip.spec.ts`, auth-gate and updated submission/browser specifications; previously prepared browser screenshots/results remain implementation evidence. Full staging CI is the parent's separately authorized execution and is not claimed by this review.

## Authority and limits

Read Smart Form product intent, operator submission, sportsbook/live-offer/V1/confidence contracts, submission and pick-identity contracts, delivery kill-switch/runtime mode requirements and applicable smart-form-submission/betting-domain/proof-closeout skills. Mission documents were consulted for scope and containment; no orchestration or canonical documentation was edited.

Preexisting contract drift is not silently redefined: `submission_contract.md` describes duplicates as rejectable, whereas existing `submission-service.ts` returns idempotent success with the existing pick and no new rows. Its key implementation hashes source, normalized market, selection, line, odds and event name; its comment also mentions event date although the implementation does not include it. This lane does not change that key or adjudicate new official-pick semantics. The browser guard correctly delegates the decision to the current server authority. Receipt display remains a submitted-value receipt, not an independently reloaded canonical detail view; no claim is made that altered metadata on a later server-deduplicated request overwrites the original row.

No production or SGO endpoint was contacted, no credentials were inspected or moved, and no workflow or approval artifacts were modified. Historical smoke receipts are not final-head staging evidence. The only preexisting dirty tracked file observed was generated `apps/smart-form/next-env.d.ts`; it was left untouched.
MERGE_SHA: pending merge
Execution SHA: e8a2048d22b59652c03ea5672e7db028e05aaf8e
