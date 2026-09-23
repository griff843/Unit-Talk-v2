# UTV2-1944 Diff Summary

Execution SHA: `9c46f975632f5229d158cdabcde9fa814a10a3a8`
MERGE_SHA: eb8a4ca34dc25898f40ecce85308729b2ea9e2b8

- Adds one Command Center-owned governed-population predicate: positive presence of `metadata.distributionMode`.
- Applies that predicate to both `picks_current_state` rows and the exact `picks` count, preserving the fast count relation.
- Applies it when performance and leaderboard load their pick population; fixture access is opt-in and visibly labelled.

- Makes governed membership the driving predicate at all three settlement join sites, so a
  non-governed settlement is dropped rather than defaulted to an `unknown` source with null units.

No schema, migration, write-path, Smart Form, or delivery behavior changed.

## Git Diff Stat
```
 .ops/sync/UTV2-1944.yml                            | 158 +++++++++++++++++++++
 apps/command-center/src/app/picks/page.tsx         |  46 +++++-
 apps/command-center/src/lib/data/analytics.ts      |  32 +++--
 apps/command-center/src/lib/data/queues.ts         |  10 +-
 .../src/lib/governed-population.test.ts            |  84 +++++++++++
 apps/command-center/src/lib/governed-population.ts |  50 +++++++
 docs/06_status/lanes/UTV2-1944.json                |  51 +++++++
 docs/06_status/proof/UTV2-1944/.gitkeep            |   0
 docs/06_status/proof/UTV2-1944/diff-summary.md     |  10 ++
 docs/06_status/proof/UTV2-1944/model-routing.json  |  14 ++
 docs/06_status/proof/UTV2-1944/verification.md     |  28 ++++
 11 files changed, 467 insertions(+), 16 deletions(-)
```

