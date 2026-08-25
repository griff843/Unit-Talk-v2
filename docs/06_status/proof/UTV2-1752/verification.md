# PROOF: UTV2-1752

MERGE_SHA: N/A

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
- [ ] Finding 2 (P1) NOT SATISFIED LOCALLY — `pnpm test:db` requires the
  staging-backed environment and must be produced by CI. It is recorded as
  pending, not waived. `N/A` is not claimed.
- [x] The four executor entrypoint files are byte-identical to the preserved
  head; only the packet module, lane-start and their two suites changed.
- [x] Each fix is load-bearing: three mutations each kill exactly one test,
  its own, and both sources restore byte-identical afterwards.

## EVIDENCE:

```text
pnpm verify:static           PASS (exit 0)
verify:static suite total    5062 tests, 5062 pass, 0 fail, 0 skipped
execution-packet suite       48 tests, 48 pass, 0 fail
lane-start suite             44 tests, 44 pass, 0 fail
r-level check                PASS — rules matched: (none)
mutation battery             3 of 3 mutations DETECTED, each killing only its own test
pnpm test:db                 PENDING — CI staging receipt required (finding 2)
```

## Verification

| Check | Result | Evidence |
|---|---|---|
| `pnpm verify:static` | PASS | Exit 0. 5062 tests, 5062 pass, 0 fail, 0 skipped. Totals read from the complete 33,002-line run log, not a tail. |
| `pnpm verify` | PARTIAL — static stages PASS | `verify` is `verify:static && test:live-db`. The static half exits 0. The live half refuses locally by design: `ci:assert-staging` reports `host=127.0.0.1 ref=unidentified expected=xskgrzbteyqdufktjrjx` before any test runs. See `pnpm test:db` below — for this lane that is a gap, not an exemption. |
| `pnpm type-check` | PASS | Stage of `pnpm verify:static` (exit 0). |
| `pnpm exec tsx --test scripts/ops/execution-packet.test.ts` | PASS | 48 tests, 0 failures. |
| `pnpm exec tsx --test scripts/ops/lane-start.test.ts` | PASS | 44 tests, 0 failures. |
| `pnpm exec tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD` | PASS | Rules matched: (none) — no R-level artifacts required for this diff. |
| Test delta | +5 | 5057 at the preserved head to 5062 here. The delta is exactly G1, G2, G3, G4, G5 and nothing else. |
| `pnpm test:db` | **PENDING — REQUIRED** | Mandatory for this T1 lane and deliberately NOT marked `N/A`. It cannot be produced from this environment: the staging target is unreachable under containment. The CI-produced receipt from the authorized staging path is the only acceptable evidence, and this lane is not complete without it. |

## Runtime Verification

No runtime, database, migration, deployment, ingestion or delivery path is
touched. Production containment was in force throughout: no SGO call, no
production mutation, no production DDL, no member delivery, no unpark, no
secret access.

This does NOT downgrade the `pnpm test:db` requirement above. The lane's tier
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

`pnpm test:db` has not run. Until the CI staging receipt exists, this lane's T1
database verification is incomplete and no green static run substitutes for it.
