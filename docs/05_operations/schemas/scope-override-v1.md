# Schema: scope-override/v1

> Comment schema for authorizing a lane to exceed its declared `file_scope_lock`.
> Validated by `.github/workflows/file-scope-lock-check.yml`.
> Introduced by UTV2-1521 to replace the manifest-embedded `scope_override` field,
> which was a self-certification loophole: it lived inside the same JSON file the
> PR's own diff controls, so any PR could grant itself arbitrary scope widening.

## Why a PR comment, not a manifest field

A comment authored by a real GitHub account cannot be forged by the PR branch's
own diff — the PR's commits cannot make GitHub believe a comment was posted by
someone it wasn't. This is the same trust property `pm-verdict/v1` already
relies on, reused here rather than inventing a new authority mechanism.

## Format

```
SCOPE_OVERRIDE: APPROVED
schema: scope-override/v1
Issue: UTV2-###
PR: #NNN
Head-SHA: <40-char sha>
Paths:
- path/one.ts
- path/two/**
Reason: <why this lane needs to exceed its declared file_scope_lock>
```

## Validation Rules

1. Line 1 must be exactly `SCOPE_OVERRIDE: APPROVED`
2. Line 2 must be exactly `schema: scope-override/v1`
3. `Issue:` must match `UTV2-\d+` and must equal the target manifest's `issue_id`
4. `PR:` must match `#\d+` and must equal the PR number being evaluated
5. `Head-SHA:` must exactly match the PR's current head SHA at evaluation time --
   a stale override (posted against an earlier commit) does not carry forward to
   a later push, since a later push could contain a different diff
6. `Paths:` must have at least one item; each item is matched with the same
   `matchesLockPattern` logic as `file_scope_lock` (exact match or `/**` prefix)
7. Author must be in `.github/CODEOWNERS`'s authorized-reviewer set (same set
   `merge-gate.yml` uses) and must NOT be a bot account
8. Tier C paths (per `scripts/ops/merge-risk.ts`'s `isTierCPath`) are honored
   the same as any other path if explicitly listed under `Paths:` -- the
   authorization step is the human comment, not a separate Tier C carve-out

## Authorization

Only comments from an authorized human member are valid overrides.
Bot-generated comments, comments from unknown users, and comments with schema
mismatches are silently ignored -- the underlying `file_scope_lock` violation
is enforced exactly as if no override existed. A missing, malformed, or
mismatched override never grants an exception; the strictest reading always
wins.

## Scope

An override authorizes exactly the `Paths:` it lists, for exactly the
`Issue`/`PR`/`Head-SHA` triple it declares. It does not carry forward across a
force-push or a new commit (a new `Head-SHA` requires a new override comment),
and it does not apply to any other lane's manifest.

## What this replaced

Prior to UTV2-1521, `scripts/ci/file-scope-guard.ts` honored a `scope_override`
object embedded directly in the lane manifest JSON (`approved_by`/`reason`/
`evidence` string fields). That mechanism is removed: the manifest is part of
the PR's own diff, so a well-formed-looking `scope_override` object proved
nothing about actual authorization -- only that the PR author typed non-empty
strings into their own file.
