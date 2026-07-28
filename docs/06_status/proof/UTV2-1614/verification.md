# PROOF: UTV2-1614
MERGE_SHA: dffed9ea5dc336b047054490c8acc976ef375424

Bound to the code-only commit carrying the final state of every in-scope file.
Code and proof are separate commits so the proof names a SHA that actually
contains the code it describes.

## Summary

Adds `ops:proof-rebind`, a surgical SHA-rebinding operation for proof bundles,
because `ops:proof-generate --merge-sha` conflates GENERATE (template,
destructive) with REBIND (surgical) and has already destroyed a bundle.

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
- [x] Missing required rows, duplicate rows, valueless rows and a row
      contradicting the top-level MERGE_SHA line all refuse.
- [x] An absent required JSON binding field refuses.
- [x] The same required key twice inside one object refuses; sibling objects
      sharing a key name do not.
- [x] The canonical PR URL is derived from the validated PR record and
      cross-checked; an independent caller-supplied URL is rejected outright.
- [x] `--apply` is impossible without a completed PR identity validation, and
      `--skip-pr-check` can never be combined with it.
- [x] Each file is replaced by temp write, fsync, rename, then a directory fsync.
- [x] `possibly_corrupted` is derived from a final checksum verification of every
      touched file.
- [x] Every refusal path writes zero bytes.

## EVIDENCE:

### Durability, stated precisely

Per-file replacement is atomic. Bundle-level all-or-nothing holds against
JS-level failures only. SIGINT, SIGTERM, SIGKILL or host crash between two
renames can leave a partial bundle. No signal handler is installed because one
running mid-rename could interleave with the write it is undoing. Recovery is
deterministic: re-run the same command, the preview reports which files remain
stale, and `--apply` completes the transaction because a rebind is idempotent.

### Mutation verification

Twelve guards reverted individually; every one fails the suite:

| Guard | Result |
|---|---|
| missing binding section refusal | fails |
| duplicate binding section refusal | fails |
| required-row validation | fails |
| duplicate-row validation | fails |
| unrelated-content validation | fails |
| duplicate JSON key detection | fails |
| absent required JSON field refusal | fails |
| PR URL shape check | fails |
| PR URL number cross-check | fails |
| CRLF preservation | fails |
| trailing-newline preservation | fails |
| execution SHA validation | fails |
| replay-equality guard | fails |
| failing-file rollback tracking | fails |
| checksum-derived possibly_corrupted | fails |
| directory fsync | fails |
| recovery-section documentation | fails |
| narrative stripped from the section | fails |
| byte-for-byte guard masks the whole body | fails |

### Real-bundle receipts (preview only, nothing written)

- **Destructive-regeneration fixture bundle** -> `proof_rebind_refused`:
  required binding section absent. Stays refused until a separately governed
  schema/evidence repair makes it canonical.
- **Containment lane bundle** -> `proof_rebind_refused`: its binding section
  carries three lines of explanatory prose, which the new full-section
  validation refuses to destroy. Five binding changes are still computed and
  reported. See the note below.

All bundle files verified byte-identical after both runs.

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
# duration_ms 96618.57088
```

Live Supabase project `zfzdnfwdarxucxtaojxm`. This lane ships ops tooling with
no DB schema or query changes; `pnpm test:db` establishes that the live-DB suite
remains undisturbed. The suite writes its own fixture rows, which are test
artifacts and must be excluded from any production pick or settlement count.

### Static verification

```
$ pnpm type-check
(clean)

$ pnpm lint
(clean)

$ pnpm test:ops
# tests 1299
# pass 1299
# fail 0
```

`pnpm verify` covers lint, type-check, build and the full test suite. Stages run
sequentially because `verify:parallel` was OOM-killed locally (exit 137); that is
not a waiver, and CI on the merge SHA is authoritative.

### Scope

`scripts/ops/proof-rebind.ts`, its test, `package.json` test wiring, plus lane
apparatus. No incident bundle is rebound by this PR.

## Merge SHA Binding

Merge SHA: pending merge
PR: https://github.com/griff843/Unit-Talk-v2/pull/1315
