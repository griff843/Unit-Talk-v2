# PROOF: WORK-2026092407

MERGE_SHA: 4180e5fefdf17cbef3a345b5d13bca38632803e2

> Pre-merge, the merge row is intentionally a placeholder. The Execution SHA row carries the last commit on this lane that changes
> anything outside `docs/06_status/proof/WORK-2026092407/` and the lane manifest.
> `post-merge-lane-close.yml` rebinds merge authority only after GitHub supplies the merged-PR
> attestation.

Generated at: 2026-09-26T00:15:00.000Z
Issue: WORK-2026092407
Tier: T2
Lane type: hygiene
Branch: claude/work-2026092407-cc-operator-bridge
PR URL: https://github.com/griff843/Unit-Talk-v2/pull/1652
Head SHA: 98bda0923b6dab73cdaefdcf2c217f48c922c5be
result: pass

## ASSERTIONS:

- [x] `pnpm ops:cc-bridge` listens on the operator's loopback only. `--bind` accepts
      `127.0.0.1`, `::1` and `localhost` and refuses every other address, including `0.0.0.0`,
      `::` and the empty string.
- [x] Each accepted connection gets its own `ssh` child running `nc 127.0.0.1 <port>` on the
      host: a shell exec, not a forward. The argument list carries `-T`, `-e none`,
      `BatchMode=yes` and `ClearAllForwardings=yes`, and no `-L`, `-R`, `-D` or `-W`. The host's
      `AllowTcpForwarding no` is not relaxed and does not need to be.
- [x] No credential is injected, stored or logged. The operator signs in on the Command Center's
      own page.
- [x] Injection: `ssh` is spawned from an argument list, never a local shell. `--` precedes the
      host, so neither the host nor the command can be read as an ssh option. The host must match
      `[A-Za-z0-9][A-Za-z0-9._@-]*` (at most 253 characters). The remote port must be an integer
      from 1 to 65535. `buildSshArgs` re-validates both itself, so the only text the remote shell
      sees is `nc 127.0.0.1 ` plus that integer.
- [x] Teardown: when the client closes, the child is killed. When the child finishes, the client
      socket is ended rather than destroyed, so the tail of a response is not cut off, and it is
      destroyed only as a 5 s backstop. A spawn error closes the client instead of hanging it.
- [x] `--check` sends one unauthenticated `GET /api/health` through the bridge. It exits 0 only
      for `200 {"ok":true,"service":"command-center"}`, and exits 1 on any other status or body,
      on no answer, on a timeout, and when ssh cannot run.
- [x] The runbook `docs/05_operations/COMMAND_CENTER_OPERATOR_ACCESS.md` covers the path, how to
      verify it, why `ssh -L` is not used, and how to retire `cc-proxy` only after the bridge is
      proven. It states that the bridge is network reach, not a product workflow (product contract
      §2.3 and §22).
- [x] Scope: the four locked files plus lane metadata. No change to sshd, the firewall, Caddy,
      DNS, compose or any published port. No deploy, no change to Command Center auth, and no
      production write.

## EVIDENCE:

Measured at `98bda0923b6dab73cdaefdcf2c217f48c922c5be` in the lane worktree, based on
`origin/main` `5b193aedb3536e5705d6b708d8fe5bc9c6bd43fb`.

```
$ pnpm exec tsx --test scripts/ops/command-center-bridge.test.ts
# tests 20
# pass 20
# fail 0

$ pnpm exec eslint --max-warnings 0 scripts/ops/command-center-bridge.ts scripts/ops/command-center-bridge.test.ts
rc=0

$ pnpm type-check
rc=0

$ pnpm test
# tests 6899
# pass 6899
# fail 0
rc=0

$ pnpm exec tsx scripts/ci/r-level-check.ts --issue WORK-2026092407 --base origin/main --head HEAD
Verdict: PASS
Changed files: 7
Rules matched: (none) — no R-level artifacts required for this diff
```

Mutation battery. Each mutation was applied alone, the bridge suite was run, and the file was
restored from a pre-mutation copy:

```
== M1 child 'close' destroys the client instead of draining it (the draft's behaviour)
not ok 13 - a child that finishes right after writing still delivers every byte
# pass 19
# fail 1
== M2 '--' removed before the ssh host
not ok 7 - ssh runs a shell-exec nc to the host loopback and asks for no forwarding
# pass 19
# fail 1
== M3 buildSshArgs stops re-validating the host
not ok 8 - buildSshArgs re-validates its own inputs rather than trusting the caller
# pass 19
# fail 1
== restored
# pass 20
# fail 0
```

Preflight: `ops:preflight WORK-2026092407 --tier T2` ran from a detached worktree at
`5b193aedb` with no tracker credential. PASS, 38 checks, 28 pass, 10 skip (tracker and
docs-only checks), 0 fail. The tier classifier's mechanical floor for the scope is T3; the lane
runs at T2.

## Verification
- [x] `pnpm exec tsx --test scripts/ops/command-center-bridge.test.ts`: 20 pass, 0 fail
- [x] `pnpm exec eslint --max-warnings 0` on both new files: rc=0
- [x] `pnpm type-check`: rc=0
- [x] `pnpm test`: 6899 pass, 0 fail (includes `test:ops`, which now runs the bridge suite)
- [x] Mutation battery: each of 3 mutations turns a distinct test red; restored 20/20
- [x] `pnpm exec tsx scripts/ci/r-level-check.ts --issue WORK-2026092407 --base origin/main --head HEAD`: PASS, no R-level artifacts required
- [ ] `pnpm verify`: not claimed locally. `ci:assert-staging` refuses the containment placeholder
      target by design. CI runs `verify` on this PR.

## Runtime Verification

One production measurement was taken, read-only. It was a single unauthenticated
`GET /api/health` through the bridge, from the operator workstation, against host alias
`unit-talk-prod`, using this lane's code:

```
start=2026-09-25T23:07:57Z
$ tsx scripts/ops/command-center-bridge.ts --check
{"check":"command-center-bridge","host":"unit-talk-prod","ok":true,"reason":"command-center reports ok"}
exit=0 end=2026-09-25T23:08:01Z
```

Not re-measured with this code: the runbook's step 2 (`401` on `/picks`, `/review`,
`/exceptions`, `/settlement` without a sign-in). That result is from an earlier draft on
2026-09-24 and the runbook says so. Step 3, a signed-in page, has not been performed. It is a
precondition in the runbook for retiring `cc-proxy`, and `cc-proxy` is not touched by this PR.

## Merge SHA Binding

Merge SHA: 4180e5fefdf17cbef3a345b5d13bca38632803e2
PR: https://github.com/griff843/Unit-Talk-v2/pull/1652
Execution SHA: 98bda0923b6dab73cdaefdcf2c217f48c922c5be

Execution anchor: `98bda0923b6dab73cdaefdcf2c217f48c922c5be` is the last commit on this lane
that changes anything outside `docs/06_status/proof/WORK-2026092407/` and the lane manifest. The
lane's implementation commits are `ff588cfc0`, `7563bbdd8` and `a75dd60a7`, on top of the
lane-start commit `1251a0213`, whose parent is `origin/main` `5b193aedb3536e5705d6b708d8fe5bc9c6bd43fb`.

`work-order.md` in this directory is a byte-identical copy of the repository-owned work order
`.ops/work/WORK-2026092407.md`, which exists only as an uncommitted file.

### Re-anchor to `98bda0923b6dab73cdaefdcf2c217f48c922c5be`

Branch refreshed from origin/main `35c68ae3e` after main advanced. The merge brings in only main's own
changes: `.ops/sync/WORK-2026092503.yml`, `apps/worker/src/runner.ts`, `apps/worker/src/worker-runtime.test.ts`, `docs/06_status/lanes/WORK-2026092503.json`, `docs/06_status/proof/WORK-2026092503/diff-summary.md`, `docs/06_status/proof/WORK-2026092503/evidence.json`, `docs/06_status/proof/WORK-2026092503/verification.md`, `docs/06_status/proof/WORK-2026092503/work-order.md`. Lane-scope files changed by the merge: 0. Superseded anchor, not
withdrawn: `a75dd60a74b176a215d972f5f4bee7609fde75b3`. `verify` re-runs on the new head.
