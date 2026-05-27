# UTV2-1177 Verification

## Verification

Commit under proof: `9096be7188e014f7cdec7baf12436a25494d9fd8`

Commands run on PR #887 head:

- `pnpm verify` - PASS
- `pnpm test:db` - PASS, 7 passed, 0 skipped with live Supabase credentials
- `tsx scripts/ci/r-level-check.ts --base origin/codex/utv2-1177-cert-gate-evidence --head HEAD` - PASS
- `tsx scripts/ci/migration-reversibility-gate.ts --base origin/codex/utv2-1177-cert-gate-evidence --json` - PASS
- GitHub schema round-trip drill - PASS

The atomic propagation RPC proof script is:

- `apps/worker/src/scripts/utv2-1177-atomic-certification-propagation-proof.ts`

The proof script emits the RPC name, append-only claim, transactional rollback claim, failure-path test reference, and verification verdict.
