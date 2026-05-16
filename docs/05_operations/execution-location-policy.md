# Execution-Location Policy And Routing

**Status:** Ratified  
**Authority:** PM + Orchestrator  
**Effective:** 2026-05-16  
**Registry authority:** UTV2-962 canonical lane registry at `.claude/lanes.json`

---

## 1. Execution-location decision model: `main_checkout` vs `worktree`

This policy defines where a lane executes. It does not create a second routing registry. The only canonical lane record remains `.claude/lanes.json`; this document defines how the registry fields must be interpreted and validated.

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
    "If executor is Codex, route to main_checkout.",
    "Else inspect file_scope_lock.",
    "If any locked path matches a main_checkout-only glob, route to main_checkout.",
    "Else if all locked paths match worktree-eligible globs, route to worktree.",
    "Else reject the lane manifest as invalid."
  ]
}
```

Normative decision rule:

```json
{
  "route_to_main_checkout_when": [
    "executor == 'codex'",
    "file_scope_lock contains a path matching 'packages/**'",
    "file_scope_lock contains a path matching 'apps/api/**'",
    "file_scope_lock contains a path matching 'apps/worker/**'",
    "file_scope_lock contains a path matching 'apps/ingestor/**'"
  ],
  "route_to_worktree_when": [
    "executor == 'claude'",
    "every file_scope_lock entry matches a worktree-eligible glob"
  ],
  "otherwise": "reject"
}
```

`main_checkout` means the lane runs on the primary repository checkout at `C:\\Dev\\Unit-Talk-v2-main`. `worktree` means the lane may run in a dedicated git worktree created for that lane.

---

## 2. Eligibility rules (machine-readable)

These rules are authoritative for routing. They must be evaluated from `file_scope_lock`; no operator judgment should override the glob outcomes without an explicit policy update.

```json
{
  "main_checkout_only_globs": [
    "packages/**",
    "apps/api/**",
    "apps/worker/**",
    "apps/ingestor/**"
  ],
  "worktree_eligible_globs": [
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
      "executor": "codex",
      "execution_location": "main_checkout",
      "reason": "All Codex lanes run on the main checkout regardless of file scope."
    }
  ]
}
```

Interpretation rules:
- Any `file_scope_lock` entry matching `packages/**` forces `main_checkout`.
- Any `file_scope_lock` entry matching `apps/api/**`, `apps/worker/**`, or `apps/ingestor/**` forces `main_checkout` because those paths are package-adjacent.
- A lane is worktree-eligible only when every `file_scope_lock` entry matches one of the listed worktree-eligible globs and the executor is Claude.
- Mixed scopes are invalid for worktree routing if even one path falls under a `main_checkout_only_glob`.

Invalid worktree routing is therefore detectable by inspection:

```json
{
  "invalid_when": [
    "execution_location == 'worktree' and executor == 'codex'",
    "execution_location == 'worktree' and any file_scope_lock entry matches a main_checkout_only_glob",
    "execution_location == 'worktree' and any file_scope_lock entry matches no listed worktree-eligible glob"
  ]
}
```

---

## 3. Registry field definitions: `execution_location` and `worktree_path` fields for lane manifests

The lane manifest stored in `.claude/lanes.json` is the canonical registry. This policy defines two fields that must be interpreted there; it does not create any duplicate manifest store.

`execution_location`
- Type: string enum
- Allowed values: `main_checkout`, `worktree`
- Required meaning:
  - `main_checkout` for any lane touching `packages/*` or a package-adjacent app path
  - `worktree` only for app/docs/scripts-only scopes and only when the executor is Claude

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
    "worktree_path": ".worktrees/<lane-branch>"
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
    "executor == 'claude'",
    "file_scope_lock is present and non-empty",
    "every file_scope_lock entry matches one of the worktree_eligible_globs",
    "no file_scope_lock entry matches a main_checkout_only_glob",
    "execution_location == 'worktree'",
    "worktree_path is present and worktree_path != '.'"
  ]
}
```

Required rejection cases:
- Reject if `file_scope_lock` includes any `packages/**` path.
- Reject if `file_scope_lock` includes any `apps/api/**`, `apps/worker/**`, or `apps/ingestor/**` path.
- Reject if the executor is Codex.
- Reject if `execution_location` claims `worktree` but `worktree_path` is missing.
- Reject if the manifest claims `worktree` for a scope outside the listed worktree-eligible globs.

Recommended manifest-level audit rule:

```json
{
  "audit_assertion": "execution_location == 'worktree' implies executor == 'claude' and every file_scope_lock entry is worktree-eligible"
}
```

---

## 5. Migration note: what existing lane-start behavior conflicts and how to resolve

Existing lane-start behavior conflicts in two ways:
- Older lane manifests use `worktree` or `worktree_path` without an explicit `execution_location` field.
- Older routing behavior may infer worktree eligibility from broad app/docs scope without enforcing the Codex override or the package-adjacent app exclusions.

Resolution:
- Treat `.claude/lanes.json` from UTV2-962 as the only canonical registry and extend its lane manifest interpretation with `execution_location`; do not create a second routing file.
- When a lane record lacks `execution_location`, derive it once from `executor` plus `file_scope_lock`, then persist the normalized value back into the canonical registry workflow.
- Normalize all main-checkout lanes to `worktree_path: "."`.
- Reject any legacy manifest that routes Codex to a worktree or routes package/package-adjacent scope to a worktree.

Migration normalization rule:

```json
{
  "legacy_manifest_resolution": [
    "If executor == 'codex', set execution_location = 'main_checkout' and worktree_path = '.'.",
    "If any file_scope_lock entry matches a main_checkout_only_glob, set execution_location = 'main_checkout' and worktree_path = '.'.",
    "If executor == 'claude' and all file_scope_lock entries are worktree-eligible, execution_location may be 'worktree'.",
    "If the manifest cannot be classified from file_scope_lock, reject it for repair instead of guessing."
  ]
}
```

This resolves the current conflict between legacy lane-start assumptions and the ratified worktree isolation constraints while preserving a single source of lane truth in `.claude/lanes.json`.
