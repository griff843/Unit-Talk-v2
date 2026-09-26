# WORK-2026092407 — Command Center has a governed, repeatable operator access path

Tier: T2 (mechanical floor T3: no Tier C path in scope; declared T2 because this is the access path to a production surface, and it is never lowered) · Lane type: hygiene · Executor: claude

Repo-owned work order (tracker independence, ratified 2026-09-05). No Linear issue by design.

## Objective

Give the operator a repo-owned, repeatable way to reach the internal-only production Command Center
that injects no credential, binds loopback only, and does not depend on TCP forwarding.

## Problem

PM decision 7 (2026-09-24): keep Command Center internal-only, no public DNS or hostname, no
exposure of port 4300, and retire the hand-created `cc-proxy` only once a governed, repeatable
path replaces it.

Measured on the production host, 2026-09-24:
- The `command-center` compose service publishes `127.0.0.1:4300` only, as
  `deploy/production/docker-compose.yml` designs. Its comment names `ssh -L` as the access path.
- `sshd` runs `AllowTcpForwarding no`, so `ssh -L` does not work. That is a production security
  control and is not to be relaxed.
- `cc-proxy` is a hand-started container, not in compose, listening on `127.0.0.1:4301`. It inserts
  the operator bearer token into **every** request. So any process on the host loopback gets
  authenticated Command Center access without credentials. Its healthcheck was inherited from the
  api image (`wget localhost:4000/health`), so it reports `unhealthy` permanently.
- The deployed Command Center (`6685f171c`, which includes #1624) already serves its own sign-in
  page: `GET /picks` with `Accept: text/html` returns 401 with a password form posting to
  `/api/session`. Token injection is therefore unnecessary.

## Acceptance criteria

1. `scripts/ops/command-center-bridge.ts` (`pnpm ops:cc-bridge`) is a repo-owned local bridge.
   - It binds a loopback-only listener on the operator's machine.
   - It carries each connection over an SSH **shell exec** (`nc 127.0.0.1 4300`), not TCP
     forwarding, to the Command Center's own loopback port.
   - It injects no credential; the operator signs in through the Command Center's page.
   - It refuses a non-loopback bind and a malformed host or port.
   - `--check` performs one unauthenticated `GET /api/health` through the bridge and exits non-zero
     unless the answer is `200 {"ok":true,"service":"command-center"}`.
2. `scripts/ops/command-center-bridge.test.ts`, wired into `test:ops`, covers:
   - argument validation;
   - loopback-only refusal;
   - byte-for-byte piping in both directions;
   - child teardown when either side closes;
   - the `--check` verdict on healthy, unhealthy and unreachable responses.
3. `docs/05_operations/COMMAND_CENTER_OPERATOR_ACCESS.md` is the runbook. It covers the access
   path, how to verify it, why `ssh -L` is not used, and the retirement procedure for `cc-proxy`.
   Retirement happens only after the bridge is proven against production.
4. The compose comment's `ssh -L` instruction is left untouched (editing the production compose
   file is out of this lane's risk class); the runbook records that it does not work and why.

## Guardrails

- No change to sshd, the firewall, Caddy, DNS, or any published port.
- No credential is injected, stored or logged by the bridge.
- Any production measurement is a single unauthenticated, read-only `GET /api/health`.

## Non-goals

- No deploy.
- No change to Command Center auth.
- The `cc-proxy` container is not removed by this PR. Removal is a host action taken after merge,
  once the bridge is proven.
- `/health` latency and the zombie-scan row cap belong to WORK-2026092404 (#1647).

## Required evidence

- `tsx --test scripts/ops/command-center-bridge.test.ts` green, with the truncation and `--`
  fixes mutation-tested.
- `pnpm test` green on the lane branch.
- The `--check` production result, recorded verbatim with its timestamp, or explicitly marked as
  not re-measured.

## File scope

- `scripts/ops/command-center-bridge.ts`
- `scripts/ops/command-center-bridge.test.ts`
- `docs/05_operations/COMMAND_CENTER_OPERATOR_ACCESS.md`
- `package.json`
