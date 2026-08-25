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

Every figure below was measured at the verified source SHA. Nothing is carried
forward from the predecessor's proof.

## ASSERTIONS:

- [x] Finding 1 (P1) FIXED — readmission captures no contract before the branch
  worktree exists, and resolves once after checkout with the worktree root
  ordered first. A branch-carried contract is reused verbatim and offline.
- [x] Finding 3 (P2) FIXED — consumption is tracked across contract-field
  extraction by per-line ownership. A recognized nested section reaches exactly
  one field and appears exactly once in the rendered packet.
- [x] Finding 4 (P2) FIXED — this bundle is regenerated. Every count,
  mutation summary and status was measured at the verified source SHA; no
  figure or unresolved-defect claim is carried over from the predecessor.
- [x] Finding 2 (P1) SATISFIED BY CI — `pnpm test:db` requires the
  staging-backed environment and is produced by CI, then validated inside the
  required `verify` context. Not waived; `N/A` is not claimed; not asserted by
  the author.
- [x] The four executor entrypoint files are byte-identical to the preserved
  head; only the packet module, lane-start and their two suites changed.
- [x] Each fix is load-bearing: eleven mutations were executed, every one was
  detected, every G1-G14 control except G2 and G3 is killed by at least one of
  them, and both sources restore byte-identical afterwards. G2/G3 are called
  out explicitly below as NOT killed by any mutation in this battery.

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
verify:static suite total    5071 tests, 5071 pass, 0 fail, 0 skipped
                             (0 `not ok` lines in the full run log)
execution-packet suite       57 tests, 57 pass, 0 fail
lane-start suite             44 tests, 44 pass, 0 fail
claude-exec + codex-exec     46 tests, 46 pass, 0 fail
r-level check                PASS — rules matched: (none)
mutation battery             11 of 11 mutations DETECTED (M1-M10 plus M4b); see
                             the mutation table below for exact kill targets
pnpm test:db                 NOT AUTHOR-ASSERTED. Produced by CI job "Writable DB
                             proof (staging only)" and validated inside the required
                             `verify` context; read that context's conclusion on the
                             head under review, not this line (finding 2)
```

## Verification

| Check | Result | Evidence |
|---|---|---|
| `pnpm verify:static` | PASS | Exit 0. 5071 tests, 5071 pass, 0 fail, 0 skipped, 0 `not ok` lines. Totals summed across the complete run log, not a tail. |
| `pnpm verify` | PARTIAL — static stages PASS | `verify` is `verify:static && test:live-db`. The static half exits 0. The live half refuses locally by design: `ci:assert-staging` reports `host=127.0.0.1 ref=unidentified expected=xskgrzbteyqdufktjrjx` before any test runs. See `pnpm test:db` below — the live half is supplied by CI, which is where it is enforceable. |
| `pnpm type-check` | PASS | Stage of `pnpm verify:static` (exit 0). |
| `pnpm exec tsx --test scripts/ops/execution-packet.test.ts` | PASS | 57 tests, 0 failures. |
| `pnpm exec tsx --test scripts/ops/lane-start.test.ts` | PASS | 44 tests, 0 failures. |
| `pnpm exec tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD` | PASS | Rules matched: (none) — no R-level artifacts required for this diff. |
| Test delta | +14 | 5057 at the preserved head to 5071 here. The delta is exactly G1-G14 and nothing else. |
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

```text
scripts/ops/  8 files, 3618 insertions(+), 41 deletions(-)
```

The whole-diff insertion total is deliberately not quoted: it counts this proof
bundle, so recording it here would change it.


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
now both read one table, `CONTRACT_FIELD_SPECS`, and every extraction site goes
through `fieldSpec()` rather than naming heading literals. `G8` fails if a
`sectionLines` call ever passes an inline heading literal again — the drift
itself is now a test failure, not a review-time catch.

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

Re-measured from scratch against the current tree. Every mutation was applied
to a byte-verified baseline and reverted **by file copy, never by
`git checkout`**; every restore was re-checked by `sha256`.

Baselines: `execution-packet.ts` `4c13a569357e33adc56e70e79416261bfcf28e7796a9cc858886807cc0bf0fe5`,
`lane-start.ts` `64c8beb94adbad60b5decff42781d67d05e7901a4242c848c7b8976878fee60c`.
Both matched after every single mutation.

| # | Mutation | Tests killed | Intended target |
|---|---|---|---|
| M1 | `sectionLines` reserved-descendant exemption removed | G1, G6, G7, G8 | G1 |
| M2 | residue claimed-child subtraction removed | G5 | G5 |
| M3 | readmission capture guard removed | G4 | G4 |
| M4 | reservation predicate given its own hardcoded five | 53 tests | G6, G7, G8 |
| M4b | narrowed **only** on the nested-suppression path | G6, G7, G8 | G6, G7, G8 |
| M5 | `parseSections` fence tracking disabled | G9, G11 | G9 |
| M6 | heading match reverted to the trimmed line | G10, G13 | G10 |
| M7 | `sectionItems` fence handling disabled | G11 | G11 |
| M8 | `sectionItems` indented-code handling disabled | G10, G13 | G13 |
| M9 | unreserved extraction heading added, `sectionLines` guard removed | G12 | G12 |
| M10 | word boundary removed from `headingMatches` | G14 | G14 |

M4 kills 53 tests rather than a handful. That is not a loose assertion: with the
reservation set narrowed, the fail-closed guard now inside `sectionLines`
refuses every extraction heading it no longer recognises, so the defect can no
longer be introduced quietly at all. M4b narrows only the nested-suppression
path, leaving the guard intact, and isolates the three controls that catch the
defect on its own terms.

M5 kills two tests: destroying fence tracking in the parser leaves
`sectionItems` with no intact fence to preserve, so G11 cannot pass either. M7
isolates the `sectionItems` half. M6 and M8 overlap on G13 for the same reason —
an indented fence depends on both the heading-indentation rule and the
indented-run handling.

**Not proven load-bearing by this battery: G2 and G3.** No mutation executed
here kills them. G3 is an inversion test that asserts a throw, and G2 asserts
the offline-reuse path that the finding-1 fix enables; neither is exercised by
removing the guard, because M3's damage is caught first by G4. This is stated
rather than left for a reader to infer from the table.

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
