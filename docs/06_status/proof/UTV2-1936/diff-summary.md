# PROOF: UTV2-1936 Diff Summary

MERGE_SHA: 8731e7e9b11fc2227d908ff2ceb3ae0a8a95d20e

Generated at: 2026-09-18T19:05:00.000Z
Issue: UTV2-1936
Tier: T2
Lane type: delivery-ui
Branch: claude/utv2-1936-command-center-fixture-guard
PR URL: https://github.com/griff843/Unit-Talk-v2/pull/1610
Head SHA: a27ac381f65d6a31afbe38ad2cec30452c450ab1
Execution SHA: a27ac381f65d6a31afbe38ad2cec30452c450ab1
Diff base: 27bddb3cedea5d56a44dac507eb14c26e6f0c458
result: pass

## Git Diff Stat

```
 apps/command-center/src/lib/data/client.test.ts | 2 +-
 apps/command-center/src/lib/data/client.ts      | 6 +++++-
 2 files changed, 6 insertions(+), 2 deletions(-)
```

Control-plane files added by `ops:lane-start` (`.ops/sync/UTV2-1936.yml`,
`docs/06_status/lanes/UTV2-1936.json`) and this proof bundle are excluded from the figure above.
`file_scope_lock` is `apps/command-center/**` and nothing else, because
`deriveDeliveryUiApp()` fails closed on any scope entry outside a canonical app root; the
pre-merge guard grants a lane its own artifacts unconditionally.

## Why this lane exists

`isTestFixturePick` guards every operator-facing Command Center surface against fixture and proof
rows. It tested `testRun` for equality with the boolean `true`:

```ts
metadata['testRun'] === true ||        // apps/command-center/src/lib/data/client.ts:95
```

**No writer has ever produced that shape.** Every one of the 60,206 production rows carrying the
key stores it as the run-identifier string. Measured in production 2026-09-18:

| `jsonb_typeof(metadata->'testRun')` | rows |
|---|---|
| `string` | 60,206 |
| `boolean` | **0** |

The clause has therefore never matched a single row since it was written. Its four siblings —
`proof_issue`, `proof_fixture_id`, `proof_script`, `test_key` — are all presence-checked
(`!= null`) and work correctly. `testRun` is the one written as an equality test, and it is the
one that fails. That inconsistency is the entire defect.

## What the leak costs, measured live

Read-only, zero rows written, production `zfzdnfwdarxucxtaojxm`, 2026-09-18.

Repo-wide over `picks` (107,865 rows):

| | before | after |
|---|---|---|
| detected as fixture | 19,365 | **79,571** |
| recovered solely by this clause | — | 60,206 |

In the operator approval scope — `picks_current_state` where
`status = 'awaiting_approval' OR approval_status = 'pending'`, the population the review queue and
`/held` read, 21,871 rows:

| | before | after |
|---|---|---|
| excluded as fixture | 8,716 | **19,587** |
| surviving to the operator | 10,871 | **2,284** |

**The 2,284 that remain are not fixtures and are not this lane's defect.** They are all
`system-pick-scanner` output created 2026-05-12..2026-07-23 — real pre-containment pipeline rows
carrying no fixture marker of any kind. Whether stale scanner output belongs in an operator queue
is a separate disposition question, and this lane deliberately does not decide it.

This figure is recorded because the issue's original acceptance criterion 4 said the survivors
would go to **0**. That was wrong, and it was corrected on the issue rather than restated here:
the measurement is 2,284, and a lane must not close against a criterion it cannot meet.

**No governed pick is newly excluded.** The governed cohort predicate is
`metadata ? 'distributionMode'`; in approval scope that cohort is **0 rows**, and none of the
seven governed picks repo-wide carries any of the five fixture markers. The corrected guard
therefore removes nothing genuine — measured, not argued.

## Why it survived review

The test asserted the fabricated shape:

```ts
{ metadata: { testRun: true } },          // client.test.ts:49
```

The test was self-consistent with the bug it existed to constrain. A test that constructs its own
input can agree with a predicate about a value neither the writer nor the reader ever sees.
Nothing in it referred to a shape any production writer emits, so it passed on every run while the
guard matched nothing.

## What changed

### 1. `apps/command-center/src/lib/data/client.ts`

`metadata['testRun'] === true` → `metadata['testRun'] != null`, matching its four siblings, plus a
docstring line recording why presence rather than equality.

This is the shared predicate. `picks.ts:132` and `queues.ts:266` both delegate to it through a
one-line `isFixtureLikePick`, and `analytics.ts` calls it directly at `:485`, `:713` and `:1005`.
One line therefore fixes seven call sites across the picks explorer, the review queue, `/held` and
the analytics reads — which is also why it is a single-line change rather than seven.

### 2. `apps/command-center/src/lib/data/client.test.ts`

Now asserts the run-identifier string production actually writes (`testRun: 'a1b2c3d4'`) rather
than a boolean no writer emits. This is what makes the mutation drill meaningful: reverting the
guard to `=== true` now fails it.

## Scope note — the duplicated copy is tracked separately, not dropped

A hand-duplicated copy of the same predicate with the identical defect lives at
`apps/api/src/alert-query-service.ts:261`, filtering settled alert-agent picks out of
`getAlertSignalQuality`. It is **not** in this lane and has **not** been forgotten.

The issue's original acceptance criterion 3 required both copies in one change. That is not
expressible: **no lane type admits both `apps/command-center/**` and `apps/api/src/**`** —
`delivery-ui` has the first, `runtime` and `modeling` have the second, `hygiene` admits only
`apps/**/*.test.ts`, and `governance` admits no app source. `Lane authority` refused the combined
change on PR #1609 with two `outside_allowed_paths` findings. It is not a required check, so that
PR could have been merged anyway; doing so would have been bypassing a correct isolation control,
not clearing a defective gate.

The `apps/api` half has its own issue, with its diff and mutation drill already written and
preserved. It waits on the `runtime` singleton lane type, currently held by the open T1 reliability
lane. `modeling` also admits `apps/api/src/**` and is free, but taking it would be choosing a lane
type to evade a concurrency rule — a PM-reserved operating-model change, already declined once.

## ASSERTIONS:

- [x] `testRun` is presence-checked, consistent with its four siblings.
- [x] The test asserts the production shape, so a revert to `=== true` fails it. Drilled — see
      `verification.md`.
- [x] No governed pick becomes invisible: the governed cohort in approval scope is 0 rows, and
      none of the 7 governed picks repo-wide carries any of the five fixture markers.
- [x] **Nothing in this diff writes.** No migration, no route handler, no server action, no
      mutation. The changed function is a pure predicate.
- [x] No containment setting, kill switch, delivery target or runtime flag is touched.
- [x] No provider-dependent value is manufactured. Fixture classification reads metadata already
      on the row; this lane makes no claim about CLV, closing lines or automated grading, which
      remain explicitly deferred under the standing SGO sequencing directive.
- [x] `pnpm lane:check --lane delivery-ui` passes on this branch — the control that correctly
      refused #1609 is satisfied by construction here, not bypassed.

## EVIDENCE:

See `verification.md` in this bundle for the measured command output, the live queries and the
mutation drill.

## Merge SHA Binding

Merge SHA: 8731e7e9b11fc2227d908ff2ceb3ae0a8a95d20e
PR: https://github.com/griff843/Unit-Talk-v2/pull/1610
Approved PR head: pending merge
Execution SHA: a27ac381f65d6a31afbe38ad2cec30452c450ab1
