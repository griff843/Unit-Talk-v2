# UTV2-1747 — diff summary

9 files changed, 1907 insertions(+), 14 deletions(-).
Substantive: 6 files changed, 1852 insertions(+), 14 deletions(-).

## Production source (inherited, unmodified by this lane)

| File | Change |
|---|---|
| `scripts/ops/execution-packet.ts` | Inherited byte-identically from `581af41b`: `PREAMBLE_KEY` without a NUL sentinel, `stripControlChars` on the rendered output, `TaskContractError` with a code, the `unmapped_sections` staleness assertion, empty-heading residue, and source provenance lines. |
| `scripts/ops/claude-exec.ts` | Inherited byte-identically: the `--dry-run` branch reads the packet without capture or persistence, and the failure handler emits structured JSON instead of calling `printDryRun` with the wrong arity. |
| `scripts/ops/codex-exec.ts` | Inherited byte-identically: the same `--dry-run` purity branch. |

This lane authored **no** new production change. The isolated-root requirement
was met without a test-only root parameter, because `getRepoRoot()` already
derives `ROOT` from `process.cwd()`.

## Tests

| File | Change |
|---|---|
| `scripts/ops/codex-exec.test.ts` | Replaces the dry-run test that never reached packet generation with three executing tests: rendered-packet-carries-the-contract, lane-root-byte-identical, and refuses-without-a-captured-contract. Adds the isolated fixture-root helpers. Corrects the file header, which claimed `main()` could only be exercised against a live Codex CLI. |
| `scripts/ops/claude-exec.test.ts` | Replaces the two dry-run tests that wrote fixtures into the live checkout with the same three shapes, run as a child process in an isolated root. Their original assertions are preserved. |
| `scripts/ops/execution-packet.test.ts` | Replaces a control-character test whose fixture contained no control characters with two tests: `PREAMBLE_KEY` is spawn-safe on its own, and a hostile description is stripped before render. Both assert their own fixture is non-vacuous. |

## What this does not do

No parser change, no new tooling, no new file, no root parameter threaded
through production code, no change to what any executor is told to do. The
packet's behaviour is unchanged; only its observability is.
