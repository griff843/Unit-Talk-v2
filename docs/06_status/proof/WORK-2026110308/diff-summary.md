# Diff summary: WORK-2026110308

Scope of the figures below: workflow files and the work order only, excluding `docs/06_status/**` and `.ops/sync/**`. They come from `git diff --stat origin/main...HEAD -- .github/ .ops/work/`.

```
 .github/workflows/post-merge-qa-gate.yml       |  2 +-
 .github/workflows/qa-experience-regression.yml |  2 +-
 .github/workflows/qa-fast.yml                  |  2 +-
 .github/workflows/staging-db-proof.yml         |  2 +-
 .ops/work/WORK-2026110308.md                   | 42 ++++++++++++++++++++++++++
 5 files changed, 46 insertions(+), 4 deletions(-)
```

| File | Change |
|---|---|
| `.github/workflows/qa-fast.yml` | `runs-on: ubuntu-latest` → `ubuntu-24.04` (:14) |
| `.github/workflows/qa-experience-regression.yml` | `runs-on: ubuntu-latest` → `ubuntu-24.04` (:16) |
| `.github/workflows/post-merge-qa-gate.yml` | `runs-on: ubuntu-latest` → `ubuntu-24.04` (:41) |
| `.github/workflows/staging-db-proof.yml` | `runs-on: ubuntu-latest` → `ubuntu-24.04` on the `staging-db-proof` job (:47). The `proof-auditor` job is unchanged. |
| `.ops/work/WORK-2026110308.md` | Repo-owned work order. |

## SHA Binding

Merge SHA: 1ba31df783f8e7ca36a27729b79be6a9c7461469
PR: https://github.com/griff843/Unit-Talk-v2/pull/1829
