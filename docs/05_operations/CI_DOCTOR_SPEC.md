# `ops:ci-doctor` — Specification

**Status:** Canonical, implementation-ready
**Authority:** `EXECUTION_TRUTH_MODEL.md` §5 (Enforcement Placement), `PREFLIGHT_SPEC.md` §14 (local vs CI-overlapping split)
**Implementer:** Codex-safe after this spec is ratified
**Script path (target):** `scripts/ops/ci-doctor.ts`
**Package script (target):** `pnpm ops:ci-doctor [-- --json] [--scope <scope>]`
**Scheduled run (target):** `.github/workflows/ci-doctor.yml` — daily cron + manual `workflow_dispatch`

`ci-doctor` is the CI-surface complement to `ops:preflight`. Where preflight validates the *local* clone, env, and repo at lane start, `ci-doctor` validates the *remote* CI surface — GitHub Actions workflows, required-check configuration, secrets, branch protection, Supabase preview-branch path, and other infrastructure that the agent cannot see from local state. It is **read-only and advisory**: it reports drift so it can be fixed, but never fixes anything itself.

The entire reason this control exists is the class of churn where a T1 PR discovered mid-run that a GitHub secret was missing, a workflow path had rotted, or a preview-branch env variable had silently broken. Those failures were invisible until a lane tripped over them. `ci-doctor` surfaces them on a daily cadence before any lane meets them.

---

## 1. Purpose

Deterministically answer one question on a schedule and on demand:

> **"Is the CI / secrets / workflow / preview-branch surface of this repo currently in a shape that will allow a normal merge flow to succeed?"**

`ci-doctor` is the **airbag**; local preflight is the **seat-belt**. Both exist because the cost of discovering drift mid-lane is high and the cost of running a few read-only API calls is low.

`ci-doctor` is **not**:
- a fixer (it does not mutate any remote state)
- a lane-start gate (preflight owns that surface)
- a merge-time check (truth-check owns that surface)
- a runtime-proof tool (T1 runtime proof lives in truth-check)

---

## 2. Execution Modes

`ci-doctor` runs in two sanctioned modes. The same check set runs in both; only the output surface and scheduling differ.

### 2.1 Local mode

```
pnpm ops:ci-doctor [-- --json] [--scope <scope>] [--explain]
```

- Executed from a developer machine against the remote repo state.
- Honors local env (`local.env` → `.env` → `.env.example`) for credentials.
- Exits non-zero on any `fail` or `infra_error`.
- Intended use: ad-hoc ("why did the workflow break?"), before merging a T1 PR, after rotating a secret.

### 2.2 Scheduled CI mode

- Executed by `.github/workflows/ci-doctor.yml` on daily cron and on `workflow_dispatch`.
- Runs the same check set.
- Publishes the machine-readable result as a workflow artifact named `ci-doctor-result.json`.
- On failure (any `fail` check), the workflow job fails — this surfaces via GitHub's normal notification channels and the Unit Talk daily digest.
- The workflow must not use any secret beyond what ci-doctor needs read-access to. No deploy keys, no push tokens, no write scopes.

**Bootstrapping note:** `ci-doctor` in CI has a bootstrapping problem — if CI itself is broken, the scheduled run cannot report. Mitigation: the workflow must be *minimal* (checkout + setup-node + install + run). If it fails to even start, the absence of the daily artifact is itself the alarm signal. The daily digest must treat "no artifact in the last 26 hours" as equivalent to a `fail`.

### 2.3 Flag semantics

| Flag | Purpose |
|---|---|
| `--json` | emit machine-readable result to stdout; human output to stderr |
| `--scope <scope>` | run a named subset of checks (`workflows` \| `secrets` \| `protection` \| `preview` \| `required-checks` \| `artifacts` \| `all`). Default `all`. |
| `--explain` | emit per-check reasoning to stderr |
| `--since <iso>` | limit workflow-history checks to runs since the given timestamp (default: 24h) |
| `--dry-run` | ignored; present for parity with other `ops:*` commands, has no effect since ci-doctor is already read-only |

### 2.4 Exit codes

| Code | Meaning |
|---|---|
| `0` | PASS — zero `fail`, zero `infra_error` |
| `1` | FAIL — at least one check failed |
| `3` | INFRA — ci-doctor could not run (missing token, network down, git root unresolvable) |

`ci-doctor` has no equivalent of `2` (not-applicable); every check is either evaluable or is an infra error. This differs from preflight and truth-check deliberately.

---

## 3. Check Set

Checks run in declared order. All checks run every invocation — no first-failure short-circuit, mirroring preflight. Check IDs are stable contracts; additions append, no renumbering.

### 3.1 Workflows (`CW*`)

Validate the presence and shape of GitHub Actions workflows that the repo depends on.

| ID | Check |
|---|---|
| `CW1` | `.github/workflows/` directory exists and is non-empty |
| `CW2` | Every referenced workflow file is valid YAML |
| `CW3` | Every workflow declared as a required status check (see `CR*`) exists as a real file under `.github/workflows/` |
| `CW4` | Every workflow's `on:` block is parseable and references only supported trigger types |
| `CW5` | No workflow references a removed or renamed action (versioned `uses:` lines resolve — existence check only, not signature check) |
| `CW6` | No workflow references a secret name that is not present in the repo's declared secret inventory (see `CS*`) |
| `CW7` | `ci-doctor.yml` itself exists and uses only read-scoped tokens |

### 3.2 Secrets (`CS*`)

Validate that GitHub Actions secrets required by workflows are present. `ci-doctor` cannot read secret *values* — GitHub's API only exposes names and existence. Validation is existence-only.

| ID | Check |
|---|---|
| `CS1` | GitHub API token used by ci-doctor has sufficient scope to list secrets (`actions:read` or equivalent) |
| `CS2` | Every secret name referenced in any workflow exists as a configured secret in the repo |
| `CS3` | No expected secret is missing (expected set is derived from a canonical file at `docs/05_operations/REQUIRED_SECRETS.md` or a machine-readable sidecar — see §8) |
| `CS4` | Environment-scoped secrets (if any) exist in the declared environment |
| `CS5` | No secret name appears in workflow yaml outside a `${{ secrets.NAME }}` reference (prevents accidental plaintext leak) |

### 3.3 Branch protection (`CP*`)

Validate that `main` branch protection is configured in a way that supports the merge policy declared in `EXECUTION_TRUTH_MODEL.md`.

| ID | Check |
|---|---|
| `CP1` | `main` has branch protection enabled |
| `CP2` | `main` requires status checks before merge |
| `CP3` | `main` requires branches be up to date before merge |
| `CP4` | `main` has a non-empty `required_status_checks.contexts` or `required_status_checks.checks` |
| `CP5` | `main` blocks force-push |
| `CP6` | `main` blocks deletion |
| `CP7` | If T1 workflow is used, the `t1-approved` label gating mechanism is present (either via CODEOWNERS + required reviews, or via a workflow that gates on the label) |

### 3.4 Required checks (`CR*`)

Validate that the set of *required* status checks on `main` matches the workflows that actually run. Drift here is the #1 cause of "PR stuck waiting for a check that no longer runs."

| ID | Check |
|---|---|
| `CR1` | Every required check (from `CP4`) corresponds to at least one workflow that produces that check name |
| `CR2` | Every workflow the repo intends as gating (declared in `docs/05_operations/REQUIRED_CI_CHECKS.md` or a sidecar) is listed as a required check on `main` |
| `CR3` | No required check on `main` is a stale name (points to a job/workflow that no longer exists) |
| `CR4` | Required check names match the actual job names/check_run names produced in the last N runs (verifies the contract is real) |

### 3.5 Preview-branch path (`CV*`)

Validate the Supabase preview-branch migration path — the surface that produced the churn events around commits `1212856` (quoted env parsing) and `36d9f75` (pooled DB URL).

| ID | Check |
|---|---|
| `CV1` | `.github/workflows/supabase-preview-branch.yml` (or whatever the canonical preview workflow is named) exists |
| `CV2` | Preview workflow references exactly the secrets declared by `REQUIRED_SECRETS.md` for the preview path |
| `CV3` | Preview workflow's env-writing step uses a quoted-value-stripping helper (grep guard: no `echo "KEY=\"$VALUE\"" >> $GITHUB_ENV` patterns) |
| `CV4` | Preview workflow uses the pooled Supabase DB URL for migration validation (positive grep for the pooled-URL pattern) |
| `CV5` | Last N scheduled or PR runs of the preview workflow did not fail for one of a known set of recurring reasons (env parse, connection refused, missing secret) — derived from workflow run history |
| `CV6` | Preview-branch toggle doc `docs/ops/SUPABASE_PREVIEW_BRANCH_VALIDATION.md` (or equivalent) exists and is marked selective-use per commit `af8e403` |

`CV*` is allowed to be **selective**: if the repo has no active preview workflow, `CV1` returns `skip` and subsequent `CV*` return `skip` with the reason recorded. Skips are distinct from passes in output.

### 3.6 Workflow history (`CH*`)

Validate that recent workflow runs do not indicate a silently-rotting path.

| ID | Check |
|---|---|
| `CH1` | The last successful run of each gating workflow is within a sane recency window (default 7 days for weekly workflows, 48h for per-PR workflows) |
| `CH2` | No gating workflow has been in a failing state for N consecutive runs (N default: 3) |
| `CH3` | No gating workflow has zero runs in the last 30 days (signals a disabled or orphaned workflow) |
| `CH4` | `ci-doctor.yml` itself has a successful run within the last 26 hours (otherwise the daily cadence is broken — the airbag is offline) |

### 3.7 Artifacts (`CA*`)

Validate that artifacts ci-doctor itself depends on (for contract-driven checks) exist and are parseable.

| ID | Check |
|---|---|
| `CA1` | `docs/05_operations/REQUIRED_SECRETS.md` (or sidecar) exists and is parseable |
| `CA2` | `docs/05_operations/REQUIRED_CI_CHECKS.md` (or sidecar) exists and is parseable |
| `CA3` | `EXECUTION_TRUTH_MODEL.md` tier matrix parses to the expected tier names (contract sanity — mirrors truth-check's existence checks) |

If any `CA*` check fails, ci-doctor exits `3` (infra) because the rest of the run cannot be trusted without the contract files.

---

## 4. What `ci-doctor` is allowed to inspect

| Allowed | Not allowed |
|---|---|
| GitHub REST/GraphQL read endpoints (`actions:read`, `metadata:read`, `pull_requests:read`, `repo:status`) | Any write scope (`contents:write`, `pull_requests:write`, `actions:write`) |
| Branch protection API (`GET /repos/:o/:r/branches/:b/protection`) | Branch protection mutation |
| Workflow run history (`GET /repos/:o/:r/actions/runs`) | Re-running workflows, cancelling runs |
| Repo secrets listing (names only — `GET /repos/:o/:r/actions/secrets`) | Reading secret values (impossible via API by design) |
| Local YAML parsing of `.github/workflows/*.yml` | Modifying any `.github/` file |
| Linear API read for issue state cross-references (optional, low priority) | Linear write |
| Supabase management API read (project status, branch listing) for preview-branch health | Supabase DDL / DML execution |
| Reading `docs/05_operations/*.md` artifact files | Writing docs |

**Token scoping:**
- Local mode: use the caller's `GITHUB_TOKEN`, validate its scopes at start (`CS1`-adjacent check); refuse if over-scoped or under-scoped
- CI mode: use a dedicated PAT or GitHub App installation token with exactly the read scopes above; never `GITHUB_TOKEN` from the workflow run itself if it grants write

---

## 5. What `ci-doctor` must NOT mutate

Enumerated explicitly. These are hard prohibitions enforced by token scoping in §4.

- **GitHub branch protection.** Read only. Even if protection is wrong, `ci-doctor` reports and exits.
- **GitHub workflow files.** Never committed to, never edited. Reported as `fail` if drifted.
- **GitHub secrets.** Never created, deleted, or rotated.
- **GitHub labels or PR state.** Never touched.
- **Linear issue state.** Never updated. `ci-doctor` may read; that is all.
- **Supabase schema or data.** Never. Management API is read-only paths only.
- **Local repo state.** Never. `ci-doctor` does not commit, push, or edit files — not even `.out/` sidecars (see §6 for where output goes).
- **Local env files.** Never written to.
- **CI workflow runs.** Never triggered, re-run, or cancelled.

If implementation discovers it "needs" to mutate something to complete a check, the check is out of scope for ci-doctor and belongs in a dedicated (manual or agent-run) remediation lane.

---

## 6. Output

### 6.1 Pass / fail vocabulary

Every check result carries exactly one of:

- `pass` — check ran and the assertion held
- `fail` — check ran and the assertion did not hold
- `skip` — check did not apply (e.g. `CV1` when no preview workflow exists)
- `infra_error` — check could not run (API error, missing token scope, unparseable file)

Top-level verdicts:

- `PASS` — zero `fail`, zero `infra_error`
- `FAIL` — one or more `fail`
- `INFRA` — one or more `infra_error` and zero `fail`

Skips never escalate to fail. They are neutral.

### 6.2 Machine-readable output (`--json`)

```json
{
  "schema_version": 1,
  "run_at": "2026-04-11T06:00:00Z",
  "mode": "local" | "scheduled",
  "repo": "griff843/Unit-Talk-v2-main",
  "scope": "all",
  "verdict": "PASS" | "FAIL" | "INFRA",
  "exit_code": 0,
  "checks": [
    { "id": "CW1", "status": "pass", "detail": "5 workflow files present" },
    { "id": "CS3", "status": "fail", "detail": "missing secret: SUPABASE_DB_URL_POOLED" }
  ],
  "failures": ["CS3"],
  "infra_errors": [],
  "skips": ["CV1", "CV2", "CV3", "CV4", "CV5", "CV6"],
  "summary": {
    "total": 28,
    "pass": 21,
    "fail": 1,
    "skip": 6,
    "infra_error": 0
  }
}
```

- Output schema: `docs/05_operations/schemas/ci_doctor_result_v1.schema.json` (to be authored alongside implementation)
- When `--json` is set, stdout is **exactly one** JSON object. All other output goes to stderr.
- `verdict` and `exit_code` must always agree — unit-testable invariant.
- Check IDs are stable. Additions append. Never renumber.

### 6.3 Human-readable output (default)

- One line per check: `[PASS|FAIL|SKIP|INFRA] <id> — <short detail>`
- Group headers (`-- Workflows --`, `-- Secrets --`, etc.)
- Summary line: `VERDICT: <verdict>  (pass: N, fail: M, skip: S, infra: I)`
- Exit code matches JSON.

### 6.4 Persistence

- Local mode: result is not persisted by default. Pass `--write-result` to write to `.out/ops/ci-doctor/<iso-timestamp>.json`. Directory must be in `.gitignore`.
- CI mode: result is uploaded as the workflow artifact `ci-doctor-result.json` with 30-day retention. The daily digest reads this artifact.
- `ci-doctor` does **not** write to Linear, Slack, Discord, or email. Notification is the digest's job.

---

## 7. Secret / workflow validation expectations

This section pins the contract for `CS*` and `CW*` to prevent scope creep.

### 7.1 Secret existence inventory

`ci-doctor` needs a canonical list of required secrets to check against. Two acceptable sources:

1. **Preferred:** `docs/05_operations/REQUIRED_SECRETS.md` with a machine-readable section (fenced `json` block or a sidecar `.json`) listing:
   ```json
   {
     "schema_version": 1,
     "secrets": [
       { "name": "GITHUB_TOKEN", "scope": "repo", "used_by": ["ci.yml"] },
       { "name": "SUPABASE_ACCESS_TOKEN", "scope": "repo", "used_by": ["supabase-preview-branch.yml"] }
     ]
   }
   ```
2. **Fallback:** grep all workflow files for `${{ secrets.NAME }}` references and treat that set as the inventory. Used when the canonical file is absent; degrades `CS3` to `skip` and emits a `CA1` fail.

Secret *values* are never inspected. Only names and existence.

### 7.2 Workflow validity

- YAML parse must succeed (use a real YAML parser, not regex).
- `on:` block must parse; supported triggers: `push`, `pull_request`, `schedule`, `workflow_dispatch`, `workflow_call`.
- `uses:` lines are not network-fetched to verify — existence-only means the ref must be non-empty and syntactically valid.
- Jobs must declare `runs-on`.
- Steps must have either `run` or `uses`.

YAML validity failures are `fail`, not `infra_error`. A workflow that will not parse is a real bug.

---

## 8. Preview-branch path validation expectations

This section pins the contract for `CV*` based on the specific churn history the control exists to prevent.

### 8.1 Known failure modes

The `CV*` checks are deliberately scoped to the three failure modes that caused observable churn:

1. **Quoted env parsing** — env values written to `$GITHUB_ENV` with surrounding quotes that survive into the running shell. Fixed in commit `1212856`. `CV3` enforces.
2. **Non-pooled DB URL** — migration validation using a direct Supabase DB URL instead of the pooled connection, causing transient connection refused. Fixed in commit `36d9f75`. `CV4` enforces.
3. **Selective-use drift** — the preview workflow being enabled globally when it is intended as selective-use. Codified in commit `af8e403`. `CV6` enforces.

New `CV*` checks may be added only when a new observed failure mode justifies it. Do not preemptively add preview checks for hypothetical problems.

### 8.2 Grep guard patterns (non-binding, helpful)

The `CV3` and `CV4` checks use simple grep patterns against the workflow YAML:

- `CV3` (negative): reject if any line matches `echo\s+"[A-Z_][A-Z0-9_]*=\\"`
- `CV4` (positive): require at least one line matching the pooled-URL pattern (e.g. `aws-0-.*\.pooler\.supabase\.com` or whatever the canonical pattern is — pin it in the preview workflow contract doc, not here)

Patterns are implementation detail. The spec cares that the checks exist and fail closed when the pattern is wrong.

---

## 9. When to run `ci-doctor`

- **Daily scheduled CI** — mandatory, non-negotiable. The cadence is the point.
- **Before merging any T1 PR** — recommended, not yet enforced in policy. Agents should run locally.
- **After rotating a secret** — recommended.
- **After touching any `.github/workflows/*.yml`** — recommended.
- **After any preview-branch workflow change** — recommended.
- **When the daily digest shows stale artifact or recent `fail`** — mandatory re-run to verify the fix.

`ci-doctor` is not expected to run on every PR. It is a cadence control, not a gating control. If a check is important enough to gate every PR, it belongs in a dedicated required status check, not in ci-doctor.

---

## 10. Non-goals

- Not a fixer. Never mutates remote state.
- Not a lane-start gate. Preflight owns local; ci-doctor owns remote surface health. Neither blocks the other.
- Not a merge gate. Truth-check owns merge-time.
- Not a runtime-proof tool. T1 runtime proof is truth-check's domain.
- Not a replacement for branch protection. It verifies protection is configured; it does not substitute for it.
- Not a Linear workflow sync tool. It may read Linear for cross-reference, but it does not update issue state.
- Not a secret scanner. It validates presence, not content. Leak detection is GitHub's own secret scanning feature.
- Not an alerting system. Output is consumed by the daily digest; ci-doctor itself does not send notifications.

---

## 11. Implementation notes (non-binding, helpful)

1. **Reuse `shared.ts` primitives where possible.** `getRepoRoot`, `git`, `parseJsonFile`, `relativeToRoot`, `emitJson`, `ROOT`, and the `--json` conventions from existing `ops:*` commands are the precedent. Match them.

2. **YAML parsing dependency.** Prefer `yaml` package (already present in many Node stacks) over regex. If not yet in the dep tree, justify the addition or use `js-yaml`. One YAML lib for the whole project.

3. **GitHub API client.** Use `fetch` with 10s timeout + 1 retry, mirroring `truth-check-lib.ts`. Do not add `@octokit/*` unless a check genuinely requires it. Consistency with truth-check is worth the minor verbosity.

4. **Token scope validation as the first real check (`CS1`).** If the token is under-scoped, everything else will fail with 403s and the output becomes noise. Validate up front and exit `3` if insufficient.

5. **Stable check ordering.** Same order every run. Tests will assert on order. Groups run in the declared order (workflows → secrets → protection → required-checks → preview → history → artifacts), and within a group the checks run in numeric order.

6. **Every check ID needs a unit test fixture** covering pass and fail. Check IDs are the test contract.

7. **Integration test plan.** Two tests minimum:
   - Run against a fixture repo with a known-good CI surface → expect `PASS`.
   - Run against a fixture with a deliberately missing required secret → expect `FAIL` with `CS3` in failures.

8. **`ci-doctor.yml` workflow must be minimal.** Checkout → setup-node → install → run `pnpm ops:ci-doctor -- --json` → upload artifact. No other steps. Any complexity here becomes a bootstrapping hazard.

9. **Artifact retention.** 30 days is enough for historical comparison without cost creep.

10. **`--scope` must be honored at the group level**, not individual check IDs. Agents should not be tuning ci-doctor at check-ID granularity; if a check is too noisy, fix it or remove it.

11. **Schema locations:**
    - `docs/05_operations/schemas/ci_doctor_result_v1.schema.json`
    - `docs/05_operations/schemas/required_secrets_v1.schema.json` (for the sidecar in §7.1)
    - `docs/05_operations/schemas/required_ci_checks_v1.schema.json`

    Match the strictness posture of existing schemas (`additionalProperties: true` for v1 forward compat).

12. **No side effects outside `.out/ops/ci-doctor/`** on local runs, and no side effects at all in CI mode beyond the artifact upload that the workflow performs (ci-doctor itself writes to stdout; the workflow uploads).

13. **Idempotent and safe to run repeatedly.** No rate-limit handling beyond the standard 10s timeout; if GitHub API rate limits are exceeded, emit `infra_error` on affected checks and exit `3`. Do not sleep-and-retry within a single run.

14. **Do not implement `--auto-fix` or any mutation flag, ever.** If that feature is ever needed, it belongs in a separate command (`ops:ci-repair` or similar). ci-doctor is diagnosis-only by contract.

15. **Daily digest integration is out of scope for this implementation.** ci-doctor writes the artifact; the digest reads it. The digest is a separate, future lane. Do not couple them.

16. **When a canonical-artifact file (`REQUIRED_SECRETS.md`, `REQUIRED_CI_CHECKS.md`) does not yet exist**, ci-doctor exits `3` with a clear message. Those files should be authored in a small follow-up lane before ci-doctor implementation lands. Do not inline a default secret list inside ci-doctor code — the inventory is a contract, not a hardcode.
