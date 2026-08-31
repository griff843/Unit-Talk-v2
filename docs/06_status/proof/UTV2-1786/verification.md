# PROOF: UTV2-1786 — Smart Form Lane 2: authenticated capper intake

## Merge SHA Binding

MERGE_SHA: 63d76eb6744943e7782e3b3645e7018da84bbb56
Head SHA: 9c8d2d431303c80066feef79df4c3326171b2267
Merge SHA: 63d76eb6744943e7782e3b3645e7018da84bbb56
Execution SHA: 9c8d2d431303c80066feef79df4c3326171b2267
Diff base: origin/main at the time of this binding

`9c8d2d43` is this branch's last non-proof commit — it carries every
implementation change under review, including the review-round correction
described below. It is execution identity, not merge authority: the
authoritative merge SHA does not exist until the PR merges, at which point
`post-merge-lane-close.yml` rebinds these anchors to it. The proof-only commit
that adds this file sits on top of `9c8d2d43` and changes no implementation byte.

The branch was 0 commits behind `origin/main` when this binding was taken, so no
sync was performed and no head-pinned artifact was invalidated to obtain it.

## Verification

| Check | Result | Evidence |
| --- | --- | --- |
| Repository gate | PASS | `pnpm verify`; all static stages exit 0 |
| Smart Form unit tests (required path) | PASS | `pnpm --filter @unit-talk/smart-form verify`, invoked by `verify:static`; 132 passed, 0 failed |
| Auth-gate E2E at this head | PASS | `pnpm exec playwright test e2e/auth-gate.spec.ts`; 3 passed against the running app |
| Review-round corrections (5 findings) | PASS | 9 new tests, each proven by reverting its fix; see "Review round" below |
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

### Review round — five findings, one bounded correction

GitHub review left five unresolved, non-outdated threads on head `6c640ca0`.
Each was checked against `apps/api/src/smart-form-validation.ts` — the server
that would receive these payloads — before being treated as real. All five were
real, and all five are corrected in `1be0d992`.

| # | Finding | Server rule it violated | Correction |
| - | --- | --- | --- |
| P1-a | Manual team-sport submission did not require both sides | `smart-form-validation.ts:129` — team sports need two entered participants | `evaluateSubmissionGuards` refuses before submit |
| P1-b | Manual provenance repeated the selected side under a second role | `:154-163` — manual participants must be distinct | `buildManualEnteredParticipants` emits distinct names only |
| P1-c | Canonical player props could carry `eventId: null` | `:203` — a canonical player needs a canonical event | `evaluateSubmissionGuards` requires a matchup |
| P2-a | `submitPick` preferred `ut_capper_token` over a valid session | API rejects the stale bearer; the session was valid | `resolveSubmitAuthorization` prefers the session |
| P2-b | `.env.example` documented a variable the browser never sees | Next.js inlines only `NEXT_PUBLIC_*` into client bundles | Both names documented; fixture E2E sets the working one |

Each correction was reverted in turn and the suite re-run. A guard whose test
still passes when the guard is gone proves nothing, so this is the load-bearing
evidence, not the green run:

```text
mutation: dedupe removed from manual provenance
  not ok 17 - manual team-sport submission is refused until both sides are entered
  not ok 18 - manual team-sport submission is refused when both sides name the same participant
  not ok 19 - manual provenance never repeats the selected side under a second role
  not ok 20 - manual provenance treats punctuation and case differences as the same participant
  # pass 21  # fail 4

mutation: team-sport two-side requirement removed
  not ok 17, not ok 18                                            # pass 23  # fail 2

mutation: player-prop event requirement removed
  not ok 21 - a canonical player prop is refused without a canonical event
                                                                  # pass 24  # fail 1

mutation: recovery token preferred over session again
  not ok 24 - submitPick prefers the authoritative session bearer over a stored recovery token
                                                                  # pass 24  # fail 1

mutation: env template + fixture command reverted to the unprefixed name
  not ok 25 - the QA auth bypass is documented under the name the browser bundle can see
                                                                  # pass 24  # fail 1

baseline restored                                                 # pass 25  # fail 0
```

Every block also asserts the case that must **still be allowed**, so a guard
that simply refused everything would fail here too: individual sports with
one-participant markets (`GOLF`), a genuinely distinct third team name, a
team-sport market with no player, a player prop with its matchup selected, and
the operator-recovery path with no session.

The client's `CLIENT_TEAM_SPORT_IDS` duplicates a server list that cannot be
imported — `apps` never import from `apps`, and the list is in neither a shared
package nor a contract. It is pinned by a test that reads the API source and
compares; adding `'WNBA'` to the server set during independent review made that
test, and only that test, fail.

### Independent verification of the correction

One focused independent review was obtained, scoped to these five corrections
only. It read the server file rather than trusting the commit message, and
re-ran each mutation itself. Verdict: all five **CORRECTED**, each new client
rule matching its cited server rule, all five inversion tests real (each kills
its target mutation and only that mutation), and no new defect blocking a
legitimate submission path.

It returned one finding against this lane, which was checked and confirmed
against the server before being accepted: the justification comment on
`participantAliasKey` named the wrong backstop. It claimed a look-alike the
client fails to collapse is refused by the server's non-ASCII check; that check
is `hasNonAscii(foldConfusables(name))`, so a character in the confusable table
folds to ASCII and passes it. The duplicate is actually caught by `aliasKey`,
which folds as well. The conclusion the comment defended still holds — the
client is only ever more permissive than the server, never less — but it rested
on a mechanism that does not exist. Corrected in `9c8d2d43`, comment only.

It also noted, as informational and pre-existing, that `BetForm.tsx:92` carries
its own local `TEAM_SPORTS` set spelling `'Soccer'` in mixed case. It predates
this lane, does not affect the new guards (`isTeamSportId` normalizes case), and
is recorded as a follow-up rather than changed here.

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
- [x] A manual team-sport submission cannot be sent with one side, and cannot be
      sent with two entries naming the same participant. Both are what the API
      counts as fewer than two participants.
- [x] Manual provenance never lists one display name under two roles, so the
      selected market side no longer duplicates an entered event side.
- [x] A canonical player prop cannot be submitted without the canonical event
      that makes its team membership verifiable.
- [x] A submission from an authenticated operator carries the server-signed
      session bearer, not a stored recovery token, so a stale or forged recovery
      token can no longer 401 an otherwise valid submission.
- [x] The QA bypass is documented under the name the browser bundle can actually
      see, and the fixture E2E command sets that name.

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

Re-executed at the corrected head `9c8d2d43`:

```text
$ pnpm type-check                                 -> exit 0
$ pnpm lint                                       -> exit 0
$ pnpm test                                       -> exit 0
# tests 5369
# pass 5369
# fail 0
  Zero 'not ok' lines across the whole run.

$ pnpm --filter @unit-talk/smart-form verify      -> exit 0
# tests 132
# pass 132
# fail 0

$ pnpm exec playwright test -c playwright.config.ts e2e/auth-gate.spec.ts -> 3 passed
  ✓ 1 unauthenticated submit redirects to the Unit Talk Capper Portal (2.8s)
  ✓ 2 a forged capper token stored in localStorage does not open /submit (2.1s)
  ✓ 3 storing a recovery token does not sign the operator in (2.0s)
```

The auth gate itself is byte-identical to head `6c640ca0`: `git diff
6c640ca0..9c8d2d43 -- app/submit/page.tsx app/login/page.tsx lib/auth-config.ts
lib/auth-allowlist.ts auth.ts` is empty. The three specs and their mutation
control were nonetheless re-executed at the corrected head rather than carried
forward on that argument alone.

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
`source_sha` is `9c8d2d43` — the last non-proof commit, which is what the merge
binding and the executor result are pinned to. The PR head is the proof-only
commit that carries this file. Setting `source_sha` to the PR head cannot be
done without changing the PR head again, so the condition is unsatisfiable for
any proof committed to its own branch pre-merge. It resolves at merge, when
`post-merge-lane-close.yml` rebinds both anchors to the authoritative merge SHA.
This is disclosed rather than worked around; no SHA is misreported.
