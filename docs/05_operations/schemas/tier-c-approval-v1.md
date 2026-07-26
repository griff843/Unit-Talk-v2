# Schema: tier-c-approval/v1

> Comment schema for authorizing a non-T1 lane to touch Tier C paths.
> Validated by `.github/workflows/tier-c-authorization-gate.yml`
> (`scripts/ci/tier-c-authorization-gate.ts`).
> Introduced by UTV2-1570 (implementation child of UTV2-1451) to close the
> Tier C self-authorization loophole: `.claude/hooks/tier-c-path-guard.sh`
> is a local, real-time editing guard that any session can route around
> (disable hooks, work outside Claude Code, etc.) -- it is not a merge
> gate. Prior to this schema, nothing mechanically stopped a T2/T3 PR from
> silently touching a Tier C path (per `scripts/ops/merge-risk.ts`'s
> `isTierCPath()`) with no comparable scrutiny to what a T1 lane already
> gets via `t1-approved` + `pm-verdict/v1`.

## One trust primitive, not two

This schema deliberately mirrors `docs/05_operations/schemas/scope-override-v1.md`'s
format and validation shape byte-for-byte where the concepts overlap
(header lines, `Issue:`/`PR:`/`Head-SHA:`/`Paths:` fields, CODEOWNERS-human
+ non-bot authorship, exact-head binding). A PR comment cannot be forged
by the PR branch's own diff -- GitHub, not the PR's commits, attests to
who posted it. Reusing the same trust mechanism `scope-override/v1` and
`pm-verdict/v1` already rely on avoids inventing a second, subtly
different authority primitive for the same underlying question ("did a
real human authorize this").

## When required

`tier-c-authorization-gate.ts` requires a valid `tier-c-approval/v1`
comment **only when both** of the following hold for the PR under
evaluation:

1. The PR's diff touches at least one path matched by `isTierCPath()`
   (imported directly from `scripts/ops/merge-risk.ts` -- this gate does
   not maintain a second Tier C path list).
2. The lane's own tier (from its lane manifest / Linear tier label) is
   **not** `T1`.

A T1 lane touching Tier C paths needs no additional artifact here: its own
`t1-approved` label + `pm-verdict/v1` APPROVED comment (enforced by
`.github/workflows/merge-gate.yml`) is PM sign-off bound to the exact
head, which necessarily covers whatever the diff touches. This gate closes
the gap specifically for **non-T1 lanes** silently touching Tier C via
self-declared file scope, with no comparable scrutiny.

## Format

```
TIER_C_APPROVAL: APPROVED
schema: tier-c-approval/v1
Issue: UTV2-###
PR: #NNN
Head-SHA: <40-char sha>
Paths:
- path/one.ts
- path/two/**
Reason: <why this lane needs to touch these Tier C paths without T1 gating>
```

## Validation rules

1. Line 1 must be exactly `TIER_C_APPROVAL: APPROVED`
2. Line 2 must be exactly `schema: tier-c-approval/v1`
3. `Issue:` must match `UTV2-\d+` and must equal the target lane's
   `issue_id`
4. `PR:` must match `#\d+` and must equal the PR number being evaluated
5. `Head-SHA:` must exactly match the PR's current head SHA at evaluation
   time -- a stale approval (posted against an earlier commit) does not
   carry forward to a later push, since a later push could contain a
   different diff
6. `Paths:` must have at least one item; each item is matched with the
   same `matchesLockPattern`-style logic `scope-override/v1` uses (exact
   match or `/**` prefix). **Full coverage is required**: every Tier C
   path touched by the PR's diff (per `isTierCPath()`) must be covered by
   at least one `Paths:` entry, or the gate fails closed even if a
   (partial) approval comment exists.
7. Author must be in `.github/CODEOWNERS`'s authorized-reviewer set (same
   set `merge-gate.yml` and `scope-override/v1` use) and must **not** be a
   bot account
8. Fields (`Issue`/`PR`/`Head-SHA`/`Reason`) may appear before or after the
   `Paths:` block, mirroring `scope-override/v1`'s own documented
   flexibility

## Authorization

Only comments from an authorized human CODEOWNERS member are valid
approvals. Bot-generated comments, comments from unknown users, comments
with schema mismatches, and comments bound to a stale head SHA are
silently ignored -- the underlying Tier C violation is enforced exactly as
if no approval existed. A missing, malformed, mismatched, or
partial-coverage approval never grants an exception; the strictest reading
always wins (fail closed).

## Scope

An approval authorizes exactly the `Paths:` it lists, for exactly the
`Issue`/`PR`/`Head-SHA` triple it declares. It does not carry forward
across a force-push or a new commit (a new `Head-SHA` requires a new
approval comment), and it does not apply to any other lane's PR.

## Relationship to `scope-override/v1`

`scope-override/v1` authorizes a lane to touch paths **outside its own
declared `file_scope_lock`**. `tier-c-approval/v1` authorizes a **non-T1**
lane to touch paths that are **Tier C** regardless of whether they are
inside or outside its declared scope -- Tier C sensitivity and file-scope
membership are orthogonal concerns. A single PR could in principle need
both artifacts (a T2 lane touching an out-of-scope Tier C path), in which
case both comments must independently validate; neither substitutes for
the other.

## What this does not change

This schema does not touch `.claude/hooks/tier-c-path-guard.sh`'s local
manifest-authorized bypass (UTV2-961, notice mechanism corrected by
UTV2-1570) -- that bypass is a real-time editing convenience for a lane
editing files already inside its own declared `file_scope_lock`, and stays
`exit 0`. This schema is the **mechanical, CI-enforced** half: it exists
precisely because the local hook is not a merge gate and a session can
route around it entirely.
