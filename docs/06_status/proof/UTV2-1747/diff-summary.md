# UTV2-1747 — diff summary

13 files changed, 3168 insertions(+), 38 deletions(-). Substantive: 8 script files.

## Production source (inherited, unmodified by this lane)

| File | Change |
|---|---|
| `scripts/ops/execution-packet.ts` | Inherited byte-identically from `581af41b`: `PREAMBLE_KEY` without a NUL sentinel, `stripControlChars` on the rendered output, `TaskContractError` with a code, the `unmapped_sections` staleness assertion, empty-heading residue, and source provenance lines. |
| `scripts/ops/claude-exec.ts` | Inherited byte-identically: the `--dry-run` branch reads the packet without capture or persistence, and the failure handler emits structured JSON instead of calling `printDryRun` with the wrong arity. |
| `scripts/ops/codex-exec.ts` | Inherited byte-identically: the same `--dry-run` purity branch. |
| `scripts/ops/lane-start.ts` | **Carry-forward correction.** Accidentally omitted from the original port. Replaces the contract-less `buildSyncYml` with `captureOrReadTaskContract` + `buildSyncYmlWithTaskContract`, so a lane's sync record carries its work order from lane-start time. Without it every `--dry-run` on a real lane refuses, because dry run deliberately never captures. One disclosed deviation from byte-identity: `syncContentWithTaskContract` gained an `export` keyword and a doc comment, to provide a test seam. |

Per PM direction (bounce 1), the preserved head is a source artifact rather than
architectural authority. `lane-start.ts` and `execution-packet.ts` are therefore
changed deliberately beyond it; `claude-exec.ts` and `codex-exec.ts` remain
byte-identical to `581af41b`. The isolated-root requirement still needed no
production change, because `getRepoRoot()` already derives `ROOT` from
`process.cwd()`.

## Corrections in this bounce

| Change | Why |
|---|---|
| `lane-start.ts`: full contract lifecycle | Resume no longer refetches or depends on Linear; each destination merges against its own sync record; divergent contracts fail closed as `lane_contract_conflict`; one bounded capture happens before any lease, worktree or manifest mutation. |
| `execution-packet.ts`: standalone CLI | Routed through capture-and-persist then the identical strict validator, so the policy-required command works on a newly admitted lane. |
| `execution-packet.ts`: nesting-aware parser | Criteria under `### Functional` no longer orphan their `## Acceptance criteria` parent and trigger a false "missing acceptance criteria" refusal. |
| `execution-packet.ts`: residue fidelity | Multiline commands, fenced code and tables keep their line structure instead of being folded by `join(' ')`. |
| `lane-start.test.ts`: child-process coverage of `main()` | The capture wiring is now executed, so removing either call site fails a test. |

## Tests

| File | Change |
|---|---|
| `scripts/ops/codex-exec.test.ts` | Replaces the dry-run test that never reached packet generation with three executing tests: rendered-packet-carries-the-contract, lane-root-byte-identical, and refuses-without-a-captured-contract. Adds the isolated fixture-root helpers. Corrects the file header, which claimed `main()` could only be exercised against a live Codex CLI. |
| `scripts/ops/claude-exec.test.ts` | Replaces the two dry-run tests that wrote fixtures into the live checkout with the same three shapes, run as a child process in an isolated root. Their original assertions are preserved. |
| `scripts/ops/execution-packet.test.ts` | Replaces a control-character test whose fixture contained no control characters with two tests: `PREAMBLE_KEY` is spawn-safe on its own, and a hostile description is stripped before render. Both assert their own fixture is non-vacuous. |
| `scripts/ops/lane-start.test.ts` | Ported byte-identically, plus one added test that executes lane-start's own sync wiring and round-trips the result through `readTaskContract`. The inherited suite stayed green when that wiring was reverted, because its capture test exercises the exec-time path instead. |

## What this does not do

No parser change, no new tooling, no new file, no root parameter threaded
through production code, no change to what any executor is told to do. The
packet's behaviour is unchanged; only its observability is.
