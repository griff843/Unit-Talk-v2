# Diff summary: WORK-2026102906

Implementation files, from `git diff --stat origin/main...8663a9a7d -- docs/05_operations/policies scripts .ops/work`:

```
 .ops/work/WORK-2026102906.md                       | 39 +++++++++++
 .../policies/codex-model-routing.json              | 24 +++----
 scripts/ops/codex-exec.test.ts                     |  7 +-
 scripts/ops/lane-manifest.test.ts                  | 41 +++++++++++-
 scripts/ops/lane-manifest.ts                       | 50 ++++++++++++++
 scripts/ops/model-routing.test.ts                  | 78 +++++++++++++++++++++-
 scripts/ops/model-routing.ts                       | 62 ++++++++++++++++-
 7 files changed, 282 insertions(+), 19 deletions(-)
```

| File | Change |
|---|---|
| `docs/05_operations/policies/codex-model-routing.json` | Policy 3.0.0: `gpt-6-luna` and `gpt-6.1-sol` replace the 5.6 slugs in every profile and in the effort catalog; `verified_against` updated. Profiles, tiers, efforts and enabled flags unchanged. |
| `scripts/ops/model-routing.ts` | `reResolveModelRouting` and the `RoutingReResolution` record (`model_routing.re_resolutions`). The `POLICY_VERSION_MISMATCH` message names the command. |
| `scripts/ops/lane-manifest.ts` | `re-resolve-routing <ID> [--json]` subcommand and usage line. |
| `scripts/ops/model-routing.test.ts` | Re-resolution, history, refusal and adversarial no-substitution tests. |
| `scripts/ops/lane-manifest.test.ts` | Command-level write, refusal and no-write-on-refusal tests. |
| `scripts/ops/codex-exec.test.ts` | Expected model ids follow the 3.0.0 policy. |
| `.ops/work/WORK-2026102906.md` | The lane's repo-owned work order. |

Lane metadata (`.ops/sync/`, `docs/06_status/lanes/`, `docs/06_status/proof/`) is excluded from the figure above.

## SHA Binding

Merge SHA: pending merge
PR: pending
