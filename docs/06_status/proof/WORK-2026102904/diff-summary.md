# Diff summary: WORK-2026102904

Execution SHA: 2f15363f273eefcdae6d67b3ca3108fd49f4d5c5

| File | Change |
|---|---|
| scripts/ops/command-center-bridge.ts | New `buildRemoteCommand`: a bash relay with the upstream reader in the foreground replaces `nc 127.0.0.1 <port>`, so the ssh session ends when Command Center closes the connection. `buildSshArgs` uses it. Header comment updated. |
| scripts/ops/command-center-bridge.test.ts | Exact-command and validation tests updated; four integration tests run the real relay locally: relay exits on server close, idle sign-in answered on a fresh socket, credentials pass through, dropped connection fails fast. |

Not changed: bind-address and host validation, credential handling (none injected), the host, sshd, ports, containers, firewall, any app code and any workflow.

## Merge SHA Binding

Merge SHA: `487d129a34c4d033caa8c5ae1413f1b649b673f6`
PR: https://github.com/griff843/Unit-Talk-v2/pull/1803
