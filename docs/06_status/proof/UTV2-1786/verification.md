# PROOF: UTV2-1786 — Smart Form Lane 2: authenticated capper intake

## Merge SHA Binding

MERGE_SHA: 05d7d9bf4ef67af09c272b98126f2c8a79b486ed
Head SHA: 05d7d9bf4ef67af09c272b98126f2c8a79b486ed
Merge SHA: 05d7d9bf4ef67af09c272b98126f2c8a79b486ed
Execution SHA: 05d7d9bf4ef67af09c272b98126f2c8a79b486ed
Diff base: origin/main at the time of this binding

`05d7d9bf` is this branch's last non-proof commit — it carries every
implementation change under review, including the `main` sync that brought
UTV2-1788 into this branch. It is execution identity, not merge authority: the
authoritative merge SHA does not exist until the PR merges, at which point
`post-merge-lane-close.yml` rebinds these anchors to it. The proof-only commit
that adds this file sits on top of `05d7d9bf` and changes no implementation byte.

## Verification

| Check | Result | Evidence |
| --- | --- | --- |
| Repository gate | PASS | `pnpm verify`; all static stages exit 0 |
| Smart Form unit tests (required path) | PASS | `pnpm --filter @unit-talk/smart-form verify`, invoked by `verify:static`; 123 passed, 0 failed |
| Auth-gate E2E at this head | PASS | `pnpm exec playwright test e2e/auth-gate.spec.ts`; 3 passed against the running app |
| Auth-gate mutation test | PASS (control proven to fail) | gate reverted to the pre-lane ordering; 2 of 3 specs failed on the refusal assertion |
| Allowlist regression tests reach required CI | PASS | both tests appear in the TAP output of the suite `verify:static` runs |
| Screenshots | PASS | 3 PNGs captured by the E2E run at this head |
| QA experience regression | EXECUTED, FAIL — stale expectation | `pnpm qa:experience --regression --mode fast`; see "QA experience disposition" |
| Writable DB leg | NOT CLAIMED LOCALLY | staging assertion refused the loopback target; CI carries the receipt |

### Focused test evidence

```text
# Subtest: an empty or unset ALLOWED_CAPPER_EMAILS admits nobody
ok 5 - an empty or unset ALLOWED_CAPPER_EMAILS admits nobody
# Subtest: the allowlist module exports no compiled-in capper constant
ok 6 - the allowlist module exports no compiled-in capper constant
# tests 123
# pass 123
# fail 0
```

### Repository gate receipts

Executed standalone at this head, not inferred from the composite run:

```text
$ pnpm type-check                                                     -> exit 0
  pnpm exec tsc -b tsconfig.json, no diagnostics.

$ pnpm test                                                           -> exit 0
# tests 5360
# pass 5360
# fail 0
# cancelled 0
# skipped 0
# todo 0
  Zero 'not ok' lines across the whole run.

$ pnpm exec tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD -> exit 0
  Verdict: PASS
  Changed files: 28
  Rules matched: operator-ui
```

`scripts/ci/r-level-check.ts` reports PASS for the `operator-ui` rule. That
verdict reflects the presence of a locally produced `apps/qa-agent/artifacts/**`
run directory on this workstation, which `apps/qa-agent/.gitignore` excludes
from the commit. It is recorded here as the measured local result and is NOT
offered as evidence that the qa-experience requirement is satisfied in a
committed tree — see "QA experience disposition" above, where that run's FAIL
verdict and the unreachable artifact path are both stated.

### E2E evidence at this head

```text
✓ 1 e2e/auth-gate.spec.ts:40 › unauthenticated submit redirects to the Unit Talk Capper Portal
✓ 2 e2e/auth-gate.spec.ts:51 › a forged capper token stored in localStorage does not open /submit
✓ 3 e2e/auth-gate.spec.ts:72 › storing a recovery token does not sign the operator in
  3 passed
```

Screenshots, captured by that run and not by hand:

- `01-capper-portal-login.png` — unauthenticated `/submit` lands on the Capper Portal.
- `02-forged-claim-refused.png` — a structurally valid, unsigned capper token in
  `localStorage` does not open `/submit`.
- `03-recovery-token-stored-not-signed-in.png` — storing a recovery token keeps
  the operator on `/login`.

### Mutation evidence — the gate is proven to fail on the condition it names

A green run of a guard proves nothing on its own. The `/submit` gate was
reverted in place to the pre-lane ordering (grant access when a stored capper
claim is present, before session resolution) and the same three specs re-run:

```text
✓ 1 unauthenticated submit redirects to the Unit Talk Capper Portal
✘ 2 a forged capper token stored in localStorage does not open /submit
    > 66 | await expect(page).toHaveURL(/\/login$/);   — failed
✘ 3 storing a recovery token does not sign the operator in
    > 91 | await expect(page).toHaveURL(/\/login$/);   — failed
  2 failed, 1 passed
```

Specs 2 and 3 fail exactly on the refusal assertion; spec 1 still passes, which
correctly shows that spec 1 is not the load-bearing control. The file was
restored before any commit — `git diff` on `app/submit/page.tsx` is empty at
this head.

### QA experience disposition

`pnpm qa:experience --regression --mode fast` was executed twice at this head
against a running Smart Form. Both runs reached the real UI — preflight passed
(`/submit` HTTP 200, `/api/auth/session` HTTP 200) — and both returned FAIL on
two hard expectations:

```text
FAILED smart_form_no_login_redirect_before_form (critical):
  Unexpected redirect to /login before Smart Form controls rendered.
FAILED smart_form_controls_render (critical):
  Missing form controls: sportSelect, marketSelect, bookSelect, submitButton.
```

This is not claimed as a passing `qa-experience` artifact, and no green QA
report was produced or fabricated. The reason for the failure is that
`apps/qa-agent`'s `smart-form/submit-pick` skill encodes the **pre-lane**
contract: `smart_form_no_login_redirect_before_form` asserts that `/submit`
renders the form without an authenticated session. That is precisely the
behavior this lane removes. The skill declares `requiresAuth: true` but does not
fail when the persona storage state carries no session, so it reports the
correct redirect as a product defect.

Producing a truthful passing run needs either a real authenticated operator
session (Google OAuth, interactive) or an update to the QA skill. The skill
lives in `apps/qa-agent/**`, outside this lane's file scope, so it is recorded
as a follow-up rather than changed here. `QA Experience Regression` is advisory
by its own workflow declaration and is not one of the four required contexts.

### Full gate and writable DB disposition

`pnpm verify` completed its static sequence and then reached `test:live-db`,
where the staging assertion refused the configured loopback target before any
client was constructed:

```text
[assert-staging] host=127.0.0.1 ref=unidentified expected=xskgrzbteyqdufktjrjx
[assert-staging] REFUSED: target identity could not be resolved from its URL
```

The writable-DB leg is not claimed as executed on this workstation. This lane
changes no schema, no migration, and no DB access path. CI's run-scoped staging
receipt, verified inside required `verify`, carries the authoritative T1 receipt
for this head.

## ASSERTIONS: product and safety claims proven by this lane

- [x] `/submit` waits for authoritative session resolution before making any
      access decision. A decision taken during `status === 'loading'` could only
      be based on client-held state; the gate now returns instead.
- [x] A capper token held in `localStorage` is not authority. It is carried into
      API calls as a bearer so an operator-issued recovery token still works, but
      the API — not the client — decides whether it is valid.
- [x] A structurally valid but unsigned capper token does not open `/submit`, and
      the forged display name and capper id never render. Proven by execution and
      by mutation.
- [x] Storing a recovery token does not sign the operator in. The login page no
      longer decodes the token and presents its unverified payload as a
      recognized identity.
- [x] The approved-capper allowlist is env-controlled and fails closed. An empty
      or unset `ALLOWED_CAPPER_EMAILS` admits nobody.
- [x] No capper email is compiled into the shipped bundle. `auth-allowlist`
      exports no constant containing an email address, asserted by a test that
      inspects the module's own exports.
- [x] The QA auth bypass is opt-in and cannot be enabled in production. An unset
      variable yields `false`; `NODE_ENV === 'production'` returns `false`
      unconditionally.
- [x] Both allowlist regression tests execute in the suite that required `verify`
      actually runs. `verify:static` invokes
      `pnpm --filter @unit-talk/smart-form verify` directly, and that app-local
      `test` script lists both. Root `package.json` is untouched.
- [x] `apps/smart-form/.env.example` documents the allowlist with a placeholder
      address. It contains no real operator email.

## EVIDENCE: executed command receipts

```text
$ pnpm ops:merge-wrapper git-merge-main --issue UTV2-1786 \
    --branch claude/utv2-1786-smart-form-lane-2   -> merged 'ort', 683516d3 -> 5381f328
$ pnpm verify                                     -> static stages exit 0; test:live-db refused a loopback target
$ pnpm --filter @unit-talk/smart-form verify      -> exit 0
# tests 123
# pass 123
# fail 0

$ pnpm exec playwright test -c playwright.config.ts e2e/auth-gate.spec.ts -> 3 passed
$ (gate reverted in place) pnpm exec playwright test ... e2e/auth-gate.spec.ts -> 2 failed, 1 passed
$ pnpm qa:experience --regression --mode fast     -> exit 2, FAIL (stale expectation; see disposition)
```

## Residual risks and deferred work

### The smart_form QA skill encodes the pre-auth-gate contract

`apps/qa-agent/src/adapters/unit-talk/surfaces/smart-form/skills/submit-pick.ts`
asserts `smart_form_no_login_redirect_before_form` as a hard critical
expectation. After this lane that assertion is wrong: an unauthenticated visitor
to `/submit` must be redirected. The skill also does not fail when the persona
storage state holds no session, so it attributes the redirect to the product.
Recorded as a follow-up beneath the existing Smart Form parent; not fixed here
because `apps/qa-agent/**` is outside this lane's declared file scope.

### The qa-experience artifact path is unreachable from a committed tree

`r1-r5-rules.json` resolves `qa-experience-report` to
`apps/qa-agent/artifacts/**/result.json`, and `apps/qa-agent/.gitignore` ignores
`artifacts/`. A committed repository can therefore never satisfy the
`operator-ui` rule's only artifact requirement, and the workflow that would
produce it is advisory and cannot start the apps in CI. This is the same
unsatisfiable-gate shape recorded for `discord-delivery` under UTV2-1793 and is
noted here rather than changed, since editing the R-level matrix is a
governance change outside this lane.

### Divergent smart-form test lists

Two scripts list smart-form tests and they disagree. Root `test:smart-form`
(reached through `pnpm test` -> `test:apps`) omits `allowlist.test.ts`;
`apps/smart-form`'s local `test` omitted `auth-config.test.ts`. Both scripts run
inside required `verify:static`, so the union is covered today and no test is
unrun — but the divergence is a live hazard: a test added to one list silently
skips the other path.

This lane completes the app-local script, which is the path the issue permits it
to touch, and leaves root `package.json` alone under the issue's explicit
exclusion. An earlier commit on this branch did edit the root script; it was
reverted once the app-local path was confirmed sufficient, and root
`package.json` is byte-identical to `main` at this head. Reconciling the two
lists into one source belongs to a lane that is allowed to touch the root
manifest.

### Pre-merge `ops:proof-check` staleness is expected here

`ops:proof-check UTV2-1786` reports `STALE: yes` before merge. `isProofStale`
compares `source_sha` to the PR head by strict equality, and this bundle's
`source_sha` is `05d7d9bf` — the last non-proof commit, which is what the merge
binding and the executor result are pinned to. The PR head is the proof-only
commit that carries this file. Setting `source_sha` to the PR head cannot be
done without changing the PR head again, so the condition is unsatisfiable for
any proof committed to its own branch pre-merge. It resolves at merge, when
`post-merge-lane-close.yml` rebinds both anchors to the authoritative merge SHA.
This is disclosed rather than worked around; no SHA is misreported.
