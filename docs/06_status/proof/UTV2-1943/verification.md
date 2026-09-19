# PROOF: UTV2-1943

MERGE_SHA: pending merge

> Pre-merge the merge row is intentionally the placeholder; the Execution SHA row carries
> the verified implementation identity. `post-merge-lane-close.yml` rebinds merge
> authority only after GitHub supplies the merged-PR attestation.

Generated at: 2026-09-19T11:45:56.671Z
Issue: UTV2-1943
Tier: T2
Lane type: governance
Branch: claude/utv2-1943-command-center-product-contract
PR URL: https://github.com/griff843/Unit-Talk-v2/pull/1616
Head SHA: f99d9bd6657013fcf1e217afad8f166ec159b033
result: pass

## ASSERTIONS:

- [x] **There is exactly one Command Center product authority.**
      `docs/03_product/COMMAND_CENTER_PRODUCT_CONTRACT.md` answers "what should Command Center
      do?" on its own. No other Command Center document is product or operations authority, and
      the acceptance test is mechanical: `grep -rl` for a live reference returns only the
      contract, the pointer stubs, and `apps/command-center/CLAUDE.md`, which explicitly defines
      no product behaviour.
- [x] **All 23 predecessor documents are archived, none deleted.** Each moved to
      `docs/archive/command-center/` with `git mv`, so the original text is preserved verbatim
      and its history follows it. A deprecated pointer stub remains at every original path.
- [x] **Every stub's two relative links resolve from the stub's own directory.** Checked by
      resolving each link against the filesystem, not by eye — the stubs sit at three different
      depths and a single hard-coded prefix would have been wrong for two of them.
- [x] **The contract states intent and acceptance, never current state.** No production row
      counts, no PR numbers, no commit SHAs, no runtime status. That rule is written into the
      contract's own metadata block so a later editor inherits it.
- [x] **The owner's two horizons are both carried.** Consolidation did not reduce Command Center
      to an operations dashboard. Research, Intelligence and Decision are first-class workspaces
      in §3 and §4 with their own surfaces; §2's four bands separate what launch requires from
      what the mature intelligence platform requires, so launch is not delayed by the future
      product and the future product is not designed out of the architecture.
- [x] **A provider-blocked capability keeps its underlying band.** Band 4 is an annotation, not a
      demotion, and is assigned only where the blocker is missing data rather than missing work.
      Without that rule the SGO deferral would silently reclassify launch requirements as
      post-launch.
- [x] **Smart Form keeps Human Capper pick creation.** §1.4 and §4.4 state that Command Center
      has no pick-composition surface. The legacy `/execution/pick-builder` is recorded as a
      band-1 *gap* to remove (G4), not as a requirement the contract inherited because the code
      exists.
- [x] **Sixteen contradictions are named before they are resolved.** Appendix A states what each
      document claimed, what is actually true, and which reconciliation rule decided it. Two are
      owner decisions and are escalated in Appendix D rather than decided here.
- [x] **Four authority references now point at the contract**, and the two stale Command Center
      entries in `PLATFORM_SURFACES_AUTHORITY.md` — which registered `apps/operator-web` as the
      Command Center data backend and asserted "No direct DB access" — are replaced by one
      accurate entry.
- [x] **No gap is implemented.** The diff contains no change under `apps/command-center/src/`.
      The gap comparison is recorded in EVIDENCE §5 as a ledger, per the directive that
      implementation waits until the consolidation is reviewed.
- [x] **The lane allowlist change is one named file, flagged in the PR body and in the file
      itself.** `.lane/lanes/governance.yml` admits `apps/command-center/CLAUDE.md` in the exact
      shape of the UTV2-1843 entries for `apps/api/CLAUDE.md` and `apps/smart-form/CLAUDE.md`,
      with the same inline rationale. It admits no glob over `apps/**`, and
      `forbidden_path_globs` is untouched.
- [x] **No product, delivery or containment behaviour changes.** The diff is documents, one root
      instruction file, one app instruction file and one lane allowlist entry. No source, no
      test, no migration, no DDL, no workflow, no kill switch, no delivery target.

## EVIDENCE:

### 1. The corpus, and why it could not be reconciled by reading

Twenty-three Command Center documents on `main` at `618712315`, across three directories:

```
docs/03_product/                     4   REDESIGN_CONTRACT, PHASE_2_CONTRACT,
                                         WAVE_3_CONTRACT, LIFECYCLE_MINIMUM_SPEC
docs/05_operations/                 18   T1_COMMAND_CENTER_BURNIN_TRUTH_CONTRACT,
                                         COMMAND_CENTER_AUDIT, CC_* (14),
                                         DECISION_WORKSPACE_MVP, RESEARCH_WORKSPACE_MVP
docs/02_architecture/contracts/       1   CC_OPERATIONS_IA
```

Four declared independent gating authority over overlapping scope. The defect is structural: an
engineer reading any one of them got a self-consistent answer, and the answers disagreed.

### 2. `apps/operator-web` is not a Command Center component — measured, not inferred

Four documents specify Command Center as a consumer of `apps/operator-web`'s `/api/operator/*`
endpoints. `PLATFORM_SURFACES_AUTHORITY.md` registered it as **LIVE** with sixteen endpoints and
said Command Center "reads from operator-web and writes through the API. No direct DB access."

Against the deploy manifest:

```
$ grep -c 'operator-web' deploy/production/docker-compose.yml
0
$ grep -oE '^  [a-z-]+:' deploy/production/docker-compose.yml
api worker ingestor discord-bot grading-cron loki grafana web smart-form command-center caddy
```

There is a `command-center` service and no `operator-web` service. Outside CI path filters and two
source comments, nothing references it. Command Center reads the database directly through
`src/lib/data/` and writes only through `apps/api` from server actions.

This voids `CC_OPERATIONS_IA` and `COMMAND_CENTER_LIFECYCLE_MINIMUM_SPEC` entirely, voids
`CC_IA_RATIFICATION` §3, and makes the endpoint-shaped requirements of
`T1_COMMAND_CENTER_BURNIN_TRUTH_CONTRACT` unimplementable as written. The contract keeps the
**requirements** those documents stated and drops the **transport** they assumed — §6 states the
boundary in terms of what Command Center may do, not what it may call.

### 3. `COMMAND_CENTER_WAVE_3_CONTRACT.md` is void, not superseded

Ten lines. The body reads *"See conversation for sections 1-13"*. That conversation does not
exist in the repository. A document whose requirements were never written down cannot be
reconciled against anything, and it has been treated as gating authority. It is archived as
evidence that it was empty.

### 4. The Command Center settle path is unexercised, not broken

Two status documents assert that the six 2026-09-18 settlements were written through Command
Center by `operator:command-center:HGkYXQqj`. Re-measured read-only against production
`zfzdnfwdarxucxtaojxm`:

```sql
select sr.source, sr.settled_by, sr.confidence, count(*) n,
       min(sr.created_at), max(sr.created_at)
from settlement_records sr join picks p on p.id = sr.pick_id
where p.metadata ? 'distributionMode'
group by 1,2,3 order by n desc;
```

One group: `operator` / **`operator:claude-agent`** / `confirmed` / n=6, spanning
06:30:48.881968+00 to 06:31:21.548495+00. **Zero** rows attributed to `operator:command-center:*`.

The distinction changes what §10 has to mean. A path that has never been used is not evidence of
a working path, and "an operator can settle through Command Center" is therefore an **acceptance
criterion in this contract** (§22 A9) rather than a capability to describe as present.
`docs/mission/plan.md` §3 condition 5 and `HUMAN_CAPPER_V1_LIFECYCLE_HANDOFF.md` §2.1 both state
the opposite and are corrected outside this lane's file scope.

### 5. Gap comparison — recorded, not implemented

The full ledger is in the PR body's linked comparison. Nine band-1 gaps (G1–G9), seven band-1
requirements already met, five band-2/3 structural gaps (G10–G14). Two of the nine are already
owned elsewhere — `/execution/pick-builder` by UTV2-1941, unclaimable outbox-row classification by
UTV2-1933 — and are recorded as attached evidence rather than re-filed, per the one-defect
one-canonical-issue rule.

The directive is explicit that no gap is worked until the contract is reviewed, and no gap is
worked here: the diff contains no file under `apps/command-center/src/`.

### 6. Stub links resolve

Each stub carries two relative links, and the 23 stubs sit at three directory depths. Resolved
against the filesystem rather than read:

```
docs/02_architecture/contracts/CC_OPERATIONS_IA.md
  OK  docs/03_product/COMMAND_CENTER_PRODUCT_CONTRACT.md
  OK  docs/archive/command-center/CC_OPERATIONS_IA.md
```

The depth is computed per path rather than hard-coded; an earlier draft used a fixed prefix that
resolved to `<repo-root>/03_product/...` and was corrected before it ran.

### 7. Lane scope

```
$ pnpm lane:check --lane governance --base origin/main --head HEAD
lane:check PASS lane=governance files=54   # content commit
lane:check PASS lane=governance files=56   # with this proof bundle
```

Run after the allowlist entry was added, which is the only reason it passes for
`apps/command-center/CLAUDE.md`. That entry is one named file, not a glob, and is called out in
the PR body so it is reviewed as a policy change rather than absorbed as a detail.

### 8. R-level

```
$ npx tsx scripts/ci/r-level-check.ts --base 618712315 --head <head>
Verdict: PASS
Changed files: 54
Rules matched: operator-ui
```

Run with explicit SHAs. `scripts/ci/r-level-check.ts` resolves its repo root from its own file
location and runs `git diff` with `cwd: repoRoot`, so `--head HEAD` from a lane worktree silently
resolves in the root checkout instead.

## Verification
- [x] `pnpm type-check`: exit 0 — run inside `pnpm verify:static`
- [x] `pnpm test`: exit 0 — 206 tests, 206 pass, 0 fail, 0 skipped, run inside
      `pnpm verify:static`
- [x] `pnpm verify:static`: exit 0 — lint + type-check + build + full test suite + smart-form
      verify + verify:commands + migration lint (135 files, no findings) + discord command
      manifest (14 definitions)
- [x] `pnpm lane:check --lane governance --base origin/main --head HEAD`: PASS — files=54 at
      the content commit, files=56 once this proof bundle is added
- [x] `npx tsx scripts/ci/r-level-check.ts --base 618712315 --head <head>`: Verdict PASS,
      rules matched `operator-ui`
- [x] Stub link resolution: every archived path's two relative links resolve on disk
- [ ] `pnpm verify`: cannot exit 0 from this containment-isolated checkout. Its
      `ci:assert-staging` step refuses because `local.env` pins
      `SUPABASE_URL=http://127.0.0.1:1`. Every gate before it passed, and `verify` itself is
      executed by CI on the PR.

## Runtime Verification

This lane changes no runtime behaviour. The diff is documents, one root instruction file, one app
instruction file and one lane allowlist entry: no source, no test, no migration, no DDL, no
workflow, no kill switch, no delivery target, no containment setting. There is nothing for a
runtime proof to execute.

The two runtime facts the contract depends on are recorded in EVIDENCE as **production
measurements** rather than as claims: the settlement-attribution query in §4, run read-only
against `zfzdnfwdarxucxtaojxm` — zero rows written, updated or deleted — and the deploy-manifest
reading in §2, taken from the repository rather than from a document.

`result: pass` refers to the static gates, the lane and R-level checks, the link resolution and
those measurements, all of which were executed rather than asserted. No live-DB write proof is
claimed and none is required at T2 for a change with no write path.

## Merge SHA Binding

Merge SHA: pending merge
PR: https://github.com/griff843/Unit-Talk-v2/pull/1616
Approved PR head: f99d9bd6657013fcf1e217afad8f166ec159b033
Execution SHA: f99d9bd6657013fcf1e217afad8f166ec159b033
