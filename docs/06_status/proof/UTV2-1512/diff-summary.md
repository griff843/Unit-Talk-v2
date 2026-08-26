# Diff summary — UTV2-1512

Branch: `claude/utv2-1512-supersede-status`
Implementation commit: `d60820bd`

## Files changed

| File | Change |
|---|---|
| `docs/06_status/lanes/UTV2-1512.json` | `status` `blocked` -> `superseded`; `heartbeat_at` restamped by the sanctioned transition |

One file, two fields. No source, test, migration, workflow, or configuration path is touched.

## Exact diff

```diff
-  "status": "blocked",
+  "status": "superseded",
   "started_at": "2026-07-08T17:00:01Z",
-  "heartbeat_at": "2026-07-09T05:15:00.000Z",
+  "heartbeat_at": "2026-08-26T19:13:36.615Z",
```

## Rationale

UTV2-1512 was superseded on 2026-07-14 by the merged Command Center v2 redesign (PR #1190,
`b0a9002b`). The manifest already recorded that outcome truthfully in its `superseded` block,
with `closed_at` set and PR #1173 closed **unmerged** at `d57d1023`. Only the lifecycle
`status` field was left at `blocked`.

Because `blocked` is not a terminal status, the lane still read as active and carried its
54-path `file_scope_lock` over `apps/command-center/**`. The manifest is tracked in **both**
`docs/06_status/lanes/` and `docs/06_status/lanes/parked/`, so the same lane was counted twice
and `ops:merge-risk` reported a `FILE_OVERLAP` block with `lanes: ["UTV2-1512","UTV2-1512"]`.
That self-overlap gated every dispatch at Phase 0 while overlapping no genuinely active lane.

`superseded` is a schema-valid non-success terminal status (`NON_SUCCESS_TERMINALS`,
`scripts/ops/shared.ts:448`).

## Explicitly not done

- The lane was **not** parked.
- Its historical scope was **not** narrowed.
- No completion was invented — the lane remains a non-success terminal.
- `main` was **not** edited directly; the change lands through this PR.
