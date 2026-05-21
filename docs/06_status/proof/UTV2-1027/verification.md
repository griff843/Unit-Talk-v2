# UTV2-1027 Verification

Merge SHA: 9ac698bee8e1140adf6a785bf97f3a9f1907a1c7

## Commands

```bash
pnpm type-check
```

Result: PASS.

```bash
pnpm test
```

Result: PASS.

```bash
node --import tsx scripts/clv-dashboard.ts --sample-data --format=json --out=/tmp/utv2-1027-clv-dashboard-sample.json
node --import tsx scripts/clv-dashboard.ts --sample-data --format=markdown --out=/tmp/utv2-1027-clv-dashboard-sample.md
```

Result: PASS. JSON parsed with `rowCount=3`, `summaries=10`, `rows=3`; Markdown emitted the expected overall, sport, band, modelVersion, and clvSourceClass rows.

```bash
node --import tsx scripts/clv-dashboard.ts --after=2099-01-01 --format=json --out=/tmp/utv2-1027-clv-dashboard-empty.json
```

Result: BLOCKED by sandbox network egress: `Failed to fetch CLV dashboard rows: TypeError: fetch failed`. The script path is read-only, but live Supabase access is unavailable from this execution sandbox.

## Verification Notes
- The CLI smoke path uses `--sample-data` only to exercise formatting and cohort math without database access.
- Production usage remains DB-backed by default and reads from `settlement_records` joined to `picks`.
- Direct `npx tsx ...` was blocked in this sandbox by IPC permissions (`listen EPERM` on `/tmp/tsx-1000/*.pipe`), so `node --import tsx` was used for issue-specific verification.
