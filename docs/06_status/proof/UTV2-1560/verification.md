# PROOF: UTV2-1560 (PR #1258)

MERGE_SHA: set-by-ci (PR #1258 has not merged yet -- this proof describes
its own pre-merge state; see "Prior merged history" below for the
already-shipped, separate PR #1256 fact)

This PR (#1258), on the same branch/lane, adds two diagnostic gap fixes and
a new manual-dispatch-only worker-recovery workflow -- see "Continuation:
diagnostic gaps closed + narrow recovery workflow" below. It is **not
merged**; do not read anything below as terminal/closed truth for #1258
itself.

## Prior merged history (PR #1256 -- separate, already-shipped fact)

PR #1256 (read-only diagnostic only) merged to main as `e2e3fa14` before
this PR existed. This is frozen, already-shipped history, kept here for
audit continuity, and is not part of #1258's own pre-merge verification.

## Verification

## Summary

The production worker's outbox claim path is confirmed failing with a
literal Cloudflare `502 Bad Gateway` when connecting from the Hetzner host
to `zfzdnfwdarxucxtaojxm.supabase.co` (discovered live during UTV2-1477).
Supabase itself is reachable and responsive from an independent client, so
this is not classified as a total Supabase outage; the read-only
investigation required by this issue narrows the cause among: host
network, Docker network, Supabase endpoint/pooler, Cloudflare edge, or
application configuration.

This PR adds `.github/workflows/ops-network-diagnose.yml`, a
`workflow_dispatch`-only, read-only diagnostic job covering every check the
issue requires: DNS resolution (A/AAAA) from both the host and the worker
container, IPv4-vs-IPv6 HTTPS reachability to the Supabase REST endpoint, a
TLS handshake capture, a DB/pooler TCP reachability test (connect-only, no
credentials), Docker network/DNS state, host route/MTU, host firewall
state (best-effort), and the worker's actual live-configured delivery
target (read from its own startup log, not assumed to be
`discord:canary`/`discord:best-bets`).

**It does not implement the safe worker-only restart mechanism** -- per the
issue's own explicit ordering ("Read-only first... Build/use a worker-only
restart path only after diagnosis"), that is scoped to a follow-up once
this diagnostic's findings identify the actual root cause.

## Post-merge findings (ops-network-diagnose.yml dispatched against main)

Host DNS, container DNS, IPv4 REST `GET /rest/v1/` (HTTP/2 401, `server:
cloudflare`, cf-ray present), TLS handshake, Docker network state, and
route/MTU/firewall all came back healthy. IPv6 REST is unavailable only
because the domain has no AAAA record at all (not a routing fault -- the
host has working IPv6 elsewhere). The worker's log tail contains a real
Cloudflare 502 HTML error page on a `claim_next_outbox` call, and a
separate `canceling statement due to statement timeout` error on the same
RPC path. **Bounded conclusion:** an intermittent Cloudflare-edge/PostgREST
RPC-path failure, not a Hetzner-side DNS/TLS/routing/firewall/Docker fault
-- every host-level network primitive checked out healthy at diagnostic
time. Two gaps in the original diagnostic (container curl absent; DB/pooler
env var not discovered) are fixed in this continuation.

## Continuation: diagnostic gaps closed + narrow recovery workflow

1. **DB/pooler variable-name discovery** -- step 0 now pattern-matches env
   *key names* (`*DB*URL*`, `*POOL*`, `*CONNECTION*`) instead of a fixed
   `DATABASE_URL|SUPABASE_DB_URL|POOLER_URL` list, so it finds the real
   variable regardless of its exact name. Values are still never printed --
   only the discovered key name and the parsed host:port.
2. **In-container HTTPS probe when curl is absent** -- step 4 now checks
   `command -v curl` first and falls back to a Node `https.request` GET
   against the same `/rest/v1/` route with no `Authorization`/`apikey`
   header, so it never invokes the real `claim_next_outbox` RPC with
   production credentials -- same unauthenticated-GET shape as the curl
   probe it replaces.
3. **`ops-worker-recovery.yml`** (new file) -- a narrow, manual-dispatch-only
   recovery workflow, touching `unit-talk-worker-1` only. It aborts with no
   action unless `docker logs --since 15m` contains a line matching
   `claim_next_outbox failed:.*(502[^0-9]|bad gateway)` -- a bounded
   15-minute window, and a real 502/Bad-Gateway signature co-located with
   the claim failure, not any `claim_next_outbox failed` line (a
   statement-timeout error, for example, does not qualify) and not stale
   historical log text. If the condition holds, it performs exactly one
   `docker restart` (no image pull, no `compose up`, no env/target change,
   no queue/DB mutation) and then verifies, before reporting success: the
   restart's own exit code was zero, the container reached `running`
   status **and** -- since the production worker has a configured Docker
   healthcheck -- `Health` is `healthy` (or `none` for a container with no
   healthcheck configured); `Health=unhealthy` or `Health` still `starting`
   after a 60-second bounded wait both fail closed, since `Status=running`
   alone is never treated as a successful outcome. The image is
   byte-identical pre/post (proving a restart, not a recreation), the
   configured worker target is compared via the canonically-parsed JSON
   `targets` field (not the raw log line, so unrelated log metadata cannot
   cause a false failure), and `RestartCount` advanced by exactly 1
   (proving exactly one restart transition, not zero or a crash loop). Any
   single failed check marks the
   whole run FAILED and the workflow step exits non-zero -- there is no
   `set +e` masking an unsuccessful or unverifiable recovery as green. This
   lane does **not** dispatch it -- it is returned here for PM review first.

## ASSERTIONS:

- [x] `ops-network-diagnose.yml` is `workflow_dispatch`-only -- no automatic/scheduled trigger, no trigger on push/PR events
- [x] Every SSH command executed is read-only: `getent`, `dig`, `curl`, `openssl s_client`, `docker network ls/inspect`, `docker logs`, `ip route`/`ip link`, `sudo iptables -L`/`ufw status` (best-effort)
- [x] No `docker restart`/`stop`/`rm`/write-exec, no `sed`/`tee`/`>` against `.env.production` or any config file, no queue/DB write commands anywhere in the workflow
- [x] Secret values (`SUPABASE_SERVICE_ROLE_KEY`, DB passwords) are never echoed -- only hostnames/ports are parsed out of `SUPABASE_URL`/`DATABASE_URL`-style values, and the DB/pooler test is a bare TCP connect with no credentials sent
- [x] `UNIT_TALK_DISCORD_TARGET_MAP` is never read or written by this workflow
- [x] `.github/workflows/merge-gate.yml` and `executor-result-validator.yml` are not touched
- [x] pnpm verify PASS (see EVIDENCE below)
- [x] r-level-check PASS (see EVIDENCE below)
- [x] pnpm test:db PASS (see EVIDENCE below)

## EVIDENCE:

```text
$ pnpm verify
(exit 0 -- full static gate + live DB smoke + live T1 proof suite)
```

```text
$ pnpm exec tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD
Verdict: PASS
Rules matched: (none) — no R-level artifacts required for this diff
```

```text
$ pnpm test:db
TAP version 13
1..7
# tests 7
# pass 7
# fail 0
# cancelled 0
# skipped 0
```

## Owner boundary (PR #1258's own, current state)

T1 -- adds a new privileged-adjacent SSH-capable GitHub Actions workflow
(uses the same `UNIT_TALK_DEPLOY_*` / `UNIT_TALK_DEPLOY_SSH_KEY` secrets as
the existing `ops-*-diagnose.yml` jobs). Requires the `t1-approved` label
and a valid Griff `pm-verdict/v1` APPROVED comment bound to **this PR's own
exact head**. This proof supplies neither -- absent and pending, not
carried forward from #1256.

## Prior merged history's owner boundary (PR #1256 -- separate, already-shipped fact)

A fresh Griff-authored `PM_VERDICT: APPROVED` was posted 2026-07-19T07:57:24Z
on PR #1256, bound to the exact merged head
`6f142c9483823c969b52e446b8f4824cdaad6553`, explicitly scoping approval to
the read-only diagnostic and its lane/proof metadata only -- not
authorizing restart/deploy/env mutation/target remap/queue replay/DB
write. The `t1-approved` label was applied after that verdict. This is
historical record only; it does not authorize any part of #1258.
