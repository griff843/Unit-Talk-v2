# PROOF: UTV2-1614
MERGE_SHA: 179c3047b475b2551fe8237c03983b927da51c15

Bound to `179c3047b475b2551fe8237c03983b927da51c15`, the commit carrying the
final state of every in-scope file. Code and proof are separate commits so the
proof names a SHA that actually contains the code it describes. The production
change landed in the code-only commit `60c9598ab1fcba915938986daa1bd50bd9b15d74`;
`e829d2bb` was a test-only follow-up (see "CI-only repair" below) and `179c3047b475b2551fe8237c03983b927da51c15`
closes every finding of five successive adversarial exact-head reviews (see
the review sections below).

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

Both real-bundle contracts are locked as tests. They read the two bundles from
the WORKING TREE and are STATE-AWARE: the pre-rebind state asserts exactly five
binding changes with their locators and target SHAs, the post-rebind state
asserts a clean no-op, and an idempotency round-trip runs unconditionally. An
earlier revision pinned them to a commit via `git show` instead; that does not
resolve on the CI runner's shallow checkout, and the repair is described under
"CI-only repair" below. The five-change test additionally asserts that the line
count is unchanged, that exactly the declared lines differ, that the long
`verified_source_note` narrative is byte-identical, and that a narrative line
reading `Merge SHA: pending merge. This bundle is bound to …` — which sits
OUTSIDE the binding section and resembles a binding row — survives untouched.

<!-- CLAIM: fixture-resolution = working-tree -->

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
# duration_ms 92747.662803
```

Live Supabase project `zfzdnfwdarxucxtaojxm`. This lane ships ops tooling with
no DB schema or query changes; `pnpm test:db` establishes that the live-DB suite
remains undisturbed. The suite writes its own fixture rows, which are test
artifacts and must be excluded from any production pick or settlement count.

Recorded honestly: an earlier run on this branch failed 1 of 7 —
`UTV2-883: no duplicate participants for the same external_id and sport` with
`Failed to list participants by type: TypeError: fetch failed`, a transport-level
failure reaching Supabase. No file in this lane's scope touches the DB layer.
Every subsequent run, including the one above, passed 7/7 with no code change.
The failing run is not claimed as a pass; the passing run is the runtime proof,
and CI on the merge SHA is authoritative.

### Static verification

```
$ pnpm type-check
(clean)

$ pnpm lint
(clean)

$ pnpm test:ops
# tests 1334
# pass 1334
# fail 0
# skipped 0
```

`test:ops` rose from 1299 to 1334 as the proof-rebind suite went from 36 to 71
assertions. `pnpm verify` covers lint, type-check, build and the full test suite.
Stages run sequentially because `verify:parallel` was OOM-killed locally
(exit 137); that is not a waiver, and CI on the merge SHA is authoritative.

### CI-only repair after the first CI run

The first CI run on this branch failed `verify` with 2 of 1308 tests erroring.
Both were the real-bundle contract tests, and the cause was the tests, not the
tool: they read the two bundles via `git show <pinned-commit>:path` so they would
describe a fixed historical artifact rather than whatever the working tree
happens to hold. That resolves on a full local clone and does NOT resolve on the
CI runner, where `actions/checkout@v4` defaults to `fetch-depth: 1` and the
pinned commit is only a shallow boundary — both tests errored with
`exists on disk, but not in <sha>`.

The self-invalidation hazard those tests were guarding against is real: a test
that reads the working tree quietly changes meaning once the bundle it describes
is legitimately rebound. That is now handled by making each contract
STATE-AWARE rather than pinned. The pre-rebind state asserts exactly five binding
changes with their locators and target SHAs; the post-rebind state asserts a
clean no-op. Whichever state the bundle is in, the other branch is the one that
would have to be wrong, and the state is derived from the bundle itself, so
neither branch can pass vacuously.

An idempotency round-trip now also runs unconditionally: the planned output is
fed straight back in and must yield zero changes and zero errors. That is a
direct proof of the recovery path documented under PARTIAL-BUNDLE RECOVERY — a
re-run completes an interrupted transaction without double-applying — and it
keeps the post-rebind branch from ever being dead code.

Re-verified on `e829d2bb`: `pnpm type-check` clean, `pnpm lint` clean,
`pnpm test:ops` 1308 pass / 0 fail. No production code changed.

### Adversarial exact-head review of `e550a7cd`, and what it changed

An independent exact-head review (`codex exec`, `gpt-5.6-sol`, effort `high`,
run in a detached worktree pinned to `e550a7cd`, prompted to refute every claim
and to default to REJECT) returned **REJECT** with six P1 defects, one P2, and
three tests it measured as tautological. Every one is closed on this head. The
review confirmed four of the eight claims were already sound: the original
top-level `MERGE_SHA:` capture, both canonical artifacts always being requested,
directory open/fsync propagation, and the single-pass rollback partition.

| Finding | Closed by |
|---|---|
| P1 a binding row inside a fenced code block is rewritten, and the mask hides it because it neutralises the same line on both sides | fenced lines are never writable; a fence-only row refuses as a missing required row, a fenced example beside a real row is neither rewritten nor counted as a duplicate, an unterminated fence fails closed |
| P1 invalid UTF-8 is silently normalised, so `sha256_before` describes text that was never on disk and a write-back would rewrite bytes outside every binding region | reads are strict; a lossy decode refuses with no checksum recorded and the bytes untouched |
| P1 a duplicate key spelled with a JSON escape bypasses raw duplicate detection | the scanner decodes escapes, so both spellings count as one key, with no false positive for escapes inside narrative values |
| P1 malformed JSON binding values are overwritten without validation | JSON fields follow the same rule the markdown rows already did, including a named-type refusal for non-strings |
| P1 unbalanced markdown ticks are accepted and erased | ticks are stripped only when balanced; otherwise the value stays unstripped and classifies malformed |
| P1 an unvalidated `--issue` permits path traversal outside `docs/06_status/proof` | the CLI requires `UTV2-NNN` or `UNI-NNN` |
| P2 the canonical PR URL shape accepts noncanonical owner/repo components | tightened to real GitHub owner/repo character classes and a non-zero-padded PR number |
| Tautological: deleting the mask comparison, and deleting the changed-line guard's planner call, each left the suite green at 45/45 | both guards are exported and driven with real mutations; the source-text assertion about the mask's shape is deleted |

On the last item, stated plainly rather than papered over: neither guard can be
tripped from the production path — the planner only edits regions the mask
neutralises, and a token replacement never changes more lines than it declares.
So a test that runs the planner and asserts no error proves nothing. Their
BEHAVIOUR is now proven behaviourally against mutated documents, and their being
CALLED is proven by asserting the planner bodies contain the calls. Running the
review's own two mutations (`mut-mask`, `mut-line`) against this head now fails
the suite where it previously passed 45/45.

One review line needs context: `worktree-clean=no` reported `?? node_modules`.
That is a symlink created by the harness to give the detached review worktree a
dependency tree; it is not part of the PR and no tracked file was modified.

### Second adversarial exact-head review, and what it changed

The fixes above were re-reviewed independently at the next head under the same
protocol, with the reviewer explicitly asked to re-run its own two prior
mutations and to hunt for defects the fixes had introduced. It returned
**REJECT** again, and it was right to: four of the fixes were themselves
fail-open at their edges. All are closed here, each mutation-verified.

| Finding | Closed by |
|---|---|
| P1 a longer opening code fence could be closed by a SHORTER line, so rows genuinely still inside the fence read as writable | a closing fence must use the same character, be at least as long as the opening run, and carry nothing but whitespace |
| P1 a row inside a FOUR-SPACE INDENTED code block was writable | writable rows are capped at three spaces of indent, matching markdown's own rule that four spaces begins a code block |
| P1 an INDENTED next-section heading did not end the binding section, so a row belonging to a LATER section became writable | section-heading detection allows the three leading spaces markdown permits |
| P1 array bindings bypassed the malformed-value rule the dotted fields enforce, so prose in `test_run_logs[].merge_sha` was overwritten with zero errors | the array loop applies the identical rule |
| P2 the exported byte guard normalised line endings, so a CRLF-to-LF rewrite of non-binding bytes masked identically on both sides and the guard returned null | the mask preserves line terminators exactly; the planner's separate CRLF check was covering this only inside the planner |
| P2 the canonical PR URL accepted invalid owner forms such as `a_b` and `a-` | owner and repository use GitHub's real character classes |
| Tautological: the changed-line guard's OWN test stayed green when the planner call was deleted — only a separate test caught it | each guard now carries its own wiring assertion, so deleting either call fails the test that claims to cover it |

The review confirmed ten of the sixteen claims held outright, including all
seven carried forward from the first review's confirmations. The planner and the
mask now share one row pattern and one heading rule, so the region the edit may
touch and the region the mask compares cannot drift apart — which is what let
three of these four cases exist in the first place.

Two of these were found and closed before the review reported them, by probing
the same surfaces it named while it was still running; the review's independent
findings are what confirmed them, and its remaining findings are what this head
adds. Recording that rather than presenting all of them as review-driven.

### Third adversarial exact-head review, and what it changed

Re-reviewed independently again at the next head, with the reviewer asked to
re-run its predecessors' mutations and to attack the newly-shared row pattern
and heading rule directly — that sharing is what three earlier findings had
exploited. It returned **REJECT** with three P1s, two P2s and one more
tautological test. All are closed here.

| Finding | Closed by |
|---|---|
| P1 a TAB-delimited heading (`##<tab>Appendix`) did not end the binding section, so the appendix's rows became writable and the shared mask concealed the rewrite | section-end detection accepts any ATX level delimited by a space or a tab |
| P1 binding-looking narrative inside an HTML `<pre>` block, or on an indented list continuation, was rewritten | `<pre>` is a verbatim region alongside code fences, and a writable row must be UNINDENTED |
| P1 a DUPLICATED CONTAINER evaded duplicate detection, which examined only leaf keys — two `sha_binding` objects read as already-bound, returned a clean no-op, and left the stale one in the file | every segment of every binding path is checked, not just the leaf |
| P2 the changed-line guard is LINE-granular, so a byte added or removed on a line that legitimately changed slipped past it | the total byte delta must equal the sum of the declared token deltas exactly |
| P2 the canonical PR owner accepted consecutive hyphens and over-length owners | GitHub's real owner rule: single hyphens, never leading/trailing/consecutive, at most 39 characters |
| Tautological: "PR identity is validated before any write" exercised only the pure validator, so disabling the CLI's own apply-without-validation gate left it green | the CLI is driven directly — `--apply` with no `--pr`, `--apply --skip-pr-check`, and `--pr-url` all refuse, each asserted to write zero bytes |

The asymmetry this settled is worth stating, because it is the rule that
prevents the whole class: **anything that SHRINKS the writable region is
permissive, anything that GROWS it is strict.** Section-END detection accepts
any heading level, any legal indent, space or tab — recognising more headings
ends the section earlier. The canonical ANCHOR must be exact and unindented, and
a writable row must be at column zero. One to three spaces is a list
continuation and four or more is an indented code block; rather than try to tell
them apart, only column zero counts, which is where every real bundle writes its
rows.


### Fourth adversarial exact-head review, and what it changed

Re-reviewed independently again, with the reviewer asked to attack the
permissive/strict asymmetry directly and to reproduce the regression sweep
itself. It returned **REJECT** with three P1s and two P2s. One of them
invalidated a claim made in the previous head's own proof, corrected below
rather than restated.

| Finding | Closed by |
|---|---|
| P1 SETEXT headings did not end the binding section — a row under `Appendix` / `--------` became writable and the mask concealed it | the section ends at the setext heading's text line; a setext underline inside a verbatim region is not a heading |
| P1 HTML comments were not verbatim — a binding-looking line inside `<!-- -->` was rewritten with zero errors and masked | comments join code fences and `<pre>` as verbatim regions |
| P1 an inline-code MENTION of a `<pre>` tag was read as an opening tag, leaving the rest of the document permanently inside an unterminated block | inline code spans are stripped before scanning for HTML tags |
| P2 the canonical PR owner bounded component repetitions rather than total length, so a 41-character hyphenated owner passed | the cap is on characters |
| P2 the placeholder set rejected `set-by-ci`, which the repository EXPLICITLY allows and 25 real bundles store | the set is the union of the two canonical sources, asserted by a test that reads both files |

The last one is the most important, because it is the first finding in this
chain where the tool was too STRICT rather than too permissive, and it was
reachable only because of a gap in this bundle's own verification. `set-by-ci`
is a CI-resolved sentinel declared in `packages/invariants/src/merge-sha-binding.ts`
and `scripts/ci/proof-binding-validator.ts`; both explicitly allow it to be
stored and resolve it at runtime. Refusing it would have blocked 25 real
bundles. The alignment is now enforced by a test that reads those two files and
asserts this set is a superset of both, rather than by a comment.

### Regression sweep — corrected and widened

The previous head claimed "397 of 397 bundles unchanged". That claim was wrong
in two ways, both found by the review rather than by me, and both are recorded
here rather than quietly fixed:

1. It covered only `verification.md`. `evidence.json` — where the sentinel
   values live — was never swept. That is exactly how the `set-by-ci`
   over-strictness went unnoticed.
2. It stopped being true for its own head. That head's proof bundle documents
   the `<pre>` rule and mentions the tag in prose, so the inline-mention defect
   caused the tool to newly refuse its own bundle.

The sweep now covers all 591 artifacts and classifies each properly, instead of
reporting any change in the error set as a new refusal:

```
artifacts compared: 591   (verification.md: 397   evidence.json: 194)

  IDENTICAL                    574
  NEWLY PLANNED                  6   5 bundles carrying set-by-ci, plus this
                                     lane's own bundle, unblocked by the fixes
  SAME VERDICT, FEWER ERRORS    11   still refused for a pre-existing structural
                                     reason; only the set-by-ci class dropped
  NEWLY REFUSED                  0
```

Preview only; `git status` reported the proof directories clean afterwards.

### Fifth adversarial exact-head review, and what it changed

Re-reviewed independently again. It returned **REJECT** with three P1s and three
P2s — including two defects in this bundle's own claims, corrected rather than
restated.

| Finding | Closed by |
|---|---|
| P1 FENCE PRECEDENCE — the scanner looked for HTML tags and comment openers BEFORE the fence opener, so a fence whose info string named a tag never opened, every row inside became writable, and the mask agreed so the rewrite was concealed | the scanner is an explicit state machine; a fence opener wins at the top level |
| P1 EMPTY ATX HEADINGS — a bare hash run with no text is a legal heading, but whitespace was required after it, so the section ran past it | any level, any legal indent, space, tab, or end-of-line |
| P1 RAW HTML BLOCKS were recognised only for the pre tag — script, style and textarea also render literally | all four literal-content tags are verbatim; div and friends remain ordinary markdown |
| P2 TEMP FILE CLEANUP — the temp was unlinked only after a RENAME failure, so a failure during write, fsync or close left a stray rebind temp file beside the artifact, unreported and mistakable for evidence | the temp is removed on every failure path |
| P2 STALE PROOF CLAIMS — this bundle asserted the real-bundle tests resolve fixtures against a pinned commit, true of an earlier revision and false since | checkable claims carry machine-readable tags that a test verifies against the implementation |
| P2 ARTIFACT DISCOVERY was one level deep, so the sweep reported 591 artifacts when there are 593 | discovery is recursive |

The stale-claim finding deserves its own note, because it is a defect in this
document rather than in the tool. Prose matching cannot distinguish a live claim
from an accurate description of what an earlier revision did, so the claims that
CAN be checked now carry machine-readable tags, and a test verifies each against
the implementation: the fixture-resolution mechanism, and the proof-rebind
assertion count in BOTH proof artifacts. That test failed against the live
narrative when it was written — which is how the stale claim was confirmed
rather than assumed — and it fails again on any future drift.

### Regression sweep — recursive, 593 artifacts

The previous sweep walked one directory level. Two evidence bundles nest one
level deeper, so the real artifact count is 593, not 591. Discovery is now
recursive, and the omission is demonstrated rather than asserted:

```
RECURSIVE artifacts: 593   (verification.md: 397   evidence.json: 196)
NON-RECURSIVE would have found: 591
  -> MISSED: 2 nested evidence.json bundles under a drift-evidence subdirectory

  IDENTICAL                    593
  NEWLY REFUSED                  0
  NEWLY PLANNED                  0
  SAME VERDICT, FEWER ERRORS     0
```

Every one of the 593 artifacts plans identically before and after this
revision's fixes. Preview only; nothing was written.

### Scope

`scripts/ops/proof-rebind.ts`, its test, `package.json` test wiring, plus lane
apparatus. No proof bundle other than this lane's own is modified by this PR.

## Merge SHA Binding

Merge SHA: pending merge
PR: https://github.com/griff843/Unit-Talk-v2/pull/1315
