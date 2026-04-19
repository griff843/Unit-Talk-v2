# UTV2-671 Diff Summary — Fibery sync client fix

## What changed

### Updated: `scripts/ops/fibery-client.ts`

Three bugs were discovered and fixed through live API validation against UTV2-668 (a known-existing Fibery entity).

---

#### Bug 1: `resolveEntity` — wrong payload shape (entity never resolved)

**Root cause:** The Fibery `/api/commands` response wraps each command result in an envelope:
```json
[{ "success": true, "result": [...entities] }]
```

The old code accessed `payload[0]` expecting an array directly, but got the envelope object. `Array.isArray(payload[0])` was always `false`, so `firstResult` was always `undefined`, and every live entity lookup threw "Fibery entity not found".

**Fix:** Access `envelope.result[0]` via the success-checked envelope:
```typescript
const envelope = payload[0] as { success?: boolean; result?: unknown[] } | undefined;
if (!envelope?.success) throw new Error(...);
const firstResult = Array.isArray(envelope.result) ? envelope.result[0] : undefined;
```

---

#### Bug 2: `appendNote` — Document fields cannot be selected or updated via entity API

**Root cause:** All note fields (`Unit Talk/Description`, `Unit Talk/Notes`) are typed as `Collaboration~Documents/Document` in the Fibery schema — not primitive fields. Querying them via `q/select` returns `entity.error/query-primitive-field-expr-invalid`. Updating them via `fibery.entity/update` has no effect.

**Correct API:** `GET /api/documents/<fibery-id>` reads content; `PUT /api/documents/<secret>` writes it. Both confirmed working with `200 true`.

**Fix:** Remove `note_field` from `resolveEntity` select. After resolving entity ID, use the REST document API to read current content and write the appended content.

---

#### Bug 3: `setState` — workflow state is a relation, not a string

**Root cause:** `workflow/state` is a relation to a `workflow/state_Unit Talk/Issue` entity. Passing a string `"Done"` to `fibery.entity/update` throws `entity.error/parse-entity-field-failed: "Entity reference should contain fibery/id key"`.

**Correct API:** Must pass `{ 'fibery/id': '<state-entity-id>' }`. State IDs are stable (e.g., "Done" = `019d9626-c37f-72ba-807f-4e760d35d277`).

**Fix:** Added `resolveStateId(entityType, stateName)` — queries `workflow/state_{entityType}` by `enum/name` to get the `fibery/id`, then passes the reference object to `updateEntity`.

---

## Live validation result (against UTV2-668)

```json
{
  "ok": true,
  "code": "fibery_sync_complete",
  "event": "pr_open",
  "results": [
    { "operation": "append_note", "detail": "appended note to Unit Talk/Issue UTV2-668 via document REST API" },
    { "operation": "set_state",   "detail": "set Unit Talk/Issue UTV2-668 to In Review" }
  ],
  "errors": []
}
```

Note confirmed written to Fibery document field. State confirmed updated to "In Review". Sync proven end-to-end.

## Missing Fibery entities (still need seeding)

| Issue | Status |
|---|---|
| UTV2-660 | MISSING — needs seeding |
| UTV2-665 | MISSING — needs seeding |
| UTV2-669 | MISSING — needs seeding |
| UTV2-670 | MISSING — needs seeding |
| UTV2-671 | MISSING — needs seeding |

UTV2-648, UTV2-652, UTV2-668 confirmed present.
