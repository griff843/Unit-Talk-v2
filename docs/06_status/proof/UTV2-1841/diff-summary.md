# DIFF SUMMARY: UTV2-1841

MERGE_SHA: pending merge
Execution SHA: c7b170b1ecd10548e6bfcad38f895a3f1b3ffa5e

```
 .github/workflows/deploy.yml | 2 +-
 1 file changed, 1 insertion(+), 1 deletion(-)
```

## `.github/workflows/deploy.yml`

One line, in the `verify` job's `Setup Node` step (line 48):

```diff
       - name: Setup Node
         uses: actions/setup-node@v4
         with:
-          node-version: 20
+          node-version: 22
           cache: pnpm
```

This is the only `setup-node` step in the workflow.

## What is deliberately unchanged

| Surface | State |
|---|---|
| `package.json` | untouched — declared in `file_scope_lock`, not needed |
| `apps/command-center/**` | untouched — the authentication assertion is preserved byte-for-byte |
| `deploy.yml` trigger | still `workflow_dispatch`-only; no change to when or whether a deploy fires |
| `deploy.yml` inputs, promote, smoke, rollback steps | unchanged |
| required checks, branch protection, CODEOWNERS, merge gate, tier semantics, approvals, bypasses | unchanged |

## Reserved-surface accounting

The diff touches `.github/workflows/`, which is a Tier C path and is owned by `@griff843` in
CODEOWNERS — hence tier T1 and a required PM verdict. The change inside it raises the verification
runtime to the repository's declared minimum. It removes no requirement, admits no candidate that
was previously refused on its merits, and grants no bypass: a candidate that fails the suite on
Node 22 still fails `Deploy`.
