## Verification

Issue: UTV2-1590

Verified source SHA: `59a2fff654b88a029fc4dafdf19e3023bf88d209`

The substantive implementation was verified from the dedicated lane worktree. The proof-only commits after the verified source SHA change only lane metadata and files under `docs/06_status/proof/UTV2-1590/`.

### Static and focused verification

- `pnpm type-check` — PASS
- `pnpm test` — PASS
- `pnpm verify` — PASS
- `npx tsx --test scripts/ops/truth-check-lib.test.ts scripts/ops/lane-close.test.ts` — PASS (191 tests)
- `npx tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD` — PASS; no R-level rules matched
- `npx tsx scripts/ops/lane-manifest.ts validate UTV2-1590 --json` — PASS
- `pnpm ops:proof-check UTV2-1590 --json` — PASS
- `git diff --check` — PASS

### Runtime verification

`pnpm test:db` executed against Supabase project `zfzdnfwdarxucxtaojxm` through the repository's T1 verification gate.

```text
1..7
# tests 7
# suites 0
# pass 7
# fail 0
# cancelled 0
# skipped 0
# todo 0
```

The live smoke suite covered submission and settlement persistence, atomic rollback invariants, participant uniqueness, and additive settlement corrections. The complete `pnpm verify` run also executed the T1 live-proof suite successfully.

### Historical required-check evidence

A read-only live GitHub evaluation of PR #1305 head `9425e96f91cc7c525cb1a71336b6806e5dac059d` selected exact required context `Executor Result Validation`, app `15368`, run `89533838816`, completed `2026-07-24T16:27:48Z`, conclusion `failure`. The differently named earlier successful run did not satisfy the required context.

### Acceptance evidence

- L3 accepts exactly Ready to Close, In PM Review, and Done.
- Historical check evaluation paginates check runs and statuses, preserves app identity, and selects the latest exact result.
- Newer failure supersedes older success, and newer success supersedes older failure.
- Ordinary pushes keep done lanes as a no-op.
- Trusted workflow dispatch with an explicit validated PR reaches idempotent terminal cleanup without rewriting PR/SHA authority, proof bindings, terminal truth history, or `closed_at`.
