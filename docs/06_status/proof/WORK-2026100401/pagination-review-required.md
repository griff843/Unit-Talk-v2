# Parent review — candidate identity cardinality

This review remains inside WORK-2026100401's canonical settlement-count scope. It is not a PM verdict.

The canonical SQL reference counts `DISTINCT pc.id`. Stable ordering alone does not prevent repeated candidate IDs across separate offset-paginated REST requests when production links are inserted or updated before an already-read offset. The current final `.filter(...).length` counts those repeated observations twice.

The added deterministic regression uses one candidate per page and repeats the same primary key on successive pages, representing this real pagination behavior rather than duplicate primary keys in one physical table snapshot. Two different candidate IDs linked to the same qualifying loss must still count as two; a repeated observation of one ID must not inflate the count.

Required bounded fix: deduplicate qualifying candidate IDs in the final count, preserving all query, canonical-settlement, correction, fixture, and fail-closed behavior. No new schema, grants, RPC, dependency, runtime trigger, scoring, grading, or Discord changes are needed. Run the focused suite and record this review's disposition truthfully.

Parent will finish the exact-HEAD proof rebind, branch refresh, CI/staging receipts, and PM controls after the CLI returns and its wrapper persists the actual attestation. Do not wait for the wrapper's final sidecar inside the child; do not fabricate approval or declare the overall task complete.

Additional proof closeout observation: the sanctioned proof-generation dry run currently refuses evidence.json with `unbindable_proof_artifact` because its schema-v2 packet contains a forbidden legacy top-level `merge_sha`. Preserve the measured evidence, migrate it to the sanctioned schema, and rebind the corrected source through the generator; never weaken the validator.
