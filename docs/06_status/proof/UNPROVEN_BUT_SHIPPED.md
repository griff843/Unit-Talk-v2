# `UNPROVEN_BUT_SHIPPED` — ledger for the proof-scaffold audit's Table C1

Produced under **UTV2-1635**. Machine-readable sibling: [`UNPROVEN_BUT_SHIPPED.json`](./UNPROVEN_BUT_SHIPPED.json).
Source audit: [`UTV2-1631/proof-scaffold-audit.md`](./UTV2-1631/proof-scaffold-audit.md).

**These two documents must be read together.** The audit records what was destroyed and
what it could not decide. This ledger decides the remainder.

---

## Headline

The audit's Table C1 concluded its 24-ish files were **"only resolvable from GitHub's
retained PR commit list, not locally. I did not resolve it."**

They are resolvable, and they are now resolved. GitHub retains a squashed PR's original
branch commits and keeps them reachable by SHA indefinitely. Walking
`/pulls/{n}/commits` and fetching `/contents/{path}?ref={sha}` at every commit that
touched each proof path recovers the exact pre-squash state.

**All 28 C1 files across 21 lanes were decided. None remained undecidable.**

| Outcome | Files | Meaning |
|---|---:|---|
| `RECOVERED` | 2 | Hand-written proof was destroyed pre-squash; retrieved byte-identically |
| `NO_LOSS_GENERATED_DIFF` | 18 | `diff-summary.md` born generated; content is diff-derived and factual |
| `NO_LOSS_AUGMENTED` | 3 | Born generated, then hand-augmented before merge |
| `PROVEN_BY_RETAINED_CI` | 2 | T3; tier proof *is* green CI on merge SHA, and that CI is retained and green |
| `UNPROVEN_BUT_SHIPPED` | 3 | Evidence genuinely unreconstructable |

So the destruction hypothesis for C1 is largely **negative**: 26 of 28 files were born as
scaffold on the branch and destroyed nothing. That is a materially better result than the
audit's worst case, and a materially worse one than "all fine" — because 2 files *were*
destroyed, on the highest-consequence lane in the set.

---

## Count reconciliation

The audit is internally inconsistent here, so the figure is derived from scratch.

| Source | Files | Lanes |
|---|---:|---:|
| Audit prose ("C1 — genuinely undecidable") | 24 | 22 |
| Audit's own two enumerated lists | 28 | 21 |
| Re-measured with the audit's shape test | 29 | 22 |
| **After excluding the confirmed false positive** | **28** | **21** |

Method: for every `verification.md` / `diff-summary.md` under `docs/06_status/proof/`,
test whether it is generator-shaped **at its adding commit** (not merely today — several
Table A files were added with real content and clobbered later, and testing today's
content misclassifies those as C1), then require the adding commit to equal
`commit_sha` in the lane manifest.

**`UTV2-1125/verification.md` is confirmed a false positive and excluded.** The audit's
verdict is right; its stated reason is half-right. `buildRuntimeVerification` did exist
before the file was added — since 2026-05-25 (`dda94cd0`) — but it emitted
`runtime-verification.md`. It was only pointed at `verification.md` on 2026-07-04
(`994ed267`). The file itself is 2,287 B of hand-written prose with substantive Summary
and Evidence sections and zero `result: not_run` / `not run by proof-generate` markers.

**The defensible figures are 28 files across 21 lanes.** The audit's "22 lanes" is
correct only if UTV2-1125 is counted, which contradicts the audit's own caveat excluding
it. "24 files" is not reproducible under any reading.

---

## Recovered — destroyed proof retrieved

### UTV2-1423 (T1, governance) — PR [#1169](https://github.com/griff843/Unit-Talk-v2/pull/1169)

*"UTV2-1423: canonical T2 merge-authority + PM-approval definition"* — the lane that
defines the merge-authority rules the whole repo runs on.

Both proof files were hand-written in branch commit
**`c003a5529962a1aeb77f38d926f6b22170fa1710`** and replaced with generator output in
branch commit `ac82663dad` before the squash. `main` therefore never saw the originals.

| File | Destroyed version | What landed on `main` |
|---|---|---|
| `verification.md` | 48 L / 2,255 B — `pnpm verify:quick` PASS, `pnpm verify:parallel` PASS, `pnpm test:db` PASS with a literal `# tests 7 / # pass 7 / # fail 0` TAP block, plus issue-specific grep verification | 23 L / 705 B — `result: not_run`, `- [ ] pnpm type-check: not run by proof-generate` |
| `diff-summary.md` | 72 L / 4,218 B — prose scope description and per-file provenance | 31 L / 806 B — generated file list |

Recovered to `docs/06_status/proof/UTV2-1423/recovered/`, **byte-identical**, verified by
matching git blob SHAs against GitHub's content API:

- `verification.md` → blob `83ca97f7ddfcd9e8d93193e43df13cab3646c9f5`
- `diff-summary.md` → blob `a3adc064bb6e248ff8c214c30470d96728fb6b71`

Nothing in the existing bundle was modified or removed. Provenance is recorded in
`docs/06_status/proof/UTV2-1423/RECOVERED.md`.

This is the finding that most justifies the exercise: a T1 governance lane was reading as
`result: not_run` on `main` while its real proof — including a green live-Supabase
`test:db` run — sat recoverable in GitHub the whole time.

---

## `UNPROVEN_BUT_SHIPPED` — risk-ordered

Ordered per PM direction, high-risk production and Tier C first.

Tier C paths (`supabase/migrations/**`, `packages/contracts/src/**`,
`packages/domain/src/**`, `packages/db/src/{lifecycle,repositories,runtime-repositories}.ts`,
`apps/api/src/{distribution-service,auth}.ts`, `apps/worker/**`, per
`.github/workflows/codex-return-review.yml`) were checked across all 21 C1 lanes.
**Exactly one lane touched Tier C: UTV2-1143** (`packages/domain/src/edge-decay/**` and
`packages/domain/src/index.ts`) — and it is *not* in the unproven set. Its C1 file is
`diff-summary.md` only; its `verification.md` is hand-written, intact, and carries a
node:test TAP block. So the highest-sensitivity lane in the set is also the
best-evidenced one, and no lane requiring re-verification touches Tier C at all.

Ordering below is therefore driven by governance-gate blast radius, then production
surface, then code volume.

### 1. UTV2-1518 — T2, governance — **HIGH**

- Merge SHA `28d6bac3f67bcfd3ac059b9b9eb3359ce07cd781`, PR [#1197](https://github.com/griff843/Unit-Talk-v2/pull/1197)
- *"widen own-lane proof-directory exemption to the full glob (reopened)"*
- Changed: `scripts/ci/file-scope-guard.ts` (+16/−1), `scripts/ci/file-scope-guard.test.ts` (+106/−0)
- **Bundle claims today:** `verification.md` is pure scaffold — `result: not_run` and four unchecked boxes (`pnpm type-check`, `pnpm test`, `pnpm verify`, `r-level-check`), all "not run by proof-generate". `diff-summary.md` is a generated file list.
- **Why unrecoverable:** both proof paths were touched exactly once on the branch, in commit `8ea7b964e526ded77b9209f56a771ca9142c2094`, and both blobs at that commit are already generator-shaped (`verification.md` 35 L, `diff-summary.md` 41 L). There is no earlier version on the branch and none on `main`. GitHub returned the complete 4-commit list and every blob — nothing is missing or expired; the hand-written version simply never existed.
- **Retained CI:** `verify`, `Executor Result Validation`, `Merge Gate`, `P0 Protocol` all **success** on head SHA; `verify` success on merge SHA.
- **Residual risk:** the file-scope CI gate that constrains every lane repo-wide was changed with a +106-line test suite but no recorded verification that the suite ran, so a scope-enforcement weakening would not have been caught by the proof bundle.

### 2. UTV2-1528 — T2, governance — **MEDIUM**

- Merge SHA `fa207483e6`, PR [#1199](https://github.com/griff843/Unit-Talk-v2/pull/1199)
- *"ratify OS v1 lock — land OS_V1_LOCK.md"*
- Changed: `.lane/lanes/governance.yml` (+4/−0)
- **Bundle claims today:** `verification.md` pure scaffold, `result: not_run`. `diff-summary.md` generated.
- **Why unrecoverable:** both proof paths were touched exactly once on the branch, in commit `2575ed35794f0eb874c251f07a72485298a7dbcc`, and both blobs there are already generator-shaped (`verification.md` 25 L, `diff-summary.md` 37 L). The 5-commit branch list was returned in full with no earlier version of either path.
- **Retained CI:** all four required contexts **success** on head SHA; `verify` success on merge SHA.
- **Residual risk:** widens the path authority of the governance lane by 4 lines with no recorded verification, so any over-broad glob would be unverified — though the diff is small enough to re-read directly.

### 3. UTV2-1513 — T2, delivery-ui — **MEDIUM-LOW**

- Merge SHA `c9531ae7616f6812bb1f743c5d46704b213b70c4`, PR [#1201](https://github.com/griff843/Unit-Talk-v2/pull/1201)
- *"Public website MVP foundation"* — 37 files, +2,657/−0
- Changed: `apps/web/**` only (new Next.js app: pages, components, config) plus `pnpm-lock.yaml`
- **Bundle claims today:** `verification.md` pure scaffold, `result: not_run`. `diff-summary.md` generated. A substantive `executor-result-proof.md` does exist.
- **Why unrecoverable:** `verification.md` was touched twice on the branch — `b52974ebca732b49ff983a5ca09fded10f01194d` and `2422c87817150ccad32ecae9c8a3f51fcf7097ae` — and **both** blobs are generator-shaped at 29 lines. GitHub returned both; neither is a hand-written predecessor.
- **Retained CI:** all four required contexts **success** on head SHA. On the merge SHA `verify` shows `cancelled` — a post-merge re-run cancelled by concurrency, not a failure; the authoritative green is the head-SHA run.
- **Residual risk:** the largest code volume in the set, but it is a wholly new isolated app with `−0` deletions — no existing runtime, DB, delivery, domain, or Tier C path is touched. Exposure is public-facing legal, pricing, and responsible-play copy shipping without a recorded review, not pipeline behaviour.

---

## `PROVEN_BY_RETAINED_CI` — thin bundle, but tier requirement met

Both are **T3**, whose proof requirement per the tier table in `CLAUDE.md` is *"Green CI
on merge SHA"* — which GitHub still retains and which is green. The bundle artifact is
scaffold; the tier obligation is satisfied by recovered evidence. Classifying these as
unproven would overstate the problem.

| Lane | Tier | Merge SHA | PR | `verify` on merge SHA | Scope |
|---|---|---|---|---|---|
| UTV2-1428 | T3 | `2b1c23169c…` | [#1196](https://github.com/griff843/Unit-Talk-v2/pull/1196) | **success** | Docs only — launch safety runbook, rollback, SLOs |
| UTV2-1498 | T3 | `d2839f5ba9…` | [#1198](https://github.com/griff843/Unit-Talk-v2/pull/1198) | **success** | Docs only — memory-to-skill promotion framework |

Recommended, not required: harvest the retained CI result into each bundle, exactly as
UTV2-1631 did for itself. That is a mechanical write of already-measured evidence, not
new proof.

---

## `NO_LOSS` — the other 16 lanes

21 files across 16 lanes were born generated on the branch and destroyed nothing.

For 18 of them the C1 file is `diff-summary.md`, and this deserves a precise reading:
generated `diff-summary.md` content is **mechanically derived from the actual diff**, so
it is factually correct about which files changed and by how much. What it lacks is prose
rationale. That is a documentation gap, not an evidence gap — and in every one of these
16 lanes the sibling `verification.md` is hand-written and intact, most carrying literal
node:test TAP blocks.

Three files were born generated and then hand-augmented on the branch before merge
(`NO_LOSS_AUGMENTED`): UTV2-1524's `verification.md` and `diff-summary.md`, and
UTV2-1433's `diff-summary.md`. UTV2-1524's `verification.md` is worth singling out — it
retains the generator's unchecked-box header but its Runtime Verification section was
replaced with a real `pnpm test:db` run (`# tests 7 / # pass 7 / # fail 0`), a P1
correction record, and the PM verdict reference. It reads as scaffold at a glance and is
not.

Lanes in this group: UTV2-1143, 1170, 1171, 1174, 1286, 1287, 1344, 1352, 1401, 1433,
1459, 1460, 1464, 1467, 1524. (UTV2-1423 also appears in C1 but is classified
`RECOVERED` above.)

---

## Retained-CI coverage, as an independent check

The four required contexts (`verify`, `Executor Result Validation`, `Merge Gate`,
`P0 Protocol`) were fetched on every C1 lane's branch head:

- **19 of 21 lanes:** all four **success**.
- **UTV2-1170 / UTV2-1171:** zero check-runs retained. Both merged 2026-05-26, predating
  the current checks regime; PR #877 still carries a legacy commit status of `success`,
  PR #876 `pending`. Their C1 file is `diff-summary.md` only and both have substantive
  hand-written `verification.md`, so this does not change their `NO_LOSS` classification.

---

## What this ledger does not claim

`UNPROVEN_BUT_SHIPPED` means the completion evidence cannot be reconstructed. It does not
mean the code is wrong, and it is not an accusation. All three lanes passed all four
required contexts at merge time, and that CI result is independently retained. Equally, it
is not an absolution: green CI is not the same as the tier-required verification log, and
for UTV2-1518 in particular the change was to a gate whose failure mode is silent.

The correct next step for the three is re-verification against current `main`, in risk
order, not retroactive proof authoring. **No proof was reconstructed, inferred, or
written from memory anywhere in this exercise** — the only content added is byte-identical
to what GitHub returned, with its source commit cited.
