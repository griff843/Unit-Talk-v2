# UTV2-1747 — diff summary

13 files changed, 3241 insertions(+), 38 deletions(-). Substantive: 8 script files.

Rewritten at bounce 1. The previous version of this file was pre-bounce text: it
described `execution-packet.ts` as inherited byte-identically, described a
`lane-start.ts` design that no longer exists, and closed by claiming "no parser
change" while its own table two sections earlier described three parser changes.
All of that was false at this head and is replaced.

## Production source

| File | Status vs `581af41b` | Change |
|---|---|---|
| `scripts/ops/claude-exec.ts` | byte-identical | Inherited: `--dry-run` reads the packet without capture or persistence; the failure handler emits structured JSON instead of calling `printDryRun` with the wrong arity. |
| `scripts/ops/codex-exec.ts` | byte-identical | Inherited: the same `--dry-run` purity branch. |
| `scripts/ops/execution-packet.ts` | **rewritten** | Standalone CLI routed through capture-and-persist then the identical strict validator; nesting-aware `parseSections` (a line belongs to the deepest heading and every ancestor, and consuming a parent consumes its descendants); residue keeps its line structure and renders multiline bodies verbatim. |
| `scripts/ops/lane-start.ts` | **rewritten** | Full contract lifecycle: capture once and persist the same contract to both roots; resume reuses without refetching; each destination merges against its own sync record; divergent valid contracts fail closed as `lane_contract_conflict`; the single bounded capture precedes any lease, worktree or manifest mutation. |

Per PM direction, the preserved head is a source artifact rather than
architectural authority, so deviating from it where correctness required is the
point of this bounce, not a defect in the carry-forward.

## Tests

| File | Change |
|---|---|
| `scripts/ops/lane-start.test.ts` | Ported, then extended with child-process execution of `main()` against a fixture repository: offline resume, per-destination merge, divergent-contract refusal, and capture failure on both the resume and fresh paths. Removing either real capture call site now fails a test. |
| `scripts/ops/execution-packet.test.ts` | Executing CLI test for a pre-contract lane (with `curl` stubbed), a hierarchical-description regression test, and a residue-fidelity test covering a fenced SQL block with indentation and a markdown table. The control-character test's fixture was corrected after the nesting change silently made it vacuous. |
| `scripts/ops/codex-exec.test.ts` | Executing dry-run coverage in an isolated root. The narrow compile smoke now asserts that `tsc` actually ran, and covers `lane-start.ts` and `execution-packet.ts` — without those entries an unresolved symbol in either file shipped past a fully green suite. |
| `scripts/ops/claude-exec.test.ts` | The same three executing shapes, run as a child process in an isolated root. |

## What this does not do

No new file, no new tooling, and no widening of the parser's heading whitelist.
No runtime, database, deployment, ingestion or delivery path is touched.
