# UTV2-1238 Diff Summary

Runtime recovery was performed through production environment and database disposition only. No repository runtime source files were modified.

## Operational Changes

- Fixed production worker crash caused by malformed `UNIT_TALK_DISCORD_TARGET_MAP={}}`.
- Recreated `unit-talk-worker-1` on deployed image `a5cdd2d1d3466d11b68af7dc999e0b9e921f5d94`.
- Corrected worker target configuration, then narrowed production worker to `UNIT_TALK_DISTRIBUTION_TARGETS=discord:canary` to avoid blindly posting stale `discord:best-bets` backlog.
- Dead-lettered only pending `discord:canary` rows whose joined pick source was `t1-proof`, using the same disposition reason already applied by worker code:
  - `proof-pick-blocked: source 't1-proof' is not a live source`
- Created one controlled `api` source canary outbox row and allowed the recovered production worker to deliver it normally.

## Repo Changes

- Added this proof packet under `docs/06_status/proof/UTV2-1238/`.
- No code changes.
- No workflow changes.
- No migration changes.
- No `.ops` changes.
- No proof/lane history deletion.

## SHA Binding

Merge SHA: `ba292a2df0c0ec29616303f239cf67ca4ce04d3f`

## Remaining Non-Code Decisions

- `discord:best-bets` has 199 stale `smart-form|queued` pending rows from 2026-06-03 through 2026-06-05. They were not retried or dead-lettered because stale live-channel delivery requires PM/operator disposition.
- `dead_letter` rows remain as historical proof-blocked rows. They should be retained for audit unless PM approves a documented archive/quarantine policy.
- `ops:runtime-health` still fails on provider freshness outside the worker/outbox remediation scope.
