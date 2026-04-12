# Required CI Checks — Canonical Inventory

**Status:** Canonical, implementation-usable
**Authority:** `docs/05_operations/CI_DOCTOR_SPEC.md` §3.4 (`CR*`), `EXECUTION_TRUTH_MODEL.md` §5
**Consumed by:** `scripts/ops/ci-doctor.ts` (checks `CA2`, `CW3`, `CR1`, `CR2`, `CR3`, `CR4`)
**Update policy:** Additions append. Entries here must reflect **shipped truth** — only checks that are (a) produced by a workflow currently in `.github/workflows/` and (b) intended to be configured as required status checks on `main` branch protection.

---

## 1. Purpose

This file is the **single source of truth** for which GitHub Actions check runs the repo considers canonically required at merge. `ci-doctor` parses the fenced JSON block below and uses it to:

1. Verify that every referenced workflow file exists under `.github/workflows/` (`CW3`).
2. Verify that every declared check name is configured as a required status check on `main` branch protection (`CR2`).
3. Cross-check configured required checks on `main` against workflows that actually produce those names (`CR1`, `CR3`).
4. Cross-check declared check names against workflow run history to confirm they actually fire (`CR4`).

Drift in any direction is a `fail`. This file is therefore a contract: what is listed here must match live branch-protection configuration and actual workflow output names.

---

## 2. Name matching contract

`ci-doctor` uses two name pools to validate required checks:

- `workflowDocs.flatMap(doc => [doc.name, ...doc.jobs])` — every workflow's top-level `name:` plus every job key under `jobs:`. A declared check `name` must match one of these values (either the workflow display name or a job id).
- `required_status_checks.contexts` / `required_status_checks.checks[].context` on `main` branch protection (read live via the GitHub API).

The `name` field in this inventory is the **status check context name** as GitHub reports it — typically the workflow job id (e.g. `verify`), **not** the workflow file name. The `workflow` field is the path to the workflow file on disk relative to repo root. The `job` field is the exact job key under `jobs:` in that workflow, and is metadata only (not used for matching by `ci-doctor` today, but preserved so future enforcement can bind a check name to an exact job).

Use the workflow's job id as the `name` — GitHub's branch protection UI lists job ids for reusable-job-style required checks.

---

## 3. Canonical inventory (machine-readable)

```json
{
  "schema_version": 1,
  "checks": [
    {
      "name": "verify",
      "workflow": ".github/workflows/ci.yml",
      "job": "verify",
      "always_required": true,
      "tier_applicability": ["T1", "T2", "T3"],
      "purpose": "Runs pnpm verify: env:check + lint + type-check + build + discord command manifest check + unit tests + DB smoke test. Primary merge gate for every tier."
    }
  ]
}
```

---

## 4. Check-by-check detail

### 4.1 `verify`

- **Owning workflow:** `.github/workflows/ci.yml`
- **Job:** `verify`
- **Trigger:** `push` (to `main`, `codex/**`) and `pull_request`
- **What it does:** Installs dependencies, writes a CI placeholder `local.env`, then runs in order:
  1. `pnpm env:check`
  2. `pnpm lint`
  3. `pnpm type-check`
  4. `pnpm build`
  5. `pnpm --filter @unit-talk/discord-bot command-manifest:check`
  6. `pnpm test`
  7. `pnpm test:db`
- **Required on main:** yes, always. Applies to T1, T2, T3 lanes without exception.
- **Merge relevance:** primary merge gate. No tier may bypass.
- **Notes:** `test:db` requires Supabase credentials; for non-migration PRs this runs against the main project; for migration PRs the parallel `Supabase PR DB Branch / validate` job re-runs `test:db` against an isolated preview branch.

---

## 5. Workflows present but NOT in the required inventory

The following workflows exist under `.github/workflows/` but are intentionally **not** declared as required checks in §3. Each exclusion is deliberate. Do not add them to the fenced JSON without a corresponding branch-protection change and a ratified policy decision.

### 5.1 `Supabase PR DB Branch` (`supabase-pr-db-branch.yml`)

- **Jobs:** `plan`, `validate`, `teardown`
- **Why excluded:** conditionally required — `validate` only runs when a PR modifies files under `supabase/migrations/**`. Adding it as an always-required check would block every non-migration PR waiting for a job that is skipped. GitHub required-status checks cannot express "required only if it runs."
- **Policy:** `validate` must pass on every PR that changes migrations. This is enforced by convention and by `ci-doctor` check `CV5` (recent run history), not by branch protection.
- **Future work:** if GitHub adds conditional required checks, revisit and promote `validate` into the required inventory.

### 5.2 `doc-truth-gate` (`doc-truth-gate.yml`)

- **Job:** `doc-truth-audit`
- **Why excluded:** workflow exists and runs on pull requests, but its canonical role in merge gating has not yet been ratified in policy. Marking it always-required here without that ratification would conflict with `EXECUTION_TRUTH_MODEL.md`.
- **Status:** Planned — promote to required once policy confirms doc-truth audit is a hard merge gate. Tracked as exposed gap in §7.

### 5.3 `Proof Coverage Guard` (`proof-coverage-guard.yml`)

- **Job:** `proof-coverage`
- **Why excluded:** runs on pull requests but is advisory under current policy. Evidence bundles are enforced by `/t1-proof` and `ops:truth-check` at the tier level, not by a blanket required check.
- **Status:** Planned — promote to required if/when proof-coverage gating is ratified as a universal merge gate. Tracked as exposed gap in §7.

### 5.4 `CI Doctor` (`ci-doctor.yml`)

- **Job:** `ci-doctor`
- **Why excluded:** cadence control, not a per-PR gating control. Per `CI_DOCTOR_SPEC.md` §9, ci-doctor is a daily airbag, not a merge gate. It runs on `schedule` and `workflow_dispatch` only; it has no `pull_request` trigger to produce a check run against.
- **Status:** permanently excluded by design. Do not add.

### 5.5 `Linear Auto-Close` (`linear-auto-close.yml`)

- **Job:** `linear-auto-close`
- **Why excluded:** post-merge automation, triggered by `push` to `main` (i.e. after the merge has already happened). Cannot be a required check for PR merge.
- **Status:** permanently excluded by design. Do not add.

---

## 6. Change procedure

1. **Adding a required check:**
   - Ensure the workflow exists and its job id is stable.
   - Add the entry to §3 JSON with full metadata.
   - Add or update the detail block in §4.
   - In the same or a follow-up PR, configure the check as required on `main` branch protection. The two must align or `CR2` will fail.
   - Run `pnpm ops:ci-doctor -- --scope required-checks` locally to confirm alignment.

2. **Removing a required check:**
   - Remove from branch protection first.
   - Then remove from §3 JSON and the §4 detail in the same PR as the branch-protection change.

3. **Renaming a job that produces a required check:**
   - This rotates the check name. Treat as "add new, remove old" with a transient overlap window. Update §3 and branch protection atomically.

Every change runs through `pnpm ops:ci-doctor` before merge.

---

## 7. Known drift and exposed gaps

This section is **load-bearing** — it documents the intentional gap between what this file declares and what live branch protection configures, so `ci-doctor` readers can interpret `CR*` results correctly.

- **`doc-truth-audit` and `proof-coverage` are workflows without canonical required-check status.** If live branch protection on `main` lists either as required but this file does not, `CR1` and `CR3` will still pass (because the names map to known job ids), but there will be no cross-verification that the check is intended. Promotion into §3 should follow a policy decision, not an observation of drift.
- **`CR2` may report additional configured required checks** that are not in §3. Those are surfaced by `CR1`/`CR3` only if they are stale (not mapped to any workflow). If branch protection drifts ahead of this file, update this file.
- **`CR2` depends on live GitHub API access.** If `GITHUB_TOKEN` is unavailable, the check returns `infra_error`, not `fail`.

---

## 8. Related documents

| Topic | Document |
|---|---|
| ci-doctor spec | `docs/05_operations/CI_DOCTOR_SPEC.md` |
| Required secrets (companion inventory) | `docs/05_operations/REQUIRED_SECRETS.md` |
| Execution truth model (merge policy) | `docs/05_operations/EXECUTION_TRUTH_MODEL.md` |
| Truth-check spec (merge-time gate) | `docs/05_operations/TRUTH_CHECK_SPEC.md` |
| Preflight spec (lane-start gate) | `docs/05_operations/PREFLIGHT_SPEC.md` |
| Delegation policy (tier matrix) | `docs/05_operations/DELEGATION_POLICY.md` |
