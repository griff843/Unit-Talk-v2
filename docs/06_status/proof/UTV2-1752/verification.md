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
- [x] Each fix is load-bearing: three mutations each kill exactly one test,
  its own, and both sources restore byte-identical afterwards.

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
verify:static suite total    5062 tests, 5062 pass, 0 fail, 0 skipped
execution-packet suite       48 tests, 48 pass, 0 fail
lane-start suite             44 tests, 44 pass, 0 fail
r-level check                PASS — rules matched: (none)
mutation battery             3 of 3 mutations DETECTED, each killing only its own test
pnpm test:db                 NOT AUTHOR-ASSERTED. Produced by CI job "Writable DB
                             proof (staging only)" and validated inside the required
                             `verify` context; read that context's conclusion on the
                             head under review, not this line (finding 2)
```

## Verification

| Check | Result | Evidence |
|---|---|---|
| `pnpm verify:static` | PASS | Exit 0. 5062 tests, 5062 pass, 0 fail, 0 skipped. Totals read from the complete 33,002-line run log, not a tail. |
| `pnpm verify` | PARTIAL — static stages PASS | `verify` is `verify:static && test:live-db`. The static half exits 0. The live half refuses locally by design: `ci:assert-staging` reports `host=127.0.0.1 ref=unidentified expected=xskgrzbteyqdufktjrjx` before any test runs. See `pnpm test:db` below — the live half is supplied by CI, which is where it is enforceable. |
| `pnpm type-check` | PASS | Stage of `pnpm verify:static` (exit 0). |
| `pnpm exec tsx --test scripts/ops/execution-packet.test.ts` | PASS | 48 tests, 0 failures. |
| `pnpm exec tsx --test scripts/ops/lane-start.test.ts` | PASS | 44 tests, 0 failures. |
| `pnpm exec tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD` | PASS | Rules matched: (none) — no R-level artifacts required for this diff. |
| Test delta | +5 | 5057 at the preserved head to 5062 here. The delta is exactly G1, G2, G3, G4, G5 and nothing else. |
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

Each mutation was applied to the shipped source, the suite run, and the source
restored by file copy — never by `git checkout`.

```text
BASELINE      execution-packet 48/48 pass    lane-start 44/44 pass

M1  sectionLines reserved-descendant subtraction neutralised
    KILLED: G1 — a recognized section nested under another recognized section
            lands in exactly one field
    execution-packet 47 pass, 1 fail   (kills only its own test)

M2  residue per-line subtraction neutralised
    KILLED: G5 — a claimed child is subtracted from an UNRECOGNIZED ancestor
            that survives as residue
    execution-packet 47 pass, 1 fail   (kills only its own test)

M3  unconditional early capture restored (the finding-1 defect)
    KILLED: G4 — the readmission path performs no contract capture before the
            worktree exists
    lane-start 43 pass, 1 fail         (kills only its own test)

RESTORE CHECK
    scripts/ops/execution-packet.ts: OK
    scripts/ops/lane-start.ts: OK
```

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
