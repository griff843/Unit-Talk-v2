# PROOF: UTV2-1947

MERGE_SHA: pending merge

Issue: UTV2-1947
Tier: T1
result: pending_exact_head_ci_and_independent_review

## ASSERTIONS:

- [x] `/live` reads only `GET /api/member/picks?status=posted&limit=50`; it cannot fall back to the raw picks route.
- [x] `/today` reads only `GET /api/member/picks?status=posted,settled&limit=200`; it cannot fall back to the raw picks route.
- [x] Free users are denied paid reads; Trial, VIP, VIP+, Capper, and Operator personas may read the member-safe feed.
- [x] `/heat-signal` admits only VIP+, Capper, and Operator personas, returns truthful unavailability, and makes zero protected requests.
- [x] `/my-picks` no longer trusts mutable Discord names, remains unavailable until canonical identity exists, and makes zero protected requests.
- [x] Empty, blank, duplicate, malformed, or DM role contexts fail closed.
- [x] The UTV2-1960 truthful-copy regression coverage remains green.
- [ ] Exact-head CI `verify` and `Writable DB proof (staging only)` must pass before merge.
- [ ] Independent PM T1 review must approve this exact head before merge.

## EVIDENCE:

Execution SHA: `b7ad1a63fd25f3f47fd92c2db8c004f1624a97cf`

Focused Discord suite:

```text
tests 109
pass 109
fail 0
```

R-level compliance:

```text
Verdict: PASS
Rules matched: discord-delivery
Required: R1
Artifact requirements: none
```

Local T1 containment result:

```text
[assert-staging] host=127.0.0.1 ref=unidentified expected=xskgrzbteyqdufktjrjx
[assert-staging] REFUSED: target identity could not be resolved from its URL (host=127.0.0.1).
```

This is the ratified `t1_live_db_precondition: deferred_to_ci` path recorded by lane admission. No local green `pnpm verify` is claimed.

Live Discord evidence remains exactly:

```text
BLOCKED: live Discord browser/session unavailable
```

## Verification

- `pnpm --filter @unit-talk/discord-bot exec tsx --test src/discord-bot-foundation.test.ts` - PASS, 109/109.
- `pnpm lint` - PASS.
- `pnpm type-check` - PASS.
- `pnpm verify` - `verify:static` PASS; final `test:live-db` phase REFUSED by the staging identity guard on the contained local target. Exact-head CI must discharge this deferred proof.
- `pnpm exec tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD` - PASS; `discord-delivery` matched, R1 required, no artifact requirement.
- `git diff --check origin/main...HEAD` - PASS.

## Merge SHA Binding

Merge SHA: pending merge
PR: pending
Execution SHA: b7ad1a63fd25f3f47fd92c2db8c004f1624a97cf
