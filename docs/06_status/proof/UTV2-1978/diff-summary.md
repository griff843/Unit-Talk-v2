# Diff summary: UTV2-1978

| File | Change |
|---|---|
| `.github/workflows/deploy.yml` | Requires `UNIT_TALK_WEB_DOMAIN` only for the public-web matrix entry and passes its HTTPS origin as `NEXT_PUBLIC_SITE_URL` to the shared image build. The existing API-origin guard remains required for every Next.js image. |
| `deploy/production/Dockerfile.nextjs` | Declares and exports `NEXT_PUBLIC_SITE_URL` before `next build`, then refuses an empty value when the selected package is `@unit-talk/web`. Smart Form and Command Center remain independent of the web-only input. |
| `scripts/ci/nextjs-deploy-wiring.test.ts` | Proves build-arg wiring, no placeholder origin, builder ordering, web missing/present behavior, non-web missing-site success, and preserved non-web API-origin refusal. Existing deployment safeguards remain in the same 44-test suite. |

Issue-owned lane, sync, and proof metadata accompany these three substantive paths. No package,
dependency, lockfile, app runtime, route, migration, Discord, canary, promotion, submission, or
delivery-release behavior changed.

## SHA Binding

Merge SHA: pending merge
PR: pending
Execution SHA: 5e8598700065af2f30eef5ca1f5e5fcc71692eef
