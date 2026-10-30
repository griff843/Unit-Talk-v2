# Required shared-predicate mutation

MERGE_SHA: pending merge

Temporarily changed the private pin interpretation inside `pinnedAudience` from staff-canary to members; routing parsing was unchanged. Rebuilt contracts and directly ran the five admitted test files with `--test-name-pattern=WORK-2026103005`.

The mutant exited 1 with eight independent behavioral failures:

- Pure audience predicate.
- Performance service.
- Authenticated bot stats route.
- Authenticated bot leaderboard route.
- Member picks handler.
- Generic picks/results handler.
- Recent settlements handler.
- Daily/weekly/monthly aggregate recap test.

The release destination and per-pick private recap tests remained executable. There was no compile failure standing in for a behavioral failure. A finally block restored the exact source bytes and rebuilt contracts. The restored command exited 0: all 11 new tests passed. Final complete focused rerun passed 236 tests, zero failures/skips.

Restored source SHA-256 (delivery-audience.ts): `36866c511b873f133420c9a224e2129dc00eb33029277c69b4bf0e02f3074404`.

Local diagnostic logs: `/tmp/work3005-mutant.log`, `/tmp/work3005-restored.log`, `/tmp/work3005-final-focused.log`. No mutant or production change was committed.
