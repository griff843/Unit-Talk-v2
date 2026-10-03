# Approved sender scope extension

Griff explicitly answered "Include all existing senders (Recommended)" on
2026-10-03 after the final audit found alert-runtime notification builders and
grading/ingestor operations webhooks outside the initial lock.

The work order and manifest record the additional exact paths. The scope was
reserved through `pnpm ops:lease reserve`; result: `ok: true`, `lease_renewed`.
The reservation ran the existing overlap checks and acquired the expanded lock
before any additional sender code was edited. No overlapping active ownership
was reported.

An attempted lane-start resume reported `Preflight token is expired`. The lane
remained admitted with an active four-hour lease; its earlier passing preflight
was not edited or forged. The approved scope extension was applied through the
lease reservation CLI and recorded in the existing manifest and work order.

The extension changes only formatting and removal of unsourced display defaults.
Root package.json additionally wires the new deterministic design test into
required verification. Its exact path was added to the active lease before editing.
It adds the existing domain package dependency to ingestor so its webhook can
consume the same pure builder. It does not change routes, activation, detectors,
cooldowns, provider policy, grading or settlement.
