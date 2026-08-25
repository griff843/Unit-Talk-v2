# PROOF: UTV2-1752

MERGE_SHA: 3e7abdbbaedaa360529871b61f1ace68b45182fe

> `MERGE_SHA` names the implementation commit `3e7abdbb`, which is an ancestor
> of the PR head. This is the form `executor-result-validator.yml` requires and
> documents: a proof may reference the implementation commit rather than its own
> commit, because a file cannot contain its own SHA. It is rebound to the actual
> merge SHA after merge by `ops:proof-generate --merge-sha` (run from
> `post-merge-lane-close.yml`). It is NOT a claim that this lane has merged.

Verified source SHA: `3e7abdbbaedaa360529871b61f1ace68b45182fe`

This lane finishes the executor-packet transport. It does not re-derive the
implementation: the preserved tree is ported byte-exact from the reviewed head
and only the exact-head findings that remained are addressed.

Every figure below was measured **at the PR head**, not at the SHA anchor. The
anchor `3e7abdbb` is this lane's first implementation commit and exists only
because a file cannot contain its own SHA; the tree there predates G8-G18 and
its source hashes differ from the mutation baselines recorded below. An earlier
revision of this document claimed measurement AT the anchor, which was false and
self-contradicting; an independent review caught it. Nothing is carried
forward from the predecessor's proof.

## ASSERTIONS:

- [x] Finding 1 (P1) FIXED — readmission captures no contract before the branch
  worktree exists, and resolves once after checkout with the worktree root
  ordered first. A branch-carried contract is reused verbatim and offline.
- [x] Finding 3 (P2) FIXED — consumption is tracked across contract-field
  extraction by per-line ownership. A recognized nested section reaches exactly
  one field and appears exactly once in the rendered packet.
- [x] Finding 4 (P2) FIXED — this bundle is regenerated. Every count,
  mutation summary and status was measured at the PR head (see the note above
  on why the SHA anchor is not the measurement point); no
  figure or unresolved-defect claim is carried over from the predecessor.
- [x] Finding 2 (P1) SATISFIED BY CI — `pnpm test:db` requires the
  staging-backed environment and is produced by CI, then validated inside the
  required `verify` context. Not waived; `N/A` is not claimed; not asserted by
  the author.
- [x] The four executor entrypoint files are byte-identical to the preserved
  head; only the packet module, lane-start and their two suites changed.
- [x] Each fix is load-bearing: the mutation battery was re-measured IN FULL at
  this head by a scripted runner — 16 mutations, 16 detected, 0 survivors — and
  both sources restored byte-identical after every one. Every control this lane
  adds is killed by at least one mutation, including G2 and G3, which an earlier
  revision of this file correctly recorded as unproven and which M14 now kills.
- [x] Finding 1 (P1) is covered END-TO-END. `lane-start` main() is executed
  through the real `--readmit-existing-branch` path by G19/G20/G21. Before this
  head that path had NO test in this repository at all, and the third
  independent review demonstrated the defect could be reintroduced with the
  whole suite green.

## EVIDENCE:

> Every figure below was measured locally before this file was written. The one
> line that is NOT a measurement is `pnpm test:db`, and it deliberately states no
> result: the receipt is produced and validated by CI per head, so any pass/fail
> written here would either predate the run it describes or be invalidated by the
> next push. An earlier revision of this file did write a flat `PASS` there; that
> assertion was made in the same push that triggered the run it described, and was
> therefore not knowable when written. It happened to be true. It was still the
> wrong thing to write, and this note records that rather than quietly deleting it.


```text
pnpm verify:static           PASS (exit 0)
verify:static suite total    5081 tests, 5081 pass, 0 fail, 0 skipped
                             (0 `not ok` lines in the full run log)
execution-packet suite       61 tests, 61 pass, 0 fail
lane-start suite             50 tests, 50 pass, 0 fail
claude-exec + codex-exec     46 tests, 46 pass, 0 fail
r-level check                PASS — rules matched: (none)
mutation battery             16 of 16 DETECTED, re-measured in full at THIS head
                             by a scripted runner; see the table below. Both
                             sources restored byte-identical after each
pnpm test:db                 NOT AUTHOR-ASSERTED. Produced by CI job "Writable DB
                             proof (staging only)" and validated inside the required
                             `verify` context; read that context's conclusion on the
                             head under review, not this line (finding 2)
```

## Verification

| Check | Result | Evidence |
|---|---|---|
| `pnpm verify:static` | PASS | Exit 0. 5081 tests, 5081 pass, 0 fail, 0 skipped, 0 `not ok` lines. Totals summed across the complete run log, not a tail. This run was executed on an unmutated tree AFTER the mutation battery finished, and both source hashes were re-checked at its completion — an earlier run this session overlapped the battery and was discarded rather than reported. |
| `pnpm verify` | PARTIAL — static stages PASS | `verify` is `verify:static && test:live-db`. The static half exits 0. The live half refuses locally by design: `ci:assert-staging` reports `host=127.0.0.1 ref=unidentified expected=xskgrzbteyqdufktjrjx` before any test runs. See `pnpm test:db` below — the live half is supplied by CI, which is where it is enforceable. |
| `pnpm type-check` | PASS, but **does not cover this diff** | Stage of `pnpm verify:static` (exit 0). `tsconfig.json` has `files: []` and no project reference covering `scripts/`, so NONE of this lane's eight changed source files are type-checked. This is why a `.heading` access on a `string` shipped green. `tsconfig.json` is not in this lane's `file_scope_lock`; reported, not fixed. |
| `pnpm exec tsx --test scripts/ops/execution-packet.test.ts` | PASS | 61 tests, 0 failures. |
| `pnpm exec tsx --test scripts/ops/lane-start.test.ts` | PASS | 50 tests, 0 failures. |
| `pnpm exec tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD` | PASS | Rules matched: (none) — no R-level artifacts required for this diff. |
| Test delta | +24 | 5057 at the preserved head to 5081 here. The delta is exactly G1-G18, G2b/G2c, G22, and the three end-to-end readmission tests G19/G20/G21 — and nothing else. |
| `pnpm test:db` | **SATISFIED — by CI, not by me** | Mandatory for this T1 lane and deliberately never marked `N/A`. It cannot be produced from this environment (`ci:assert-staging` refuses `host=127.0.0.1`). It is produced by the CI job **Writable DB proof (staging only)** against staging `xskgrzbteyqdufktjrjx` under the `staging-ci` environment, and validated **inside the required `verify` context** by `scripts/ci/verify-db-proof-receipt.ts --command 'pnpm test:db' --expect-workflow CI --expect-job staging-db-proof`. The artifact is scoped `utv2-1630-db-proof-receipt-${run_id}-${run_attempt}` with `if-no-files-found: error`, so a prior run's receipt cannot be substituted and a deleted upload fails the required context rather than skipping it. First observed at head `3973d900`, run `32859010194`, receipt `sha256=e2e0109f…73d3`, `verify` SUCCESS. This is CI's assertion, not mine. |

## Runtime Verification

No runtime, database, migration, deployment, ingestion or delivery path is
touched. Production containment was in force throughout: no SGO call, no
production mutation, no production DDL, no member delivery, no unpark, no
secret access.

This does not weaken the `pnpm test:db` requirement above. The lane's tier
requires the receipt regardless of whether this diff touches a database path,
and the row records it as outstanding.

### Finding 1 (P1) — readmission resolved a contract before the branch existed

The predecessor resolved the contract before the worktree was created, so only
the control checkout was visible. On a readmitted branch whose contract control
does not hold, that early pass fetched a NEWER contract from Linear and
persisted it to the control root. The post-checkout pass then saw a contract at
both roots and, when they differed, failed closed as `lane_contract_conflict`
against the branch's own valid record. It also made readmission require the
network for a branch already carrying everything it needs.

Readmission now captures nothing early. The single resolution runs after
checkout with the worktree root ordered ahead of control, so the branch's own
copy wins. `resolveTaskContractAcrossRoots` reaches `fetchLinearTaskSource`
only when NO root holds a contract, so the empty string returned by
`linearTaskToken()` under containment is never consumed — the reuse path is
genuinely offline. Fresh lanes keep the early bounded capture unchanged, so a
Linear failure still leaves lane state untouched.

Covered by G2 (offline reuse after checkout), G3 (inversion: the pre-checkout
ordering fails closed while the post-checkout ordering succeeds on the same
fixture, proving the defect is timing and not a missing contract) and G4
(structural: no capture before the worktree exists).

### Finding 3 (P2) — a nested recognized section was emitted twice

An ancestor's `lines` deliberately carry its whole subtree, so a recognized
section nested under another section was emitted once inside the ancestor's
field and again by the field that owns the key, whose per-call consumed-set
could not observe the earlier pass. Occurrences now record per-line ownership.
Descendants reserved by a different contract field are subtracted from the
ancestor and left unconsumed for their own field, and the same subtraction is
applied to residue so a claimed child never reappears in additional issue
content.

Covered by G1 (recognized ancestor) and G5 (unrecognized ancestor surviving as
residue).

### A control that was vacuous until a second fixture was added

The residue half of finding 3 was initially proven by nothing. With the
subtraction neutralised (M2), the entire suite still passed, because G1's
enclosing section is itself a contract field and therefore never reaches the
residue path. G5 was added specifically to exercise a recognized child under an
UNRECOGNIZED ancestor, and M2 now kills it. This is recorded rather than
quietly corrected: presence and a green run proved nothing until the mutation
was executed against the path the control names.

### Mutation / inversion battery

Superseded by the consolidated **Mutation battery** section below, which was
re-measured from scratch against the current tree. The earlier block in this
position reported an M1-M3 battery whose mutations were written against code
this lane has since replaced; it was removed rather than left to contradict the
current table, which is the defect an independent review found in this bundle.

G3 is itself the inversion for finding 1: it asserts that resolving with only
the pre-checkout root fails closed on the same fixture that resolves offline
once the worktree exists.

### Provenance split, recorded before any change

Preserved source head `d54abcbda8c5a218c0ac4072b98a13175426199c`, whose lane
content is byte-identical to the reviewed head
`bc53be68447bf09d056ce59dd2724bd1e2aaee05` — the two differ only by merge
commits taken from `main`. Verified by checksum before porting.

Ported byte-exact and unchanged by this lane:

```text
scripts/ops/claude-exec.ts        7b1577a356d338d1
scripts/ops/claude-exec.test.ts   64532e51f11a7658
scripts/ops/codex-exec.ts         927868f53c18a3df
scripts/ops/codex-exec.test.ts    55f220781c063985
```

Ported, then changed by this lane's findings:

```text
scripts/ops/execution-packet.ts        485a2580b123897f
scripts/ops/execution-packet.test.ts   8d1c2b94cbb2b256
scripts/ops/lane-start.ts              e5546157e9fe2283
scripts/ops/lane-start.test.ts         9932cd876d05bd79
```

None of the preserved work existed on `main` before this lane. Probed at base
`10ad4ddea1924da6458249e41f9277532d52dfb9`: the trimmed-emptiness fix, the
section-aggregation fix and the readmit re-resolution were all absent, and the
original blind `copyFileSync(syncPath, ...)` was still present.

### Substantive diff stat

Measured at the head this bundle describes, by the command shown:

```text
$ git diff --numstat origin/main...HEAD -- scripts/ops/
  8 files, 5087 insertions(+), 41 deletions(-)
```

Two notes, both from review findings:

- The whole-diff insertion total is deliberately not quoted: it counts this
  proof bundle, so recording it here would change it.
- An earlier revision recorded `3618 insertions` — the figure at the SHA anchor
  `3e7abdbb`, a tree that predates most of the tests this bundle reports. That
  is precisely the "measured at the anchor, not the head" defect this document's
  own header claims to have repudiated, and a third independent review caught it
  still present. The command is now quoted alongside the figure so the claim is
  reproducible rather than asserted.


## Review threads (PR #1447)

Three threads were opened by the automated reviewer. All three are addressed.

| Thread | Sev | Subject | Disposition |
|---|---|---|---|
| `PRRT_kwDORr3vD86cHGhR` | P1 | `test:db` left `PENDING_REQUIRED` | Already outdated when read. The receipt is produced and validated by CI inside the required `verify` context. |
| `PRRT_kwDORr3vD86cHGhZ` | P2 | Reserve all recognized contract headings | **FIXED**, and the fix is broader than the report. |
| `PRRT_kwDORr3vD86cHGhc` | P2 | Honor fenced code while parsing headings | **FIXED**, plus a second half the report did not name. |

### Thread 2 — the reserved set was the wrong shape, not merely too short

The first version of the reservation fix restated its own literal list of
reserved headings beside the extraction calls. That list omitted `guardrails`,
all four `non goals` spellings, and `required evidence`/`evidence`. A
`### Non-goals` nested under `## Acceptance criteria` was therefore left inside
the acceptance ancestor AND extracted by the non-goals pass: the same sentence
became both a thing to do and a thing NOT to do. For an executor that is a
contradictory, silently widened work order.

Lengthening the list would not have been a fix. `non goals` matches by PREFIX,
so a flat list of keys cannot even express its matching rule, and any restated
list can drift again the next time a field is added. Extraction and reservation
now both read one table, `CONTRACT_FIELD_SPECS`.

Two claims that stood here earlier were FALSE and are corrected rather than
deleted:

- *"every extraction site goes through `fieldSpec()` rather than naming heading
  literals"* — a **third** mirror survived at the empty-acceptance guard,
  restating the acceptance headings with `.includes` instead of the shared match
  rule, so an alias in the table was invisible to it and silently re-enabled the
  legacy whole-description fallback. Found by an independent review while this
  document asserted the mirror was gone. It now reads the table; G18 covers it,
  parameterized over every alias so a reinstated mirror fails on whichever one
  it omits.
- *"`G8` fails if a `sectionLines` call ever passes an inline heading literal
  again"* — it does not. G8 fails on a literal that DIVERGES from the table; a
  literal that merely restates it passes. The protection is real but narrower
  than was claimed, and the claim is corrected rather than the code, because a
  faithful restatement is not itself the defect. What IS now impossible is the
  drift: `sectionLines` throws on any extraction heading the reservation set
  does not contain (G12).

### Thread 3 — the parser was half the defect

The heading regex ran against `rawLine.trim()` and tracked no fence state, so
a `#` line inside a ``` block opened a section, consumed the `#` as syntax, and
split the fence. `parseSections` now tracks fences and requires at most three
leading spaces (four or more is code). An unterminated fence deliberately runs
to end of input: treating the remainder as code is the fail-closed reading.

That alone was NOT sufficient, and the shortfall was found by an assertion, not
by inspection. `sectionItems` flattened a fenced block into a single
whitespace-collapsed paragraph, which put
`# do not run this against production` on the same line as `pnpm test:db` —
where the comment silently swallows the command. Preserving the `#` in the
parser while flattening the block here would have left the original harm intact
in a different function. `sectionItems` is now fence-aware and emits a fenced
block as one item with its newlines.

## Mutation battery

**Re-measured in full at this head by a scripted runner.** Earlier revisions of
this file carried rows and baseline hashes belonging to a previous tree; three
consecutive independent reviews found figures in this bundle that had been
measured somewhere other than where they were claimed. The table below is the
runner's output, and `evidence.json`'s `mutation_testing` block is generated
from the same JSON rather than transcribed.

Each mutation was applied to a `sha256`-verified baseline, both suites were run,
and the baseline was restored **by file copy, never by `git checkout`**, with
`sha256` re-checked before the next mutation.

Baselines, at this head:
`execution-packet.ts` `982c4a5e52f4e9152a5773d55e094005487bef63fa87b30de8ff611f43d67f86`,
`lane-start.ts` `6dbbf21774e775ca1b3e8c1aebd89c8f9c2886f3385215b9b478491995e0003c`.
Both matched after every mutation.

| # | Mutation | File | Tests killed |
|---|---|---|---|
| M1 | `sectionLines` reserved-descendant subtraction disabled | `execution-packet.ts` | `G1`, `G6`, `G7`, `G8` |
| M2 | `unmappedSections` claimed-child subtraction disabled | `execution-packet.ts` | `G5` |
| M3 | `parseSections` fence tracking destroyed (`FENCE_RE` never matches) | `execution-packet.ts` | 19 tests, including `B1`, `F3`, `F4`, `F8` |
| M4 | heading regex leading-space bound `^ {0,3}` widened to `^ *` | `execution-packet.ts` | `G10`, `G13`, `G17` |
| M5 | `sectionLines` unreserved-extraction-heading guard removed | `execution-packet.ts` | `G12` |
| M6 | `headingMatches` prefix word-boundary removed | `execution-packet.ts` | `G14` |
| M7 | `indentWidth` stops expanding a tab to the next 4-column stop | `execution-packet.ts` | `G16`, `G22` |
| M8 | a blank line ends an indented run in `sectionItems` | `execution-packet.ts` | `G17` |
| M9 | `resolveTaskContractAcrossRoots` takes the LAST matching root, not the first | `execution-packet.ts` | `G21`, `G2b` |
| M10 | `laneContractRoots` returns `[ROOT, worktreePath]` (order reversed) | `lane-start.ts` | `G15`, `G21` |
| M11 | `resolveReadmissionContract` captures on the readmission path too | `lane-start.ts` | `G20`, `G4` |
| M12 | readmission resolves the contract against ROOT only (finding 1, ordering half) | `lane-start.ts` | `F5`, `G19`, `G20`, `G21` |
| M13 | finding 1 restored: control's sync record written over the branch's via `writeFileSync`/`readFileSync` | `lane-start.ts` | `G19`, `G20` |
| M14 | offline reuse disabled — a valid contract at a root is never reused | `execution-packet.ts` | 7 tests, including `G2`, `G20`, `G21`, `G2b` |
| M15 | `TaskContractConflictError` throw removed (disagreement no longer fails closed) | `execution-packet.ts` | `F1`, `G19`, `G2c`, `lane-start main() refuses two different valid contracts instead of choosing one` |
| M16 | `persistTaskContractToRoots` merges every destination against `roots[0]` | `execution-packet.ts` | `F5b`, `lane-start main() persists one contract to both roots, merging each against its own record` |

**16 mutations, 16 detected, 0 survivors.**

Reading notes, so no row is read as stronger than it is:

- **M3 is blunt.** Destroying `FENCE_RE` outright breaks fence handling
  everywhere, so it kills 19 tests rather than isolating one. It establishes
  that fence tracking is load-bearing, not that any single control is specific
  to it. M14 is broad for the same reason.
- **M12 and M13 are the finding-1 mutations.** M13 is the reintroduction a third
  independent review used to show that, before G19/G20 existed, the defect could
  be restored with the whole suite green. Both are now killed end-to-end.
- **M10 and M9 changed no behaviour before this head.** Root precedence decided
  only which root was *reported* as the contract's source, and that value was
  emitted nowhere. It is now emitted as `contract_source`, which is what lets
  G21 kill both mutations through `lane-start` main() rather than through a
  unit test on an unobservable field.
- **G2 and G3 are no longer unproven.** An earlier revision of this section
  stated that no mutation in the battery killed them. M14 kills both, and the
  third independent review's equivalent mutation did the same. That earlier
  statement is superseded, not deleted, because it was cited elsewhere in this
  bundle.
- The two `lane-start main()` tests that appear by name in M15 and M16 predate
  this lane; they are reported verbatim as the runner emitted them.

### Three vacuous controls, all disclosed

This bundle has now disclosed **three** assertions of my own that proved nothing
when written. All three were found the same way — by executing the mutation the
control names — and all three are recorded rather than quietly corrected.

1. **The residue control (G1's original form).** With the subtraction
   neutralised the suite still passed, because G1's enclosing section is itself
   a contract field and never reaches the residue path. G5 was added to
   exercise a recognized child under an UNRECOGNIZED ancestor.
2. **G10 as first written.** It asserted only that the indented comment
   appeared exactly once. That holds whether or not the defect is present, so
   M6 killed nothing. Rewritten to assert the `#` survives and no section
   opens.
3. **G9 and G10's structural halves — found by the independent reviewer, not
   by me.** Both read `entry.heading` off elements of
   `TaskContract.unmapped_sections`, which is `string[]`. `entry.heading` is
   therefore `undefined` on every element, `undefined ?? ''` is `''`, the regex
   never matches, and `assert.equal(someFalse, false)` passed unconditionally.
   These were the **only** assertions covering "no phantom section was opened" —
   the precise half of the defect thread 3 named — and this bundle previously
   claimed they held. They now read `entry.split('\n')[0]`, and the structural
   assertion was moved **ahead** of the textual one in each test, because when
   it ran second the textual assertion failed first under mutation and the
   structural one was never reached. Only after that reorder do M5 and M6 fail
   on the structural message specifically.

Two further controls were theatre in a different way — they asserted the shape
of the source text rather than behaviour:

- **G8** grepped for `sectionLines(parsed, ['`. The reviewer defeated it twice:
  once by giving the reservation predicate its own hardcoded list — reintroducing
  the exact defect G8 is named for, with the suite still green — and once by
  hoisting the headings to a `const` with an extra unreserved entry. G8 is now
  behavioural, enumerating every heading of every field and proving each is both
  extracted into its own field and withheld from its ancestor.
- **G4** grepped `lane-start.ts` for the shape of a ternary. I measured that
  G2 and G3 do **not** catch a reintroduction of the finding-1 defect, so that
  grep was the lane's only coverage for a P1 fix. The decision is now extracted
  into `resolveReadmissionContract`, and G4 injects a spy resolver and asserts
  it is never called on readmission — and *is* called exactly once for a fresh
  lane, so the guard has not simply disabled capture everywhere.

The lexical guard could not be repaired in place: G8 enumerates the field table,
so it structurally cannot see a heading that extraction accepts but that was
never added to that table. That property is now enforced in the production code
instead — `sectionLines` throws on any extraction heading the reservation set
does not know — which is what makes the reviewer's second evasion impossible
rather than merely detected. G12 covers that guard.

### A fourth defect, found while covering the third

The indented-code case was still broken. `^ {0,3}` means a fence indented four
spaces — the ordinary way to nest code under a list item — is not a fence, so it
fell through to the paragraph collapse along with plain indented code. Measured
on the shipped tree before the fix:

```text
acceptance_criteria = [
  "keep the indented block verbatim",
  "# indented shell comment pnpm verify",
  "and a nested fenced block:",
  "```bash # do not run in prod pnpm destroy ```"
]
```

That is the comment swallowing the command — the exact harm this lane exists to
fix — surviving at a different indentation. G10's own fixture exhibited it while
asserting nothing about it. `sectionItems` now holds an indented run verbatim as
one item; G13 covers it, G10 gained an assertion for the collapse, and M8
isolates it.

## Second independent review — a sixth vacuous control, on this lane's own P1

A second independent review of head `eec27f18` returned CHANGES_REQUIRED. The
five previously-disclosed controls were confirmed genuinely repaired. It then
found what the first review's fixes had not touched.

**The ordering half of finding 1 (P1) had no live control at all.** G2 is cited
throughout this bundle as proving "the branch copy wins over the control
checkout". Its fixture seeds a contract in exactly **one** root — so
`rootIndex === 0` restates the fixture and holds under *any* precedence. Three
separate reintroductions of the defect all passed green: reversing the root
order in `laneContractRoots` (L2), making readmission resolve control-only (L3),
and reversing precedence inside `resolveTaskContractAcrossRoots` (M11).

One correction to the review's characterisation, verified by measurement: on a
genuine disagreement between two valid contracts the resolver **fails closed**
with `TaskContractConflictError` rather than preferring a root. Reversing
precedence therefore cannot serve a stale control contract to a lane; what it
flips is which root is *reported* as the source when the two agree. The coverage
gap was entirely real; the harm is narrower than "the control checkout wins".
G2b now asserts the reported source under agreement, G2c asserts the fail-closed
refusal under disagreement (and that the refusal is symmetric, not an artefact of
search order), and G15 asserts the root order directly. L2 → G15, M11 → G2b,
L3 → F5.

**The named harm survived at tab indentation.** `^ {4,}` matched spaces only, so
a tab-indented block — and a tab-indented fence, which is not a fence under the
three-space rule — fell through to the paragraph collapse. Measured on the tree
this bundle had already declared closed:

```text
"\t# do not run in prod\n\tpnpm destroy"  ->  "# do not run in prod pnpm destroy"
```

That output is byte-identical to what the mutation which kills G13 produces. The
section below titled "A fourth defect, found while covering the third" declared
this class closed while it was live at a different indentation. Indentation is
now measured in columns with tabs expanded to the next 4-column stop; G16 covers
tabs, G17 covers the blank-line-inside-an-indented-run rule that had no test.

**F5 was a new source grep testing the wrong code path.** Added by this PR and
not disclosed, it anchored on the first `if (readmitExistingBranch) {` — the
*resume* path's throw-guard — with an end anchor that never matched, so its
"block" was the remaining 26KB of the file. This bundle condemned exactly that
pattern in G4 in the same breath. It is re-anchored on the readmission metadata
write with both anchors asserted and the slice length bounded, and it is
disclosed as still being a source-text control.

**Two claims in this document were simply false** and are corrected in place
above: that every extraction site goes through `fieldSpec()` (a third mirror
survived at the empty-acceptance guard), and that G8 fails on any inline heading
literal (it fails only on one that diverges from the table).

**The SHA anchor contradicted every figure.** `sha_binding` asserted that figures
were measured at `3e7abdbb`, a tree that predates G8-G18 entirely. This is the
first review's P1 recurring in inverted form. The anchor is now described as what
it is: an ancestor commit used because a file cannot contain its own SHA.

**`diff-summary.md` was never regenerated.** I updated its Verification section
and left its Tests section reporting 54/54 and its prose describing the removed
five-key `CONTRACT_FIELD_HEADINGS` list — the very defect the same document
declares fixed two sections earlier — as current. One of three bundle files was
stale while finding 4 claimed all three were regenerated.

## Third independent review — the eighth and ninth, and the P1 was still open

A third independent review of head `56c4700b` returned CHANGES_REQUIRED. It
reproduced every suite count and the `verify:static` total exactly, confirmed
the executor-entrypoint port byte-for-byte, ran an eighteen-mutation battery of
its own, and upheld the fail-closed correction recorded above — extending it:
because `LaneContractResolution.source` had no consumer anywhere in production,
root precedence was **behaviourally inert**, so G15 and G2b were guarding a
value nothing could observe. Verified independently: the two `.source` reads in
`lane-start.ts` are `ResolvedActiveLane.source`, a different type.

**Finding 1 — this lane's headline P1 — had no control that survived semantic
reintroduction.** The review restored the original clobber with
`fs.writeFileSync(dest, fs.readFileSync(syncPath))` in place of the removed
`copyFileSync`. All 47 tests passed. F5's positive regexes still matched, its
negative regex was bypassed, and G2/G2b/G2c/G3/G4/G15 were untouched — every one
of them exercises an extracted helper or the shared resolver directly, so none
executes the readmission call site. The defect this lane exists to close was
guarded exclusively by a grep this same document classes as theatre.

Confirmed by measurement before fixing: `--readmit-existing-branch` appeared in
**zero** tests in this repository. `lane-start` main() had never been executed
through the readmission path by any test, in this lane or before it.

The remedy is end-to-end. `seedReadmissionFixture()` builds a throwaway git
repository with a local bare origin, a branch carrying its own committed work
order, a readmission preflight token, and stub `gh`/`pnpm` binaries on PATH, and
runs `lane-start.ts` as a program:

- **G19** — control and branch carry *different* valid contracts. Readmission
  must refuse with `lane_contract_conflict`, and the branch's committed record
  must be byte-unchanged afterwards. Under the defect this run SUCCEEDS.
- **G20** — the branch carries the only contract. Readmission must reuse it with
  `contract_fetched: false` (the child environment has no `LINEAR_*` token, so a
  capture would refuse), and the control checkout must inherit it.
- **G21** — both roots agree. The lane must report `contract_source:
  lane-worktree`, which is the root-ordering property made observable.

Measured: the reintroduction is killed by G19 and G20; resolving control-only is
killed by G19, G20 and G21; and the two ordering mutations are now each killed
by an end-to-end test as well as their unit test.

**The ninth vacuity was a field emitted nowhere.** `LaneContractResolution.source`
was computed and never read, so the precedence encoded in `laneContractRoots`
could not be observed by an operator or an automated caller. Rather than delete
it and retire its two tests, `lane-start` now emits `contract_source`,
`contract_hash` and `contract_fetched` on all three success paths — resume,
readmission and fresh start. An operator reconciling a lane running on an
unexpected work order can now see which copy won and whether the network was
touched, and G21 asserts it end-to-end.

**Finding 4 recurred a third time.** `diff-summary.md` still reported the
figures of two heads ago, still asserted the `G8` claim this document had
already labelled false, and still credited finding 1 to G2/G3/G4 — while
carrying a new paragraph *admitting* it had been stale. The mutation baselines
quoted in this file were `eec27f18`'s while `evidence.json` carried the head's;
"3618 insertions" was the figure at the SHA anchor; and a single bundle held
three different mutation counts.

Re-synchronising was tried twice and failed twice, so the duplication is gone
instead: every measured figure is single-sourced here, `evidence.json`'s
`mutation_testing` block is generated from the battery runner's own output
rather than typed, and `diff-summary.md` quotes no figures at all.

**A P3 behaviour change was undisclosed.** Column-aware indentation means a
tab-indented nested list item now measures four columns and is held verbatim as
code rather than re-flowed into its parent. No content is lost, and a
four-space nested item already behaved this way — tabs extended an existing rule
rather than creating a class. G22 pins both halves and asserts they classify
identically, so a future tab-specific special case fails. Narrowing this
correctly needs real list-nesting state in `sectionItems`, which is a change of
scope rather than a fix; it is disclosed here, not silently kept.

### Running count of my own vacuous controls

Nine, across three review rounds. Three vacuous assertions (G1's original form,
G10's first rewrite, the G9/G10 structural halves), four source-text greps
(G8, G4, F5, and F5 again after re-anchoring — it remained the sole detector of
the P1), one fixture that could not fail on the property it was cited for (G2),
and one pair of tests guarding a field with no consumer (G15/G2b, counted once).
**Six of the nine were found by independent reviewers, not by me.**

The pattern across all nine is one thing: I asserted the *presence* of a fix
rather than its *effect*. An occurrence count, a source grep, a single-root
fixture and an unobservable field all share the property that they pass whether
or not the code is correct. The only reliable detector has been executing the
mutation the control names and watching what dies.

Two of the three rounds found a defect in the control the *previous* round had
just installed. That is the strongest single statement this bundle can make
about its own reliability, and it is the reason no round of this lane treats a
clean review as a formality.

### Residual risk

CORRECTION TO AN EARLIER READING IN THIS BUNDLE: an earlier draft recorded
`pnpm test:db` as unobtainable in-PR. That was wrong. It is unobtainable
*locally*, but UTV2-1630 moved the producer into `ci.yml`, so the required
`verify` context itself both produces and validates the staging receipt. The
residual risk below is therefore about scope, not about missing DB proof.

What remains outstanding is not evidence but authorization: Merge Gate is
BLOCKED pending a `pm-verdict/v1` APPROVED comment from CODEOWNERS and the
`t1-approved` label, and an independent exact-head review. Green CI does not
substitute for either, and this bundle does not claim it does.
