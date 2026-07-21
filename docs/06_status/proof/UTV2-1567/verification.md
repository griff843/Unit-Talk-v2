# PROOF: UTV2-1567

MERGE_SHA: 7c25ed65

The SHA above is `main`'s HEAD at the time this lane branched, an ancestor
of the eventual PR merge commit — per this repo's accepted proof-binding
convention, a commit cannot embed the hash of the merge commit it will
later become part of.

## Verification

CI workflow logic only, no runtime/domain/DB code touched.

## ASSERTIONS:

- [x] `post-merge-lane-close.yml`'s "Resolve merge SHA" step resolves the real merge SHA via `gh pr view <pr_url> --json mergeCommit` for `workflow_dispatch`, not `github.sha`
- [x] The `push`-triggered path is unchanged (still uses `github.sha`, which is correct there)
- [x] "Bind proof artifacts to merge SHA" consumes `steps.resolve_sha.outputs.merge_sha`, not `github.sha` directly
- [x] Regression test added and passing: `scripts/ops/post-merge-lane-close-workflow.test.ts`
- [x] YAML parses validly
- [x] `pnpm verify` PASS

## EVIDENCE:

```text
$ npx tsx --test scripts/ops/post-merge-lane-close-workflow.test.ts
# tests 2
# pass 2
# fail 0
```

```text
$ node -e "yaml.parse(fs.readFileSync('.github/workflows/post-merge-lane-close.yml','utf8')); console.log('YAML valid')"
YAML valid
```

```text
$ pnpm verify
(exit code 0)
```

## Tier

T2 — CI workflow logic + regression test only.
