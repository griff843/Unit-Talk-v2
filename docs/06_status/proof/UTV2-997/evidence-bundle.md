# UTV2-997 Evidence Bundle

## Column Documentation

| Field              | Source path                                                                                  |
| ------------------ | -------------------------------------------------------------------------------------------- |
| `odds`             | `picks.odds`                                                                                 |
| `clv`              | `picks.clv`, falling back to `settlement_records.clv`, then `settlement_records.payload.clv` |
| `result`           | `settlement_records.result`                                                                  |
| `confidence`       | `picks.confidence`, falling back to `picks.metadata.confidence`                              |
| `edge`             | `picks.metadata.promotionScores.edge`                                                        |
| `trust`            | `picks.metadata.promotionScores.trust`                                                       |
| `readiness`        | `picks.metadata.promotionScores.readiness`                                                   |
| `uniqueness`       | `picks.metadata.promotionScores.uniqueness`                                                  |
| `boardFit`         | `picks.metadata.promotionScores.boardFit`                                                    |
| `market`           | `picks.market`                                                                               |
| `sport`            | `picks.sport`, falling back to `picks.sport_id`                                              |
| `stake_units`      | `picks.stake_units`                                                                          |
| `band`             | `picks.band`                                                                                 |
| `edge_source`      | `picks.metadata.edgeSource`, falling back to `picks.metadata.domainAnalysis.edgeSource`      |
| `edge_method`      | `picks.metadata.edgeMethod`, falling back to `picks.metadata.domainAnalysis.edgeMethod`      |
| `real_edge`        | Derived edge-source classification                                                           |
| `confidence_proxy` | Derived edge-source classification                                                           |
| `null_scores`      | `picks.metadata.promotionScores IS NULL`                                                     |
| `null_band`        | `picks.band IS NULL`                                                                         |

## Edge-Source Split Logic

The script classifies each exported row with these deterministic rules:

- `real_edge`: `edge_source` is present, is not `confidence-proxy`, and either `picks.metadata.domainAnalysis.edgeSource` or the resolved `edge_source` equals `domain-analysis-v1`.
- `confidence_proxy`: resolved `edge_source` equals `confidence-proxy` or is null.
- `null_scores`: `picks.metadata.promotionScores` is null or missing.
- `null_band`: `picks.band` is null or missing.

## Sample Output Structure

```json
{
  "generated_at": "2026-05-18T00:00:00.000Z",
  "filters": {
    "after": "2026-04-20"
  },
  "columns": ["odds", "clv", "result"],
  "rows": [
    {
      "odds": -110,
      "clv": 1.8,
      "result": "win",
      "confidence": 72,
      "edge": 75,
      "trust": 70,
      "readiness": 80,
      "uniqueness": 65,
      "boardFit": 77,
      "market": "player_points",
      "sport": "NBA",
      "stake_units": 1,
      "band": "A",
      "edge_source": "domain-analysis-v1",
      "edge_method": "domain-analysis",
      "real_edge": true,
      "confidence_proxy": false,
      "null_scores": false,
      "null_band": false
    }
  ],
  "sample_counts": {
    "total": 1,
    "real_edge": 1,
    "confidence_proxy": 0,
    "null_scores": 0,
    "null_band": 0
  }
}
```

## Script Usage

```bash
npx tsx scripts/model-evaluation-dataset.ts --after=2026-04-20
```
