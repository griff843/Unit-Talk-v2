# UTV2-1798 — Diff Summary

**Issue:** UTV2-1798 — Smart Form Auth.js host trust (`UntrustedHost` correction)
**Parent:** UTV2-1787
**Branch:** `claude/utv2-1798-smart-form-auth-trust-host`
**PR:** https://github.com/griff843/Unit-Talk-v2/pull/1475
**Tier:** T1
**Lane type:** governance
**Implementation SHA:** `890d08e3fc372100121c858692121979172d3197`
MERGE_SHA: f69d86f94bf18badccd4639d9db168f2d28c42a5

**Merge SHA:** pending merge (anchor `f69d86f94bf18badccd4639d9db168f2d28c42a5`)

## What changed in the product

Authentication at `https://picks.unit-talk.com` was impossible after the first
production deployment. Auth.js v5 refuses a request whose `Host` it has not been
told to trust, so all four `/api/auth/*` routes answered `500 UntrustedHost`
while the page itself rendered over a trusted certificate. This lane declares
that trust at the deployment layer — the only layer that knows the reverse-proxy
topology — so sign-in becomes possible on the next deployment.

## Files Changed

| File | Change |
| --- | --- |
| `.github/workflows/deploy.yml` | adds `AUTH_TRUST_HOST=true` to the `.env.smart-form` writer in **both** `canary` and `promote`, immediately after `NEXTAUTH_URL`, with the reasoning recorded inline. No other line of the workflow changes. |
| `scripts/ci/nextjs-deploy-wiring.test.ts` | adds tests 12 and 13. Test 12 parses the real `printf`/`ssh` env-file writers out of `deploy.yml` and asserts host trust reaches `.env.smart-form` in both jobs and reaches no other env file, while `NEXTAUTH_URL`, the three server-only secrets, the absent QA bypass and the derived API origin are unchanged. Test 13 asserts the parked-mode contract is byte-for-byte untouched. |
| `deploy/production/ENV_FILES.md` | documents `AUTH_TRUST_HOST` in the `.env.smart-form` shape and records why it is neither a GitHub secret nor `trustHost: true` in the application. |
| `docs/06_status/lanes/UTV2-1798.json` | lane manifest. |
| `.ops/sync/UTV2-1798.yml` | lane sync metadata. |

```text
 .github/workflows/deploy.yml            |  16 ++++
 .ops/sync/UTV2-1798.yml                 | 158 ++++++++++++++++++++++++++++++++
 deploy/production/ENV_FILES.md          |  21 +++++
 docs/06_status/lanes/UTV2-1798.json     |  41 +++++++++
 scripts/ci/nextjs-deploy-wiring.test.ts | 140 ++++++++++++++++++++++++++++
 5 files changed, 376 insertions(+)
```

## Explicitly not changed

`apps/smart-form/auth.ts`, Google OAuth provider logic, the allow-list, API
authentication, Caddy routing, Supabase or schema, provider ingestion, member
delivery, Command Center. Zero files under `apps/` are modified; the diff touches
no application source at all.

## Manifest Files Changed

- `docs/06_status/lanes/UTV2-1798.json`
