# T1 Queue Behavior — Non-Blocking Guarantee

**Status:** Canonical contract — AUT-1
**Purpose:** The mechanical guarantee that a T1 item awaiting Griff never blocks T2/T3 progress elsewhere.
This is a structural guarantee, not a timeout or race-avoidance mitigation — the distinction matters because
a timeout-based "don't wait too long on T1" design can still degrade throughput while it waits; a structural
exclusion cannot, because there is no code path where the loop variable can ever be a T1 item.

---

## 1. Structural exclusion at candidate selection

The kernel's candidate query (`STATE_MACHINE.md` §3.1, `selecting` state) is defined as:

> All Ready Linear issues with tier label `T2` or `T3`, satisfying the same eligibility filters
> `ops:lane-maximizer` already applies for human-invoked dispatch (concurrency slots, file-scope conflicts,
> forbidden-combination rules, dependency blockers).

**T1-tier issues are never a member of the set this query returns.** There is no filter step that "skips" a
T1 item after considering it — the query's `tier IN ('T2','T3')` predicate means a T1 item is never
constructed as a candidate object in the first place. Consequently:

- The `dispatching`/`shadow_evaluating` cycle states (`STATE_MACHINE.md` §3.1) iterate only over this set.
  There is no iteration variable that could ever hold a T1 candidate.
- `dispatch_packet_v1.schema.json`'s `tier` enum has no `T1` value (deliverable 3, `THREAT_MODEL.md` #5) —
  even if a defect somewhere upstream produced a T1 candidate, packet emission would fail schema validation
  before the packet could be acted on. This is the second, independent enforcement layer for the same
  guarantee (belt and suspenders, matching the pattern used throughout this contract set).

**Why this is the correct design over a timeout:** a design where the kernel "notices" a T1 item, attempts
to wait for Griff, and times out after N minutes still spends kernel cycle time on that item and still risks
an implementation bug where the wait is not correctly bounded or not correctly non-blocking (e.g. a
synchronous wait inside the candidate loop). Structural exclusion has no waiting to get wrong — the T1 item
simply is not iterable.

---

## 2. T1 visibility without blocking

Non-blocking does not mean invisible. A T1 issue Ready and awaiting Griff must still surface, per
`NOTIFICATION_TAXONOMY.md`'s digest-only default (not an individual ping — see that document's non-notify
list). The mechanism:

- The kernel's `reporting` cycle state (`STATE_MACHINE.md` §3.1) includes a read-only tally of currently
  Ready T1 issues (count and list) in its cycle summary, written to the audit log as an `info`-severity
  event.
- This feeds the **existing** `ops:daily-digest` surface (`EXECUTION_TRUTH_MODEL.md` §8) rather than a new,
  parallel T1-tracking mechanism — see `COMPATIBILITY_MAP.md`. Griff reviews T1 backlog the same way he
  already does today; the kernel does not introduce a second place to look.
- This tally is **read-only telemetry**, never a queue the kernel manages, retries against, or expires
  entries from. There is no "T1 queue" object with kernel-owned state — the "queue" named in this document's
  title is Linear's own Ready-state T1 backlog, unmodified, merely counted for visibility.

---

## 3. Dependency interaction: T2/T3 blocked BY an unresolved T1

A different scenario from "a T1 item sits idle" is "a T2/T3 candidate cannot proceed because it depends on a
T1 lane that hasn't merged yet" (e.g. a T2 issue's acceptance criteria assume a T1 contract change is
already shipped). This is **not** a new problem this system introduces — it is the existing
`dependency_blocker` finding already produced by the dispatch preflight artifact
(`LANE_CONCURRENCY_POLICY.md` §8, "Dependency blockers").

**Kernel behavior:** identical to a human-invoked `/dispatch` hitting the same blocker — the candidate is
skipped for this cycle (logged as `candidate_refused_concurrency` or an equivalent dependency-blocker audit
event, not silently dropped) and the kernel proceeds immediately to the next independent candidate in the
same cycle. The kernel never spins, retries within the same cycle, or holds up `selecting`/`dispatching`
waiting for the dependency to clear — it re-evaluates the blocked candidate fresh on the **next** scheduled
wake (15 minutes later by default, `LIMITS.md` §1), exactly as any other transient blocker would be
re-evaluated.

**This is the same non-blocking guarantee as §1, applied one hop away:** just as a T1 item is never
iterable, a T2/T3 candidate blocked by an unresolved dependency does not consume more than a single
candidate-evaluation's worth of cycle time before the loop moves on. Neither case allows one Linear issue's
state to stall the cycle's progress through the rest of the queue.

---

## 4. Falsifiable check

This guarantee is checkable, not just asserted: `PROGRAM_COMPLETION_DEFINITION.md` requires empirical
evidence that at least one real T1 item was Ready/awaiting Griff at the same time the kernel was actively
dispatching/merging T2/T3 work during the certification window, with audit-log timestamps showing
uninterrupted T2/T3 cycle throughput across that overlap — proving the guarantee held under real, not just
theoretical, conditions.
