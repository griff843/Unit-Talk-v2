# PROOF: UTV2-1978

MERGE_SHA: ed89569df229a98dfa31833fd821de3794359fb0

Issue: UTV2-1978
Tier: T1
Branch: codex/utv2-1978-web-build-origin
result: pending_exact_head_ci_and_independent_pm_review

## ASSERTIONS:

- [x] The deploy build passes `https://${{ secrets.UNIT_TALK_WEB_DOMAIN }}` as `NEXT_PUBLIC_SITE_URL`; no hostname, placeholder, or credential is committed.
- [x] The shared builder exports the value before `next build`, so `/robots.txt` page-data collection sees the canonical origin.
- [x] A public-web build with no website origin fails before compilation; Smart Form and Command Center do not acquire the web-only requirement.
- [x] The public API origin remains mandatory for every Next.js image.
- [x] Existing Smart Form, Command Center, API-origin, canary, promotion, containment, and secret-boundary assertions pass in the focused suite.
- [x] A production-shaped public-web image generated all 15 static routes, including `/robots.txt`, without push or deployment.
- [ ] Exact-head CI `verify` and `Writable DB proof (staging only)` must pass in the sanctioned `staging-ci` GitHub environment.
- [ ] Independent PM T1 review must approve this exact head before merge.

## EVIDENCE:

Execution SHA: `bbc5dc4de5d50d55adc87b1ac862515ba02d8141`

Focused deployment wiring:

```text
pnpm exec tsx --test scripts/ci/nextjs-deploy-wiring.test.ts
tests 44
pass 44
fail 0
```

Static gate:

```text
pnpm verify:static
exit 0
lint, type-check, build, test, production-post-migration, Smart Form verify, and verify:commands passed
```

Production-shaped image build:

```text
docker build --file deploy/production/Dockerfile.nextjs \
  --build-arg APP_DIR=apps/web \
  --build-arg APP_PACKAGE=@unit-talk/web \
  --build-arg APP_PORT=4200 \
  --build-arg NEXT_PUBLIC_API_BASE_URL=https://api.unit-talk.com \
  --build-arg NEXT_PUBLIC_SITE_URL=https://unit-talk.com ...
Generating static pages (15/15)
/robots.txt (Static) prerendered as static content
exit 0
image ID sha256:73c59954c4e9e9186f77c7bb5650b4eb2b30de48789464b98db4df37539e8538
```

The same build with a `.test` website hostname reached page-data collection and was refused by
the unchanged site-config validation as a placeholder. This demonstrates that the repair supplies
the input without weakening canonical-origin validation.

R-level compliance:

```text
Verdict: PASS
Changed files: 8
Rules matched: (none) — no R-level artifacts required for this diff
```

Local T1 database containment:

```text
[assert-staging] host=127.0.0.1 ref=unidentified expected=xskgrzbteyqdufktjrjx
[assert-staging] REFUSED: target identity could not be resolved from its URL (host=127.0.0.1).
Writable DB verification requires xskgrzbteyqdufktjrjx. Run it through the staging-ci GitHub environment with CI_SUPABASE_* credentials.
```

Writable live-DB proof is blocked/deferred to exact-head CI. No local green `pnpm verify` claim is
made; `verify:static` passed and the writable phase refused the non-staging target as designed.

## Verification

- `pnpm exec tsx --test scripts/ci/nextjs-deploy-wiring.test.ts` — PASS, 44/44.
- `pnpm verify:static` — PASS.
- `pnpm test:db` — REFUSED by staging identity guard; delegated to exact-head `staging-ci`.
- Production-shaped `docker build` for `@unit-talk/web` — PASS; 15/15 static pages, including `/robots.txt`.
- `pnpm exec tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD` — PASS; no matching R-level rule.
- `git diff --check origin/main...HEAD` — PASS.

## STOP CONDITIONS ENCOUNTERED:

- Writable live-DB proof cannot run locally because the configured host resolves to loopback rather than sanctioned staging project `xskgrzbteyqdufktjrjx`; exact-head CI must supply this proof.
- No deployment, push of an image, production mutation, Discord mutation, pick change, delivery release, merge, or lane finalization was performed.

## Merge SHA Binding

Merge SHA: ed89569df229a98dfa31833fd821de3794359fb0
PR: https://github.com/griff843/Unit-Talk-v2/pull/1746
Execution SHA: bbc5dc4de5d50d55adc87b1ac862515ba02d8141

## Current-main resync — 2026-10-13

PM requested sanctioned update-branch and fresh exact-head proof in comment 6143393993.
The merge wrapper updated PR #1746 onto main `4ba6fb32ad15563e7243f3d787f6e3955f986543`,
producing execution SHA `bbc5dc4de5d50d55adc87b1ac862515ba02d8141`.

The only incoming file versus reviewed head `418e148797c33478feed031d9e7e8c37419affb5`
is `docs/06_status/readiness/readiness-score.json`. All three approved implementation
files are byte-identical to that reviewed head. No implementation was edited.

```text
git diff --exit-code 418e148797c33478feed031d9e7e8c37419affb5 HEAD --
  .github/workflows/deploy.yml deploy/production/Dockerfile.nextjs
  scripts/ci/nextjs-deploy-wiring.test.ts
exit 0
pnpm exec tsx --test scripts/ci/nextjs-deploy-wiring.test.ts
44 tests, 44 passed, 0 failed, 0 skipped
pnpm exec tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD
PASS; 9 changed files; no matching R-level artifact requirement
git diff --check origin/main...HEAD
exit 0
```

The static-gate and local-image evidence above was produced at original source
`5e8598700065af2f30eef5ca1f5e5fcc71692eef`; it is retained as historical evidence,
not represented as a rerun at the resynced SHA. Prior-head CI and executor comments
are stale for this new binding. Fresh final-head CI (including sanctioned staging DB
proof and verify) and a fresh executor result remain required. No merge, deployment,
production/Discord mutation, pick change, delivery release or PM approval occurred.
