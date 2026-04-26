# Experience QA Trust Layer

Experience QA is the browser regression gate for product surfaces. It separates three layers:

- Step results: browser navigation and interaction steps.
- Expectation results: product invariants that must hold after the browser observes the page.
- Final verdict: the gate decision after preflights, steps, and expectations are combined.

## Commands

```bash
pnpm qa:experience --help
pnpm qa:experience --surface command_center --persona operator --flow daily_ops --mode observe
pnpm qa:experience --surface smart_form --persona capper --flow submit_pick
pnpm qa:auth --product unit-talk --persona capper
```

Observe mode launches a headed browser and writes screenshots, video, trace, `qa_result.json`, `qa_result.md`, and `issue_report.md` under `apps/qa-agent/artifacts/`.

## Auth State

Persona storage state is saved to deterministic Playwright files:

```text
personas/unit-talk-operator.json
personas/unit-talk-capper.json
personas/unit-talk-vip.json
personas/unit-talk-free.json
```

Real files are gitignored. If a persona-gated skill requires auth and the file is missing, QA fails clearly with:

```bash
pnpm qa:auth --product unit-talk --persona <persona>
```

## Verdicts

- `FAIL`: any critical expectation or hard invariant fails.
- `NEEDS_REVIEW`: a high-severity expectation fails or `--force` continues after a required dependency failure.
- `PASS`: browser steps pass and required expectations pass.
- `SKIP`: a required preflight fails and `--force` was not used.

Preflights can be skipped with `--skip-preflight`. `--force` continues browser automation after failed required preflights for diagnosis, but the final verdict cannot be a clean pass.

## Expectations

Add expectations to the skill definition under `apps/qa-agent/src/adapters/<product>/surfaces/<surface>/skills/`. Expectations receive observed network responses, console errors, selector results, page access, and preflight results.

Command Center `daily_ops` currently enforces:

- No lifecycle signal is `BROKEN`.
- No HTTP 5xx network responses.
- The required dashboard shell renders.

Smart Form `submit_pick` currently enforces:

- `/api/auth/session` does not return HTTP 500.
- The page does not unexpectedly redirect to `/login` before the form renders.
- Sport, market, book, and submit controls render, or an intentional auth state renders.
- No HTTP 5xx network responses.

Lifecycle naming follows the canonical DB model: `picks.status` moves `validated -> queued -> posted -> settled`.

## Preflights

Add preflights to the product adapter or skill definition. Required preflights stop noisy browser work unless `--force` is supplied.

Command Center checks:

- Frontend route reachable.
- `operator-web /health` reachable.
- Operator dashboard snapshot reachable.

Smart Form checks:

- Submit route reachable.
- NextAuth session endpoint does not return HTTP 500.

## Selector Contracts

Prefer stable `data-testid` selectors and keep fallbacks until the product implements them. If a preferred selector is missing but a fallback works, QA continues and records a regression recommendation.

Smart Form recommended selectors:

- `smart-form-sport-select`
- `smart-form-market-select`
- `smart-form-book-select`
- `smart-form-submit-button`
- `smart-form-auth-error`
- `smart-form-success-state`

Command Center recommended selectors:

- `command-center-lifecycle-card`
- `command-center-api-status`
- `command-center-worker-status`
- `command-center-picks-table`
- `command-center-settlement-queue`
