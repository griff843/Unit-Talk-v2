# PROOF: UTV2-1798 — Smart Form sign-in is possible at picks.unit-talk.com

## Merge SHA Binding

MERGE_SHA: 890d08e3fc372100121c858692121979172d3197
Merge SHA: pending merge
Execution SHA: 890d08e3fc372100121c858692121979172d3197
PR: https://github.com/griff843/Unit-Talk-v2/pull/1475

`890d08e3fc372100121c858692121979172d3197` is the last non-proof commit on this
branch. Every receipt below was executed against that exact tree. It differs from
the implementation commit `2a414110` only in the lane manifest's `pr_url`,
`status` and `heartbeat_at` fields, written by the lane-binding automation after
the push; no source file differs, and the static receipts were re-executed here.

---

## Summary

The first production deployment (run `33469047650`, `d201fd93`) succeeded on
every mechanical measure — all jobs green, three trusted Let's Encrypt
certificates, parked containment verified twice — and still nobody could sign in.
`apps/smart-form` runs Auth.js v5 (`next-auth@5.0.0-beta.31`), which refuses any
request whose `Host` it has not been told to trust. Behind Caddy, that is every
request. All four `/api/auth/*` routes answered `500` while `/login` rendered
normally, so the failure was invisible to the health check and to TLS.

This lane declares the trust in the layer that owns the reverse-proxy topology:
one line, `AUTH_TRUST_HOST=true`, in the `.env.smart-form` writer of both the
`canary` and `promote` jobs. No application file is touched.

---

## The failure, measured in production

Live at `https://picks.unit-talk.com` at the time of writing:

```text
/api/auth/providers      500  ssl_verify=0
/api/auth/csrf           500  ssl_verify=0
/api/auth/session        500  ssl_verify=0
/login                   200  ssl_verify=0
```

The container's own log names the cause:

```text
[auth][error] UntrustedHost: Host must be trusted. URL was:
  https://picks.unit-talk.com/api/auth/session.
  Read more at https://errors.authjs.dev#untrustedhost
```

And the deployed `.env.smart-form` on the host has no host-trust key at all
(key names only; no values were read or printed):

```text
NODE_ENV PORT NEXTAUTH_URL NEXTAUTH_SECRET GOOGLE_CLIENT_ID
GOOGLE_CLIENT_SECRET ALLOWED_CAPPER_EMAILS UNIT_TALK_API_URL
NEXT_PUBLIC_API_BASE_URL
```

`NEXTAUTH_URL` is present and correct. It is a v4 name and does not confer trust
in v5 — which is precisely why the deployment looked complete and was not.

---

## Runtime Verification

### The correction was proven by execution, not by reading

The production build of `apps/smart-form` was started twice from the same
artifact, differing only in `AUTH_TRUST_HOST`, and requested through a forwarded
host exactly as Caddy forwards one:

```text
$ curl -H 'X-Forwarded-Host: picks.example-unittalk.test' \
       -H 'X-Forwarded-Proto: https' \
       http://127.0.0.1:4411/api/auth/providers

# WITHOUT AUTH_TRUST_HOST  (the deployed production state)
500   UntrustedHost log lines: 1
      {"message":"There was a problem with the server configuration. ..."}
      UntrustedHost: Host must be trusted. URL was:
        https://picks.example-unittalk.test/api/auth/providers

# WITH AUTH_TRUST_HOST=true  (this lane)
200   UntrustedHost log lines: 0
      {"google":{"id":"google","name":"Google","type":"oidc",
        "signinUrl":"https://picks.example-unittalk.test/api/auth/signin/google",
        "callbackUrl":"https://picks.example-unittalk.test/api/auth/callback/google"}}
```

This is an inversion control with both directions executed: the failure
reproduces without the variable and disappears with it, on the same build, with
the same secret, the same client id and the same allow-list. The 200 response
also shows the Google callback URI derived from the forwarded origin, which is
the value the OAuth client must match.

Production build receipt for that artifact:

```text
$ NODE_ENV=production NEXTAUTH_SECRET=<local control placeholder> \
  NEXT_PUBLIC_API_BASE_URL=https://api.example-unittalk.test \
  pnpm --filter "@unit-talk/smart-form..." build          -> exit 0
  ✓ Compiled successfully   ✓ Generating static pages (7/7)
```

No credential in that run is a production value; `picks.example-unittalk.test`
is a reserved test hostname and nothing left this machine.

### Why the deployment layer and not the application

`apps/smart-form/auth.ts` is unmodified and carries no `trustHost`. Trusting a
forwarded `Host` is a claim about a topology, not about an application: the
deployment provisions the hostname and puts Caddy in front of it, so the
deployment is the layer entitled to make the claim. `trustHost: true` in source
would make every other runtime — a developer's laptop included — trust whatever
`Host` a caller sends. This is also why the value is not a GitHub secret: it is a
constant derived from a known trusted topology, not owner-supplied material.

---

## Static Verification

```text
$ pnpm lint                                            -> exit 0
$ pnpm type-check                                      -> exit 0
$ pnpm verify:static                                   -> exit 0
$ pnpm verify:commands                                 -> exit 0
$ pnpm exec tsx --test scripts/ci/nextjs-deploy-wiring.test.ts
  # tests 13  # pass 13  # fail 0  # skipped 0
$ pnpm exec tsx scripts/ci/r-level-check.ts               -> exit 0
  Verdict: PASS
  Changed files: 8
  Rules matched: (none) — no R-level artifacts required for this diff
```

`scripts/ci/r-level-check.ts` matches no rule for this diff, and that is the
honest result rather than an absent check: the R-level rules in
`docs/05_operations/r1-r5-rules.json` key on schema, migration, delivery and
domain paths, none of which this lane touches. The lane changes one deployment
environment line, its test and its documentation.

`pnpm verify` exits 1 locally at `test:live-db` and only there, by design:

```text
[assert-staging] host=127.0.0.1 ref=unidentified expected=xskgrzbteyqdufktjrjx
[assert-staging] REFUSED: target identity could not be resolved from its URL.
```

The writable receipt is produced inside CI by the `staging-ci` environment and
verified within the required `verify` job, which is the only place it is
obtainable. No production database was contacted by this lane.

`scripts/ci/nextjs-deploy-wiring.test.ts` is reachable from required `verify`
through `pnpm test -> pnpm test:ops -> tsx --test`, unchanged from UTV2-1795.

### The assertions read the real workflow, not a marker

Tests 12 and 13 do not grep for a token. `envFileWrites()` parses the actual
`printf '%s\n' … | ssh … cat > '$DEPLOY_PATH/.env.<name>'` pipelines out of
`deploy.yml` with the YAML loader, reconstructs each env file as the list of
`KEY=VALUE` entries the deploy would really write, and asserts over that model.
A marker in a comment cannot satisfy it; only the writer itself can.

### Mutation evidence

Every assertion was shown to fail on the defect it names. `deploy.yml` was
restored and its SHA-256 re-confirmed between each mutation.

| # | Mutation | Result |
| --- | --- | --- |
| 1 | drop `AUTH_TRUST_HOST` from the **canary** path only | `not ok 12` |
| 2 | leak `AUTH_TRUST_HOST` into `.env.web` | `not ok 12` |
| 3 | hard-code `NEXT_PUBLIC_API_BASE_URL=https://api.unit-talk.com` | `not ok 12` |
| 4 | parked mode forces `_enabled_targets="best-bets"` | `not ok 13` |
| 5 | add `AUTH_TRUST_HOST` to `.env.production` | `not ok 13` |
| 6 | leak `NEXTAUTH_SECRET` into `.env.web` | `not ok 4` and `not ok 12` |
| 7 | parked mode sets `_ingestor_autorun=true` | `not ok 13` |

7 mutations, 7 caught. Mutation 1 is the load-bearing one: a correction applied
to one deployment path and not the other is exactly the defect this shape of
change invites, and the test refuses it. Mutation 6 is caught twice, by the
pre-existing secret-isolation assertion and by the new one, which is the correct
result — the new test must not weaken the old contract.

```text
=== BASELINE RESTORED
b6513e6d40c2e679e6a4fe53644d4d7cd62f7e4a9fcd2019dbe01f7ea8b1cbdf  .github/workflows/deploy.yml
# tests 13  # pass 13  # fail 0
```

---

## Verification

ASSERTIONS:

- [x] `.env.smart-form` receives `AUTH_TRUST_HOST=true` — asserted against the
      parsed env-file writer, and proven sufficient by the executed 500→200
      inversion.
- [x] Applied to **both** the `canary` and the `promote` path; test 12 loops both
      job ids and mutation 1 confirms a one-sided fix fails.
- [x] Restricted to the Smart Form: no `AUTH_TRUST_HOST` key appears in
      `.env.web`, `.env.edge` or `.env.production`; mutations 2 and 5 confirm.
- [x] `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `NEXTAUTH_SECRET` and
      `ALLOWED_CAPPER_EMAILS` remain in `.env.smart-form` only, absent from every
      other file the same step writes; mutation 6 confirms.
- [x] The QA authentication bypass remains absent — no `SMART_FORM_QA_AUTH_BYPASS`
      or `NEXT_PUBLIC_SMART_FORM_QA_AUTH_BYPASS` key in any written env file.
- [x] `NEXT_PUBLIC_API_BASE_URL` remains `https://$CADDY_DOMAIN` by deployment
      derivation in both `.env.smart-form` and `.env.web`; mutation 3 confirms a
      hard-coded hostname is refused.
- [x] `NEXTAUTH_URL=https://$SMART_FORM_DOMAIN` is unchanged; no `AUTH_URL` and no
      other Auth.js environment name was introduced.
- [x] Parked containment is unchanged: the five parked values are still written
      from the mode branch, the parked branch still forces
      `SYNDICATE_MACHINE_ENABLED=false`, both autorun flags false, scheduling
      false, and `_enabled_targets="none"` regardless of the
      `UNIT_TALK_ENABLED_TARGETS` secret. Mutations 4 and 7 confirm.
- [x] No new GitHub secret. `AUTH_TRUST_HOST` is a deployment constant.
- [x] Zero files under `apps/` modified. `apps/smart-form/auth.ts` is byte-identical
      to `main`.
- [x] No deployment was triggered by this lane and no pick was submitted.

EVIDENCE:

```text
$ pnpm exec tsx --test scripts/ci/nextjs-deploy-wiring.test.ts
ok 1 - both Next.js apps are built and pushed by the deploy workflow
ok 2 - deployment fails closed when required Next.js configuration is absent
ok 3 - the QA authentication bypass never reaches production
ok 4 - server-only credentials reach only the container that needs them
ok 5 - Caddy routes every approved hostname from configuration, not from source
ok 6 - each Next.js surface is independently deployable and rollable
ok 7 - the shared image builds either app without an app-owned config change
ok 8 - the build-time auth placeholder can never become the runtime secret
ok 9 - the intake container refuses to start on a configuration that admits nobody
ok 10 - the public API origin is compiled into the browser bundle, not supplied at runtime
ok 11 - the API verifies exactly the capper token Smart Form signs
ok 12 - Auth.js trusts the proxied host only where the deployment provisions it
ok 13 - the host-trust correction leaves parked containment untouched
1..13
# tests 13
# pass 13
# fail 0
# skipped 0
```

---

## Residual risks and deferred work

1. **The fix is not in production until a governed deployment runs it.** The
   deployed `.env.smart-form` still lacks the key; nothing changes on the host
   until the next `Deploy` dispatch writes it. That dispatch is not performed by
   this lane and is not requested here — it follows PM merge approval at the exact
   head.

2. **Google sign-in end-to-end is not yet proven against the real client.** The
   inversion control proves Auth.js accepts the proxied host and derives the
   correct callback URI; it does not prove the owner's Google OAuth client has
   `https://picks.unit-talk.com/api/auth/callback/google` registered. That is the
   first thing the post-deployment check will establish, and it is the most likely
   remaining blocker.

3. **`www.unit-talk.com` has no certificate.** The Caddyfile declares exactly
   three site blocks and `www` is not one of them. Unrelated to this correction;
   recorded as a follow-up observation, not fixed here.

4. **`api.unit-talk.com/health` responds in roughly 14 s.** Measured during the
   deployment verification. Unrelated to this correction; recorded as a follow-up
   observation.

5. **Production containment is unchanged.** No paid ingestion, no member delivery,
   no system picks, no production database write, no pick submitted.
