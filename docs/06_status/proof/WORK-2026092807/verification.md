# PROOF: WORK-2026092807

MERGE_SHA: pending merge

Issue: WORK-2026092807
Tier: T2
Lane type: delivery-ui
Branch: claude/work-2026092807-smart-form-delivery-posture
Head SHA: cf050e518d4296f4b8a2b9b51da06ed3a6f32468
result: pass

## ASSERTIONS:

- [x] `resolveDeliveryDisposition` (`apps/smart-form/lib/delivery-disposition.ts`) reads the server's
      `deliveryPosture`. `track-only` yields a Track Only disposition that states no delivery
      record was created. `delivery-refused` yields a refusal disposition carrying
      `deliveryRefusedReason` when the server gives one.
- [x] `enqueued === true` still outranks posture. A response without a recognised posture falls
      back to the previous disposition (an older API build).
- [x] The disposition is still a function of the server response alone.
- [x] `SubmitPickResult` declares `deliveryPosture`, `deliveryRefusedReason` and `deliveryTarget`
      as optional server fields.
- [x] The bet-slip copy (`BetSlipPanel.tsx`) says Track Only stays Track Only and is never
      delivered, and that a delivery request is authorized or refused by the server.
- [x] Scope: 4 files, all under `apps/smart-form`. No API, contract, DB, delivery, containment
      or kill-switch change, and no production write.

## EVIDENCE:

### Tests

```
$ pnpm exec tsx --test apps/smart-form/test/api-client.test.ts
# tests 37
# pass 37
# fail 0
```

Four cases were added: the track-only posture; delivery-refused with and without a reason;
`enqueued` outranking posture; and an unrecognised posture falling back.

### Mutation drill

Removing both posture branches from `resolveDeliveryDisposition` turned 2 of the new tests red.
With the file restored, all 37 pass.

## Verification

- [x] `pnpm exec tsx --test apps/smart-form/test/api-client.test.ts`: 37 pass, 0 fail
- [x] Smart Form `tsc --noEmit`: exit 0
- [x] Mutation drill: removing the posture branches turns 2 tests red
- [x] `pnpm verify` passed in the required CI `verify` context on the merged head `f6f6a34cb32152a92d97aec0587d4d7b9d255076` (run 36476232947), and on `main` at merge `a6ca76a2b` (run 36477669170).
- [x] `pnpm type-check` is included in that `pnpm verify` run and passed.
- [x] `pnpm test` is included in that `pnpm verify` run and passed.
- [x] `pnpm exec tsx scripts/ci/r-level-check.ts --base a6ca76a2b3205b459580dfa09f5d1a98f28d7e8f^ --head a6ca76a2b3205b459580dfa09f5d1a98f28d7e8f`: Verdict PASS, 9 changed files, rule matched `operator-ui`. Recorded after merge by WORK-2026092813.

## Runtime Verification

This lane is T2 and presentation-only. It renders a field the deployed API already returns
(`deliveryPosture`, from `submit-pick-controller.ts`). No live-DB proof is claimed, and the
change reaches operators only through a deploy.

## Merge SHA Binding

Merge SHA: pending merge
PR: https://github.com/griff843/Unit-Talk-v2/pull/1681
Execution SHA: cf050e518d4296f4b8a2b9b51da06ed3a6f32468
