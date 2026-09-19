# UTV2-1946 Diff Summary

Execution SHA: `cb8e405828dfb80e64475889a1fc4b425a6b3097`
MERGE_SHA: pending merge

- Imports the contracts-owned `isGovernedDeliveryTarget()` predicate through the Command Center governed-population helper, normalizing only the `discord:` transport prefix.
- Filters the default Exceptions outbox population to governed targets before both rows and counts are produced. It separates dead letters older than 24 hours into delivery history.
- Applies the shared `applyPickPopulation` predicate to all three pick-based exception queues. Measured in production, those queues were eligible over 126,348 rows of which 4 are governed; the prior `isTestFixturePick` heuristic ran after the row limit had already been taken from the full table.
- Pushes both partitions into the query — `.in('target', governedOutboxTargets)` and its complement — so counts and rows come from one server-side population and neither read is unbounded. The target list is derived from the contracts registry, not re-typed in Command Center.
- Adds an explicit `Show non-governed delivery rows` diagnostic mode. It reports those rows as non-operational inventory and does not supply them to the fire board.

No schema, migration, write path, delivery activation, kill-switch, Smart Form, or outbox mutation changed.
