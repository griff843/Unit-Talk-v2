# Stale Language Audit — D-CONST-8

## Search Terms Used

| Term | Files Searched | Hits in Target Files |
|---|---|---|
| `fail-open` | packages/db/CLAUDE.md, packages/contracts/CLAUDE.md | 1 (db/CLAUDE.md:37) |
| `fail open` | same | 0 |
| `fail_open` | same | 0 |
| `fallback` | same | 1 (db/CLAUDE.md:33 — InMemory test-only note; clarified) |
| `best effort` | same | 0 |
| `continues` | same | 0 |
| `warn only` | same | 0 |
| `advisory` | same | 0 |
| `non-blocking` | same | 0 |

## Authoritative Code State

File: `packages/db/src/writer-authority.ts`

```
/**
 * Asserts that the given writer role is authorized to write the given field.
 * Throws UnauthorizedWriterError if the role is not in the allowed list.
 * Unregistered fields are rejected (fail-closed) — every writable field must
 * be explicitly registered.
 */
export function assertFieldAuthority(field: string, writerRole: WriterRole): void {
  const authority = getFieldAuthority(field);
  if (!authority) {
    throw new UnauthorizedWriterError(field, writerRole, []); // fail-closed: unregistered fields are denied
  }
  if (!authority.allowedWriters.includes(writerRole)) {
    throw new UnauthorizedWriterError(field, writerRole, authority.allowedWriters);
  }
}
```

Code is definitively fail-closed. No changes made to this file.

## Stale Language Found and Corrected

### packages/db/CLAUDE.md — line 37 (before)
```
**Writer authority:** 5 fields have explicit write authorization ... Unregistered fields are fail-open.
```

### packages/db/CLAUDE.md (after)
```
**Writer authority:** 5 fields have explicit write authorization ... Unregistered fields are **fail-closed** — 
`assertFieldAuthority()` throws `UnauthorizedWriterError` for any unregistered or unauthorized field. 
Every writable field must be explicitly registered before it can be written. Missing authority, 
invalid writer role, or unregistered fields must throw — production write paths never silently bypass authority.
```

### packages/contracts/CLAUDE.md — missing section (before)
No Fail-Closed Authority Contract language present.

### packages/contracts/CLAUDE.md (after)
Added "Fail-Closed Authority Contract" section under Core Concepts explicitly stating:
- Authority checks throw on missing or invalid authority
- Unsupported privileged actions are denied by default
- Cross-domain writes require explicit writer role permit
- Dual-auth and approval-expiration rules are blocking enforcement

## Scope Confirmation: No Out-of-Scope Changes

- No changes to `packages/db/src/writer-authority.ts`
- No changes to any migration files
- No changes to scoring, promotion, or runtime product code
- No changes to proof gates or CI workflows (only constitution docs)
- No changes to database.types.ts (D-CONST-7 scope — handled by a separate standalone migration lane)
