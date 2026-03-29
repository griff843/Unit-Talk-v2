# Alert Agent Extraction Contract

**Status:** RATIFIED 2026-03-29
**Lane:** claude (contract) — codex (implementation: UTV2-125 contract, UTV2-126 impl)
**Authority:** This document defines the process boundary between `apps/api` and the alert agent scheduler.

---

## Problem

`apps/api/src/index.ts` currently boots both:
1. The HTTP API server (`createApiServer`)
2. The alert agent scheduler (`startAlertAgent`)
3. The recap scheduler (`startRecapScheduler`)

This creates four concrete failure modes:
- API restarts kill alert/recap scheduling silently
- Alert agent crashes can destabilize the API process
- The API `package.json` must declare Discord / agent dependencies unrelated to HTTP handling
- API and alert agent cannot scale independently

---

## Scope of This Contract

This contract covers extraction of `startAlertAgent` only. `startRecapScheduler` may be extracted in a follow-on contract. Do not extract both in one PR.

---

## Target Architecture

```
apps/api/src/index.ts        ← HTTP API only. No alert agent. No recap scheduler.
apps/alert-agent/src/main.ts ← Standalone alert agent process entry point.
```

Both processes share `@unit-talk/db` repositories. Neither imports from the other.

---

## Implementation Spec (Codex: UTV2-126)

### New file: `apps/alert-agent/src/main.ts`

```typescript
// Entry point for the alert agent process.
// Run with: node dist/main.js (or tsx src/main.ts in dev)

import { createApiRuntimeDependencies } from '../../api/src/server.js'; // ← or from @unit-talk/db directly
import { startAlertAgent } from '../../api/src/alert-agent.js';        // ← will move to shared package in future

const runtime = createApiRuntimeDependencies();
let stop: (() => void) | null = null;
let shuttingDown = false;

stop = startAlertAgent(runtime.repositories);

console.log(JSON.stringify({
  service: 'alert-agent',
  status: 'started',
  persistenceMode: runtime.persistenceMode,
}));

process.once('SIGINT', shutdown('SIGINT'));
process.once('SIGTERM', shutdown('SIGTERM'));

function shutdown(signal: string) {
  return () => {
    if (shuttingDown) return;
    shuttingDown = true;
    stop?.();
    console.log(JSON.stringify({ service: 'alert-agent', status: 'stopped', signal }));
    process.exit(0);
  };
}
```

### Modified: `apps/api/src/index.ts`

Remove:
```typescript
import { startAlertAgent } from './alert-agent.js';
let stopAlertAgent: (() => void) | null = null;
stopAlertAgent = startAlertAgent(runtime.repositories);
stopAlertAgent?.();
```

The API `index.ts` should only start the HTTP server and recap scheduler after this change.

### New file: `apps/alert-agent/package.json`

Minimum fields:
```json
{
  "name": "@unit-talk/alert-agent",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "start": "node dist/main.js",
    "dev": "tsx src/main.ts"
  }
}
```

### New file: `apps/alert-agent/tsconfig.json`

Must extend root `tsconfig.json` and add a project reference to `apps/api` (until alert agent logic is moved to a shared package).

---

## Acceptance Criteria (UTV2-126)

- [ ] `apps/alert-agent/src/main.ts` exists and starts the alert agent
- [ ] `apps/api/src/index.ts` no longer imports or starts the alert agent
- [ ] Both processes start independently and handle SIGTERM cleanly
- [ ] `apps/api` tests still pass (alert agent test file `alert-agent.test.ts` remains in `apps/api/src/` for now)
- [ ] `pnpm verify` passes

---

## Out of Scope

- Moving `alert-agent.ts` logic to a shared package (future T2 item)
- Extracting `startRecapScheduler` (separate follow-on contract)
- Any changes to alert detection or notification logic

---

## Rollback

If extraction causes instability: revert `apps/api/src/index.ts` to restore `startAlertAgent` call. The new `apps/alert-agent/` can remain as a stub without being run.
