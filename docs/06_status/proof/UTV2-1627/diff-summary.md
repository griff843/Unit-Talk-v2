# UTV2-1627 Diff Summary

MERGE_SHA: b6c395f0565ad66ee4c799a10049ed8c5e0594b4

- Isolates writable CI and proof execution from production Supabase.
- Preserves the UTV2-1628 privileged-client boundary and UTV2-1629/1630 workflow architecture.
- Recovers missing ephemeral lane tokens only after ownership, PR/head, dependency, and singleton-scope validation.
- Requires dedicated mechanically read-only shadow-parity credentials; service-role and anon fallbacks are forbidden.
- Makes query errors and zero scanned candidates blocking shadow-parity outcomes.
- Replaces contradictory proof histories with one exact implementation-SHA evidence package.
