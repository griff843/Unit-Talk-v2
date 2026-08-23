# UTV2-1734 Executor Work-Order Verification

## Verification

- `pnpm type-check` — PASS (exit 0).
- `pnpm test` — PASS as part of `pnpm verify:static` (exit 0).
- `pnpm verify:static` — PASS (exit 0): DB-client boundary, sync, system alignment, automation coverage, env, lint, type-check, build, root test suite, smart-form verification, command manifest, and migration lint all passed.
- `pnpm exec tsx --test 'scripts/ops/claude-exec.test.ts' 'scripts/ops/codex-exec.test.ts' 'scripts/ops/execution-packet.test.ts' 'scripts/ops/lane-start.test.ts'` — PASS: 95 tests, 95 passed, 0 failed.
- `pnpm ops:codex-exec -- --issue UTV2-1734 --dry-run` — PASS (exit 0); the sanctioned entry point generated a Codex invocation and showed the authoritative task-contract hash and Objective section before the repo brief.

Writable live-DB proof is blocked/deferred: target identity could not be resolved from its URL (host=unparseable). Writable DB verification requires xskgrzbteyqdufktjrjx. Run it through the staging-ci GitHub environment with CI_SUPABASE_* credentials.

## Runtime proof

The dry-run exercised the real Codex dispatch entry point without spawning a paid executor. Behavioral inversions execute both executor packet boundaries with an injected invalid packet result and prove all three refusal properties: one parseable JSON object with `code=EXECUTION_PACKET_INVALID`, exit code 2, and no continuation callback (therefore no prompt build or executor spawn).

The legacy compatibility test begins with a contract-less sync record, fetches a fixture Linear work order through the same dispatch compatibility path used by both executors, persists it in the control root and lane worktree, generates the execution packet, and renders the preserved legacy description.

## Independent adversarial review

One independent read-only review was performed. It classified three blockers: the Linear token appeared in curl argv, executor inversion tests were source-only, and pre-contract active lanes could not dispatch through the sanctioned executor entry points. The single permitted correction cycle fixed all three. The focused suite passed after correction; no second review cycle was run.

## SHA binding

- Verified source SHA: `804203fda1a929303fc027951a66b0df454656c1`
- Merge SHA: N/A (pre-merge; lane finalization must bind the merge SHA)

## Result

PASS — implementation and static/runtime proof are complete; writable DB proof remains explicitly deferred to staging CI as directed.
