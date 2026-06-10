# UTV2-1239 Diff Summary — Deploy Alignment

## Changes

No code changes. Governance/evidence lane only.

**Deploy triggered:** `dcd649d5` → production via workflow_dispatch
**Services updated:** api, worker, ingestor, discord-bot
**Deploy method:** Docker images built from `dcd649d5`, pushed to GHCR, deployed via docker compose on Hetzner node

## What this lane proves

- Production SHA now equals intended main SHA
- Deploy workflow (verify → rollback-dry-run → build × 4 → canary → promote → smoke) all passed on `dcd649d5`
- SHA drift block against UTV2-1042 dispatch is removed (deploy aligned)

## SHA Binding

Verified source SHA: dcd649d5267c1790f910260e3bdfc5c0304ab981
Merge SHA: PENDING — no PR for this governance lane; evidence tied to deploy run 27253256755
