# UTV2-1944 Diff Summary

Execution SHA: `81683c655b1ba018fef1f7579230b2ab4d020484`

- Adds one Command Center-owned governed-population predicate: positive presence of `metadata.distributionMode`.
- Applies that predicate to both `picks_current_state` rows and the exact `picks` count, preserving the fast count relation.
- Applies it when performance and leaderboard load their pick population; fixture access is opt-in and visibly labelled.

No schema, migration, write-path, Smart Form, or delivery behavior changed.
