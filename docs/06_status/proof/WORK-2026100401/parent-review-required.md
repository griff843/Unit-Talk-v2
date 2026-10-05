# Parent review — canonical JSONB fixture semantics

WORK-2026100401 remains within its existing runner/test/proof scope. Independent parent review rejects the current fixture port pending this correctness repair; this is not a PM verdict or a new product requirement.

The live canonical `reporting.pick_fixture_reason` was queried with literal JSONB values using the supported Management API with `read_only: true`. Observations are in `.out/canonical-jsonb-observation.json` and the probe is `.out/canonical-jsonb-observation.py`; no application row was mutated.

Current `metadataObject()` discards arrays and scalar strings. PostgreSQL JSONB `?` recognizes top-level array elements and scalar strings as well as object keys. Also, JSONB `->>'eventName'` returns serialized text for structured eventName values, whereas the current string-only check discards those values.

Required correction under the existing canonical fixture acceptance criterion:

- Exclude metadata `["proof_issue"]` and scalar `"proofRunId"`, just as the canonical SQL does.
- Exclude metadata `{"eventName":{"label":"Command Center QA"}}`, matching the canonical SQL extraction.
- Continue retaining null metadata and unmarked arrays such as `["production"]`.
- Add deterministic regression coverage comparing these observed outcomes. Preserve all current settlement, read-only, pagination and fail-closed guards.
- Preserve this review and measured observation in the own-work proof bundle; update its disposition truthfully after the tests pass.

## Disposition

Accepted and repaired. The runner now mirrors PostgreSQL JSONB `?` semantics for top-level object
keys, array string elements, and scalar strings, and mirrors `->>` text extraction for structured
`eventName` values. The focused runner suite passes 26/26, including the measured six-case JSONB
regression.

The parent stopped only a local read-only CI watcher so the sanctioned CLI can finish and the outer wrapper can persist its attestation. GitHub jobs remain running. Do not wait indefinitely for model-routing.json inside this child: the wrapper creates that file only AFTER the child returns. Parent will finish exact-HEAD CI and control closure after the wrapper's final commit. Do not fabricate model provenance or PM approval.
