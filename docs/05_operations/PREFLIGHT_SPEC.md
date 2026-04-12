# `ops:preflight` — Specification

**Status:** Canonical, implementation-ready
**Authority:** `EXECUTION_TRUTH_MODEL.md` §2 (Lane Lifecycle), `LANE_MANIFEST_SPEC.md` §2 (lane start gating)
**Implementer:** Codex-safe after this spec is ratified
**Script path (target):** `scripts/ops/preflight.ts`
**Package script (target):** `pnpm ops:preflight -- <UTV2-###> --tier <T1|T2|T3> --branch <branch>`
**Interop contract:** must produce a token that satisfies `validatePreflightToken()` in `scripts/ops/shared.ts` (token file shape, path, and field semantics below are the authoritative contract `lane-start` already reads).

Preflight is the mechanical gate that runs *before* `ops:lane-start`. It verifies that the local environment, repo, branch, and prerequisite artifacts are in a state where starting a lane will not immediately discover a hidden blocker. On pass, it emits a short-lived, issue-bound, HEAD-bound token that `lane-start` requires.

No lane may start without a valid preflight token. This is the point of the control.

---

## 1. Purpose

Deterministically answer one question before any lane begins:

> **"If I start a lane for `<UTV2-###>` on `<branch>` from `<HEAD>` right now, are the local prerequisites actually in place?"**

Preflight is **local-scoped**. It validates the state of the working clone, env, and declared prerequisites. It does **not** re-validate CI health, GitHub secret rotation state, remote infra, or anything that `ops:ci-doctor` is intended to own. Splitting responsibilities prevents preflight from becoming slow and prevents `ci-doctor` from becoming a lane-start gate.

Preflight replaces "the agent should have checked X before starting" as a convention with a script that refuses to emit a token when X is not true.

---

## 2. Command Shape

```
pnpm ops:preflight -- <UTV2-###> --tier <T1|T2|T3> --branch <branch> [flags]

Positional:
  <UTV2-###>                 Linear issue id the lane will serve (required)

Required flags:
  --tier <T1|T2|T3>          tier the lane will run under; gates tier-specific checks
  --branch <branch>          target branch name (must satisfy validateBranchName: <owner>/<issue-id-lowercase>-<slug>)

Optional flags:
  --json                     emit the full machine-readable result to stdout
  --dry-run                  run all checks but do not write the token
  --refresh                  overwrite an existing non-expired token if checks still pass (default: refuse)
  --require-doc <path>       add additional required-doc paths (repeatable) on top of tier defaults
  --skip <check-id>          waive a specific check; only permitted for T3 and a fixed waivable set (see §5); emits a visible waiver entry
  --explain                  emit per-check reasoning to stderr
```

### Exit codes

| Code | Meaning | Token written? |
|---|---|---|
| `0` | PASS — all checks passed, token written | **yes** |
| `1` | FAIL — one or more checks failed; token not written and any stale token at the target path is removed | no |
| `2` | NOT APPLICABLE — a precondition makes preflight irrelevant (e.g. issue not Ready, tier label missing) | no |
| `3` | INFRA — local environment is broken in a way preflight cannot diagnose (git not installed, repo root unresolvable, write-permission denied on token dir) | no |

These exit codes mirror `ops:truth-check` intentionally. Callers (including `lane-start`) may branch on them.

---

## 3. Sub-checks

Checks run in declared order. First failure does not short-circuit — **all checks run** and all results are emitted in the JSON output, so one preflight call surfaces every blocker at once. This matters because the recent churn pattern was "fix one blocker, discover the next" per run.

Check IDs are stable contracts: additions append, no renumbering.

### 3.1 Repo / Git checks (always)

| ID | Check | Severity |
|---|---|---|
| `PG1` | `git rev-parse --show-toplevel` resolves to a repo root | infra (exit 3) |
| `PG2` | Working tree is clean — no uncommitted changes, no staged changes, no untracked files outside `.gitignore` | fail |
| `PG3` | `main` is up to date with `origin/main` (fetch then compare) — local not behind | fail |
| `PG4` | Current HEAD matches the branch specified by `--branch`, **or** the branch does not yet exist locally (lane-start will create it) | fail |
| `PG5` | Target branch, if it exists, is ancestor-clean relative to `main` (no divergence except forward commits on the lane branch) | fail |
| `PG6` | No active rebase, merge, bisect, or cherry-pick in progress | fail |
| `PG7` | No worktree already exists at `worktreePathForBranch(branch)` unless it is a sanctioned resume (matching active manifest in `started`/`in_progress`/`blocked`/`reopened`) | fail |
| `PG8` | `.git/hooks` are not bypassed (no `core.hooksPath` pointing at a no-op; pre-commit hook if present is executable) | fail |
| `PG9` | `git config user.email` and `user.name` are set | fail |

### 3.2 Environment / secrets checks (always)

| ID | Check | Severity |
|---|---|---|
| `PE1` | `local.env` exists at repo root (or `.env` if the former is absent) and is parseable by `@unit-talk/config` without throwing | infra |
| `PE2` | `LINEAR_API_TOKEN` or `LINEAR_API_KEY` present and non-empty | fail |
| `PE3` | `GITHUB_TOKEN` present and non-empty | fail |
| `PE4` | For T1 or T2: `SUPABASE_SERVICE_ROLE_KEY` present and non-empty (required downstream by `test:db` and by T1 runtime proof) | fail |
| `PE5` | No credential-shaped value is wrapped in unescaped quotes that would survive as a literal (env parser guard — the class of bug that produced commit `1212856`) | fail |

### 3.3 Dependency / prerequisite checks (always)

| ID | Check | Severity |
|---|---|---|
| `PD1` | `node --version` matches `package.json#engines.node` | fail |
| `PD2` | `pnpm --version` matches `package.json#engines.pnpm` | fail |
| `PD3` | `node_modules` present and `pnpm-lock.yaml` not drifted (`pnpm install --frozen-lockfile --lockfile-only` succeeds in a dry-run sense, or `pnpm list --depth 0` resolves without errors) | fail |
| `PD4` | TypeScript project references are resolvable (`tsconfig.json` parse succeeds; referenced projects exist on disk) | fail |
| `PD5` | No lockfile conflict markers anywhere in the tree | fail |

### 3.4 Linear / issue checks (always)

| ID | Check | Severity |
|---|---|---|
| `PL1` | Linear issue `<UTV2-###>` exists | infra on 401/403/5xx, else fail |
| `PL2` | Issue has exactly one tier label (`t1` / `t2` / `t3`) and it matches `--tier` | fail |
| `PL3` | Issue state is `Ready` or `In Progress` (or `Backlog` with an explicit `--refresh` justification — see §5 waiver rules) | fail |
| `PL4` | Issue has a non-empty description (acceptance criteria surface) | fail |
| `PL5` | No other active manifest already owns this issue (one-manifest-per-issue rule — prior manifest must be `done` to start a new lane) | fail |
| `PL6` | No overlap with `file_scope_lock` of any active manifest **if** the caller passed a candidate file list via `--files` (optional early warning; lane-start is the authoritative check) | warn |

### 3.5 Required-doc / prerequisite-artifact checks (tier-gated)

Preflight accepts an expected set of documents that must exist before a lane of a given tier may start. Defaults below; `--require-doc` appends.

| ID | Check | Default requirement |
|---|---|---|
| `PR1` | `EXECUTION_TRUTH_MODEL.md` exists at `docs/05_operations/` | all tiers |
| `PR2` | `LANE_MANIFEST_SPEC.md` exists at `docs/05_operations/` | all tiers |
| `PR3` | `TRUTH_CHECK_SPEC.md` exists at `docs/05_operations/` | all tiers |
| `PR4` | Lane manifest schema exists at `docs/05_operations/schemas/lane_manifest_v1.schema.json` | all tiers |
| `PR5` | Truth-check result schema exists | all tiers |
| `PR6` | Evidence bundle schema exists at `docs/05_operations/schemas/evidence_bundle_v1.schema.json` | T1, T2 |
| `PR7` | Current active phase contract exists (e.g. `PHASE2_SCHEMA_CONTRACT.md`) when the issue is labelled against that phase | T1 |
| `PR8` | Any `--require-doc` paths | caller-driven |

`PR*` checks are mechanical existence checks. Preflight does not evaluate doc content.

### 3.6 Tier-specific additions

**T1 additions:**

| ID | Check |
|---|---|
| `PT1` | `pnpm test:db` credentials usable: `SUPABASE_SERVICE_ROLE_KEY` validates against Supabase URL via a 1-query health ping (`select 1`), 10s timeout, 1 retry |
| `PT2` | Evidence-bundle generator is resolvable: `scripts/evidence-bundle/new-bundle.mjs` exists and is executable |
| `PT3` | Active phase contract referenced by the issue is present and readable |

**T2 additions:** none beyond the shared block.

**T3 additions:** none; PR6 and PT* do not apply.

### 3.7 Baseline green check (always)

| ID | Check |
|---|---|
| `PB1` | `pnpm type-check` passes on the current HEAD |
| `PB2` | `pnpm test` passes on the current HEAD |

Rationale: if the baseline is red, any lane starting here will discover "someone else's failure" mid-flight. Starting fresh work on a red baseline is a root cause of the churn preflight exists to prevent. These checks **do not run on every preflight by default** — see §5 `--fast` policy — because they are slow.

**Default policy:**
- T1 and T2: `PB1` and `PB2` **must** run. No fast path.
- T3: `PB1` runs; `PB2` may be skipped if `--fast` is passed and `HEAD` matches the most recent successful baseline run recorded in `.out/ops/preflight/.baseline-cache.json`.

A baseline cache record has shape `{ head_sha, tests_passed_at, type_check_passed_at }`. Preflight only trusts the cache if `head_sha` matches current HEAD.

---

## 4. Tier-aware behavior summary

| Check group | T1 | T2 | T3 |
|---|:-:|:-:|:-:|
| PG1–PG9 (git) | required | required | required |
| PE1–PE5 (env) | required | required | required, PE4 skipped |
| PD1–PD5 (deps) | required | required | required |
| PL1–PL6 (Linear) | required | required | required |
| PR1–PR5 (core docs + schemas) | required | required | required |
| PR6 (evidence bundle schema) | required | required | not required |
| PR7 (active phase contract) | required | if applicable | not required |
| PT1–PT3 (T1 extras) | required | — | — |
| PB1 (type-check) | required | required | required |
| PB2 (test) | required | required | optional (`--fast` with cache) |

Waivers are never permitted on T1 checks. `--skip` on a T1 check exits `1`.

---

## 5. Failure vocabulary

Every check result carries exactly one of:

- `pass` — check ran and the assertion held
- `fail` — check ran and the assertion did not hold
- `skip` — check was intentionally not run (tier-gated or waived via `--skip`)
- `waived` — check was waived via `--skip <id>`; only permitted for a fixed set on T3
- `infra_error` — check could not be run because the tool, credential, or repo state prevented execution (e.g. git not installed)

Top-level verdicts:

- `PASS` — zero `fail`, zero `infra_error`; `skip`/`waived` allowed per tier rules; token is written
- `FAIL` — one or more `fail` results; token is not written and any stale token for the same branch is removed
- `INFRA` — one or more `infra_error` results; token is not written, stale token not touched
- `NOT_APPLICABLE` — Linear issue is not in a startable state or tier label is missing; token is not written

**Waivable checks (T3 only):** `PB2`, `PG3`, `PL4`, `PR7`. Waivers require `--skip <id> --waiver-reason "<text>"`. Each waiver is recorded in the token under `waivers[]` with reason + timestamp, visible to `lane-start` and appearing in the daily digest. Waivers do not suppress check execution — they downgrade a `fail` to `waived` and the check detail remains in the output.

**Nothing is waivable on T1.** T2 may waive only `PL4`.

Forbidden verdict phrasing in human output: "probably fine," "should be green," "looks ok." Pass or fail — no middle.

---

## 6. Token generation rules

On `PASS`, preflight writes exactly one token file. The token is the contract that `lane-start` reads via `validatePreflightToken()`.

### 6.1 Token path

```
<repo_root>/.out/ops/preflight/<branch>.json
```

Where `<branch>` is used literally, so `codex/utv2-539-foo` resolves to `.out/ops/preflight/codex/utv2-539-foo.json`. This matches `preflightTokenPathForBranch()` in `shared.ts` and is the authoritative location.

Directory is created if missing. Must honor `.gitignore` entry `.out/ops/preflight/`.

### 6.2 Token shape (schema_version 1)

```json
{
  "schema_version": 1,
  "branch": "codex/utv2-539-truth-check",
  "head_sha": "abc123...",
  "tier": "T2",
  "issue_id": "UTV2-539",
  "generated_at": "2026-04-11T18:30:00Z",
  "expires_at": "2026-04-11T19:00:00Z",
  "checks": {
    "git": "pass",
    "env": "pass",
    "deps": "pass"
  },
  "status": "pass"
}
```

**Field rules:**

- `schema_version`: must be `1`. Unknown versions are rejected by `validatePreflightToken()`.
- `branch`: lane target branch; must match the file path slug and the `--branch` argument.
- `head_sha`: full SHA of `HEAD` at the moment of generation. Token becomes invalid if HEAD moves.
- `tier`: the tier the lane will run under; must match Linear label and `--tier` argument.
- `issue_id`: the Linear issue id; uppercase `UTV2-###`.
- `generated_at`: ISO-8601 UTC, moment of write.
- `expires_at`: ISO-8601 UTC, `generated_at + TTL` (see §7).
- `checks`: condensed rollup — one of `pass` / `fail` / `skip` per group (`git` | `env` | `deps`). This matches the existing `PreflightToken.checks` shape in `shared.ts`. Group-level detail is for humans; the full check list is persisted separately (see §6.4).
- `status`: must be exactly `pass` when the token is written. Any other value is a programming error; `lane-start` rejects anything else.

### 6.3 Additive fields (optional, non-breaking)

The following fields are permitted additions; `validatePreflightToken()` ignores unknown fields today but may enforce them in a future schema version:

- `waivers`: array of `{ check_id, reason, waived_at }`
- `baseline_cache_hit`: bool — true if `PB2` was satisfied from cache
- `preflight_run_id`: uuid for correlation across logs
- `required_docs_checked`: array of paths verified for PR* checks

Additions must not change the required-field contract above.

### 6.4 Full result sidecar

In addition to the token, preflight writes a detailed result sidecar at:

```
<repo_root>/.out/ops/preflight/<branch>.result.json
```

Sidecar shape:

```json
{
  "schema_version": 1,
  "issue_id": "UTV2-539",
  "tier": "T2",
  "branch": "codex/utv2-539-truth-check",
  "head_sha": "abc123...",
  "verdict": "PASS",
  "run_at": "2026-04-11T18:30:00Z",
  "checks": [
    { "id": "PG1", "status": "pass", "detail": "..." },
    { "id": "PG3", "status": "fail", "detail": "local main is 2 commits behind origin/main" }
  ],
  "waivers": [],
  "token_path": ".out/ops/preflight/codex/utv2-539-truth-check.json"
}
```

The sidecar is always written — on pass, fail, or infra — so the most recent run can be inspected. The **token** is only written on pass.

---

## 7. Token TTL

- Default TTL: **30 minutes** from `generated_at`.
- T1 TTL: **15 minutes** (stricter — T1 lanes must be started promptly after preflight to reduce the window for HEAD or env drift).
- TTL is not configurable by CLI flag in Phase 1. If preflight expires, rerun — do not extend.

Rationale: TTLs are not about wall-clock time alone; they are about bounding the window in which a preflight result can be trusted. A token older than its TTL has non-trivial probability of being stale relative to the repo or the env, so `lane-start` refuses it unconditionally.

---

## 8. Token invalidation rules

A token is **invalid** (and `lane-start` must refuse it) if any of the following is true. This mirrors `validatePreflightToken()` in `shared.ts`:

1. Token file does not exist at the expected path.
2. `schema_version !== 1`.
3. `status !== 'pass'`.
4. `issue_id` does not match the issue `lane-start` is being invoked for.
5. `branch` does not match the `--branch` argument.
6. `head_sha` does not match the current HEAD at the moment of lane-start.
7. `expires_at` is unparseable or has passed.

Additionally, **preflight itself** must delete any stale token for the same branch when it encounters one during a `FAIL` or `INFRA` run, unless `--dry-run` is set. This prevents a previous-pass token from being resurrected by a subsequent failing run.

**Preflight does not invalidate tokens for other branches.** One token per branch, owned by that branch.

---

## 9. Branch / issue / HEAD binding

A preflight token binds three identifiers together:

- `issue_id` — the Linear issue the lane will serve
- `branch` — the local/remote branch the lane will use
- `head_sha` — the SHA the local clone is at when the token was issued

All three must match at lane-start or the token is refused. This is the mechanical guarantee against:

- Starting a lane for the wrong issue because `UTV2-###` was typed wrong in lane-start
- Starting a lane on the wrong branch because the agent switched branches after preflight
- Starting a lane after a pull that moved HEAD, such that the checks no longer reflect current state

The binding is asymmetric: **preflight writes it; lane-start enforces it.** Neither side trusts the other beyond the field values.

---

## 10. Pass / fail behavior

**On PASS (exit 0):**
- Sidecar written to `<branch>.result.json`.
- Token written to `<branch>.json`.
- JSON result emitted to stdout if `--json`.
- Human-readable summary to stdout otherwise.

**On FAIL (exit 1):**
- Sidecar written.
- Token **not** written. Any existing token at `<branch>.json` is deleted.
- JSON result emitted with `verdict: "FAIL"`.
- Human-readable output enumerates every failing check ID and its `detail`. No soft language.

**On NOT_APPLICABLE (exit 2):**
- Sidecar written with `verdict: "NOT_APPLICABLE"`.
- Token not written. Existing token untouched (the lane may still be resumable; leave state alone).

**On INFRA (exit 3):**
- Sidecar written if possible.
- Token not written. Existing token untouched.
- Human output names the infra failure (missing git, unreadable env file, denied write to `.out/ops/preflight/`, etc.).

Preflight is **idempotent on PASS**: rerunning with unchanged inputs overwrites the token with a refreshed `generated_at` / `expires_at` only if `--refresh` is passed, otherwise refuses. The default (refuse) prevents silent TTL extension.

---

## 11. Machine-readable output

When `--json` is set, stdout is **exactly one** JSON object matching the sidecar shape (§6.4). No other stdout output is permitted. Human-readable text, check-by-check explanations, and progress indicators all go to stderr.

Exit code and `verdict` must always agree — this is a unit-testable invariant:

| verdict | exit_code |
|---|---|
| `PASS` | `0` |
| `FAIL` | `1` |
| `NOT_APPLICABLE` | `2` |
| `INFRA` | `3` |

Check IDs are stable. Additions append. Never renumber.

Output schema (target): `docs/05_operations/schemas/preflight_result_v1.schema.json`. The token schema (target): `docs/05_operations/schemas/preflight_token_v1.schema.json`. Both to be authored alongside implementation; the existing `PreflightToken` interface in `shared.ts` is the contract the token schema must preserve exactly.

---

## 12. What `lane-start` must trust from preflight

`lane-start` already enforces the following via `validatePreflightToken()` and must continue to. This section pins the contract.

`lane-start` trusts that, **if a valid token exists at the declared path:**

- At `generated_at`, the git tree was clean and on the declared `head_sha`.
- At `generated_at`, the environment had the required credentials for the declared tier.
- At `generated_at`, Linear believed the issue existed, was at the declared tier, and was in a startable state.
- At `generated_at`, required docs/schemas for the tier existed.
- At `generated_at`, the baseline was green per tier policy.
- The token has not expired.
- `HEAD` has not moved since generation.

`lane-start` does **not** re-run any of these checks. The token is the attestation.

`lane-start` **does** enforce:

- File-scope lock overlap (against active manifests)
- Worktree creation / resume logic
- Manifest uniqueness per issue
- Branch name validation

These are lane-start's responsibility because they concern cross-lane state that preflight cannot see at time-of-run.

---

## 13. What preflight does NOT guarantee

Preflight is a local snapshot. It is silent on:

- Remote CI health at PR time (`ops:ci-doctor` owns this)
- GitHub branch protection configuration
- Secrets stored in GitHub Actions vs local env
- Supabase preview-branch workflow health
- Remote lockfile conflicts introduced after preflight
- Codex return scope bleed (`codex:receive` owns this)
- Whether the Linear issue will stay in a startable state (it may be changed in the 30-minute TTL window)
- Whether the baseline will stay green after another commit lands on `main`
- Runtime proof for T1 (that lives in `ops:truth-check`)

Preflight is a **necessary** condition for starting a lane, not a **sufficient** one for finishing one. Do not treat a green preflight as permission to skip verification at close time.

---

## 14. Local-only vs CI-overlapping responsibilities

| Concern | Owner |
|---|---|
| Local git / worktree / branch state | **Preflight** |
| Local env file parseability and required credentials | **Preflight** |
| Local dep resolution (`pnpm`, `node_modules`, lockfile) | **Preflight** |
| Required docs/schemas present on disk | **Preflight** |
| Local baseline (`type-check`, `test`) green | **Preflight** |
| Linear issue state snapshot | **Preflight** (authoritative at generation time only) |
| GitHub branch protection rules | **`ops:ci-doctor`** (not preflight) |
| GitHub required-checks configuration | **`ops:ci-doctor`** |
| Secret rotation / CI secret presence | **`ops:ci-doctor`** |
| Supabase preview-branch workflow path | **`ops:ci-doctor`** |
| Scheduled CI self-test | **`ops:ci-doctor`** |
| File-scope overlap across active lanes | **`ops:lane-start`** |
| Manifest schema validation | **`ops:lane-manifest` / `ops:lane-close`** |
| Merge-time done-gate | **`ops:truth-check`** |

Preflight does not call GitHub. Preflight does not evaluate CI. If a check would require remote infra access beyond Linear and Supabase health-ping, it belongs in `ops:ci-doctor` instead.

---

## 15. When preflight must be rerun

Preflight must be rerun when any of the following is true, even if the existing token has not yet expired:

1. `HEAD` has moved (any commit, pull, rebase, reset).
2. The working tree has gained or lost uncommitted changes since generation.
3. `local.env` has been modified.
4. `node_modules` has been reinstalled or `pnpm-lock.yaml` has changed.
5. The target branch name has changed.
6. The Linear issue's tier label has changed.
7. The existing token has been deleted, moved, or edited.
8. The existing token's TTL has elapsed.
9. An `ops:*` command or the agent explicitly invalidated the token.

Rerun is cheap for T3 (cache-eligible) and moderately expensive for T1/T2 (baseline runs). Agents should not "save time" by reusing stale tokens — doing so reintroduces the entire failure class preflight exists to prevent.

---

## 16. Non-goals

- Preflight is not a fix-it tool. It reports. It does not `git pull`, `pnpm install`, or regenerate env files.
- Preflight is not a PM gate. It does not check GitHub labels, PR state, or reviewer assignment.
- Preflight is not a CI doctor. It does not validate remote CI, secrets, or workflow files.
- Preflight is not a lane-start. It does not create manifests, worktrees, or file locks.
- Preflight does not consult agent memory or session context.
- Preflight does not parse or judge doc content — existence-only for PR* checks.

---

## 17. Implementation notes (non-binding, helpful)

- **Reuse `shared.ts` primitives.** `getRepoRoot`, `git`, `currentHeadSha`, `preflightTokenPathForBranch`, `validateBranchName`, `validateTier`, `writeJsonFile`, `ensureDir`, `relativeToRoot` already exist and are the canonical helpers.
- **Preserve the `PreflightToken` interface shape exactly.** `lane-start` already reads it via `validatePreflightToken`. Do not add required fields without a `schema_version` bump.
- **One run must execute all checks.** Do not short-circuit on first failure — the point of the control is to surface every blocker in one pass. Short-circuit only on `PG1` (no repo) and `PE1` (no env file) where subsequent checks cannot run meaningfully.
- **Linear and Supabase calls must use 10s timeout with 1 retry**, matching `truth-check-lib.ts`. Failures become `infra_error`, not `fail`.
- **Baseline cache** lives at `.out/ops/preflight/.baseline-cache.json`. Schema: `{ head_sha, type_check_passed_at, tests_passed_at }`. Cache is trusted only when `head_sha` matches current `HEAD`. Never trust cache across HEAD changes.
- **Token deletion on FAIL must be atomic.** Use `fs.rmSync(path, { force: true })` inside a try/catch that logs but does not throw — token deletion failure is not itself a preflight failure.
- **Every check must have a unit test fixture** for pass and fail. Check IDs are the test contract.
- **Integration test:** run `ops:preflight` on a clean repo for a real T3 issue, assert exit 0 and token file present with correct fields. Then corrupt `local.env` and assert exit 1 and token deleted.
- **No side effects outside `.out/ops/preflight/`** except log writes to stderr and network reads for Linear/Supabase.
- **Do not call `ops:lane-start` from `ops:preflight` automatically.** They are separate commands. The agent or script orchestrating a lane start calls them in sequence.
- **Deterministic check order.** Same order every run. Test fixtures depend on stable order.
- **`--json` output is the integration contract.** All other output is informational. Agents and CI must read JSON, not scrape stderr.
