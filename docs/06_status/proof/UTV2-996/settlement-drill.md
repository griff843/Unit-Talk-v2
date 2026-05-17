# PROOF: UTV2-996
MERGE_SHA: 2370bc8f6490e844d3946f53f18224f3d5a76733

ASSERTIONS:
- [x] 396 settled records in settlement_records table — table queryable and populated
- [x] 1 correction record found with corrects_id pointing to original; max chain depth 1
- [x] All sampled original settlement rows have corrects_id = null (not mutated by corrections)
- [x] 100 settlement audit rows sampled — all well-formed (append-only invariant holds)
- [x] 5 of 5 recent settlement records have corresponding audit trail entries
- [x] New DB smoke tests pass: duplicate settlement idempotency (same record ID returned, 1 base row)
- [x] New DB smoke tests pass: correction chain additivity (original row result unchanged, corrects_id null)
- [x] Correction audit entries logged as settlement.corrected; original as settlement.recorded

EVIDENCE:
```json
{
  "ok": true,
  "assertions": [
    {
      "label": "settlement_records table is queryable",
      "passed": true,
      "detail": "396 settled records found"
    },
    {
      "label": "correction chains exist in production data",
      "passed": true,
      "detail": "1 correction records found; max chain depth 1"
    },
    {
      "label": "original settlement rows are not mutated by corrections",
      "passed": true,
      "detail": "all sampled original rows have corrects_id = null"
    },
    {
      "label": "audit_log settlement rows are well-formed (append-only invariant)",
      "passed": true,
      "detail": "100 settlement audit rows sampled — all well-formed"
    },
    {
      "label": "recent settlement records have corresponding audit trail entries",
      "passed": true,
      "detail": "5 of 5 sampled settlement records have audit entries"
    }
  ],
  "stats": {
    "totalSettled": 396,
    "corrections": 1,
    "correctionChainMaxDepth": 1,
    "auditRowsChecked": 100,
    "samplePickIds": [
      "b5ef3573-a970-4f18-9772-79c5193a9cfe"
    ]
  },
  "ranAt": "2026-05-17T15:57:02.806Z"
}
```

```json
{
  "representativePickId": "dc864a66-05d3-46d3-af04-ab9bd3536655",
  "receiptCount": 1,
  "settlementRecordId": "5bbbe325-7d92-4a84-acac-29211eec8458",
  "correctionChainDepth": 1,
  "lifecycleStates": ["validated", "queued", "posted"],
  "clvStatus": "missing_closing_line",
  "clvPercent": null,
  "profitLossUnits": -1,
  "recapPeriod": "weekly",
  "latestGradingRun": {
    "startedAt": "2026-05-16T11:34:53.476775+00:00",
    "status": "succeeded",
    "skipped": null,
    "errors": null,
    "actionableReasons": []
  },
  "auditActions": [
    "settlement.graded",
    "distribution.sent",
    "promotion.suppress",
    "promotion.suppress",
    "promotion.force_promote"
  ]
}
```
