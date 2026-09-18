# PROOF: UTV2-1935 Diff Summary

MERGE_SHA: pending merge

Generated at: 2026-09-18T16:20:00.000Z
Issue: UTV2-1935
Tier: T2
Lane type: delivery-ui
Branch: claude/utv2-1935-review-queue-suppression-reason
PR URL: https://github.com/griff843/Unit-Talk-v2/pull/1608
Head SHA: 09b8396bfe5431a2da00a469aadf5f8b7cf81a6d
Execution SHA: 09b8396bfe5431a2da00a469aadf5f8b7cf81a6d
Diff base: c79a5bb2a2a9113222459983a0c55c5720a2045a
result: pass

## Git Diff Stat

```
 apps/command-center/src/app/held/page.tsx          | 168 +++++++++++++++++++--
 apps/command-center/src/components/ReviewQueueClient.tsx | 42 +++++-
 apps/command-center/src/lib/data/queues.ts         |  12 ++
 apps/command-center/src/lib/suppression.test.ts    |  83 ++++++++++
 apps/command-center/src/lib/suppression.ts         |  52 +++++++
 5 files changed, 347 insertions(+), 10 deletions(-)
```

Control-plane files added by `ops:lane-start` (`.ops/sync/UTV2-1935.yml`,
`docs/06_status/lanes/UTV2-1935.json`) and this proof bundle are excluded from the figure
above; the full `c79a5bb2a..HEAD` stat is 8 files / 467 insertions.

## Why this lane exists

#1606 closed four Dimension 5 gaps and left two standing, both of the same kind: a
surface that **cannot** state a fact rather than one that chooses not to.

1. **The review queue could not explain a suppression.** `PicksExplorerClient` gained a routing
   cell under #1606, but `/review` — the queue an operator actually works from — has no such
   column, and `QUEUE_SELECT` never requested `promotion_reason` at all. The absence was
   structural: there was no value in the row to render.
2. **`/held` was still not a held-queue page.** #1606 replaced a redirect to `/review` (a query
   that excludes held picks by construction) with a redirect to `/operations/approvals`. That
   was a correct repair of a wrong destination, but it left the contract's "held queue exists and
   shows picks in held status" satisfied only by a cockpit that merges held rows with
   `awaiting_approval` and review rows and drops the age and hold-reason fields `getHeldQueue`
   already computes.

Both are fully provider-independent, so both are closable now under the standing SGO sequencing
directive.

## What changed, and why

Every change is read-only presentation over data the database already holds. **No write path, no
mutation, no route handler, no server action, and no delivery, approval or containment control is
touched by this diff.** There is no migration.

### 1. `lib/suppression.ts` — one definition, deliberately import-free

`describeSuppression(promotionStatus, promotionReason)` returns `{ suppressed, reason,
missingReason }`. It is a pure module with **no import of `lib/data/*`**, which is what lets a
client component (`ReviewQueueClient`) and a server component (`/held`) share it without pulling
server-only code into the browser bundle.

The load-bearing decision is the treatment of a blank reason. `promotionReason` is trimmed, and a
whitespace-only or empty string collapses to `null` exactly as a missing one does. A naive
`reason != null` check passes `'   '` and renders an operator three spaces — which satisfies the
letter of "non-null" and none of the contract's "non-blank". `missingReason` is then true only
when the pick **is** suppressed and has no usable reason: that is the state the contract is
actually about.

Status matching is case- and whitespace-insensitive over `{suppressed, not_eligible}` and
**fails open** on a missing or non-string status. Failing closed there would invent a suppression
the row does not claim, and paint a red "no reason recorded" defect on every pick whose status
failed to load.

### 2. `lib/suppression.test.ts` — 11 cases, each naming a row shape

The command-center app had no unit tests before #1606 introduced `clv-summary.test.ts`; this is
the second such file. The cases that matter are the blank-reason pair (4 and 5), which fail under
a naive non-null check, and case 9, which pins the fail-open direction on an unknown status.

### 3. `QUEUE_SELECT` gains `promotion_reason`

One column, added beside the `promotion_status` the select already requested. `ReviewPick` and
`HeldPick` both carry `promotionStatus` / `promotionReason`, and both mappers read them through
the existing `asStringOrNull` accessor rather than coercing.

### 4. The review queue renders a Routing column

`SuppressionCell` mirrors the semantics `PicksExplorerClient`'s `RoutingCell` established under
#1606, so the two surfaces cannot drift in what a suppression looks like: the status in muted
caps, the reason in amber, and a missing reason in rose as `no reason recorded`. A non-suppressed
pick renders an em dash, which is the one place a dash is honest — there is genuinely nothing
withheld to explain. The expanded-row `colSpan` moves 9 → 10 with the new column.

### 5. `/held` becomes a real page

`app/held/page.tsx` was 13 lines of `redirect('/operations/approvals')`. It is now a server page
over `getHeldQueue({})` rendering Pick / Held by / Age / Hold reason / Routing / Score — the
three fields the cockpit flattens away (`heldBy`, `ageHours`, `holdReason`) plus the new routing
cell. Ages of 24h or more render amber.

Failure is not rendered as emptiness. A throw or a `degraded` queue renders `DegradedState` with
the cause, and a genuine empty result renders a message that says the load **succeeded** — so an
operator can tell "no picks are held" from "the held queue could not be read".

## ASSERTIONS:

- [x] A suppressed pick with a recorded reason renders that reason on `/review`. Asserted by
      `a suppressed pick with a real reason reports that reason and no defect`.
- [x] A suppressed pick with **no** reason renders as a stated defect, not an em dash. Asserted by
      `a suppressed pick with a null reason is a defect, not a blank` and by
      `the missing-reason label is a stated defect, not a placeholder glyph`, which requires
      `NO_REASON_RECORDED !== '—'`.
- [x] A whitespace-only reason counts as blank. Asserted by `a whitespace-only reason is blank,
      which is what "non-blank" in the contract means`. This is the assertion a non-null check
      cannot make.
- [x] A non-suppressed pick is never reported as owing a reason. Asserted by `a non-suppressed
      pick owes no reason even when it has none`.
- [x] An unreadable status fails open, not closed. Asserted by `a missing or non-string status is
      not silently treated as suppressed`.
- [x] `promotion_reason` is actually selected — without it the column would be structurally empty
      regardless of the rendering. `QUEUE_SELECT` in `lib/data/queues.ts` now lists it.
- [x] `/held` resolves to a page whose query is `.eq('review_decision', 'hold')` — `getHeldQueue`
      — rather than to any surface that merges or excludes the held population.
- [x] **Nothing in this diff writes.** No server action, route handler, mutation, kill switch,
      approval transition, containment flag or delivery target appears in the change, and there is
      no migration.
- [x] No provider-dependent value is manufactured. This lane renders `promotion_reason`, which the
      scoring path already writes; it makes no claim about CLV, closing lines or automated grading.

## EVIDENCE:

See `verification.md` in this bundle for the measured command output and the mutation drill.

## Merge SHA Binding

Merge SHA: pending merge
PR: https://github.com/griff843/Unit-Talk-v2/pull/1608
Approved PR head: pending merge
Execution SHA: 09b8396bfe5431a2da00a469aadf5f8b7cf81a6d
