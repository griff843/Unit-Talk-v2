# WORK-2026092401 — the conveyor names an unprovisioned archive, and never calls it archived

Tier: T1 (mechanical floor: `.github/workflows/`) · Lane type: governance · Executor: claude

## Problem

The header of `.github/workflows/warehouse-archive-conveyor.yml` says that with no archive
credentials "the run exits cleanly after reporting that it is not configured". It does not. The only
scheduled run (35980767152, 2026-09-24T09:21Z) failed with exit 1 at `warehouse doctor`, and
`warehouse staleness` failed after it with the same generic "configuration is incomplete" text.

The canonical requirement is the opposite of the header: `WAREHOUSE_OBJECT_STORAGE_PROVISIONING.md`
§3 says a misconfigured run *fails*, `config.ts` rule 2 says missing configuration fails closed, and
`WAREHOUSE_ARCHIVE_CONTRACT.md` §8 says a missing heartbeat is *stale, never unknown*. So the red
conclusion is correct and the header is wrong. What is missing is a distinction a reader can act on:
"nothing is provisioned yet", "half-provisioned", and "ready" all print the same text.

## Outcome

- `describeConfig` reports `archive_state`: `not_provisioned` (no archive key present at all),
  `incomplete` (some present, some missing or placeholder), or `ready` (object store and source
  both resolve). A placeholder is never counted as provisioned.
- `warehouse doctor` exits 0 only for `ready`; both other states stay non-zero. It writes a job
  summary, when `GITHUB_STEP_SUMMARY` is set, that names the state and says plainly that no window
  was exported, uploaded, verified or manifested, and that nothing became prune-eligible.
- The workflow header states what the run actually does.
- No step is added, removed or reordered; there is still no prune path.

## Acceptance

- Tests cover missing, partial, placeholder-only and complete configurations, and pin that only
  `ready` exits 0 and that the summary never contains a configured value.
- A workflow test fails if the header claims a clean exit again.
- Mutations: making `not_provisioned` exit 0, or counting a placeholder as provisioned, turns a
  named test red.
