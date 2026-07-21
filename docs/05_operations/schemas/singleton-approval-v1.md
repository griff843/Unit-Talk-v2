# Schema: singleton-approval/v1

> Linear comment schema for authorizing a lane whose file scope includes
> singleton-only paths (paths that require serialized execution --
> `SINGLETON_ONLY_FILES`/`SINGLETON_ONLY_PREFIXES` in `scripts/ops/lane-start.ts`).
> Validated by `scripts/ops/singleton-approval.ts`, invoked from
> `scripts/ops/lane-start.ts` in place of the bare `--singleton-approved` flag.
> Introduced by UTV2-1570 (implementation child of UTV2-1451) to close the
> singleton self-authorization loophole: `--singleton-approved` was a bare
> CLI flag with no verification behind it at all -- any caller, from any
> automated flow, could pass it and the check would pass unconditionally.

## Why a Linear comment, not a GitHub PR comment

Singleton approval is needed at `ops:lane-start` time, **before any PR
exists** -- there is nothing to comment on in GitHub yet. Linear issue
comments are checkable pre-PR. This is the one place this repo's
approval-artifact family (`scope-override/v1`, `tier-c-approval/v1`,
`pm-verdict/v1`) is not GitHub-comment-based; the trust property is the
same (a comment authored by a real account cannot be forged by the
requesting flow's own code), just anchored to a different platform because
the authorization has to exist earlier in the lifecycle than a PR does.

## Format

Posted as a comment on the Linear issue being started:

```
SINGLETON_APPROVED
schema: singleton-approval/v1
Issue: UTV2-###
Paths:
- path/one.ts
- path/two/**
Reason: <why this lane needs to touch singleton-only paths>
```

## Validation rules

`scripts/ops/singleton-approval.ts`'s `validateSingletonApprovalRef` enforces,
in order (first failure wins, fail closed):

1. `--singleton-approval-ref` must be a well-formed Linear comment URL
   (`https://linear.app/<workspace>/issue/<ISSUE-ID>/<slug>#comment-<id>`).
   Malformed URLs fail with `singleton_approval_malformed_ref`.
2. The `<ISSUE-ID>` embedded in the URL must equal the issue being started.
   Mismatch fails with `singleton_approval_issue_mismatch` -- a valid
   approval comment for a *different* issue can never authorize this one.
3. The referenced comment must actually exist on that issue (fetched live
   via the Linear GraphQL API, matched by exact `url` equality against the
   comment's own canonical `url` field -- never by parsing/reconstructing an
   ID from the ref string, since Linear's comment URL fragment is a
   truncated 8-character prefix of the full comment UUID, not the full ID).
   Missing fails with `singleton_approval_not_found`.
4. The comment must not be bot-authored (`botActor` must be null). Bot
   authorship fails with `singleton_approval_bot_author`.
5. The comment's author (`user.id`) must equal the **issue's own
   `creator.id`** -- the human who owns the issue, fetched live from the
   same query, not a config-file allowlist. An approval posted by anyone
   else, however senior, fails with `singleton_approval_wrong_author`. This
   is deliberately narrower than `tier-c-approval/v1`'s CODEOWNERS-set
   check: singleton approval is scoped to *this specific issue's owner*,
   not any authorized reviewer.
6. The comment body must match the fixed schema above: line 1 exactly
   `SINGLETON_APPROVED`, line 2 exactly `schema: singleton-approval/v1`,
   an `Issue:` field matching `UTV2-\d+` and equal to the issue being
   started, and at least one `Paths:` entry. Schema mismatch fails with
   `singleton_approval_schema_mismatch`.
7. **Full coverage is required**: every singleton path in the lane's
   declared file scope must be covered by at least one `Paths:` entry
   (exact match or trailing `/**` prefix, same `matchesLockPattern` logic
   `scope-override/v1` and `tier-c-approval/v1` use). Partial coverage
   fails with `singleton_approval_incomplete_coverage`, listing the
   uncovered paths.

Any of the above failing means the approval is invalid; `lane-start.ts`
fails closed and refuses to start the lane. There is no "partial credit" --
a missing, malformed, wrong-author, or incomplete-coverage approval never
grants an exception.

## Legacy `--singleton-approved` flag

The bare `--singleton-approved` flag is retained for exactly one release as
a deprecated, warning-only path: passing it alone (without
`--singleton-approval-ref`) emits a deprecation warning to stderr and a
`deprecation_warning` field in the JSON result, but is **never sufficient
authority on its own** going forward -- any singleton-path lane started
with only the bare flag and no valid `--singleton-approval-ref` fails
closed with `singleton_approval_missing`. The flag exists only so
already-scripted callers do not break instantly; it must not be treated as
an approval mechanism.

## Relationship to `scope-override/v1` and `tier-c-approval/v1`

All three schemas share the same underlying trust property (an externally
authored, unforgeable-by-the-requesting-diff artifact) and a similar
line-based comment format, but authorize different things and live on
different platforms:

| Schema | Platform | Authorizes | Authorized by |
|---|---|---|---|
| `scope-override/v1` | GitHub PR comment | exceeding declared `file_scope_lock` | any CODEOWNERS human, non-bot |
| `tier-c-approval/v1` | GitHub PR comment | non-T1 lane touching Tier C paths | any CODEOWNERS human, non-bot |
| `singleton-approval/v1` | Linear issue comment | starting a lane with singleton-only paths in scope | specifically the issue's own creator |
