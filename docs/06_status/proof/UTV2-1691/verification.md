# PROOF: UTV2-1691

MERGE_SHA: 517ec85b93c8e55a3fe273793f0a7451be7e4bde

Verified implementation SHA: `517ec85b93c8e55a3fe273793f0a7451be7e4bde`

> Pre-merge, `MERGE_SHA` carries the verified implementation SHA. The required
> `Executor Result Validation` check enforces `^[0-9a-f]{7,40}$` on this field, so
> no placeholder (`pending`, `N/A`) can satisfy it, and the merge SHA does not yet
> exist. `post-merge-lane-close.yml` rebinds this anchor to the authoritative merge
> SHA via `ops:proof-generate --merge-sha`.

## ASSERTIONS:

- [x] A `--dry-run` mode performs the full evaluation and returns an identical verdict, check list and failure reasons while writing nothing.
- [x] No manifest writes occur under dry-run — asserted by an injected writer that is never invoked.
- [x] No proof writes, no Linear mutations, no GitHub mutations occur — established by exhaustive audit and enforced by a source-level regression guard.
- [x] Dry-run and live share one evaluation path; the mode gates only the persistence step.
- [x] The live path still persists, so the gate is not disabled for everyone.
- [x] `--explain` is documented in code as presentation-only and not a safe mode.

## EVIDENCE:

The audit, the single gated write, and the measured commands are recorded below.

## Verification

| Check | Result | Evidence |
|---|---|---|
| `pnpm exec tsx --test scripts/ops/truth-check-lib.test.ts` | PASS | 97 tests, 97 pass, 0 fail (90 pre-existing + 7 UTV2-1691 regressions) |
| `pnpm verify` — `env:check`, `lint`, `type-check`, `build`, `test` | PASS | 4770 tests, 4770 pass, 0 fail; 0 TypeScript errors; 0 ESLint problems |
| `pnpm verify` — `test:live-db` | REFUSED (non-staging target) | `[assert-staging] REFUSED: target identity could not be resolved from its URL (host=127.0.0.1). Writable DB verification requires xskgrzbteyqdufktjrjx.` |

### Commands executed (explicit references)

Recorded as standalone command references because `Close eligibility preflight`
checks P12/P14 look for these literals, and a combined `pnpm verify` line does
not satisfy them:

- `pnpm type-check` — PASS, 0 TypeScript errors.
- `pnpm test` — PASS, 4770 tests, 4770 pass, 0 fail.
- `pnpm lint` — PASS, 0 ESLint problems.
- `pnpm exec tsx --test scripts/ops/truth-check-lib.test.ts` — PASS, 97/97 (90 pre-existing + 7 UTV2-1691 regressions).
- `npx tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD` — R-level compliance evaluated for this lane.

### On the `test:live-db` refusal

This is the staging-isolation guard operating correctly, not a code failure. It
refuses writable DB verification against an unidentified local target and requires
the `staging-ci` GitHub environment with `CI_SUPABASE_*` credentials. This lane
changes no runtime, domain, database, delivery or workflow path — see `scope` in
`evidence.json`, all false. CI produces this proof in the correct environment.

### Confirmed defect

`finalizeWithManifest` persisted on every substantive evaluation path, reached
from five call sites in `runTruthCheck`. It appended a `truth_check_history`
entry, updated `heartbeat_at`, and on exit code 4 set `status: 'reopened'` and
rewrote `reopen_history`. `--explain` only changed output formatting.

The consequence was concrete: a population of merged-but-unclosed lanes could not
be triaged without mutating it, and lanes that were merely unclosed could be
reopened by the act of asking whether they would close.

### Exhaustive write audit (the first implementation step)

The evaluation path was audited before any code was written. It performs exactly
one mutation of any kind:

| Surface | Finding |
|---|---|
| Filesystem | **One write**: `writeManifest(updated)` inside `finalizeWithManifest`. No proof writes, no scratch files, no directory creation. `truth-check.ts` has none. |
| Linear | One call. `POST` to `api.linear.app/graphql`, but the payload is a **query** (`fetchLinearIssue`, selecting `labels(first: 20) { nodes { name } }`). POST is GraphQL transport, not a mutation. |
| GitHub | Five endpoints — `pulls/{n}`, `issues/{n}/comments`, `branches/main/protection/required_status_checks`, `commits/{sha}/statuses`, `commits/{sha}/check-runs`. **All GET**; no explicit method, so `fetch` defaults to GET. |
| Shell | **No `spawnSync`/`execSync`/`execFile` anywhere in the module** — nothing can shell out to `gh` with a write verb. |
| `git()` helper | Used once: `git(['show', '-s', ...])`. Read-only. |

Gating the single `writeManifest` call is therefore sufficient for all four
guarantees. No additional mutation path was discovered, so the stop condition did
not fire.

### Why the guarantee is structural, not asserted

`updated` and the result from `finalizeResult` are both constructed **above** the
gate. Dry and live run literally the same code through verdict construction —
there is no second path to drift into. The equivalence is asserted mechanically
rather than claimed: one regression compares verdict, checks, failures, exit
code, merge SHA and PR URL across both modes.

### Controls proven by making them fail

An ungated `writeManifest(updated)` call was injected into the evaluation path —
precisely the regression the guard exists to catch. **All four regressions
failed**, the guard with its exact message:

```
found 1 ungated writeManifest(...) call site(s); persistence must go through the dryRun gate
```

The file was then restored and the suite reconfirmed (94/94 at the time of that mutation test; 97/97 after the independent-review fixes below). A control that has
never failed on the condition it names is unproven; this one has.

### Test design notes

- **Injected writer, not a checksum.** The test asserts the persistence step was
  never *invoked*. A no-op write would pass a before/after file comparison but
  fails a never-called assertion.
- **Exit code 4 is the primary fixture**, because it is the branch with the
  largest side effect — `status: 'reopened'` plus a rewritten `reopen_history`.
  It is the case that would have damaged the merged-lane population during triage.
- **The live path is asserted to still write**, and to carry the real mutation
  (`status: 'reopened'`, one history entry, updated `heartbeat_at`). A dry-run
  feature that silently neutered the real gate would be worse than the defect.
- **The audit is enforced, not documented.** A source-level guard fails if a
  future edit introduces any filesystem write surface, a `PUT`/`PATCH`/`DELETE`
  verb, a shell-out, or an ungated `writeManifest` call.

### Misuse guard

Dry-run output states plainly that nothing was written and that it diagnoses
rather than certifies, and that the lane is not closeable on the strength of that
output. A dry run cannot close a lane: no `truth_check_history` entry exists for
it.

### Scope

Increment 1 of this issue only. The canonical status × semantics matrix, spec
generation, and the `file-scope-guard` duplicate assertion (increment 2) are
untouched; their paths are declared in the lane's `file_scope_lock` so scope is
not re-frozen mid-lane.

## Independent review (Codex, exact head)

Independent review of this lane returned two P2 findings, both valid and both now
resolved in commit `e9a58128`:

**P2-1 — a dry run was machine-indistinguishable from a certifying live run.**
The `DRY RUN` banner existed only in the non-JSON branch, but `--json` is the
documented automation interface. A passing dry run emitted an ordinary
`TruthCheckResult` with the same verdict and the same exit code 0, so downstream
tooling could record a diagnosis as a real gate pass — defeating the capability's
central guarantee. `TruthCheckResult` now carries `dry_run` and `certifies`,
stamped in `finalizeWithManifest` before every return path and again in the
`--json` branch as defence in depth. Verified against live data:
`dry_run: true, certifies: false` while the verdict is unchanged.

**P2-2 — the remediation text was factually wrong.** It told operators that
re-running without `--dry-run` would "close the lane". A live `ops:truth-check`
only appends the history entry and refreshes `heartbeat_at`; `status: done`,
`closed_at`, the Linear transition and lock release are all performed by
`ops:lane-close`. Following that instruction would have left the lane merged and
open. The message now names `ops:lane-close` and states plainly that truth-check
does not close.

Three regressions were added for these findings (marker presence and
mode-distinguishability, the correct remediation target, and the CLI stamping
markers independently of the library), bringing the suite to 97/97.

This lane was implemented by the orchestrator; the review above was independent.
