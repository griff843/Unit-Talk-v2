# UTV2-1485 Diff Summary

## Summary

- Added browser-local saved Alert Builder definitions in Command Center.
- Saved entries are validated on load and discard malformed or governance-tampered data.
- No schema, API, worker, approval, or Discord dispatch path was added.

## Files Changed

- `apps/command-center/src/app/intel/alerts/page.tsx` — saves, loads, and deletes internal alert filters from browser local storage, with clear local-only/dispatched-disabled labels.
- `apps/command-center/src/lib/alert-builder.ts` — adds defensive parsing for saved definitions while preserving fail-closed governance validation.
- `apps/command-center/src/lib/alert-builder.test.ts` — covers valid persistence parsing, malformed storage, and tampered governance flags.

## Scope and Safety

The issue does not authorize an `alert_definitions` schema or API write contract. Persistence is intentionally local to the operator's browser. A saved definition remains `destination: internal`, `internalOnly: true`, and `requiresApprovalBeforeDispatch: true`; it cannot create, approve, or dispatch an alert.
