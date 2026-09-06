# PROOF: UTV2-1844 — signed odds and line entry, and a three-valued participant identity mode

MERGE_SHA: pending merge
Execution SHA: 55b0f7c852ff42405c0e02cd461058103ffdbb8a

## ASSERTIONS:

- [x] **A1 —** Signed fields render as a text input with a signed `pattern` and `inputMode="text"`,
      never `numeric` or `decimal`. Mobile numeric and decimal keypads commonly omit the minus key,
      so the contract's own negative ranges were unenterable on a phone.
- [x] **A2 —** A signed decimal survives being typed one character at a time. `-3.5` reaches `-3.5`
      through the intermediate states `-`, `-3`, `-3.`, and a leading minus survives `-0` on the way
      to `-0.5`.
- [x] **A3 —** A fully typed value is still handed on as a `number`, not a string. Preserving
      intermediate states does not change the shape of ordinary values.
- [x] **A4 —** Input that is not a number is rejected rather than coerced: the field is left
      unchanged.
- [x] **A5 —** Participant identity is three-valued (`canonical` / `structured-fallback` /
      `manual`), replacing a `manualOverride` boolean that could not distinguish canonical
      resolution from a database-backed structured fallback from an honest manual coverage gap.
- [x] **A6 —** Canonical mode requires a selected matchup. Submitting in canonical mode with no
      event now fails with `canonical-requires-event` instead of proceeding.
- [x] **A7 —** The two fallback guard messages name the verified coverage-gap path rather than a
      "manual participant override".
- [x] **A8 —** Containment is untouched: no `trackOnly` and no `distributionMode` change anywhere
      in this diff.
- [x] **A9 —** The keystroke fix is mutation-proven — reverting it turns two tests red, named below.

## Verification

How each assertion above was established, so the evidence table below is read as measurement rather
than as description.

- **Executed, not inspected.** Every claim about behaviour comes from a test that was run on this
  branch at `55b0f7c852ff42405c0e02cd461058103ffdbb8a`. The commands and their exact counts are in
  "Commands run"; `pnpm test` reports `tests 5970, pass 5970, fail 0`.
- **The keystroke repair was proven by inversion.** Reverting `nextSignedInputValue` to coerce every
  keystroke turns exactly two named tests red, and leaves the complete-value test green. Both halves
  matter: the mutation table records the failure, and A3 records what must *not* break while fixing
  it.
- **The mobile-keypad assertion carries its own inversion.** The rendering test asserts the positive
  attributes and additionally `doesNotMatch(/inputmode="(?:numeric|decimal)"/)`, so a silent
  regression to a keypad without a minus key fails rather than passing unnoticed.
- **Containment was checked by diff, not by recollection — and the command had to be corrected.**
  The receipt originally read `git diff origin/main...HEAD | grep -E "trackOnly|distributionMode"`
  returns nothing. That was true when written and is no longer reproducible: this bundle now
  *describes* those two identifiers, so the grep matches its own text — four hits, all of them lines
  of `docs/06_status/proof/UTV2-1844/verification.md` and `evidence.json` inside the diff. The
  substantive claim is unchanged and was re-measured with the proof bundle excluded:

  ```
  git diff origin/main...HEAD -- . ':(exclude)docs/06_status/proof/**' ':(exclude).ops/sync/**' \
    | grep -E "trackOnly|distributionMode"
  # exit 1 — no matches
  ```

  Over the ten changed non-proof files, no `trackOnly` and no `distributionMode` occurrence is added,
  removed or modified, so this lane changes no delivery or distribution behaviour.
- **What is not verified here is stated, not omitted.** `pnpm verify` refused locally under
  containment at `test:live-db`; the binding receipt is the required `verify` check on this head, and
  the end-to-end browser flow is explicitly disclaimed in "What this lane does not claim".

## EVIDENCE:

| Assertion | Evidence |
|---|---|
| A1 | `apps/smart-form/components/SignedNumberInput.tsx` in this diff; `apps/smart-form/test/control-plane-boundary.test.ts` renders the component and asserts `type="text"`, `inputmode="text"`, the exact `pattern`, and `doesNotMatch(/inputmode="(?:numeric\|decimal)"/)` — the last is the inversion, so a regression to a numeric keypad fails rather than passing silently |
| A2 | `control-plane-boundary.test.ts` — "a signed decimal stays enterable one keystroke at a time" and "a signed field preserves a leading minus that Number() would erase" |
| A3 | `control-plane-boundary.test.ts` — "a fully typed signed number is handed on as a number, not a string" |
| A4 | `control-plane-boundary.test.ts` — "a signed field clears on empty and rejects input that is not a number", over `abc`, `-1-2`, `1.2.3`, `--5` |
| A5, A6, A7 | `apps/smart-form/lib/form-utils.ts` in this diff — `SmartFormIdentityMode`, the `canonical-requires-event` branch, and the two reworded descriptions; `apps/smart-form/app/submit/components/BetForm.tsx` threads the mode through every selector |
| A8 | `git diff origin/main...HEAD -- . ':(exclude)docs/06_status/proof/**' ':(exclude).ops/sync/**' \| grep -E "trackOnly\|distributionMode"` exits 1 with no matches (see the note above on why the unscoped form is self-matching) |
| A9 | the mutation table below |

### Commands run

Taken against `55b0f7c852ff42405c0e02cd461058103ffdbb8a`, the tree this bundle describes.

```
pnpm lint                              # exit 0
pnpm type-check                        # exit 0
pnpm test                              # exit 0 — tests 5970, pass 5970, fail 0
npx tsx scripts/ci/r-level-check.ts --issue UTV2-1844
                                       # Verdict: PASS · Changed files: 16 · Rules matched: operator-ui
pnpm verify                            # refused locally at test:live-db under containment; the
                                       #   binding receipt is the required `verify` check on this head
```

### Mutation evidence

A control is only proven by making it fail on the condition it names. The mutation was executed on
this branch and reverted.

| Mutation | Command | Result |
|---|---|---|
| `nextSignedInputValue` returns `parsed` unconditionally instead of comparing the round-trip — i.e. coerces every keystroke, which is the behaviour this lane found and repaired | `pnpm exec tsx --test apps/smart-form/test/control-plane-boundary.test.ts` | `# pass 7 / # fail 2` — "a signed decimal stays enterable one keystroke at a time" and "a signed field preserves a leading minus that Number() would erase" |

The two tests that stay green under that mutation are the point of A3: coercion is correct for a
*complete* value, and the repair must not break that while fixing the partial case.

### Diff scope

```
 apps/smart-form/app/submit/components/BetForm.tsx  | 565 ++++++++++++++-------
 apps/smart-form/components/SignedNumberInput.tsx   |  70 +++
 apps/smart-form/e2e/phase-one.spec.ts              | 126 ++++-
 apps/smart-form/e2e/real-reference.spec.ts         |   7 +-
 apps/smart-form/e2e/smart-form-submission.spec.ts  |   2 +-
 apps/smart-form/lib/form-utils.ts                  |  23 +-
 apps/smart-form/test/api-client.test.ts            |  16 +-
 .../smart-form/test/control-plane-boundary.test.ts |  70 +++
 apps/smart-form/test/form-utils.test.ts            | 125 +++++
 9 files changed, 794 insertions(+), 210 deletions(-)
```

Measured with `git diff --stat origin/main...HEAD` excluding this lane's own manifest, sync file and
proof directory. Every path is inside the declared `file_scope_lock`. No `.github/workflows/**` file,
no `package.json`, no migration, no schema, no API or worker source.

## Merge SHA Binding

| Field | Value |
|---|---|
| PR: | https://github.com/griff843/Unit-Talk-v2/pull/1523 |
| MERGE_SHA: | pending merge |
| Verified source SHA: | 55b0f7c852ff42405c0e02cd461058103ffdbb8a |

PR: https://github.com/griff843/Unit-Talk-v2/pull/1523
Merge SHA: pending merge
Verified source SHA: 55b0f7c852ff42405c0e02cd461058103ffdbb8a

`55b0f7c852ff42405c0e02cd461058103ffdbb8a` is the last commit on this branch that changes any file
outside `docs/06_status/proof/UTV2-1844/`, and it is the tree the commands above were run against.

**Why the anchor moved.** It was `825bb865996f310be9351e3790a6f0b388e85b42` until this branch was
resynced onto `origin/main` to satisfy strict branch-protection freshness rather than merge while
`BEHIND`. Rule 4 of `scripts/ci/proof-binding-validator.ts` is a two-dot
`git diff verified_source_sha..HEAD` (`:129-135`, `:267`), so the resync's own content —
`docs/06_status/readiness/readiness-score.json`, which is not one of `PROOF_ONLY_PREFIXES` — enters
that diff and the previous anchor could not be kept by rewording. **Every receipt above was
re-executed at `55b0f7c85`**, not carried forward.

Two receipts changed and both are recorded rather than smoothed over. `r-level-check` now reports
**Changed files: 16** where the previous anchor reported 13; the three extra files are the readiness
ledger the resync carried in and this bundle's own two files. And the A8 containment command was
rewritten, because the previous form had become self-matching — see the Verification section above.

## How this lane was executed

Routed to Codex under `codex-sol-high`; the routing evidence is
`docs/06_status/proof/UTV2-1844/model-routing.json`. The Codex run went silent during its own
`pnpm verify` — `EXECUTION_SILENT`, no heartbeat for 763s against a 600s window, with the work
uncommitted in the worktree and progress checkpointed at phase `verify`. The orchestrator took the
work forward from that state rather than re-dispatching.

Reviewing it before committing found one defect, which is the keystroke coercion recorded above. It
is worth stating plainly because it is not a style objection: the returned code made a `-3.5` spread
unenterable one character at a time on the very device this lane exists to support, and the returned
tests could not see it, because they asserted the rendered markup rather than what happens after a
keystroke. That is why the repair extracted `nextSignedInputValue` — a component whose logic is only
reachable through a DOM event cannot be asserted about, and the missing assertion was exactly where
the defect was.

## What this lane does not claim

- It does **not** claim the combined browser → API → persisted-pick flow works. The four
  `apps/smart-form/e2e/` specs are run by no CI workflow, so no green check on this PR is evidence
  about them. That verification is a separate step before release and it needs the backend admission
  half as well as this one.
- It does **not** claim stale-event handling, canonical team fallback or honest missing-coverage
  provenance are proven end to end. This diff makes the *form* distinguish the three identity modes;
  whether the server accepts and persists them truthfully is the backend half and is not verified
  here.
- It does **not** claim Track Only non-delivery is re-proven. Those guards are unchanged, already
  mutation-tested, and already deployed; this diff touches none of them.
