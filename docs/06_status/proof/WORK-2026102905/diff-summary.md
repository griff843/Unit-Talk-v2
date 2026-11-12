# Diff summary: WORK-2026102905

Implementation files, from `git diff --stat origin/main...0b000e563 -- .github scripts .ops/work`:

```
 .github/workflows/close-eligibility-preflight.yml |  2 +-
 .github/workflows/proof-gate.yml                  | 13 ++--
 .ops/work/WORK-2026102905.md                      | 42 +++++++++++++
 scripts/ops/workflow-hardening.test.ts            | 75 +++++++++++++++++++++++
 4 files changed, 126 insertions(+), 6 deletions(-)
```

| File | Change |
|---|---|
| `.github/workflows/close-eligibility-preflight.yml` | The branch match in "Evaluate close eligibility" is `(utv2\|uni\|work)-[0-9]+`. |
| `.github/workflows/proof-gate.yml` | "Detect issue ID" and "Extract issue ID" match `(utv2\|uni\|work)-[0-9]+` and read the branch from `env:` instead of `${{ }}` substitution. The proof-auditor job's proof-dir match covers `work`. |
| `scripts/ops/workflow-hardening.test.ts` | Runs the three resolve steps with bash, as written, for WORK, UTV2, UNI and no-id branches, and asserts that the two `proof-gate.yml` steps contain no `${{`. |
| `.ops/work/WORK-2026102905.md` | The lane's repo-owned work order. |

Lane metadata (`.ops/sync/`, `docs/06_status/lanes/`, `docs/06_status/proof/`) is excluded from the figure above.

## SHA Binding

Merge SHA: 104185674f639dabebcef104d68b17158de5230f
PR: https://github.com/griff843/Unit-Talk-v2/pull/1804
