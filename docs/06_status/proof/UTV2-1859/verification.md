# PROOF: UTV2-1859 — remove the stale client submission guard

**Issue:** UTV2-1859 · **Lane:** claude · **Tier:** T2 · **Lane type:** delivery-ui
**Branch:** `claude/utv2-1859-client-submission-guard`
MERGE_SHA: 9abb4ac62aa150d097d3adfc04b05fd9ee6d6629

**Verified source SHA:** `c10f289cbc654c2f5ba2ac152c5685b49d57a3dc`

## Merge SHA Binding

| Field | Value |
|---|---|
| PR: | https://github.com/griff843/Unit-Talk-v2/pull/1539 |
| MERGE_SHA: | pending merge |
| Verified source SHA: | c10f289cbc654c2f5ba2ac152c5685b49d57a3dc |

PR: https://github.com/griff843/Unit-Talk-v2/pull/1539
Merge SHA: 9abb4ac62aa150d097d3adfc04b05fd9ee6d6629
Verified source SHA: c10f289cbc654c2f5ba2ac152c5685b49d57a3dc

`c10f289cbc654c2f5ba2ac152c5685b49d57a3dc` is the last commit on this branch that changes any file
outside `docs/06_status/proof/UTV2-1859/`, and it is the tree every command in this document was run
against. It is the second merge of `origin/main` into this branch, taken to satisfy strict
branch-protection freshness rather than to change anything: both resyncs brought documentation only
and zero application code.

## ASSERTIONS:

- [x] **A1 —** The `canonical-player-requires-event` branch is removed from
      `evaluateSubmissionGuards` (`apps/smart-form/lib/form-utils.ts`), and its code is removed from
      the `SubmissionGuardFailure['code']` union so it cannot be reintroduced by accident.
- [x] **A2 —** A canonical player prop with no scheduled event is admitted by the client:
      `evaluateSubmissionGuards({sportId:'NBA', identityMode:'structured-fallback',
      canonicalEventId:null, selectedPlayerId:'player-123'})` returns `null`.
- [x] **A3 —** A real browser now issues exactly one `POST /api/submissions` for that ticket. The
      Playwright case at `apps/smart-form/e2e/smart-form-submission.spec.ts:1366` drives the form to
      Submit and asserts `expect.poll(() => submissionRequests).toBe(1)`.
- [x] **A4 —** The captured payload is truthful: `metadata.distributionMode` is `track-only`,
      participant resolution is canonical, the event id is `null` on both the resolution and the
      metadata, and the resolved player carries its `teamId`.
- [x] **A5 —** Every remaining client guard that exists only because a server rule exists cites that
      rule as a quoted `// SERVER-RULE:` fragment, and a test reads
      `apps/api/src/smart-form-validation.ts` as text and fails when a cited fragment is no longer
      there. All three fragments were confirmed present on `origin/main`, so the control is not
      vacuous.
- [x] **A6 —** Three mutations each turn a distinct assertion red — a stale citation, the restored
      guard against the unit tests, and the restored guard against the browser. The third reproduces
      the originally reported symptom exactly (`Expected: 1, Received: 0`).
- [x] **A7 —** Scope is four files, all under `apps/smart-form/`, matching `file_scope_lock`. No
      server file, no contract, and nothing under `.github/` is touched: no gate, required check,
      workflow, label, approval artifact or lane type is added.

## EVIDENCE:

Every command below was re-run at the verified source SHA above, after the second `main` resync.

## What was actually wrong

Milestone 1 step 4 could not be performed in a browser even after UTV2-1856 (#1536) repaired the
server. `evaluateSubmissionGuards` in `apps/smart-form/lib/form-utils.ts` carried a
`canonical-player-requires-event` branch that refused a canonical player prop with no scheduled
event, and it refused it **before the request existed** — the operator pressed Submit and the form
issued no `POST /api/submissions` at all, showing *"Select a canonical matchup"*.

That branch mirrored a server rule. Its own comment cited the rule by `file:line`. UTV2-1856
removed the server rule and left the mirror behind. **No server-side evidence can detect this
class**, because the defect is that the request is never sent: the server tests assert the server's
new behaviour, the client tests asserted the client's old behaviour, and nothing compared them. A
green `pnpm verify`, a complete proof bundle and a merged server repair all coexisted with a form
that refused.

## Verification

All commands were run in the lane worktree
`.out/worktrees/claude__utv2-1859-client-submission-guard` at the verified source SHA
`c10f289cbc654c2f5ba2ac152c5685b49d57a3dc`, after `CI=true pnpm install --frozen-lockfile`. That
SHA is the second `main` resync merge; every command in this section was re-run against it rather
than carried forward from the pre-resync anchor, and both resyncs brought documentation only —
zero application code — which is why the counts below do not move.

### `pnpm type-check`

```
> @unit-talk/v2@0.1.0 type-check
> pnpm exec tsc -b tsconfig.json
exit=0
```

No diagnostics.

### `pnpm test` — the two touched suites

```
pnpm exec tsx --test apps/smart-form/test/form-utils.test.ts apps/smart-form/test/api-client.test.ts
# tests 58
# pass 58
# fail 0
exit=0
```

The full suite runs in the required `verify` check on this PR, which is the authoritative result.
No local full-suite PASS is claimed here.

### Browser run — the evidence this lane exists to produce

```
NEXT_PUBLIC_SMART_FORM_QA_AUTH_BYPASS=1 npx playwright test -c playwright.config.ts \
  e2e/smart-form-submission.spec.ts --workers=1 --reporter=line

14 passed (1.1m)
E2E_EXIT=0
```

Run three times on this lane in total: **14 passed (2.3m)** at the first implementation anchor,
**14 passed (1.1m)** after the lint retype, and **14 passed (1.1m)** at the verified source SHA
above. The wall-clock figure moves with machine load and carries no information; the pass count and
the exit code are the receipt.

The new test at `e2e/smart-form-submission.spec.ts:1366` drives the deployed form's own code in a
real browser: NBA, a date with no scheduled event, manual matchup fallback, a canonical team and a
canonical player selected from search, Points Over 27.5 at -110, conviction 8, Submit. It asserts
exactly one `POST /api/submissions` is issued and, on the captured payload,
`metadata.distributionMode === 'track-only'`, canonical participant resolution, a null event id on
both the resolution and the metadata, and the resolved player's `teamId`.

### `pnpm lint`

```
> eslint . --cache --cache-location .cache/eslint/
exit=0
```

**Added after CI caught what this bundle had not measured.** The first `verify` run on this branch
failed at `apps/smart-form/e2e/smart-form-submission.spec.ts:1469:65` with
`@typescript-eslint/no-explicit-any: Unexpected any` — the payload assertion used
`Record<string, any>`. It is now an explicit shape naming `distributionMode`, `eventId` and the
`participantResolution` fields the test actually reads, which is a better assertion target than
`any` regardless of the rule.

This is recorded rather than quietly amended, because the interesting part is not the rule but the
gap: the local gate on this lane was `pnpm type-check` plus the two touched suites, and `pnpm lint`
was never re-run after the code was written. Preflight's `verify:quick` ran at lane-start, before
the code existed. The first attestation therefore described a green tree that had not been fully
measured, which is the same failure mode this lane exists to close, committed against itself.

After the retype: `pnpm lint` exit 0, `pnpm type-check` exit 0, and the browser suite re-run —
**14 passed (1.1m)**, exit 0. The retype changes the exact object the Track Only and provenance
assertions destructure, so the suite was re-run rather than assumed unaffected.

### `npx tsx scripts/ci/r-level-check.ts --issue UTV2-1859`

```
Verdict: PASS
Changed files: 9
Rules matched: operator-ui
```

**This output changed across the resyncs and is recorded as it now reads, not as it first read.** At
the pre-resync anchor it reported `Changed files: 3` and `Rules matched: (none)`. At the verified
source SHA it reports 9 changed files and matches `operator-ui`, because the check compares against
`main` and the two resync merges pulled UTV2-1843's documentation into the comparison. The verdict
is `PASS` in both readings — every `required[]` artifact triggered by `operator-ui` is present —
but the earlier numbers would have been a stale receipt for this head, so they are superseded here
rather than left standing. The count still does not equal the four files this lane actually changed;
that discrepancy is reported rather than reconciled to a convenient number.

## Mutation testing — three mutations, three distinct assertions

A control that never fails on the condition it names proves nothing. Each mutation below was applied
to the branch, the relevant suite was run, and the file was restored and re-run green.

### 1. Stale `SERVER-RULE` citation → the coupling control fails

One `// SERVER-RULE:` fragment was altered so it no longer appears in
`apps/api/src/smart-form-validation.ts`:

```
# tests 33
# pass 32
# fail 1
error: 'client guard cites a server rule that is no longer in apps/api/src/smart-form-validation.ts:
        manual participant resolution requires at least one entered PARTICIPANTX'
```

**This is the control that would have caught UTV2-1856.** It is the whole point of the lane: the
previous coupling was a `file:line` citation in a comment, which is documentation of the coupling
and not enforcement of it. The replacement quotes the server's own text and reads
`smart-form-validation.ts` as text at test time — required, because invariant 8 forbids an app
importing from another app. It is the same technique `executor-result-validate.test.ts` uses to hold
a TypeScript module and a workflow YAML byte-identical.

### 2. Restore the deleted guard → the unit tests fail

```
# tests 58
# pass 55
# fail 3
not ok 21 - a canonical player prop is admitted without a canonical event
not ok 58 - no client guard refuses a structured-fallback player prop that has no event
```

Restoring the file returns `# tests 58 / # pass 58 / # fail 0`.

### 3. Restore the deleted guard → the browser test fails with zero requests

```
1 failed
  e2e/smart-form-submission.spec.ts:1366 › a structured-fallback player prop with no scheduled event submits
1 passed (33.2s)
MUT_EXIT=1

Error: expect(received).toBe(expected)
  Expected: 1
  Received: 0
  Timeout 5000ms exceeded while waiting on the predicate
  > 1467 |   await expect.poll(() => submissionRequests).toBe(1);
```

**Expected 1, received 0** is Griff's finding reproduced exactly: the form refuses before issuing a
request. The test detects it.

## Why the guard was deleted rather than corrected

The obvious repair — rewrite the client mirror to match the server's *new* rule — would recreate the
defect. What the server enforces now, in `validateSearchBackedPlayer`, is narrow: it refuses only a
player whose `match.teamId` is falsy, i.e. one whose team relationship the participants observation
edge cannot establish. **A client cannot evaluate that predicate**, because deciding it requires the
same `searchPlayers` read the server performs. A client mirror would either re-refuse valid picks or
guess at the answer. The server's refusal is explicit and reaches the operator as a submission
error, so the honest client behaviour is to send the request and let the authority answer.

## Scope

Four files, all under `apps/smart-form/`, matching `file_scope_lock` exactly. No server file, no
contract, no workflow, no gate, no label, no approval artifact, no lane type.
`git diff origin/main --name-only -- .github/` is empty.

The `docs/06_status/proof/UTV2-1859/.gitkeep` that `ops:lane-start` committed was deleted: the
review packet demands it be declared in scope while CEP-E2 refuses it once declared, and
`expected_proof_paths` is settable only at `create`. This bundle's two markdown files keep the
directory present.

## What this does not claim

- **It does not claim the deployed Smart Form works.** Production is `d3f69b804` and neither this
  change nor UTV2-1856 is running there. Dispatching a deployment is a reserved decision.
- **It does not claim Milestone 1 step 4 is performed.** That step is an operator action by Griff
  against the deployed system. This is a browser run against locally built code with the submission
  endpoint intercepted.
- **It does not claim a database write.** The e2e intercepts `**/api/submissions` and asserts the
  request and its payload; persistence is asserted by `pnpm test:db` and the
  `Writable DB proof (staging only)` job, and no credential is placed in the Playwright environment.
- **It does not claim UTV2-1856 is merged.** #1536 is open and awaiting a T1 verdict. The three
  server fragments this lane's coupling test cites were verified to exist on `origin/main`, so the
  control is not vacuous and this lane is green on a `main` base independently of #1536.
- The two changes must nevertheless **reach production together**: shipping this client change
  without #1536 would let the browser send a request the deployed server still refuses.

