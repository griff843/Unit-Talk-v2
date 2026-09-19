# UTV2-1946 Diff Summary

Execution SHA: `d9fc89721584631a9a53a5b9f2d03aff2dff6d29`
MERGE_SHA: pending

- Imports the contracts-owned `isGovernedDeliveryTarget()` predicate through the Command Center governed-population helper, normalizing only the `discord:` transport prefix.
- Filters the default Exceptions outbox population to governed targets before both rows and counts are produced. It separates dead letters older than 24 hours into delivery history.
- Adds an explicit `Show non-governed delivery rows` diagnostic mode. It reports those rows as non-operational inventory and does not supply them to the fire board.

No schema, migration, write path, delivery activation, kill-switch, Smart Form, or outbox mutation changed.
