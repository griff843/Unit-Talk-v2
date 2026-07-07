# Direct Main Bypass Policy

**Status:** Active  
**Authority:** PM  
**Issue:** UTV2-1432  
**Effective:** 2026-07-07

## Rule

No agent, lane, or operator may push, commit, merge, or otherwise land changes directly on `main` as a shortcut around the normal PR merge gate.

All planned work must flow through:

1. A bounded issue or approved execution packet.
2. A branch or lane worktree with explicit file scope.
3. Verification appropriate to the tier.
4. A GitHub PR with tier label and required checks.
5. Merge only after the applicable gate allows it.

## Prohibited Bypasses

The following are not allowed for ordinary execution:

- Committing directly on `main`.
- Pushing directly to `origin/main`.
- Squashing, cherry-picking, or fast-forwarding lane work into `main` without a PR.
- Using admin rights to merge with failing required checks.
- Editing protected operational truth files on `main` to make a lane appear closed.
- Applying runtime, migration, or production data changes because a PR is inconvenient.

## Emergency Exception

A direct-main bypass is allowed only for a production emergency where waiting for the PR gate would materially increase customer, data, security, or operational risk.

Before taking the bypass, the operator must record all of the following in a durable place, preferably the incident issue or emergency PR:

- The incident or issue ID.
- The exact files or commands required.
- Why the normal PR path is too slow for the risk.
- The rollback plan.
- The person authorizing the bypass.

After the bypass, the operator must open a follow-up PR or reconciliation issue that captures the final diff, verification, and incident note. The follow-up must not be skipped because `main` already contains the change.

## Non-Emergency Alternatives

When the goal is speed but there is no production emergency, use one of these paths instead:

- Open a small PR with the minimal diff.
- Use the tier-appropriate expedited review path.
- Split the work into a docs-only or verification-only lane.
- Ask PM to reshape the issue or approve a narrower execution packet.

## Relationship To Other Policies

This policy does not weaken:

- `docs/05_operations/DELEGATION_POLICY.md`
- `docs/05_operations/MERGE_DEPLOY_DISCIPLINE.md`
- `docs/05_operations/REQUIRED_CI_CHECKS.md`
- `docs/05_operations/LANE_MANIFEST_SPEC.md`

If policies conflict, use the stricter path and escalate to PM.
