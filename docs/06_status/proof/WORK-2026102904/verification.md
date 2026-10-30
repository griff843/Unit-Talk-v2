# PROOF: WORK-2026102904

MERGE_SHA: pending merge

Issue: WORK-2026102904
Tier: T2
Lane type: hygiene
Execution SHA: `2f15363f273eefcdae6d67b3ca3108fd49f4d5c5`
result: local_static_pass

## ASSERTIONS:

- [x] Cause reproduced against production through the real bridge. A keep-alive client that POSTs `/api/session` (no credentials) after a 7 s or 70 s idle got no response within 30 s. After 0 s and 3 s it got 401 in about 110 ms. The host's `nc 127.0.0.1 4300` stays alive after Command Center closes the idle connection, and over ssh it exited only when the client gave up (20 s), while the new relay exited about 5 s after the server's close.
- [x] Fixed: with the new relay, the same POSTs after 7 s and 70 s returned 401 in 1585 ms and 1895 ms on a fresh socket. `command-center-bridge.ts --check` reports `command-center reports ok`.
- [x] Successful login, refused credentials and an absent credential pass through unchanged (200 / 401 / 401). The bridge injects no credential and binds loopback only.
- [x] An interrupted connection (the server drops it mid-request) fails promptly instead of hanging.
- [x] The remote command is built only from a literal and a port re-validated as an integer. No host, sshd, port, container or firewall change.

## EVIDENCE:

Bridge suite on the execution SHA:

```text
pnpm exec tsx --test scripts/ops/command-center-bridge.test.ts
tests 24
pass 24
fail 0
```

Ops aggregate:

```text
pnpm test:ops
tests 3709
pass 3699
fail 0
skipped 10
```

Mutation checks. Each change was applied to `command-center-bridge.ts`, the bridge suite was run, and the file was restored:

```text
M1 remote command restored to nc 127.0.0.1 <port>   -> fail 3 (exact command, relay-exit, dropped-connection tests)
M2 explicit <&0 removed from the writer             -> fail 4 (exact command, idle sign-in, credentials, dropped-connection tests)
M3 shell waits on the writer instead of the reader  -> fail 3 (exact command, relay-exit, dropped-connection tests)
```

Production repro through the bridge (`GET /api/health`, then `POST /api/session` with no credentials on the same pooled socket):

```text
idle    before (nc)              after (relay)
0 s     401 in 112 ms            401 in 120 ms
3 s     401 in 114 ms            401 in 115 ms
7 s     STALLED 30 s             401 in 1585 ms (fresh socket)
70 s    STALLED 30 s             401 in 1895 ms (fresh socket)
```

## Verification

- [x] `pnpm exec tsx --test scripts/ops/command-center-bridge.test.ts`: 24 pass, 0 fail.
- [x] `pnpm test:ops`: 3699 pass, 0 fail, 10 skipped. This runs the ops suite under `pnpm test`.
- [x] `pnpm exec eslint` on both changed files: exit 0. The repo-wide `pnpm lint` and `pnpm type-check` run in CI (`pnpm verify`).
- [x] Mutation checks: 3 of 3 caught.
- [x] `pnpm exec tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD`: Verdict PASS, no R-level artifacts required for this diff.
- [ ] `pnpm verify` in CI on the PR head: pending.

## Merge SHA Binding

Merge SHA: pending merge
PR: https://github.com/griff843/Unit-Talk-v2/pull/1803
