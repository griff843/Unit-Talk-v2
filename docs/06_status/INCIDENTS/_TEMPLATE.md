# Incident — `<INC-ID>`

> Copy this file to `INC-YYYY-MM-DD-<slug>.md`. Fill every section. If a section truly does not apply, write `n/a` with a one-line reason; do not delete it.

## Header

| Field | Value |
|---|---|
| Incident ID | `INC-YYYY-MM-DD-<slug>` |
| Title | `<short descriptive title>` |
| Severity | `Low` / `Medium` / `High` / `Critical` |
| Status | `Open` / `Mitigated` / `Resolved` |
| Detected | `YYYY-MM-DDTHH:MM:SSZ` |
| Resolved | `YYYY-MM-DDTHH:MM:SSZ` or `n/a` |
| Primary Linear | `UTV2-XXX` + URL |
| Related issues | `UTV2-...`, `UTV2-...` |
| Fix PR | `https://github.com/griff843/Unit-Talk-v2/pull/<N>` |
| Fix commit | `<short sha>` on branch `<name>` |
| Owner | `<person / lane>` |

## Timeline

All times UTC.

- `YYYY-MM-DDTHH:MM:SSZ` — `<event>`
- `YYYY-MM-DDTHH:MM:SSZ` — `<event>`

## Detection Path

How the incident surfaced. Name the script, test, operator surface, or observability signal. Include exact file paths where applicable.

## Impact

Concrete blast radius: which runtime paths were broken, which rows were affected, which downstream work was blocked. Quantify where possible (row counts, minutes of degraded state, brake sources affected).

## Root Cause

The actual technical cause, not a symptom. Identify the code or migration that introduced the gap and the assumption that was wrong.

## Policy / Control Failure

Which governance rule, test coverage lane, or review gate *should* have caught this and did not. This is the institutional-learning section — be specific.

## Remediation

What actually shipped to fix it. Bullet the concrete changes, with PR/commit links:

- `<change 1>`
- `<change 2>`

Call out any partial remediation (e.g. data cleanup deferred, inventory-only) explicitly.

## Follow-Up Issues

| Linear | Title | Status |
|---|---|---|
| `UTV2-XXX` | `<title>` | `<state>` |

## Prevention / Lessons / New Controls

Durable rules, new test lanes, or new review gates that come out of this incident. Prefer mechanical enforcement over "remember to…".

- `<rule or control>`
- `<rule or control>`

## Linked Evidence / Proof Bundles

- `<path or URL to evidence bundle, proof script, or test>`
- `<path or URL>`
