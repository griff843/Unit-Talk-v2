# UTV2-1749 Diff Summary

Generated at: 2026-08-31T20:21:40.394Z
Issue: UTV2-1749
Tier: T1
Lane type: governance
Branch: codex/utv2-1749-alert-workflow-wiring
PR URL: N/A
Head SHA: 6a4fb2415e6519de6a1f716b2e33d4d2d5a4cf99
Merge SHA: N/A
Diff base: fd0e7b19b7ebeaf5a336e1ea296015f843af7561
Diff target: 6a4fb2415e6519de6a1f716b2e33d4d2d5a4cf99

## Git Diff Stat
```
.github/workflows/ingestor-staleness-alert.yml |   3 +
 .ops/sync/UTV2-1749.yml                        | 296 +++++++++++++++++++++++++
 docs/06_status/lanes/UTV2-1749.json            |  44 ++++
 docs/06_status/proof/UTV2-1749/.gitkeep        |   0
 scripts/ci/ingestor-alert-wiring.test.ts       |  81 +++++++
 5 files changed, 424 insertions(+)
```

## Git Name Status
```
M	.github/workflows/ingestor-staleness-alert.yml
A	.ops/sync/UTV2-1749.yml
A	docs/06_status/lanes/UTV2-1749.json
A	docs/06_status/proof/UTV2-1749/.gitkeep
A	scripts/ci/ingestor-alert-wiring.test.ts
```

## Exact Functional Diff

- `alerting-pass`: add `SUPABASE_ANON_KEY: ${{ secrets.SUPABASE_ANON_KEY }}`.
- `alerting-pass`: add `UNIT_TALK_OPS_ALERT_WEBHOOK_URL: ${{ secrets.UNIT_TALK_OPS_ALERT_WEBHOOK_URL }}`.
- `monitor`: add `SUPABASE_ANON_KEY: ${{ secrets.SUPABASE_ANON_KEY }}`.
- Add `scripts/ci/ingestor-alert-wiring.test.ts`, which parses the workflow YAML, locates both runtime steps, and requires the exact secret expressions for the Supabase triplet and operations webhook.

Expected effect: both scheduled jobs can satisfy the application configuration loader's full Supabase credential contract; `alerting-pass` can also consume the existing operations webhook secret for its authorized canary-only reporting path. The cadence, workflow permissions, alert thresholds, member-channel control, and system-pick control are byte-unchanged.

This is pre-merge static evidence only. A successful scheduled execution is not claimed until a post-merge run is observed.

## Manifest Files Changed
- No files_changed entries recorded.

## SHA Binding
Head SHA: 6a4fb2415e6519de6a1f716b2e33d4d2d5a4cf99
Merge SHA: N/A
