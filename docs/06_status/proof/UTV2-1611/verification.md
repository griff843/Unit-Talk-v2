# PROOF: UTV2-1611

MERGE_SHA: 6b2c76747a368a45e42b9788cc665a852e525fca

> Pre-merge this anchor carries the verified branch-head SHA. The authoritative
> merge SHA does not exist yet; post-merge closeout must rebind this artifact.

Generated at: 2026-08-16T16:27:02Z
Issue: UTV2-1611
Tier: T1
Lane type: runtime
Branch: codex/utv2-1611-automated-write-boundary
PR URL: https://github.com/griff843/Unit-Talk-v2/pull/1427
Verified implementation source: 6b2c76747a368a45e42b9788cc665a852e525fca
Pre-proof branch head: 6b2c76747a368a45e42b9788cc665a852e525fca
Result: static implementation verified; completion blocked on an authorized live-DB proof path and staging receipt

## ASSERTIONS:

- [x] System-generated board and candidate-scanner submissions are created directly in `awaiting_approval` without a transient `validated` state.
- [x] A synthetic future producer marked `systemGenerated` is governed without source allowlist membership, and adding a valid `PickSource` requires an explicit compile-time policy classification.
- [x] Missing or stale current market evidence fails closed before the producer invokes submission persistence.
- [x] Scheduler/enablement flags grant execution only and cannot approve or release an automated pick.
- [x] Producer, transition actor/reason, snapshot timestamp, and snapshot age are recorded as boundary provenance.
- [x] A readiness helper mechanically detects any marked automated producer, including the synthetic future source, observed in `validated`.
- [x] Manual and operator submission behavior remains on the existing `validated` path.
- [ ] Writable Postgres behavior is not claimed locally; the authoritative exact-head receipt must come from staging project `xskgrzbteyqdufktjrjx`.

## EVIDENCE:

## Verification

- [x] `pnpm verify:static`: PASS on rebased head, including `pnpm type-check`, build, canonical `pnpm test`, lint, environment checks, automation coverage, and command/migration checks.
- [x] `pnpm exec tsx --test 'apps/api/src/automated-write-boundary.test.ts' 'apps/api/src/board-pick-writer.test.ts' 'apps/api/src/candidate-pick-scanner.test.ts'`: PASS, 39/39.
- [x] `pnpm exec tsx --test apps/api/src/submission-service.test.ts`: PASS, 73/73.
- [x] `pnpm exec tsx --test apps/api/src/settlement-service.test.ts`: PASS, 25/25.
- [x] `npx tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD`: PASS; matched `lifecycle-fsm`; R4 fault report is PM-gated advisory.
- [x] `git diff --check`: PASS.
- [x] `pnpm ops:automation-coverage-check`: PASS; the boundary cases are registered through the canonical candidate-scanner suite.

```text
$ pnpm verify:static
exit 0

$ pnpm exec tsx --test 'apps/api/src/automated-write-boundary.test.ts' 'apps/api/src/board-pick-writer.test.ts' 'apps/api/src/candidate-pick-scanner.test.ts'
1..39
# tests 39
# pass 39
# fail 0
# skipped 0

$ npx tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD
Verdict: PASS
Changed files: 12
Rules matched: lifecycle-fsm
Advisory (PM-gated) artifacts missing: r4-fault-report
```

## Runtime Verification

The focused tests execute the real submission service against the in-memory
repository bundle and exercise both automated producer loops. They demonstrate
the initial lifecycle decision, fail-closed evidence checks, provenance, and
manual-path preservation. The rework regression also proves that a synthetic
future producer marked `systemGenerated` cannot bypass the boundary solely
because its source is absent from a historical allowlist.

`pnpm test:db` was attempted locally. The staging guard stopped execution before
any writable test or database mutation:

```text
[assert-staging] host=127.0.0.1 ref=unidentified expected=xskgrzbteyqdufktjrjx
[assert-staging] REFUSED: target identity could not be resolved from its URL (host=127.0.0.1). Writable DB verification requires xskgrzbteyqdufktjrjx. Run it through the staging-ci GitHub environment with CI_SUPABASE_* credentials.
```

Writable live-DB proof is blocked/deferred: target identity could not be resolved
from its URL (host=unparseable). Writable DB verification requires
`xskgrzbteyqdufktjrjx`. Run it through the `staging-ci` GitHub environment with
`CI_SUPABASE_*` credentials.

No production credentials were sourced or copied. No Supabase project, stranded
row, scanner flag, deployment, or public distribution target was mutated.

## Stop Condition

The repository Proof Coverage Guard requires a live-DB proof case under an
accepted T1 proof-test path because `submission-service.ts` changed. This lane's
allowed file list contains no accepted live-DB proof path. Adding one or applying
an infrastructure-only skip label would exceed the packet's authority. The lane
therefore requires scope expansion plus a staging-CI exact-head receipt before
it can satisfy the T1 proof gate.

The Return Review Packet also requires direct package-script wiring for the new
`automated-write-boundary.test.ts` file. The suite is registered through
`candidate-pick-scanner.test.ts` and executes under `pnpm verify:static`, but the
mechanical wiring gate still fails and `package.json` is outside the allowed
file scope. That correction likewise requires an explicit scope expansion.

## SHA Binding

Head SHA: 6b2c76747a368a45e42b9788cc665a852e525fca
Merge SHA: N/A — post-merge closeout responsibility

### PM-authorized scope addition

`apps/api/src/t1-proof-utv2-1611-board-write-boundary.test.ts` was added to `file_scope_lock` under explicit PM authorization on 2026-08-16, under the existing accepted T1-proof path. One file; no lane restart; no broader expansion.

It exists because the Proof Coverage Guard correctly refused a change to sensitive runtime paths that carried no corresponding live-DB proof, and because acceptance criterion 8 requires live proof of zero unauthorized direct-to-validated writes. The proof drives the real `board-construction` submission path through `submitPickController` against staging and asserts the persisted row starts in `awaiting_approval`, that the birth lifecycle event agrees and never names `validated` in either direction, and that no direct-to-validated board write exists for the run. Fixtures are namespaced with a per-run UUID under `utv2-1611-boundary-*` and are voided in `after()` so none is left actionable.

### Two governance layers, and which one this lane changes

The Phase 7A brake in `distribution-service.ts` (`GOVERNANCE_BRAKE_SOURCES`) governs autonomous SOURCES — `system-pick-scanner`, `alert-agent`, `model-driven` — by source alone, with no marker, transitioning after creation. `t1-proof-awaiting-approval.test.ts` exercises that path with minimal source-only fixtures and is unchanged by this lane.

This lane adds a distinct boundary governing automated PRODUCTIONS, keyed on the `systemGenerated` marker every automated producer stamps, materializing them into `awaiting_approval` in the same atomic write as the pick and its birth lifecycle event. `board-construction` was deliberately excluded from `GOVERNANCE_BRAKE_SOURCES` as "operator-triggered" (comment at `distribution-service.ts:79-84`, PM correction 2026-04-10); the board writer later became scheduled and autonomous, so its picks reached `validated` ungoverned. That is the defect closed here.

### Known limitations

- **`GOVERNANCE_BRAKE_SOURCES` has no exhaustiveness constraint.** It is a plain `ReadonlySet<PickSource>`, so a newly added autonomous source omitted from it is ungoverned by the source brake. Resolved mechanically as latent rather than live: measured on this head through the production path, a marker-stamped `board-construction` submission persists as `awaiting_approval` even though `board-construction` is absent from that set, so omission can no longer persist a `validated` pick for a marker-stamped producer. The residual exposure is a source-only automated submission from an unlisted source. Filed separately as UTV2-1716; not addressed here.
- **Shadow Parity Check is unavailable.** It fails with "No mechanically read-only production credential is provisioned." Recorded as infrastructure debt per PM decision; no credential was provisioned or fabricated for this lane. It is not one of the four required merge contexts.
- The boundary keys on the `systemGenerated` marker. A source-only automated submission is governed by the Phase 7A source brake instead, which is why this boundary deliberately does not claim those fixtures.
