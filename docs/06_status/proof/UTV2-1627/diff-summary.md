# UTV2-1627 Diff Summary

- Adds a fail-closed database identity guard keyed to the actual Supabase URL, database URL, declared project ref, and explicit access mode.
- Routes writable CI and proof workflows through isolated `CI_SUPABASE_*` credentials.
- Keeps production proof regression and shadow parity paths explicitly read-only.
- Inventories every credentialed database test and proof entrypoint, including its owner and authorized execution paths.
- Makes writer-inventory drift and production credential reuse blocking CI failures.
- Guards the UTV2-1497 concurrent outbox claim proof before any repository is created.
- Expands execution-packet Tier C warnings for worker and proof-coverage self-amendments.
- Adds negative tests for production identity, target mismatches, unclassified writers, read-only mutation signals, workflow credential misuse, and missing guards.

Verified implementation SHA: `5cfa98630c4b6051e2f53a54c4ecf422a6790bfa`
