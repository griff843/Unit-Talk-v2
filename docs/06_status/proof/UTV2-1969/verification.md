# PROOF: UTV2-1969

MERGE_SHA: pending
Issue: UTV2-1969 (bounded child of UTV2-1924)
Tier: T2
PR: https://github.com/griff843/Unit-Talk-v2/pull/1717
Execution SHA: d539144260cb03acccedd1ff48026a309023fe95
result: reviewed implementation verified; correction-head results bind in the fresh exact-head executor receipt

## ASSERTIONS:

- [x] Fresh form visibly defaults to Track Only; existing defaults/reset remain true.
- [x] Explicit Request Official Pick Delivery changes the existing trackOnly field to false and the header to Delivery eligible requested.
- [x] Rendered fixture captures actual distributionMode=delivery-eligible only after selection.
- [x] Deliberate selection back to Track Only submits distributionMode=track-only.
- [x] Successful submission/reset starts the next form in Track Only.
- [x] A delivery request receiving server delivery-refused renders Saved, delivery refused; the next Track Only response renders Saved as Track Only.
- [x] Existing capper authorization/refusal and Track Only regression tests remain green in the composite static suite. No server authorization code changed.
- [x] Only BetForm.tsx and its existing fixture interaction test are substantive changes.
- [x] Reviewed head 2c3de07422eaf7a6506bec9c068e9ecd8457706f: verify and Writable DB proof (staging only) PASS in CI run37320734563. The proof-only correction creates a new head; its required results are bound separately in the fresh executor receipt after those exact-head runs complete.
- [ ] Canonical broader authenticated local QA remains SKIP: local server unavailable and required local operator storage state absent. No dry-run is represented as runtime proof. PM disposition: not a pre-merge blocker for this bounded control; authenticated deployed acceptance is required after deployment before watched delivery resumes.

## Evidence

EVIDENCE:

- CLI implementation executor: codex-cli 0.153.3, admitted gpt-5.6-luna / medium; retain actual model-routing sidecar, including interrupted proof attempts. Desktop Codex transcribed this proof bundle after the CLI return; no claim of CLI-authored final documentation.
- Focused rendered fixture: 1/1 PASS (19.1s), after the strict-assertion correction at Execution SHA. Isolated API/form ports4623/4723 and .next-utv2-1969-4. Real POST bodies, switch-back, reset and server-refused receipt are asserted; this is a local fixture, not production-persona evidence.
- Existing submission guard: pnpm exec tsx --test apps/smart-form/test/submission-guard.test.ts — 7/7 PASS.
## Verification

- pnpm type-check — PASS within canonical static suite.
- pnpm test — PASS within canonical static suite, including existing server capper refusal and Track Only cases.
- pnpm lint/build — PASS within canonical static suite. Package next lint is incompatible with the installed Next15 toolchain; root ESLint is used.
- pnpm verify — executed directly by desktop at source-equivalent head db401582bf3c7b6ddaa7ef3b3667955ca7fd64d6. Static portion PASS. Live DB gate REFUSED host127.0.0.1/refunidentified before writable tests. Overall local gate BLOCKED/FAIL, never labeled green. This historical local refusal is superseded for the reviewed head by staging CI run37320734563: verify PASS and Writable DB proof PASS on approved staging target xskgrzbteyqdufktjrjx. Correction-head CI is independently verified and bound in the fresh executor receipt; this historical local refusal is not upgraded to PASS.
- pnpm exec tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD — result recorded in evidence.json after proof formatting. The mechanical artifact check does not supersede the actual QA SKIP.
- qa:experience actual run2026-10-05T13-23-10-a43ve2: SKIP, required localhost4100 surface preflight unavailable. QA_STORAGE_MISSING for personas/unit-talk-operator.json independently confirmed; no session invented. Advisory CI additionally fails posting its comment with HTTP403 and is outside this issue's scope.

## Safety and handoff

No merge, deployment, production registration, delivery release, production pick submission, role mutation, replay or retry. No backend/routing/kill-switch/idempotency edits. Existing negative-control pick2d462c4f-286a-4f2a-8bdc-c3677f525b4b was not mutated. Production containment is unchanged by this work. After independent PM review and a separately approved deployment, watched acceptance must use a NEW real pick.

Final exact head and required CI results are reported in the fresh PR executor receipt after the proof-only correction and exact-head runs complete. Source-file equivalence is checked against Execution SHA; no implementation changes follow it. Lane ownership remains held for review; this is not lane closeout.
