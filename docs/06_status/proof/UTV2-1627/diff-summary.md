# UTV2-1627 Diff Summary

MERGE_SHA: 72b4747fab755038a15fad133912777749313fc0

- Adds a fail-closed database identity guard keyed to the actual Supabase URL, database URL, declared project ref, and explicit access mode.
- Routes writable CI and proof workflows through isolated `CI_SUPABASE_*` credentials.
- Keeps production proof regression and shadow parity paths explicitly read-only.
- Inventories every credentialed database test and proof entrypoint, including its owner and authorized execution paths.
- Makes writer-inventory drift and production credential reuse blocking CI failures.
- Guards the UTV2-1497 concurrent outbox claim proof before any repository is created.
- Expands execution-packet Tier C warnings for worker and proof-coverage self-amendments.
- Adds negative tests for production identity, target mismatches, unclassified writers, read-only mutation signals, workflow credential misuse, and missing guards.

Verified implementation SHA: `076b7356078725288d902a1bd92a2bd9d37c921e`
