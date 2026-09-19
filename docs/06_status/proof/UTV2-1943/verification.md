# PROOF: UTV2-1943

MERGE_SHA: pending merge

> Pre-merge the merge row is intentionally the placeholder; the Execution SHA row carries
> the verified implementation identity. `post-merge-lane-close.yml` rebinds merge
> authority only after GitHub supplies the merged-PR attestation.

Generated at: 2026-09-19T18:05:00.000Z
Issue: UTV2-1943
Tier: T2
Lane type: governance
Branch: claude/utv2-1943-command-center-product-contract
PR URL: https://github.com/griff843/Unit-Talk-v2/pull/1616
Head SHA: 8f35a2abc31c982c8769195d303b64d4ba26dbb7
result: pass

## ASSERTIONS:

- [x] **There is exactly one Command Center product authority.**
      `docs/03_product/COMMAND_CENTER_PRODUCT_CONTRACT.md` answers "what should Command Center
      do?" on its own. No other Command Center document is product or operations authority, and
      the acceptance test is mechanical: `grep -rl` for a live reference returns only the
      contract, the pointer stubs, and `apps/command-center/CLAUDE.md`, which explicitly defines
      no product behaviour.
- [x] **All 24 predecessor documents are archived, none deleted.** Each moved to
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

Twenty-four Command Center documents on `main` at `618712315`, across three directories:

```
docs/03_product/                     4   REDESIGN_CONTRACT, PHASE_2_CONTRACT,
                                         WAVE_3_CONTRACT, LIFECYCLE_MINIMUM_SPEC
docs/05_operations/                 19   T1_COMMAND_CENTER_BURNIN_TRUTH_CONTRACT,
                                         COMMAND_CENTER_AUDIT, CC_* (14),
                                         DECISION_WORKSPACE_MVP, RESEARCH_WORKSPACE_MVP,
                                         HUMAN_CAPPER_V1_LIFECYCLE_HANDOFF
docs/02_architecture/contracts/       1   CC_OPERATIONS_IA
```

The twenty-fourth, `HUMAN_CAPPER_V1_LIFECYCLE_HANDOFF.md`, was added to the corpus by the owner
during review. It is a dated measurement snapshot whose figures were already stale, and it was
being read as current Command Center and Human Capper authority. It is archived on the same terms
as the other twenty-three, with a pointer stub at its original path.

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

Each stub carries two relative links, and the stubs sit at three directory depths. Resolved
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
lane:check PASS lane=governance files=59   # content commit, PM revisions + band correction
```

Run after the allowlist entry was added, which is the only reason it passes for
`apps/command-center/CLAUDE.md`. That entry is one named file, not a glob, and is called out in
the PR body so it is reviewed as a policy change rather than absorbed as a detail.

### 8. R-level

```
$ npx tsx scripts/ci/r-level-check.ts --base 39dc4ff69 --head <head>
Verdict: PASS
Changed files: 59
Rules matched: operator-ui
```

Run with explicit SHAs. `scripts/ci/r-level-check.ts` resolves its repo root from its own file
location and runs `git diff` with `cwd: repoRoot`, so `--head HEAD` from a lane worktree silently
resolves in the root checkout instead.

### 9. The owner revision delta was reviewed, not re-derived

The owner revised the contract in seven commits (`4d703774c`..`3ab092f5d`, 5 files, +274/-280) and
asked for a review of that delta rather than a redesign. Every claim the revision makes that could
be checked against something other than itself was checked:

- **The runtime-read correction is corroborated by shipped code, not accepted on assertion.**
  `apps/command-center/src/lib/data/runtime-truth.ts` exists and gates both readers behind
  `assertPrivilegedRequestAuthenticated()`; `src/lib/server-api.ts` attaches the operator bearer
  credential server-side only. `apps/command-center/package.json` depends on `@unit-talk/config`,
  `@unit-talk/contracts`, `@unit-talk/db`, `@unit-talk/domain` and `@unit-talk/observability`. The
  previous text of `apps/command-center/CLAUDE.md` — "Calls no other internal application to read"
  and "no `@unit-talk/*` packages — frontend only" — was therefore factually false at the prior
  head. The correction is right, and it does not reintroduce `apps/operator-web`: nothing in the
  diff references it as a backend.
- **Archive integrity holds at the new count.** `docs/archive/command-center/` holds 24 files;
  Appendix B lists 24; every original path carries a stub, and every stub follows the same
  ARCHIVED / "Not authority" template.
- **One authority, still.** A live-reference sweep returns only the contract itself, the pointer
  stubs, and `apps/command-center/CLAUDE.md`, which defines no product behaviour. The four
  authority references — root `CLAUDE.md`, `docs_authority_map.md`, `PLATFORM_SURFACES_AUTHORITY.md`
  and `apps/command-center/CLAUDE.md` — all name the contract and agree with each other.
- **No unresolved-decision residue.** Appendix D's two owner questions are now stated as ratified
  decisions, and no "open question", "position taken" or "reserved to the owner" phrasing survives
  anywhere it would reopen them.

Two defects were found and repaired in this lane, both inside the contract and both introduced by
the revision:

1. Appendix B's "Not retired, and why" table lost a row. Removing the handoff row left a blank line
   inside the table body, terminating the table and orphaning the "Proof bundles referencing any
   retired document" row into literal text. Confirmed with `cat -A` before and after; the table is
   contiguous again.
2. §8.3 keeps "Scoring and promotion" and "Review history" at band 1 on pick detail while §4.3 and
   §16 move the score breakdown, suppression analysis, review queue and held queue to band 2. The
   owner decision sanctions exactly that split — a fact may appear on pick detail while the
   dedicated workflow around it waits — but the contract never wrote it down, so the two readings
   stood as a contradiction. One paragraph after the §8.3 table now states the distinction.

Neither repair changes a band assignment, a workspace, an authority claim or an acceptance
criterion. A full table scan across all five changed files reports no remaining ragged or
header-less table.

### 10. The band model is now mechanically checkable, not readable

PM returned the PR CHANGES REQUIRED on one acceptance defect: the contract still carried compound
band assignments, so whether a capability blocked launch depended on how its cell was read.

Every atomic capability now carries exactly one current band. A band-4 capability records what it
becomes when its blocker clears in a separate **When unblocked** column — metadata, not a second
band. Four rows described two capabilities each and were split so both halves could be banded.

The invariant is enforced by a scan over every table in the file rather than by reading:

```
every band cell is one of 1, 2, 3, 4, "Out of product"   -> 88 cells, 0 violations
every band-4 row carries an underlying priority          -> 0 violations
no non-band-4 row carries an unblock value               -> 0 violations
every table with a band-4 row has a When unblocked column-> 0 violations
no ragged or header-less table anywhere in the file      -> 0 violations
every §N.N cross-reference resolves to a real heading    -> 0 dangling
```

The only compound forms left in the file are the three quoted inside §2.2 rule 1 as examples of what
is no longer permitted.

**No product decision moved.** Basic per-capper and aggregate record / units / ROI remain band 1;
deeper segmentation and comparison remain band 2; the dedicated review and held workflows remain
band 2; exceptions remain band 1; Research and Intelligence remain part of the long-term product;
every provider-blocked capability remains explicitly blocked rather than demoted or removed.
Closing-line value is the case the old notation was hiding: its underlying priority genuinely is 1,
and it is still band 4 today, so it does not hold launch.

## Verification
- [x] `pnpm type-check`: exit 0 — run inside `pnpm verify:static`
- [x] `pnpm test`: exit 0 — 206 tests, 206 pass, 0 fail, 0 skipped, run inside
      `pnpm verify:static`
- [x] `pnpm verify:static`: exit 0 — lint + type-check + build + full test suite + smart-form
      verify + verify:commands + migration lint (135 files, no findings) + discord command
      manifest (14 definitions)
- [x] `pnpm lane:check --lane governance --base origin/main --head HEAD`: PASS — files=59 at
      the content commit, matching the 59 files the PR API reports
- [x] `npx tsx scripts/ci/r-level-check.ts --base 39dc4ff69 --head <head>`: Verdict PASS,
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
Approved PR head: 8f35a2abc31c982c8769195d303b64d4ba26dbb7
Execution SHA: 8f35a2abc31c982c8769195d303b64d4ba26dbb7
