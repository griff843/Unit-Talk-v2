# UTV2-1859 — Diff Summary

**Issue:** UTV2-1859 — remove the stale client submission guard that refuses a canonical player prop without a canonical event
**Lane:** claude · **Tier:** T2 · **Lane type:** delivery-ui
**Branch:** `claude/utv2-1859-client-submission-guard`
MERGE_SHA: pending merge
**Verified source SHA:** `c10f289cbc654c2f5ba2ac152c5685b49d57a3dc`

## What changed

```
 apps/smart-form/e2e/smart-form-submission.spec.ts | 129 ++++++++++++++++++++++
 apps/smart-form/lib/form-utils.ts                 |  34 +++---
 apps/smart-form/test/api-client.test.ts           |  10 +-
 apps/smart-form/test/form-utils.test.ts           |  52 +++++++++
 4 files changed, 205 insertions(+), 20 deletions(-)
```

Four files, all under `apps/smart-form/`. No server file is touched, no contract is touched, no
workflow, gate, label, approval artifact or lane type is added or changed.
`git diff origin/main --name-only -- .github/` is empty.

## `apps/smart-form/lib/form-utils.ts` (+16 / -18)

Three edits, one of which is the repair and two of which are the control that stops it recurring.

1. **The guard is deleted.** `evaluateSubmissionGuards` carried a `canonical-player-requires-event`
   branch that refused every structured-fallback canonical player selection made without a canonical
   event. `'canonical-player-requires-event'` is removed from the `SubmissionGuardFailure['code']`
   union, and the branch is replaced by a comment stating why no player branch belongs there.

2. **The reason is recorded where the branch was**, rather than in a commit message that nobody
   reads at the point of the next change. The server rule this mirrored — *"canonical player
   selection requires a canonical event so team membership can be verified"* — was removed by
   UTV2-1856. What the server enforces now is narrower and lives in `validateSearchBackedPlayer`:
   it refuses only a player whose `match.teamId` is falsy, i.e. one whose team relationship the
   participants observation edge cannot establish. **A client cannot evaluate that predicate**,
   because deciding it requires the same `searchPlayers` read the server performs. Mirroring it here
   would either re-refuse valid picks or guess at the answer. The server's refusal is explicit and
   reaches the operator as a submission error, so the honest client behaviour is to send the request
   and let the authority answer it.

3. **Four `smart-form-validation.ts:NNN` line-number citations become quoted server text.** Each
   surviving guard that exists only because a server rule exists now carries a
   `// SERVER-RULE: <fragment>` comment whose fragment is a literal substring of
   `apps/api/src/smart-form-validation.ts`. Line numbers drift silently; quoted text does not.

## `apps/smart-form/test/api-client.test.ts` (+8 / -2)

One assertion inverted. It asserted that a canonical player prop with no event is refused; it now
asserts the same input returns `null`, i.e. is admitted. The test's own comment records that it
asserted the opposite until UTV2-1856 changed the server, so the inversion is visible as a
deliberate correction rather than a silent edit.

## `apps/smart-form/test/form-utils.test.ts` (+52 / -0)

Two new tests, and the first is the point of the lane:

- **`every client submission guard cites a server rule that still exists`** reads both
  `apps/smart-form/lib/form-utils.ts` and `apps/api/src/smart-form-validation.ts` as **text**,
  extracts every `// SERVER-RULE:` fragment, and asserts each one is still present in the server
  file. Reading the server as text rather than importing it is required: invariant 8 forbids an app
  importing from another app. This is the same technique `executor-result-validate.test.ts` uses to
  hold two copies of one rule in agreement across a TypeScript module and a workflow YAML.
- **`no client guard refuses a structured-fallback player prop that has no event`** pins the
  specific behaviour this lane restores.

## `apps/smart-form/e2e/smart-form-submission.spec.ts` (+129 / -0)

One appended Playwright test that drives the real form in a real browser: NBA, a date with no
scheduled event, manual matchup fallback, a canonical team and a canonical player selected from
search, a Points Over 27.5 at -110, conviction 8, then Submit. It intercepts `**/api/submissions`,
asserts **exactly one** request is issued, and asserts on the captured payload that
`metadata.distributionMode` is `track-only`, that the participant resolution is `canonical`, that
the event id is null on both the resolution and the metadata, and that the resolved player carries
its `teamId`.

It never contacts a live server: reference data and the submission endpoint are both intercepted, so
the harness stays a browser-to-API contract test and no credential is placed in its environment.

