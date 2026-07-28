# PROOF: UTV2-1614
MERGE_SHA: 60c9598ab1fcba915938986daa1bd50bd9b15d74

Bound to the code-only commit carrying the final state of every in-scope file.
Code and proof are separate commits so the proof names a SHA that actually
contains the code it describes.

## Summary

Adds `ops:proof-rebind`, a surgical SHA-rebinding operation for proof bundles,
because `ops:proof-generate --merge-sha` conflates GENERATE (template,
destructive) with REBIND (surgical) and has already destroyed a bundle.

This revision closes the fail-closed defects raised by the exact-head review of
the previous head. Nothing in it relaxes an existing refusal; every change either
adds a refusal or corrects a comparison that was made against the wrong value.

## ASSERTIONS:

- [x] The operation never templates; it rewrites only declared binding regions.
- [x] Every byte outside those regions is proven unchanged, including escape
      sequences, CRLF, and trailing-newline state.
- [x] Missing, duplicated or malformed canonical binding sections refuse.
- [x] Each canonical binding row is its own writable region; the section body is
      never replaced wholesale.
- [x] Additional narrative inside the section is preserved byte-for-byte, along
      with line order, blank lines, indentation, EOL convention and
      trailing-newline state.
- [x] The ORIGINAL top-level `MERGE_SHA:` value is captured and validated BEFORE
      any planned rewrite, and it is that original value the section row is
      compared against.
- [x] Matching stale top-level and section values are accepted as valid rebind
      input; contradictory concrete values refuse; a valueless or malformed
      top-level value refuses.
- [x] Every existing binding-row value is validated before it can be replaced:
      SHA rows must carry a 40-character SHA or a recognised pre-merge
      placeholder; the `PR:` row must carry a canonical GitHub pull-request URL,
      and one naming a different pull request refuses rather than being
      repointed. Malformed nonempty values refuse.
- [x] Missing required rows, duplicate rows and valueless rows all refuse.
- [x] An absent required JSON binding field refuses.
- [x] Raw duplicate-key detection covers EVERY writable JSON binding key,
      required and optional alike, scoped per object so sibling objects sharing
      a key name do not refuse.
- [x] The canonical PR URL is derived from the validated PR record and
      cross-checked; an independent caller-supplied URL is rejected outright.
- [x] `--apply` is impossible without a completed PR identity validation, and
      `--skip-pr-check` can never be combined with it.
- [x] The CLI always requests BOTH canonical artifacts — `evidence.json` and
      `verification.md` — so a bundle missing either refuses before any write
      instead of being partially rebound.
- [x] Each file is replaced by temp write, fsync, rename, then a directory
      fsync. A parent-directory open or fsync failure is propagated, so
      `proof_rebind_applied` can never be emitted over an unproven rename.
- [x] `restored_files` and `possibly_corrupted` are both derived from one final
      checksum verification of every touched file, making them mutually
      exclusive and exhaustive.
- [x] Every refusal path writes zero bytes.

## EVIDENCE:

### Durability, stated precisely

Per-file replacement is atomic. Bundle-level all-or-nothing holds against
JS-level failures only. SIGINT, SIGTERM, SIGKILL or host crash between two
renames can leave a partial bundle. No signal handler is installed because one
running mid-rename could interleave with the write it is undoing. Recovery is
deterministic: re-run the same command, the preview reports which files remain
stale, and `--apply` completes the transaction because a rebind is idempotent.

The directory fsync is what makes the rename durable. Its failure is now
propagated rather than swallowed: the run drops into the rollback path and
reports the failure. The rename has already taken effect in the page cache, so
the restore is still meaningful; what is withheld is only the unearned success
claim.

### Mutation verification

Every fix in this revision was reverted individually on a scratch copy of
`scripts/ops/proof-rebind.ts` and the suite re-run. Each revert fails, so no
assertion above is satisfied by a tautology:

| Reverted guard | Failing test | Suite |
|---|---|---|
| changed-line guard neutralised (`if (false)`) | `the changed-line guard refuses a real mutation that touches an undeclared line` | 44 pass / 1 fail |
| top-level `MERGE_SHA:` read back AFTER the rewrite | `the ORIGINAL top-level MERGE_SHA is captured before any rewrite`, `every existing binding-row value is validated before it can be replaced` | 43 pass / 2 fail |
| duplicate-key scan restricted to the required fields | `duplicate raw keys are detected for EVERY writable JSON binding, optional included` | 44 pass / 1 fail |
| directory open/fsync failure swallowed again | `a parent-directory open or fsync failure is PROPAGATED, never swallowed` | 44 pass / 1 fail |
| row-value malformed/foreign refusals removed | `every existing binding-row value is validated before it can be replaced` | 44 pass / 1 fail |
| CLI file list filtered back to files that exist | `the CLI always requests BOTH canonical artifacts, so a missing one refuses` | 44 pass / 1 fail |
| `restored_files` derived from a non-throwing restore call | `restored_files and possibly_corrupted are disjoint and both come from the final checksum pass` | 44 pass / 1 fail |

The guards carried over from the previous revision remain mutation-verified:
missing and duplicate binding section refusals, required-row and duplicate-row
validation, absent required JSON field refusal, PR URL shape and number
cross-checks, CRLF and trailing-newline preservation, execution-SHA validation,
the replay-equality guard, failing-file rollback tracking, the recovery-section
documentation, narrative preservation inside the section, and the byte-for-byte
mask that neutralises only the canonical rows.

The changed-line guard specifically replaces a tautological predecessor. That
test asserted only that the production path does not trip its own guard — true
by construction, and equally true with the guard deleted. The guard is now a
pure exported function driven with three real mutations: an undeclared narrative
line rewritten alongside the declared binding, a line deleted, and a line
appended past the end of the document. Each is refused; neutralising the guard
fails the test.

### Real-bundle receipts (preview only, nothing written)

Both runs are previews. `--apply` was not used, no `--apply` path was reached,
and `git status` reported both proof directories clean afterwards.

```
$ pnpm ops:proof-rebind --issue <PR-1311 lane> --pr 1311 \
    --merge-sha 5f4abb09113f33ec9ca5ba88ab639041c521c00e \
    --approved-head 07c123808aeb015eade6f934d43e190f219d3fa7
=> proof_rebind_refused
   verification.md: required "## Merge SHA Binding" section is absent — refusing;
   a rebind must never invent the canonical binding section
   checksums: sha256_before == sha256_after for both artifacts (changed: false)
```

That bundle heads its binding block `## SHA Binding`, not the canonical
`## Merge SHA Binding`. It stays refused until a separately governed
schema/evidence repair makes it canonical.

```
$ pnpm ops:proof-rebind --issue <PR-1313 lane> --pr 1313 \
    --merge-sha 2822b709c74c43dc24a50dc6df35597e1a0463fe \
    --approved-head e0464b519206ca63f707002ea91d91136750d797 \
    --execution-sha 6718c0de3c125beaa241bb8eb6937a7fa8e5f0bb
=> proof_rebind_preview, errors: [], changes: 5

  evidence.json     sha_binding.merge_sha
                      null -> 2822b709c74c43dc24a50dc6df35597e1a0463fe
  evidence.json     sha_binding.current_pr_head_sha
                      6718c0de… -> e0464b519206ca63f707002ea91d91136750d797
  evidence.json     static_proof.test_run_logs[0].merge_sha
                      null -> 2822b709c74c43dc24a50dc6df35597e1a0463fe
  verification.md   line 2 (MERGE_SHA:)
                      6718c0de… -> 2822b709c74c43dc24a50dc6df35597e1a0463fe
  verification.md   ## Merge SHA Binding > Merge SHA (line 280)
                      "pending merge" -> 2822b709c74c43dc24a50dc6df35597e1a0463fe
```

Exactly five binding changes, and no other byte moves. The previous revision's
proof described this bundle as refused because its binding section carries
explanatory prose; that statement was wrong and is retracted here. The section
body is never replaced wholesale — each canonical row is its own writable
region — so the prose is preserved and the preview succeeds.

Both real-bundle contracts are pinned as tests. They read the two bundles from
commit `2822b709c74c43dc24a50dc6df35597e1a0463fe` via `git show` rather than from
the working tree, so the assertions describe fixed historical artifacts and
cannot change meaning if either bundle is later legitimately rebound. The
five-change test additionally asserts that the line count is unchanged, that
exactly the declared lines differ, that the long `verified_source_note` narrative
is byte-identical, and that a narrative line reading
`Merge SHA: pending merge. This bundle is bound to …` — which sits OUTSIDE the
binding section and resembles a binding row — survives untouched.

## Verification

### Live-DB runtime proof

```
$ pnpm test:db
1..7
# tests 7
# suites 0
# pass 7
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 89363.166772
```

Live Supabase project `zfzdnfwdarxucxtaojxm`. This lane ships ops tooling with
no DB schema or query changes; `pnpm test:db` establishes that the live-DB suite
remains undisturbed. The suite writes its own fixture rows, which are test
artifacts and must be excluded from any production pick or settlement count.

Recorded honestly: the first run on this head failed 1 of 7 —
`UTV2-883: no duplicate participants for the same external_id and sport` with
`Failed to list participants by type: TypeError: fetch failed`, a transport-level
failure reaching Supabase. No file in this lane's scope touches the DB layer.
The immediate re-run above passed 7/7 with no code change. The failing run is not
claimed as a pass; the passing run is the runtime proof, and CI on the merge SHA
is authoritative.

### Static verification

```
$ pnpm type-check
(clean)

$ pnpm lint
(clean)

$ pnpm test:ops
# tests 1308
# pass 1308
# fail 0
# skipped 0
```

`test:ops` rose from 1299 to 1308 as the proof-rebind suite went from 36 to 45
assertions. `pnpm verify` covers lint, type-check, build and the full test suite.
Stages run sequentially because `verify:parallel` was OOM-killed locally
(exit 137); that is not a waiver, and CI on the merge SHA is authoritative.

### Scope

`scripts/ops/proof-rebind.ts`, its test, `package.json` test wiring, plus lane
apparatus. No proof bundle other than this lane's own is modified by this PR.

## Merge SHA Binding

Merge SHA: pending merge
PR: https://github.com/griff843/Unit-Talk-v2/pull/1315
