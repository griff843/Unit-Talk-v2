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
| `pnpm exec tsx --test scripts/ops/truth-check-lib.test.ts` | PASS | 94 tests, 94 pass, 0 fail (90 pre-existing + 4 new) |
| `pnpm verify` — `env:check`, `lint`, `type-check`, `build`, `test` | PASS | 4770 tests, 4770 pass, 0 fail; 0 TypeScript errors; 0 ESLint problems |
| `pnpm verify` — `test:live-db` | REFUSED (non-staging target) | `[assert-staging] REFUSED: target identity could not be resolved from its URL (host=127.0.0.1). Writable DB verification requires xskgrzbteyqdufktjrjx.` |

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

The file was then restored and the suite reconfirmed at 94/94. A control that has
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
