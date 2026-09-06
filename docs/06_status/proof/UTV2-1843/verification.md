# PROOF: UTV2-1843 — Smart Form product intent consolidation

MERGE_SHA: pending merge

## ASSERTIONS:

1. `docs/03_product/smart-form/intent.md` exists and covers the complete operator journey —
   authentication and canonical identity, sport-aware selections, database-backed participants,
   automatically derived matchups, honest fallback on missing event or participant coverage, signed
   odds, bet-slip review, submission, receipt, persisted Track Only truth, and observation — with
   each behaviour tied to an implementation citation and to a named form of verification.
2. The contained pilot and a finished, repeatably usable Smart Form are distinguished explicitly,
   and the document states that a merge or a unit-test count cannot establish deployed usability.
3. Both signed-field `Input mode` prescriptions in
   `docs/05_operations/SMART_FORM_V1_OPERATOR_SUBMISSION_CONTRACT.md` are corrected **in the
   contract**, with the reason recorded inline. The intent document points at the corrections and
   does not restate them.
4. Acceptance Criterion 11 of the same contract is corrected in place to the rule the two later
   ratified confidence contracts require and the code implements.
5. `apps/smart-form/CLAUDE.md` no longer describes the app as public-facing or unauthenticated.
6. Product intent is required reading through `CLAUDE.md`, `AGENTS.md` and `apps/api/CLAUDE.md`
   including for backend work; `docs/03_product/*/intent.md` is registered in the docs authority
   map; `/dispatch` packets quote applicable acceptance criteria inline.
7. No gate, required check, workflow, label, approval artifact or lane type is added.
8. Every `file:line` citation in the new document was re-measured against the branch head.

## EVIDENCE:

| Assertion | Evidence |
|---|---|
| 1, 2 | `docs/03_product/smart-form/intent.md` in this diff — §3 (journey, per-step implementation and verification), §5 (pilot vs finished table), §7 (what counts as verification), §8 (state table with gaps marked) |
| 3, 4 | `docs/05_operations/SMART_FORM_V1_OPERATOR_SUBMISSION_CONTRACT.md` in this diff — the two `Input mode` rows and Acceptance Criterion 11, each with an inline "Corrected 2026-09-06" note |
| 5 | `apps/smart-form/CLAUDE.md` in this diff |
| 6 | `CLAUDE.md`, `AGENTS.md`, `apps/api/CLAUDE.md`, `docs/05_operations/docs_authority_map.md`, `.claude/commands/dispatch.md` in this diff |
| 7 | `git diff --stat` below: no `.github/workflows/**` path, no `package.json`, no schema |
| 8 | The citation re-measurement table in §2 below, and the printed source lines beneath it |

### Commands run

```
pnpm lint                              # exit 0
pnpm type-check                        # exit 0
pnpm build                             # exit 0
pnpm test                              # exit 0 — tests 5962, pass 5962, fail 0
pnpm verify                            # refused locally at test:live-db under containment, see below
npx tsx scripts/ci/r-level-check.ts --issue UTV2-1843
                                       # Verdict: PASS · Changed files: 12 · Rules matched: operator-ui
```

`scripts/ci/r-level-check.ts` matched the `operator-ui` rule and returned PASS with every triggered
`required[]` artifact present.

### Diff scope

```
 .claude/commands/dispatch.md                       |   9 +
 AGENTS.md                                          |  17 +
 CLAUDE.md                                          |  17 +
 apps/api/CLAUDE.md                                 |  21 +
 apps/smart-form/CLAUDE.md                          |  78 +++-
 docs/03_product/smart-form/intent.md               | 485 +++++++++++++++++++++
 .../SMART_FORM_V1_OPERATOR_SUBMISSION_CONTRACT.md  |  31 +-
 docs/05_operations/docs_authority_map.md           |   1 +
 docs/06_status/proof/UTV2-1843/.gitkeep            |   0
```

No `.github/workflows/**` file, no `package.json`, no migration, no schema, no source code.

---


## Verification

**Lane:** claude
**Tier:** T2
**Lane type:** governance
**Branch:** claude/utv2-1843-smart-form-product-intent
**Scope:** documentation and agent-instruction consolidation only. No runtime code, no schema, no
workflow, no check, no label, no gate.

## Merge SHA Binding

| Field | Value |
|---|---|
| PR: | https://github.com/griff843/Unit-Talk-v2/pull/1521 |
| MERGE_SHA: | pending merge |
| Verified source SHA: | 79bab4d2267061427b48f7a521a8c61acb72436f |

PR: https://github.com/griff843/Unit-Talk-v2/pull/1521
MERGE_SHA: pending merge
Verified source SHA: 79bab4d2267061427b48f7a521a8c61acb72436f

`79bab4d2267061427b48f7a521a8c61acb72436f` is the commit carrying every content change in this
lane, and it is the tree the commands below were run against. The commits after it on this branch
touch only `docs/06_status/lanes/UTV2-1843.json` and this file, so no verified content moved.

## What was verified, and how

### 1. Commands run on the branch

```
pnpm lint          # exit 0
pnpm type-check    # exit 0
pnpm build         # exit 0
pnpm test          # exit 0 — tests 5962, pass 5962, fail 0
pnpm verify        # refused locally at test:live-db, see below
```

`pnpm verify` cannot complete in this environment and the refusal is not a failure of this change.
Its `test:live-db` step calls `pnpm ci:assert-staging`, which resolves the configured Supabase host
and refuses anything that is not the staging project:

```
[assert-staging] host=127.0.0.1 ref=unidentified expected=xskgrzbteyqdufktjrjx
[assert-staging] REFUSED: target identity could not be resolved from its URL (host=127.0.0.1).
```

`local.env` pins `SUPABASE_URL=http://127.0.0.1:1` under production containment, so the writable-DB
step is structurally unrunnable here. It runs in CI through the `staging-ci` environment, and the
authoritative `verify` receipt for this branch is the CI run, not this local one. The four steps
`verify` runs before it — lint, type-check, build, test — all pass locally and are recorded above.

### 2. Every file:line citation re-measured against the branch head

This document is mostly citations, and a stale citation is this lane's dominant failure mode. Each
`path:line` in `docs/03_product/smart-form/intent.md` was extracted mechanically and the line at
that number printed from the branch's own checkout, not recalled. Two were wrong and were corrected
before commit:

| Citation as first written | Actual | Corrected to |
|---|---|---|
| `lib/form-utils.ts:326` for `confidence` | `:326` is `odds: values.odds` | `:317,328,377` |
| `docker-compose.yml:223` | ambiguous — root file has no line 223 | `deploy/production/docker-compose.yml:223` |

Spot receipts for the load-bearing ones, printed from the branch:

```
apps/smart-form/auth.ts:24                     return findAllowedCapper(email, allowedCappers) !== null;
apps/smart-form/auth.ts:35                     token.capperId = capper.capperId;
apps/smart-form/lib/auth-allowlist.ts:43       export function parseAllowedCapperEmails(...)
apps/api/src/handlers/submit-pick.ts:93        // UTV2-1672 CAPPER_TRACK_ONLY_PIN_GUARD_START
apps/api/src/handlers/submit-pick.ts:119           if (metadata['distributionMode'] === undefined) {
apps/api/src/handlers/submit-pick.ts:143       const submittedBy = auth?.role === 'capper' && auth.capperId
apps/api/src/controllers/submit-pick-controller.ts:36  await validateSmartFormRelationships(payload, repositories.referenceData);
apps/api/src/controllers/submit-pick-controller.ts:86  if (!routingShadowEnabled && isTrackOnlyPickMetadata(result.pick.metadata)) {
apps/api/src/smart-form-validation.ts:9        const TEAM_SPORTS = new Set([...])
apps/api/src/smart-form-validation.ts:500      async function findCanonicalCoverage(
apps/api/src/handlers/reference-data.ts:37     teamsAvailable: teams.length > 0,
apps/smart-form/lib/form-utils.ts:317          const confidence = values.capperConviction >= 10 ? 0.99 : values.capperConviction / 10;
apps/smart-form/lib/form-utils.ts:377          confidenceSource: 'capper-conviction',
apps/smart-form/app/submit/components/BetForm.tsx:1799      form.setValue('eventName', `${awayName} @ ${homeName}`, {
apps/smart-form/app/submit/components/BetForm.tsx:1902      if (!manualIdentityOverride && awayParticipantId === homeParticipantId) {
apps/smart-form/app/submit/components/BetForm.tsx:3148      inputMode="decimal"
apps/smart-form/app/submit/components/BetForm.tsx:3922      inputMode="numeric"
deploy/production/docker-compose.yml:223       test: ["CMD", "curl", "-fsS", "http://localhost:4400/login"]
```

### 3. The two contract contradictions were confirmed to exist before correcting them

Not assumed from a summary — read out of the contract on `main`:

- `SMART_FORM_V1_OPERATOR_SUBMISSION_CONTRACT.md` § "Odds — American Format" carried
  `| Negative range | -100 to -50000 |` and `| Input mode | \`numeric\` |` in the same table.
  `inputMode="numeric"` renders a digits-only keypad with no minus key, so the negative range was
  unenterable on the mobile surface the same contract's Acceptance Criterion 13 requires. The
  implementation matched the contract exactly (`BetForm.tsx:3922`), and the operator hit it on a
  real device during the pilot.
- The same table one field down carried `| Range | -999.5 to +999.5 |` with
  `| Input mode | \`decimal\` |`, implemented at `BetForm.tsx:3148` with the placeholder `e.g. -3.5`.
  `decimal` also has no minus key. **This one was not reported by the operator** — it was found by
  enumerating every `inputMode` in the app rather than fixing only what was reported, and it is
  corrected in the same pass.
- Acceptance Criterion 11 read "Confidence is not present on the operator form", which
  `T1_SMART_FORM_V1_CONTRACT.md` and `T2_SMART_FORM_CONFIDENCE_CONTRACT.md` (UTV2-49) both
  contradict and which `form-utils.ts:317,328,377` implements the opposite of.

Both are corrected **in the canonical contract, in place**, with the reason recorded inline so the
correction cannot be tidied back as a typo. The intent document points at the corrections; it does
not restate them.

### 4. No gate, check, workflow, label or lane type was added

Confirmed by diff. The changed set is eight files: one new product intent document, one canonical
contract corrected, one authority-map row, four agent-instruction files, and one skill file. No
`.github/workflows/**` file is touched, no `package.json` script is added, no schema changes, and
no required check is affected.

## Known non-blocking failures, stated rather than discovered in review

`Lane authority` and `Return review packet` are expected to report out-of-scope files on this PR.
Neither is a required check (branch protection requires exactly `verify`, `Executor Result
Validation`, `Merge Gate`, `P0 Protocol`), so neither blocks the merge — but the cause is recorded
here rather than left for a reviewer to rediscover.

`.lane/lanes/governance.yml` admits `docs/05_operations/**`, `CLAUDE.md`, `AGENTS.md` and
`.claude/commands/**`, and admits none of:

- `docs/03_product/**` — no lane type admits it at all
- `apps/api/CLAUDE.md` — reachable only under the `runtime` lane's `apps/api/**`
- `apps/smart-form/CLAUDE.md` — reachable only under the `delivery-ui` lane's `apps/smart-form/**`

So this change genuinely spans three lane types and **no single lane type can hold it**. That is a
structural property of the change, not a scoping mistake: the user's instruction names
`docs/03_product/smart-form/intent.md` explicitly, and wiring required reading is only meaningful if
it reaches the app-level instruction files that agents actually read.

The lane's own `file_scope_lock` declares all eight paths, so `File scope lock` should pass; it is
the lane-type glob list that disagrees. `.lane/lanes/governance.yml` is outside this lane's
`file_scope_lock`, which is pinned at lane-start and cannot be widened by an agent, so registering
`docs/03_product/**` and `apps/*/CLAUDE.md` there would require a CODEOWNERS `scope-override/v1`.
That registration is the durable repair and is recorded as a recommendation — it is deliberately
**not** requested as a precondition for this PR, because the instruction that authorized this work
stated it must not become another prerequisite or gate framework.

## Correction made during review, before merge

The first draft of `intent.md` §3.2 stated that canonical identity "**resolved to `griff843`**" in
production on 2026-09-06. That is not established by anything measurable from here. No pick has
persisted — step 4 is blocked — so there is no `capper_id` to read back, and a session claim is not
observable to an agent.

What **is** established, and what the document now says: production `d3f69b804` has #1488
(`2ac233424`) as an ancestor (`git merge-base --is-ancestor`, verified), and `auth.ts:24` admits a
sign-in only when `findAllowedCapper` returns non-null, which the post-#1488 parser cannot do
without an explicit `=<canonicalCapperId>` entry. So a successful sign-in on this build proves an
explicit canonical mapping was used and that local-part derivation did not occur — and proves
nothing about *which* id. The pilot-progress line was narrowed the same way, from "steps 1-3
passed" to steps 1 and 2, with step 3 established only to that extent.

This is the exact defect class this document warns about in §7 — a self-consistent claim that no
assertion constrains — caught in the artifact whose purpose is to prevent it.

## Corrections made on owner review, 2026-09-06

Three defects were reported by the owner after the first push. All three are in the document's
*claims*, not in the wiring, and each was measured before being corrected.

**1. `intent.md` §4.1 asserted that seeding the catalog requires unparking provider ingestion.**
False. `docs/05_operations/T1_REFERENCE_DATA_SEEDING_AND_RECONCILIATION_POLICY.md` (RATIFIED
2026-04-02) §1 lists sports, leagues, **teams**, sportsbooks, market families, market types and stat
types with primary seed source *"Governed static seed (migration)"*, ongoing refresh source
*"None"*, and provider contribution *"Nothing"*. §2 states a team row *"cannot be created from a
provider observation alone — must be seeded from governed data or operator-approved."* Only players
and player-team assignments are provider-sourced. The section now distinguishes an authorized
static reference-data seed (production data — reserved item 1) from provider activation (reserved
items 3 and 6), states that neither requires the other, and states that **neither is a Milestone 1
prerequisite**. Standing criterion 5 in §9 was corrected the same way; it previously collapsed both
into "a reserved decision".

**2. `intent.md` §8 recorded Submission as "Done".** It is not. Every real attempt 422s on the
event-existence gate (UTV2-1842 finding A) and no pick has persisted. The table now carries an
explicit state vocabulary — Exercised / Implemented, blocked in the deployed flow / Implemented,
unreachable today / Partial / Gap — and the distinction is applied consistently, not only to the
reported row. Five rows moved off an implicit "Done": Submission, Receipt, Track Only persisted
truth, read-only observation and honest fallback provenance are each implemented and unreachable
behind the same gate; event-bound participants is unreachable because production holds 789 events
and **0 in the future**. Rows that were genuinely performed against the deployed system — reaching
the form, authenticating, sport-aware selection, bet-slip review — are now labelled *Exercised*
rather than *Done*, so the word carries a measured meaning.

**3. "Non-required check" was treated as authorization for the `Lane authority` red.** It is not,
and that reasoning is withdrawn. `lane:check` fails on exactly three paths — `apps/api/CLAUDE.md`,
`apps/smart-form/CLAUDE.md` and `docs/03_product/smart-form/intent.md` — none of which any lane
contract in `.lane/lanes/` admits (`grep -l 03_product .lane/lanes/*.yml` returns nothing;
`apps/smart-form/**` is admitted only by `delivery-ui`). The supported resolution is the one
`.lane/lanes/governance.yml` records eight times in its own comments: the lane that hits the gap
adds the bounded glob in the same PR. `.lane/lanes/governance.yml` is outside this lane's pinned
`file_scope_lock`, so that edit requires a CODEOWNERS `scope-override/v1` pinned to the head. That
request is stated exactly in the PR body rather than routed around.

## What this lane does not claim

- It does not claim the Smart Form is usable. Three of its findings are open gaps tracked under
  UTV2-1842, and the intent document marks them as gaps rather than omitting them.
- It does not claim the corrected `inputMode` prescription has been implemented. Changing the
  control is UTV2-1842's diff; this lane corrects the contract that told the control to be wrong.
- It does not claim any browser or device verification. No such run was performed here.
