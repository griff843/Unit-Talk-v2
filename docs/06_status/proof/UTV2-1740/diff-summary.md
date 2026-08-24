# UTV2-1740 Diff Summary

MERGE_SHA: 10c3f82dbf06aa95cbdd352d061ad20b645bc436

Issue: UTV2-1740
Tier: T1
Lane type: runtime
Proof profile: app-runtime
Branch: claude/utv2-1740-alerting-config-fix

## Implementation

| File | Change |
|---|---|
| `.github/workflows/ingestor-staleness-alert.yml` | Byte-identical to the superseded lane's head. No change. |
| `scripts/ingestor-alert-check.ts` | `main()` now passes the loaded configuration into the scheduled pass, merged with `process.env` so the `AppEnv` allow-list does not drop undeclared tuning keys. Two comments corrected: one that had become false when this lane made a branch live, and one that misstated precedence. |
| `scripts/ingestor-alert-check.test.ts` | Pure append. Adds a counting-repository zero-write proof for the disabled path, an injected-configuration precedence test, and a wiring guard for the call site. |

## Substantive diff stat

```text
.github/workflows/ingestor-staleness-alert.yml |  60 +-
scripts/ingestor-alert-check.test.ts           | 706 ++++++++++++++++++++-
scripts/ingestor-alert-check.ts                | 826 ++++++++++++++++++++-----
3 files changed, 1430 insertions(+), 162 deletions(-)
```

## Scope notes

- No migration, contract, domain, database-authority, API routing or worker file changed.
- No blocked Discord target was added or activated; member delivery stays disabled.
- Production stays parked; no production access was performed in this lane.
