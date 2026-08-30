# QA Result

```
schema:      experience-qa/v1
Product:     unit-talk
Surface:     smart_form
Persona:     operator
Flow:        submit_pick
Environment: local
Head SHA:    b18a0b82
Timestamp:   2026-08-30T13:18:45.092Z
Mode:        observe
Status:      [PASS]
Verdict:     Browser steps passed and required expectations passed.
Duration:    4183ms
```

## Preflight Results

- PASSED smart_form_route_reachable: Smart Form /submit returned HTTP 200.
- PASSED nextauth_session_no_500: Smart Form /api/auth/session returned HTTP 200.

## Step Results

1. ✓ Navigate to Smart Form /submit
2. ✓ Wait for form content to render
3. ✓ Check for sport selector
4. ✓ Check for market type control
5. ✓ Check for sportsbook / book selector
6. ✓ Check for submit button
7. ✓ Attempt to open sport selector (observe mode interaction)

## Observations

- None

## Expectation Results

- PASSED smart_form_session_no_500 (critical): /api/auth/session did not return HTTP 500.
- PASSED smart_form_no_login_redirect_before_form (critical): No unexpected redirect to /login before form render.
- PASSED smart_form_controls_render (critical): Sport, market, book, and submit controls rendered.
- PASSED smart_form_no_5xx_network_responses (critical): No HTTP 5xx network responses observed.

## Final Verdict

PASS: Browser steps passed and required expectations passed.

## Screenshots

- `/home/griff843/unit-talk-utv2-1787-admission-2/.out/worktrees/codex__utv2-1787-smart-form-phase-1/apps/qa-agent/artifacts/unit-talk-smart_form-submit_pick-operator/2026-08-30T13-18-45-cfrypw/01-form-loaded.png`
- `/home/griff843/unit-talk-utv2-1787-admission-2/.out/worktrees/codex__utv2-1787-smart-form-phase-1/apps/qa-agent/artifacts/unit-talk-smart_form-submit_pick-operator/2026-08-30T13-18-45-cfrypw/02-form-controls-verified.png`
- `/home/griff843/unit-talk-utv2-1787-admission-2/.out/worktrees/codex__utv2-1787-smart-form-phase-1/apps/qa-agent/artifacts/unit-talk-smart_form-submit_pick-operator/2026-08-30T13-18-45-cfrypw/03-sport-selector-interaction.png`

## Video

`/home/griff843/unit-talk-utv2-1787-admission-2/.out/worktrees/codex__utv2-1787-smart-form-phase-1/apps/qa-agent/artifacts/unit-talk-smart_form-submit_pick-operator/2026-08-30T13-18-45-cfrypw/9952b29acfb02b67584924cdf09f19ff.webm`

## Trace

`/home/griff843/unit-talk-utv2-1787-admission-2/.out/worktrees/codex__utv2-1787-smart-form-phase-1/apps/qa-agent/artifacts/unit-talk-smart_form-submit_pick-operator/2026-08-30T13-18-45-cfrypw/trace.zip`
