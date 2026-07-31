# Executable Wiring Coverage

**Status:** ratified under UTV2-1624 · **Enforcement point:** `pnpm ops:automation-coverage-check` (runs inside `verify:static`, which the required `verify` context executes)

Capability *presence* is not capability *coverage*. A test file that no command ever runs, and an ops script that nothing ever invokes, are indistinguishable from green CI. This document is the canonical spec for the mechanism that closes that gap.

Implementation: `scripts/ops/executable-wiring.ts`, invoked by `scripts/ops/automation-coverage-check.ts`.
Ledger: `docs/05_operations/executable-wiring-baseline.json`.

---

## 1. The execution graph

Reachability is computed from a real execution graph, never inferred from filename similarity. The graph is built from:

| Source | Handling |
|---|---|
| Root `package.json` scripts | every script is a node |
| Every workspace package's scripts | resolved via `pnpm-workspace.yaml` globs |
| `pnpm <script>` / `pnpm run <script>` | edge to the root package's script |
| `pnpm --filter <pkg> <script>` / `-F` | edge to that workspace's script |
| `pnpm -r --if-present run <script>` | edge to every workspace declaring that script |
| `pnpm exec <cmd>` | the remainder is re-interpreted in the target package's directory |
| `tsx --test` / `node --test` | positional arguments are test files, after value-taking flags are consumed |
| Globs and explicit file lists | expanded against the working tree (see §2) |
| `vitest` / `jest` / `playwright test` | runner discovery, scoped (§2) |
| `.github/workflows/*.yml` `run:` blocks | parsed as commands so workflow-level test invocations count |

Commands are split quote-aware on `&&`, `||`, `;`, `|` and newlines, so a chain like
`pnpm verify:static` → `pnpm test` → `pnpm test:ops` → `tsx --test …` resolves end to end.

Every reachable test carries the concrete chain that reaches it, for example:

```
pnpm verify -> verify:static -> test -> test:ops -> tsx --test
```

## 2. Glob and discovery fidelity

Two mis-reads would each make dead tests look alive, so both are modelled explicitly:

- **`**` is not globstar in POSIX `sh`.** pnpm runs scripts under `sh`, which expands `**` as a single-segment `*`. A pattern such as `apps/qa-agent/src/**/*.test.ts` therefore runs only the tests one level deep; anything nested is silently skipped. The checker expands with shell semantics first and falls back to Node's recursive glob only when the shell matches nothing (which is when Node actually receives the literal pattern). Files hidden by this collapse are reported as `WIRING_GLOB_SHADOWED`.
- **Not every runner invocation runs tests.** `npx playwright install chromium` is a browser download, not a test run. Runner invocations only count as discovery when they are actual test runs, and Playwright discovery is scoped to its config's `testDir` rather than the whole package.

## 3. Test classification

| Status | Meaning |
|---|---|
| `required-reachable` | reachable from a required root (default: `pnpm verify`) |
| `optional-reachable` | reachable only from another named command or a workflow; the command is recorded |
| `fixture-helper-not-executable` | matches test-file naming but registers no tests and imports no test framework |
| `quarantined` | held out of CI deliberately, with issue, owner and expiry |
| `unwired` | reachable from nothing |

Required roots are declared in the ledger's `required_roots`. They default to `['verify']`.

## 4. Capability classification

Applies to `scripts/ops/**` and `scripts/ci/**`.

| Status | Meaning |
|---|---|
| `required-gate` | invoked by a command on the required path |
| `wired-command` | invoked by some package script |
| `wired-workflow` | invoked by a workflow `run:` block |
| `invoked-library` | imported or spawned by non-test source |
| `test-covered-library` | imported only by tests — but by a test that actually runs |
| `baselined` | orphan with a reviewed disposition, owner, issue and expiry |
| `orphan` | zero executable references: **fails** |

**Documentation-only reference is never sufficient** for anything claimed as automated. A capability referenced solely by a runbook or skill file is an orphan. A capability imported only by a test that itself never runs is also an orphan — the import proves nothing if the importer is dead.

## 5. Staged enforcement

Phase A (UTV2-1624) does not append every unwired test to `test:ops`. Instead:

1. The inventory and counts are re-derived mechanically by the checked-in tool. No count is hardcoded.
2. Critical governance/merge-path tests that are safe and deterministic are wired immediately, each negatively demonstrated by mutation.
3. Everything else is recorded in the reviewed baseline ledger with a classification, owner, issue and expiry.
4. Any newly introduced unwired test fails `verify:static`.
5. Any baseline entry that loses its owner, issue or expiry fails.

**The ledger may shrink but never grow.** `max_entries` caps each section; exceeding it fails. Entries that become reachable, become non-executable fixtures, or reference deleted files are *stale* and must be removed — which is what forces the ledger down over time.

### Allowed test dispositions

`phase-b-wiring` · `failing-triage` · `quarantined` · `external-service` · `destructive` · `duplicate-coverage` · `obsolete-review`

### Allowed capability dispositions

`manual-diagnostic` · `one-shot-migration-aid` · `transitional-wiring-gap` · `archive-delete-candidate`

## 6. Finding codes

| Code | Severity | Meaning |
|---|---|---|
| `WIRING_TEST_UNWIRED_NEW` | fail | a test reachable from nothing and absent from the ledger |
| `WIRING_BASELINE_TEST_ENTRY_INCOMPLETE` | fail | entry missing owner, issue, expiry, or using an unapproved disposition |
| `WIRING_BASELINE_TEST_ENTRY_STALE` | fail | entry now reachable, now a fixture, or pointing at a deleted file |
| `WIRING_BASELINE_TESTS_GREW` | fail | test entries exceed `max_entries` |
| `WIRING_CAPABILITY_ORPHAN` | fail | active capability with zero executable references and no disposition |
| `WIRING_BASELINE_CAPABILITY_ENTRY_INCOMPLETE` | fail | as above, for capabilities |
| `WIRING_BASELINE_CAPABILITY_ENTRY_STALE` | fail | as above, for capabilities |
| `WIRING_BASELINE_CAPABILITIES_GREW` | fail | capability entries exceed `max_entries` |
| `WIRING_BASELINE_TEST_ENTRY_EXPIRED` | warn | past expiry — deliberately a warning, so a calendar date can never block every merge in the program |
| `WIRING_GLOB_SHADOWED` | warn | a `**` pattern whose shell expansion hides files |
| `AUTO_WIRING_TOOL_FAILURE` | fail | parser/tool defect, reported separately from implementation findings |

Tool and parser failures are held in `parser_errors` and surfaced as `[TOOL-FAILURE]`, so a broken parser can never be mistaken for a clean repository.

## 7. Receipts

`pnpm ops:automation-coverage-check --output <path> --json` persists a machine-readable report containing total test files, reachable/unreachable counts, the reachability path per file, capability counts and classifications, baseline sizes, newly unwired failures, and tool failures. The text mode prints the concise human summary.

Flags: `--wiring-baseline <path>` to point at an alternate ledger, `--no-wiring` to run the registry-only checks.

## 8. Non-goals

- Running all tests indiscriminately in every CI job.
- Classifying external-service or destructive tests as required without isolation.
- Deleting a test merely because it is currently unwired.
- Weakening existing verify, branch-protection or governance requirements.
