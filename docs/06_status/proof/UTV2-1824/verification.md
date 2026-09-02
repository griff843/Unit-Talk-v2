# PROOF: UTV2-1824

MERGE_SHA: 284951151ef8c4c3198fbee603f50ace9143a34c

> Pre-merge this row carries the branch implementation SHA, which is the last non-proof
> commit on the branch. `post-merge-lane-close.yml` rebinds merge authority from GitHub's
> merged-PR attestation after merge. It is deliberately not the string `N/A`: a
> non-SHA anchor passes the rebinder but fails required Executor Result Validation.

Issue: UTV2-1824
Tier: T1
Lane type: delivery-ui
Branch: claude/utv2-1824-smart-form-canonical-identity
Execution SHA: 284951151ef8c4c3198fbee603f50ace9143a34c

## Summary

Smart Form resolved a signed-in capper's identity by taking the email local-part and
replacing every character outside `[a-z0-9_-]`. That value is not cosmetic: `apps/smart-form/auth.ts`
writes it into the session JWT as `capperId`, and `apps/api/src/handlers/submit-pick.ts`
prefers that claim over whatever `submittedBy` the form sent. So the derived string became
the persisted identity of a real pick — `griffadavi@gmail.com` resolved to `griffadavi`,
not to canonical `griff843`.

`ALLOWED_CAPPER_EMAILS` now carries the canonical id explicitly, as `email=capperId`. An
entry that does not supply one is refused outright rather than falling back to the
local-part, and an id that is not already canonical is refused rather than repaired —
silent repair is how the wrong identity reached the database in the first place. Empty
still admits nobody.

## Verification

ASSERTIONS:

- [x] An authorized login resolves to its explicitly mapped canonical capper id, not to the
      email local-part.
- [x] An allowlist entry with no explicit `=capperId` mapping is rejected and admits nobody
      (it does not fall back to the local-part).
- [x] A capper id outside `^[a-z0-9][a-z0-9_-]*$` is refused rather than sanitised.
- [x] `deriveCapperIdFromEmail` is gone from the module surface — the derivation path cannot
      be reached, not merely bypassed.
- [x] An unset, empty or whitespace-only `ALLOWED_CAPPER_EMAILS` continues to admit nobody
      (UTV2-1786 behaviour preserved).
- [x] The mutation test is faithful: restoring local-part derivation makes the acceptance
      tests fail, so they are load-bearing rather than decorative.
- [x] No real credential, personal address, or capper id appears in the test fixtures or in
      `apps/smart-form/.env.example`; `ALLOWED_CAPPER_EMAILS` remains server-authoritative
      and operator-supplied.
- [x] `pnpm type-check` and `pnpm test` are green on this branch — the whole-repo suite is
      5439 passing, 0 failing — and `scripts/ci/r-level-check.ts` returns PASS.

EVIDENCE:

```
$ pnpm type-check
> @unit-talk/v2@0.1.0 type-check
> pnpm exec tsc -b tsconfig.json
(no diagnostics; exit 0)

$ pnpm exec tsx --test apps/smart-form/test/allowlist.test.ts
1..9
# tests 9
# pass 9
# fail 0

$ pnpm exec tsx --test apps/smart-form/test/*.test.ts
# tests 135
# pass 135
# fail 0
# skipped 0

$ pnpm test
(whole repo, aggregated across every node:test file)
tests=5439 pass=5439 fail=0   exit=0

$ npx tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD
Verdict: PASS
Changed files: 6
Rules matched: operator-ui
```

`pnpm verify` is the composite of `env:check + lint + type-check + build + test`; the
type-check and test legs are recorded above and were run on this branch head. The
environment leg runs under containment (`local.env` points every Supabase client at an
unreachable address), which is the intended posture — this lane makes no database call.

## Runtime Verification

This lane is a Delivery/UI change with no database access, no migration and no network I/O:
`apps/smart-form/lib/auth-allowlist.ts` is a pure parser over one environment string. The
runtime behaviour that matters is therefore proved by execution of the parser itself, and by
inverting it.

### Mutation test — the control fails on the condition it names

Restoring local-part derivation inside `parseAllowedCapperEmails` (entries with no `=` fall
back to `email.split('@')[0].replace(/[^a-z0-9_-]/g, '')`) and re-running the suite:

```
not ok 5 - UTV2-1824: an entry with no explicit mapping is rejected and admits nobody
  error: |-
    expected no approved cappers for "someone.else@example.com"
not ok 6 - UTV2-1824: a non-canonical capper id is refused rather than sanitised
  error: |-
    expected a non-canonical id to be refused: "someone.else@example.com=Griff 843"
# pass 7
# fail 2
```

The mutation was reverted from the working tree before commit; the branch carries the
fixed implementation, which returns `# pass 9 / # fail 0`.

### Executed measurement of the identity chain

The changed module was executed directly at this head (not stubbed — these are the exported
functions the Next.js auth callback calls):

```
Q1 parsed entries: [{"email":"pilot.capper@example.com","capperId":"griff843"},{"email":"other.capper@example.com","capperId":"other-capper"}]
Q2 resolved capperId for a mixed-case authorized login: griff843
Q3 entries admitted for an unmapped (bare email) value: 0
Q4 entries admitted for a non-canonical id: 0
Q5 entries admitted for an empty ALLOWED_CAPPER_EMAILS: 0
Q6 exported names: findAllowedCapper,normalizeEmail,parseAllowedCapperEmails
Q7 derivation helper present: false
```

Q1/Q2 are the load-bearing pair: the address's local-part is `pilot.capper`, and the
resolved identity is `griff843`. The identity comes from the mapping, not from the address.
Under the previous implementation the same address resolved to `pilotcapper`.

### Identity chain, read end to end

- `apps/smart-form/lib/auth-allowlist.ts` — `parseAllowedCapperEmails` yields `{email, capperId}`
  only for an explicitly mapped, canonical entry.
- `apps/smart-form/auth.ts:32-41` — `findAllowedCapper` result sets `token.capperId`,
  `token.sub`, and the signed capper claim.
- `apps/api/src/handlers/submit-pick.ts:142-149` — when the authenticated role is `capper`,
  `auth.capperId` overrides any form-supplied `submittedBy`, and that is the value persisted.

So a login mapped to `griff843` persists `submittedBy = griff843` server-side, with no
trust placed in the browser payload.

## Containment

No pick was submitted, no database was written, no migration was applied, no provider was
resubscribed and no member-facing delivery path was touched. The change is confined to
allowlist parsing and its tests plus the `.env.example` documentation of the new format.

## Known follow-up (not in this lane's scope)

`docs/05_operations/REQUIRED_SECRETS.md` still describes `ALLOWED_CAPPER_EMAILS` as a
"comma-separated allow-list of capper email addresses". That sentence is now stale — the
value is a comma-separated list of `email=capperId` pairs. The file is outside this lane's
`file_scope_lock`, which is immutable for lane life, so it is recorded here rather than
edited. The deployed value must be migrated to the new format before an approved capper can
sign in; that value is operator-supplied by policy and is not set by this lane.

## Merge SHA Binding

Merge SHA: 284951151ef8c4c3198fbee603f50ace9143a34c
Approved PR head: 284951151ef8c4c3198fbee603f50ace9143a34c
Execution SHA: 284951151ef8c4c3198fbee603f50ace9143a34c
