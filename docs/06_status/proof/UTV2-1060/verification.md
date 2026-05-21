# UTV2-1060 Verification

**Issue:** UTV2-1060 — Reassess stale required-check pollution  
**Tier:** T2  
**Branch:** `claude/utv2-1060-stale-check-pollution`  
**Verified:** 2026-05-21  
**Merge SHA:** b1c97d27782544f2ad8c41bfaf961c6d498b9531

## Verification

### Root cause confirmed

The Proof Auditor Gate (`proof-auditor-gate.yml`) ran `git diff --name-only` on the PR diff, which includes deleted files. When closed-lane proof directories were removed from `main` after a lane close, those paths appeared in the diff. The gate tried to audit non-existent directories, producing:

```
Proof dir does not exist: docs/06_status/proof/UTV2-1011
Proof dir does not exist: docs/06_status/proof/UTV2-1035
```

### Fix verified

Added `--diff-filter=ACM` (Added/Copied/Modified only) to the `git diff` command. Confirmed via:

```bash
pnpm type-check
```
Result: PASS (no workflow YAML to typecheck; TS project check exits 0)

```bash
pnpm test
```
Result: PASS — 481 tests, 0 fail

```bash
pnpm lint
```
Result: PASS

### Evidence

- PR #825 (UTV2-1064) — before fix: Proof Auditor Gate FAIL (deleted proof dirs)
- After `--diff-filter=ACM` applied: Proof Auditor Gate PASS on UTV2-1064 PR
- No false negatives: newly added proof directories still audited (ACM includes Added)

## R-level

No runtime, migration, or modeling rules triggered. CI workflow change only.
