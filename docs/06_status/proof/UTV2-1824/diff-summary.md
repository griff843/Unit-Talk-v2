# UTV2-1824 Diff Summary

Issue: UTV2-1824
Tier: T1
Lane type: delivery-ui
Branch: claude/utv2-1824-smart-form-canonical-identity
Head SHA: 284951151ef8c4c3198fbee603f50ace9143a34c
Merge SHA: 2ac23342444ee2b3fbb086493e1b6ca6d862c59f
Diff base: 5fd7d299643be0755c7ca347dbca30cc5af0b998

> Merge authority does not exist before the merge. The head row carries execution identity —
> the last non-proof commit — and the merge row is rebound from GitHub's merged-PR
> attestation after merge.

## What changed

| File | Change |
|---|---|
| `apps/smart-form/lib/auth-allowlist.ts` | `deriveCapperIdFromEmail` deleted. `parseAllowedCapperEmails` now requires an explicit `email=capperId` entry and validates the id against `^[a-z0-9][a-z0-9_-]*$`, refusing rather than repairing. |
| `apps/smart-form/test/allowlist.test.ts` | Four UTV2-1824 acceptance tests added covering explicit mapping, unmapped entries, non-canonical ids, and absence of the derivation helper; existing UTV2-1786 empty-value behaviour retained. |
| `apps/smart-form/.env.example` | Documents the `email=capperId` format and that an unmapped entry admits nobody. No real address or id is committed. |

## Why

The derived id was persisted as pick identity. `apps/smart-form/auth.ts` puts `capperId` in
the session JWT and `apps/api/src/handlers/submit-pick.ts` prefers that claim over the
form's `submittedBy`, so `griffadavi@gmail.com` would have written `griffadavi` rather than
canonical `griff843` onto a real pick.

## Blast radius

Confined to Smart Form sign-in admission. No database access, no migration, no network I/O,
no member-facing delivery path, no API route behaviour change. `r-level-check` matches
`operator-ui` and returns PASS.

## Behaviour change requiring an operator action

A deployed `ALLOWED_CAPPER_EMAILS` in the old bare-email format now admits nobody rather
than admitting a derived identity. The value must be migrated to `email=capperId` form
before an approved capper can sign in. It is operator-supplied by policy and is not set by
this lane.

## Git Name Status
```
M	apps/smart-form/.env.example
M	apps/smart-form/lib/auth-allowlist.ts
M	apps/smart-form/test/allowlist.test.ts
A	.ops/sync/UTV2-1824.yml
A	docs/06_status/lanes/UTV2-1824.json
A	docs/06_status/proof/UTV2-1824/diff-summary.md
A	docs/06_status/proof/UTV2-1824/evidence.json
A	docs/06_status/proof/UTV2-1824/verification.md
```

## SHA Binding
Head SHA: 284951151ef8c4c3198fbee603f50ace9143a34c
Merge SHA: 2ac23342444ee2b3fbb086493e1b6ca6d862c59f
