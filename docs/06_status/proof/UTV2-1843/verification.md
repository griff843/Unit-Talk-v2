# UTV2-1843 — Verification

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

## What this lane does not claim

- It does not claim the Smart Form is usable. Three of its findings are open gaps tracked under
  UTV2-1842, and the intent document marks them as gaps rather than omitting them.
- It does not claim the corrected `inputMode` prescription has been implemented. Changing the
  control is UTV2-1842's diff; this lane corrects the contract that told the control to be wrong.
- It does not claim any browser or device verification. No such run was performed here.
