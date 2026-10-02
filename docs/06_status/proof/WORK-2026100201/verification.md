# PROOF: WORK-2026100201

MERGE_SHA: pending merge

Issue: WORK-2026100201
Tier: T2
result: blocked
Implementation SHA: 8ee3aa8d43f82bfe459e54e2713c45612add9344

## ASSERTIONS:

- [x] All 26 imported files are byte-identical to the prepared production package.
- [x] Both components reuse exact monogram/wordmark paths and wordmark transforms.
- [x] Nine React SSR + Playwright checks passed at 375, 768, and 1440 px for Smart Form, expanded sidebar, and collapsed sidebar.
- [x] Both application builds and application type-checks passed.
- [x] Focused operator-surface tests passed: 16 tests, zero failures.
- [x] R-level compliance passed; operator-ui matched.
- [ ] Full pnpm verify passed: blocked by the existing staging DB target guard.

## EVIDENCE:

Branding-only browser evidence is in evidence.json. The isolated harness renders
the actual components with built app CSS; it stubs OperatorLink and exercises no
service or navigation workflows. Screenshot filenames refer to local
apps/qa-agent/artifacts/WORK-2026100201-branding/.

## Verification

- pnpm build: PASS (workspace package outputs generated).
- pnpm --filter @unit-talk/smart-form build: PASS with an ephemeral build-only AUTH_SECRET.
- pnpm --filter @unit-talk/command-center build: PASS, including final flex sizing.
- pnpm --filter @unit-talk/smart-form type-check: PASS.
- pnpm --filter @unit-talk/command-center type-check: PASS.
- pnpm exec tsx --test apps/operator-web/src/server.test.ts apps/command-center/src/lib/server-api.test.ts: PASS (16/16).
- pnpm verify: static sequence PASS; full command exit 1 at test:live-db -> test:db -> ci:assert-staging.
- Smart Form flow E2E: not run by the default gate because UNIT_TALK_SMART_FORM_E2E is unset.
- pnpm exec tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD: PASS; operator-ui matched.
- git diff --check: PASS.

Next-generated next-env.d.ts changes were restored after builds; no generated
application declarations are included in the branding change.

## Blocking Output

```text
[assert-staging] host=127.0.0.1 ref=unidentified expected=xskgrzbteyqdufktjrjx
[assert-staging] REFUSED: target identity could not be resolved from its URL (host=127.0.0.1).
Writable DB verification requires xskgrzbteyqdufktjrjx.
Run it through the staging-ci GitHub environment with CI_SUPABASE_* credentials.
```

No DB guard was bypassed. This lane remains blocked for full verification.

## Merge SHA Binding

Merge SHA: pending merge
PR: pending
