# PROOF: UTV2-1560

MERGE_SHA: 4fdd98ef2806580b038e7336b345ad31ab4dfec1

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

## Known limitation: cannot be live-tested from this branch

GitHub Actions does not allow `workflow_dispatch` on a brand-new workflow
file until it exists on the default branch -- there is no way to dispatch
it against `origin/main` before merge. The plan is to dispatch it
immediately once this PR merges and report the real findings (DNS results,
IPv4/IPv6 status codes, TLS handshake result, DB/pooler TCP result, Docker
network state, route/MTU, firewall state, and the live-confirmed worker
target) as an immediate follow-up comment on this issue.

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

## Owner boundary

T1 -- adds a new privileged-adjacent SSH-capable GitHub Actions workflow
(uses the same `UNIT_TALK_DEPLOY_*` / `UNIT_TALK_DEPLOY_SSH_KEY` secrets as
the existing `ops-*-diagnose.yml` jobs). Requires the `t1-approved` label
and a valid Griff `pm-verdict/v1` APPROVED comment bound to the reviewed
head. This proof supplies neither.
