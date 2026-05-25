# Execution-Location Policy And Routing

**Status:** Ratified  
**Authority:** PM + Orchestrator  
**Effective:** 2026-05-16  
**Registry authority:** UTV2-962 canonical lane registry at `docs/06_status/lanes/*.json`

---

## 1. Execution-location decision model: `main_checkout` vs `worktree`

This policy defines where a lane executes. It does not create a second routing registry. The only canonical lane record remains `docs/06_status/lanes/*.json`; this document defines how the registry fields must be interpreted and validated.

Decision inputs:
- `executor`
- `file_scope_lock`
- `execution_location`
- `worktree_path`

Decision outputs:
- `execution_location: "main_checkout"`
- `execution_location: "worktree"`

Deterministic routing model:

```json
{
  "decision_order": [
    "If operation is merge/control/closeout, route to main_checkout.",
    "Else inspect file_scope_lock.",
    "If any locked path matches a singleton-only glob, require serialized plan approval.",
    "Else if file scopes are disjoint from active lanes, route to worktree.",
    "Else reject the lane manifest as invalid."
  ]
}
```

Normative decision rule:

```json
{
  "route_to_main_checkout_when": [
    "operation is branch refresh",
    "operation is PR merge",
    "operation is Linear Done transition",
    "operation is lane closeout",
    "operation is orchestration reconcile"
  ],
  "route_to_worktree_when": [
    "operation is lane implementation",
    "file_scope_lock is disjoint from active lanes",
    "lane worktree has isolated install/build state"
  ],
  "otherwise": "reject"
}
```

`main_checkout` means the control/merge operation runs on the primary repository checkout at `C:\\Dev\\Unit-Talk-v2-main` or `/home/griff843/code/Unit-Talk-v2`. `worktree` means the lane implementation runs in a dedicated git worktree created for that lane.

---

## 2. Eligibility rules (machine-readable)

These rules are authoritative for routing. They must be evaluated from `file_scope_lock`; no operator judgment should override the glob outcomes without an explicit policy update.

```json
{
  "singleton_only_globs": [
    "supabase/migrations/**",
    "packages/contracts/src/**",
    "packages/domain/src/**",
    "packages/db/src/lifecycle.ts",
    "packages/db/src/repositories.ts",
    "packages/db/src/runtime-repositories.ts",
    "apps/api/src/distribution-service.ts",
    "apps/api/src/auth.ts",
    "apps/worker/**",
    "packages/db/src/database.types.ts"
  ],
  "worktree_eligible_globs": [
    "apps/**",
    "packages/**",
    "apps/command-center/**",
    "apps/discord-bot/**",
    "apps/smart-form/**",
    "apps/qa-agent/**",
    "docs/**",
    "scripts/**",
    ".claude/**",
    ".github/**"
  ],
  "executor_overrides": [
    {
      "operation": "merge/control",
      "execution_location": "main_checkout",
      "reason": "Merges, branch refreshes, Linear Done, closeout, and reconciliation are serialized."
    }
  ]
}
```

Interpretation rules:
- Normal implementation lanes are worktree-eligible when their `file_scope_lock` is disjoint from active lanes and no singleton-only path is present.
- Any `file_scope_lock` entry matching a singleton-only glob requires a serialized execution plan rather than default parallel dispatch.
- Package and runtime-adjacent lanes may use worktrees only with isolated install/build state.
- Mixed scopes are invalid for parallel dispatch if they overlap active lane locks or include singleton-only paths without approval.

Invalid worktree routing is therefore detectable by inspection:

```json
{
  "invalid_when": [
    "execution_location == 'worktree' and worktree_path == '.'",
    "execution_location == 'worktree' and any file_scope_lock entry overlaps an active lane",
    "execution_location == 'worktree' and any file_scope_lock entry matches a singleton_only_glob without approval",
    "execution_location == 'worktree' and any file_scope_lock entry matches no listed worktree-eligible glob"
  ]
}
```

---

## 3. Registry field definitions: `execution_location` and `worktree_path` fields for lane manifests

The lane manifest stored in `docs/06_status/lanes/*.json` is the canonical registry. This policy defines two fields that must be interpreted there; it does not create any duplicate manifest store.

`execution_location`
- Type: string enum
- Allowed values: `main_checkout`, `worktree`
- Required meaning:
  - `main_checkout` for control, merge, branch refresh, Linear Done, closeout, and reconciliation operations
  - `worktree` for normal parallel lane implementation

`worktree_path`
- Type: string
- Required when `execution_location == "main_checkout"`
- Required value for `main_checkout`: `.`
- Meaning: `"."` always points to the primary checkout root, not a separate worktree directory
- When `execution_location == "worktree"`, `worktree_path` must point to the created worktree path for that lane

Required field model:

```json
{
  "main_checkout_manifest_shape": {
    "execution_location": "main_checkout",
    "worktree_path": "."
  },
  "worktree_manifest_shape": {
    "execution_location": "worktree",
    "worktree_path": ".out/worktrees/<lane-branch>"
  }
}
```

Registry invariant:

```json
{
  "invariant": "If execution_location is main_checkout, worktree_path must equal '.'."
}
```

---

## 4. Validation rules: what checks must pass before a lane can use a worktree

A lane may use a worktree only if every validation below passes.

```json
{
  "worktree_validation_checks": [
    "file_scope_lock is present and non-empty",
    "every file_scope_lock entry matches one of the worktree_eligible_globs",
    "no file_scope_lock entry overlaps an active lane",
    "no file_scope_lock entry matches a singleton_only_glob without approval",
    "execution_location == 'worktree'",
    "worktree_path is present and worktree_path != '.'",
    "lane worktree uses isolated install/build state"
  ]
}
```

Required rejection cases:
- Reject if `file_scope_lock` overlaps an active lane.
- Reject parallel dispatch if `file_scope_lock` includes singleton-only paths without approval.
- Reject if `execution_location` claims `worktree` but `worktree_path` is missing.
- Reject if the manifest claims `worktree` for a scope outside the listed worktree-eligible globs.

Recommended manifest-level audit rule:

```json
{
  "audit_assertion": "execution_location == 'worktree' implies worktree_path != '.', disjoint file locks, and isolated install/build state"
}
```

---

## 5. Migration note: what existing lane-start behavior conflicts and how to resolve

Existing lane-start behavior conflicts in two ways:
- Older lane manifests use `worktree` or `worktree_path` without an explicit `execution_location` field.
- Older routing behavior may infer worktree eligibility from broad app/docs scope without enforcing the Codex override or the package-adjacent app exclusions.

Resolution:
- Treat `docs/06_status/lanes/*.json` from UTV2-962 as the only canonical registry and extend its lane manifest interpretation with `execution_location`; do not create a second routing file.
- When a lane record lacks `execution_location`, derive it once from `executor` plus `file_scope_lock`, then persist the normalized value back into the canonical registry workflow.
- Normalize all control/merge lanes to `execution_location = 'main_checkout'` and `worktree_path: "."`.
- Normalize normal parallel implementation lanes to `execution_location = 'worktree'` and a dedicated `.out/worktrees/...` path.

Migration normalization rule:

```json
{
  "legacy_manifest_resolution": [
    "If operation is merge/control/closeout/reconcile, set execution_location = 'main_checkout' and worktree_path = '.'.",
    "If lane implementation file locks are disjoint and no singleton-only path is present, set execution_location = 'worktree'.",
    "If a singleton-only path is present, require serialized execution plan approval.",
    "If the manifest cannot be classified from file_scope_lock, reject it for repair instead of guessing."
  ]
}
```

This resolves the current conflict between legacy lane-start assumptions and the ratified worktree isolation constraints while preserving a single source of lane truth in `docs/06_status/lanes/*.json`.
