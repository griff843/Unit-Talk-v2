# VERIFICATION: UTV2-1844

MERGE_SHA: pending merge
Execution SHA: 825bb865996f310be9351e3790a6f0b388e85b42

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

## EVIDENCE:

| Assertion | Evidence |
|---|---|
| A1 | `apps/smart-form/components/SignedNumberInput.tsx` in this diff; `apps/smart-form/test/control-plane-boundary.test.ts` renders the component and asserts `type="text"`, `inputmode="text"`, the exact `pattern`, and `doesNotMatch(/inputmode="(?:numeric\|decimal)"/)` — the last is the inversion, so a regression to a numeric keypad fails rather than passing silently |
| A2 | `control-plane-boundary.test.ts` — "a signed decimal stays enterable one keystroke at a time" and "a signed field preserves a leading minus that Number() would erase" |
| A3 | `control-plane-boundary.test.ts` — "a fully typed signed number is handed on as a number, not a string" |
| A4 | `control-plane-boundary.test.ts` — "a signed field clears on empty and rejects input that is not a number", over `abc`, `-1-2`, `1.2.3`, `--5` |
| A5, A6, A7 | `apps/smart-form/lib/form-utils.ts` in this diff — `SmartFormIdentityMode`, the `canonical-requires-event` branch, and the two reworded descriptions; `apps/smart-form/app/submit/components/BetForm.tsx` threads the mode through every selector |
| A8 | `git diff origin/main...HEAD \| grep -E "trackOnly\|distributionMode"` returns nothing |
| A9 | the mutation table below |

### Commands run

Taken against `825bb865996f310be9351e3790a6f0b388e85b42`, the tree this bundle describes.

```
pnpm lint                              # exit 0
pnpm type-check                        # exit 0
pnpm test                              # exit 0 — tests 5970, pass 5970, fail 0
npx tsx scripts/ci/r-level-check.ts --issue UTV2-1844
                                       # Verdict: PASS · Changed files: 13 · Rules matched: operator-ui
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
| Verified source SHA: | 825bb865996f310be9351e3790a6f0b388e85b42 |

PR: https://github.com/griff843/Unit-Talk-v2/pull/1523
Merge SHA: pending merge
Verified source SHA: 825bb865996f310be9351e3790a6f0b388e85b42

`825bb865996f310be9351e3790a6f0b388e85b42` is the last commit on this branch that changes any file
outside `docs/06_status/proof/UTV2-1844/`, and it is the tree the commands above were run against.

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
