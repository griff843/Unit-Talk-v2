# App: apps/qa-agent

Playwright-based Experience QA agent. Tests real browser flows (Command Center, Smart Form, Discord) using persona-based credentials and surface-specific skill scripts. Produces structured artifacts and maintains a regression ledger.

## Role in Unit Talk V2

- System layer: **QA / experience verification**
- Runtime: on-demand CLI tool (not a daemon)
- Maturity: active (4 skills, regression ledger, Playwright browser automation)

## Quick Reference

```bash
# Run a single flow
pnpm qa:experience --surface command_center --persona operator --flow daily_ops

# Run regression suite (changed surfaces only)
pnpm qa:experience --regression --mode fast

# Bootstrap auth state (REQUIRED before first run or after auth expires)
pnpm qa:auth --product unit-talk --persona operator

# Dry-run — parse options, no browser
pnpm qa:experience --surface smart_form --persona operator --flow submit_pick --dry-run
```

---

## Auth Bootstrap — Required Before Any Browser Run

QA uses Playwright storage state files (cookies + localStorage) to authenticate as a persona without replaying a login flow during tests. **These files must be seeded manually once per persona before any QA run will work.**

### Storage state location

Files live at: `personas/<product>-<persona>.json`
Example: `personas/unit-talk-operator.json`

A `.example.json` is committed as a reference template. The real `.json` file is **not** committed (it contains session tokens).

### How to seed auth state

```bash
pnpm qa:auth --product unit-talk --persona operator
```

This command:
1. Opens a **non-headless** Chromium browser window
2. Navigates to the surface's login URL (`http://localhost:4300` for operator persona)
3. Waits for you to complete login manually (up to 5 minutes)
4. Detects when you reach an authenticated URL
5. Saves the browser storage state to `personas/unit-talk-operator.json`
6. Closes the browser

You must complete the login in the browser window before the timeout. The surface must be running locally.

### When to re-seed

Re-seed when:
- `pnpm qa:experience` aborts with `Missing Playwright storage state`
- Auth tokens have expired (session cookies invalidated)
- The persona's credentials changed

### Available personas

| Persona | Tier | Default surface | Storage state file |
|---|---|---|---|
| `operator` | operator | `command_center` (port 4300) | `personas/unit-talk-operator.json` |
| `capper` | capper | `smart_form` (port 4100) | `personas/unit-talk-capper.json` |
| `free_user` | free | `smart_form` or `discord` | `personas/unit-talk-free_user.json` |
| `vip_user` | vip | `discord` | `personas/unit-talk-vip_user.json` |

**Currently committed:** `unit-talk-operator.json` (real auth state, not to be committed to git). `unit-talk-capper.example.json` is a reference only.

---

## Running QA

### Single flow

```bash
pnpm qa:experience \
  --product unit-talk \
  --surface command_center \
  --persona operator \
  --flow daily_ops \
  --mode fast
```

Required flags: `--surface`, `--persona`, `--flow`
Optional flags: `--product` (default: `unit-talk`), `--mode` (default: `observe`), `--env` (default: `local`)

### Regression mode

```bash
pnpm qa:experience --regression --mode fast
```

Regression mode:
1. Runs `git diff --name-only origin/main` to detect changed files
2. Looks up which skills are affected by the changed files
3. Runs only the affected skills
4. Exits non-zero if any previously-passing skill now fails

If no files changed relative to main, exits 0 with no skills run.

### Modes

| Mode | Behavior |
|---|---|
| `observe` | Default. Slower, more careful navigation. Full screenshot captures. |
| `fast` | Reduced timeouts. Minimal screenshots. Used in CI and regression. |

### Skip preflight

```bash
pnpm qa:experience --surface command_center --persona operator --flow daily_ops --skip-preflight
```

Skips HTTP health checks for dependencies (API). Use when you know the service is up but the preflight check is returning false negatives. **Do not use to mask real failures.**

### Force through failed preflights

```bash
pnpm qa:experience --surface command_center --persona operator --flow daily_ops --force
```

Continues browser automation even when required preflight checks fail. Records failures. Use to investigate whether the browser flow degrades gracefully.

---

## Available Skills

| Surface | Flow | Persona | What it tests |
|---|---|---|---|
| `command_center` | `daily_ops` | `operator` | Login, pick board render, health signals, operator snapshot data |
| `smart_form` | `submit_pick` | `operator`, `capper` | Form load, market type selection, submission success |
| `discord` | `access_check` | `free_user` | Discord slash command availability and role-based access |
| `discord` | `pick_delivery` | `vip_user` | Pick delivery embed rendering in Discord |

---

## Status Meanings

| Status | Meaning | Exit code |
|---|---|---|
| `PASS` | All required preflight checks passed; all hard expectations met | 0 |
| `NEEDS_REVIEW` | Flow completed; soft expectations failed or observations need human judgment | 0 |
| `FAIL` | A required preflight failed AND `--force` not set; OR a hard expectation failed | 1 |
| `SKIP` | Required preflight failed and `--force` not set; browser automation not attempted | 1 |
| `ERROR` | Unexpected exception during skill execution | 1 |

**Regression is recorded separately from status.** A flow that returns `NEEDS_REVIEW` on first run and then `FAIL` on second run is a regression. Check `apps/qa-agent/ledger/ledger.json` for regression flags.

### Preflights

Each skill defines a list of preflight checks (HTTP health checks against required services). If a preflight check with `required: true` fails:
- Without `--force`: skill returns `SKIP`, browser automation is skipped
- With `--force`: skill records the failure and continues

The Command Center `daily_ops` skill requires:
- `http://localhost:4300` → HTTP 200 (`command_center_reachable`)

If Command Center is down, QA will `SKIP`.

---

## Artifacts

Every run writes artifacts to `apps/qa-agent/artifacts/<surface>-<flow>-<persona>/<runId>/`:

| File | Contents |
|---|---|
| `result.json` | Full `QAResult` — schema v1, all expectations, preflight results, screenshots list, console errors, network observations |
| `result.md` | Human-readable summary with status, step log, expectation results, UX friction items |
| `issue-report.md` | If the run fails and has an `issueRecommendation`, a pre-filled Linear issue template |
| `*.png` | Screenshots captured during the flow |

The `artifacts/latest/` symlink points to the most recent run for quick access.

### Ledger

`apps/qa-agent/ledger/ledger.json` tracks all runs by `(product, surface, flow, persona)` tuple. Each entry records:
- `firstSeen` / `lastSeen` ISO timestamps
- `occurrences` (run count)
- `status` (latest)
- `regression: true` if a previously-PASS flow is now failing

The ledger is committed to git for regression tracking. Artifacts are **not** committed (too large).

---

## Debugging Failures

### "Missing Playwright storage state"

```
Error: Missing Playwright storage state for unit-talk/operator: .../personas/unit-talk-operator.json.
Run pnpm qa:auth --product unit-talk --persona operator.
```

**Fix:** Run `pnpm qa:auth --product unit-talk --persona operator`. The required surface must be running.

### SKIP — operator health/snapshot preflight failed

The skill checked `http://localhost:4200/health` and it timed out or returned an error.

**Diagnose:**
```bash
curl -m 8 http://localhost:4200/health
curl -m 8 http://localhost:4200/api/operator/snapshot
```

Check `pnpm ops:brief` to diagnose why the Command Center health check is failing.

To see the browser behavior anyway: `--force` flag.

### FAIL — hard expectation failed

Read `artifacts/<run>/result.md` for the failing expectation name and evidence. Check `apps/qa-agent/src/adapters/unit-talk/surfaces/<surface>/` for the expectation source.

### No changed surfaces detected (regression mode)

`git diff --name-only origin/main` returned no matches for skill trigger paths. Either the branch has no changes relative to main, or the changed file paths don't map to any skill's trigger list.

Check which files trigger which skills: `apps/qa-agent/src/regression/run-changed-surfaces.ts`.

### Console errors in result

`result.json` has a `consoleErrors` array. These are browser console errors captured during the run. `result.md` shows the first 5. Not all console errors cause a `FAIL` — only expectations that check for specific errors will fail.

---

## Startup Prerequisites for QA

Before running any QA flow locally:

| Prerequisite | Check |
|---|---|
| Auth state seeded | `ls personas/unit-talk-operator.json` |
| API running on 4000 | `curl -s http://localhost:4000/health` |
| Operator-web on 4200 | `curl -s http://localhost:4200/health` |
| Command Center on 4300 | `curl -s http://localhost:4300` |
| Smart Form on 4100 (for smart_form flows) | `curl -s http://localhost:4100` |
| Playwright installed | `npx playwright install chromium` |

---

## What NOT to Do

- Do not commit real persona JSON files (`personas/unit-talk-operator.json`) — they contain session tokens
- Do not run `--force` to paper over a real preflight failure in CI
- Do not delete `ledger/ledger.json` — it is the regression baseline
- Do not run QA against production without explicit PM approval — the `--env production` flag targets live services


---

## System Invariants (inherited from root CLAUDE.md)

**Test runner:** `node:test` + `tsx --test` + `node:assert/strict`. NOT Jest. NOT Vitest.

**Module system:** ESM (`"type": "module"`) — use `import`/`export`. File extensions in imports use `.js`.

**Verification gate:** `pnpm verify` runs env:check + lint + type-check + build + test. QA (`pnpm qa:experience`) is separate from `pnpm verify` and is not gated by it.
