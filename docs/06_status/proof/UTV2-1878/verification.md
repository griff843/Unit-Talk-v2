# PROOF: UTV2-1878

MERGE_SHA: pending merge

> Pre-merge the merge row is intentionally the placeholder; the Execution SHA row carries
> the verified implementation identity. `post-merge-lane-close.yml` rebinds merge
> authority only after GitHub supplies the merged-PR attestation.

Generated at: 2026-09-10T16:41:17.718Z
Issue: UTV2-1878
Tier: T1
Lane type: governance
Branch: claude/utv2-1878-membership-product-contract
PR URL: https://github.com/griff843/Unit-Talk-v2/pull/1557
Head SHA: a615ba0aa5d9d6aef5e7539dc7a04c8e49e1c2d9
result: pass

## ASSERTIONS:

- [x] `docs/03_product/MEMBERSHIP_PRODUCT_CONTRACT.md` exists and is the single authoritative
      destination document for customer tiers, entitlements, public transparency, website claims,
      Discord design and future product capabilities.
- [x] Free and Trial members retain access to **all** settled results, recaps and corrections. The
      contract states this in prose at `:79` and enforces it in the entitlement matrix at `:246-247`,
      where every tier column reads `Yes` for "All settled picks and complete results" and for
      "All recaps and corrections".
- [x] That free access is bounded rather than open-ended: `:95` states that free access to settled
      results never grants access to an active paid pick before settlement, and that active picks,
      live advice and premium alerts remain controlled by tier.
- [x] `docs/mission/intent.md` carries a pointer naming the contract as the canonical membership
      product destination, and that pointer explicitly does **not** create a readiness threshold:
      it states that the contract defines the destination, does not prove a capability is
      implemented or live, that current-state claims still require live evidence, and that overall
      readiness remains governed exclusively by
      `docs/05_operations/T1_PRODUCTION_READINESS_CONTRACT.md`.
- [x] The lane changes documentation only. No application code, no schema, no workflow, no gate and
      no entitlement enforcement path is modified — 4 files changed, all under `docs/`.

## EVIDENCE:

The measured commands are recorded below. Every result is the output of the command as run in this
lane's worktree at head `a615ba0aa5d9d6aef5e7539dc7a04c8e49e1c2d9`.

```
$ pnpm type-check
> @unit-talk/v2@0.1.0 type-check
> pnpm exec tsc -b tsconfig.json
(exit 0)

$ pnpm test
(full repository suite; per-file TAP aggregates summed across all files)
files: 100   # tests 6118   # pass 6118   # fail 0
(exit 0)

$ pnpm verify
Not run locally by design, and not claimable from this workstation: `pnpm verify` invokes
`ci:assert-staging-target`, which pins the writable-DB step to the staging project
`xskgrzbteyqdufktjrjx` and fails closed outside CI. This lane's manifest records
`t1_live_db_precondition: deferred_to_ci` for exactly this reason, so `pnpm verify` is asserted by
the required `verify` check on the merge SHA and enforced at closeout by truth-check `G6`, which
requires both `verify` and `Writable DB proof (staging only)` green on that SHA.

$ npx tsx scripts/ci/r-level-check.ts --base 7b3fd41115d7ddd21815f0309b0ebf600f6d1f13 --head a615ba0aa5d9d6aef5e7539dc7a04c8e49e1c2d9
Verdict: PASS
Changed files: 4
Rules matched: (none) — no R-level artifacts required for this diff

$ git diff --stat 7b3fd41115d7ddd21815f0309b0ebf600f6d1f13 a615ba0aa5d9d6aef5e7539dc7a04c8e49e1c2d9
 4 files changed, 553 insertions(+)

$ sed -n '79p;95p;246,247p' docs/03_product/MEMBERSHIP_PRODUCT_CONTRACT.md
All members, including Free and Trial, may see the complete settled record after a pick is settled.
Free access to settled results never grants access to an active paid pick before settlement. Active picks, live advice, and premium alerts remain controlled by tier.
| All settled picks and complete results | Yes | Yes | Yes | Yes | Yes |
| All recaps and corrections | Yes | Yes | Yes | Yes | Yes |
```

## Verification
- [x] `pnpm type-check`: exit 0
- [x] `pnpm test`: exit 0 — 6118 tests, 6118 pass, 0 fail across 100 test files
- [x] `pnpm verify`: deferred to CI on the merge SHA per the manifest's
      `t1_live_db_precondition: deferred_to_ci`; enforced by truth-check `G6`. Not claimed locally.
- [x] `npx tsx scripts/ci/r-level-check.ts --base 7b3fd4111 --head a615ba0aa`: Verdict PASS,
      4 changed files, no rules matched

## Runtime Verification

This is a `governance` lane, which `declaredProfileForLaneType` resolves to the `static` proof
profile. It changes documentation only and introduces no runtime behaviour, so there is no runtime
surface for this bundle to exercise: the four changed files are `docs/` markdown, and no
application code, migration, workflow or entitlement enforcement path is touched.

The live-database obligation is not waived by that. It is deferred to CI and discharged there —
`Writable DB proof (staging only)` runs against the pinned staging project on the merge SHA, and
`G6` refuses closeout without both that receipt and `verify` green on the same SHA.

## Merge SHA Binding

Merge SHA: pending merge
PR: https://github.com/griff843/Unit-Talk-v2/pull/1557
Approved PR head: pending merge
Execution SHA: a615ba0aa5d9d6aef5e7539dc7a04c8e49e1c2d9
