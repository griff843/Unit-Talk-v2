# PROOF: WORK-2026091001

MERGE_SHA: pending merge
Execution SHA: cf256a0478f54200e0d73ec4a246e2ff5bc4b097
PR: https://github.com/griff843/Unit-Talk-v2/pull/1556

## Summary

Ordinary non-P0 declarations use the existing repository tier without a second PM gate. Historical and trusted-base positive P0 obligations, unresolved-classification refusal, and existing tier review remain. The lane is bound through ops:lane-link-pr; files_changed is populated through ops:lane-manifest update. Required proof was generated through ops:proof-generate and populated from measured results.

## ASSERTIONS:

- [x] Ordinary applicability no longer adds universal exact-head PM approval.
- [x] Historical/base P0, proper tier approvals and unresolved refusal remain.
- [x] Lane binding and measured proof are present.
- [x] Return-review packet honors existing authenticated, exact-head scope overrides.
- [ ] Reserved scope/T1 integration approvals are issued.
- [ ] Consumer activation and real ordinary/existing PR integration and closeout are proven.

## EVIDENCE:

The source at cf256a0478f54200e0d73ec4a246e2ff5bc4b097 produced 6414 passing tests, zero test failures, and zero reported skips, across 6414 reported. Static, build, test and command checks passed. pnpm verify exits 1 at its staging target guard; this is not a full gate pass. No staging credentials entered fixtures. Smart Form browser E2E was not enabled.

## Verification

```text
$ pnpm verify
[lint-migrations] Skipping schema baseline replay-root 00000000000000_baseline_live_schema.sql (snapshot, not a forward migration; fidelity verified by Live Schema Parity).
[lint-migrations] 134 migration file(s) checked — no findings.

> @unit-talk/v2@0.1.0 test:live-db /home/griff843/code/Unit-Talk-v2/.out/worktrees/codex__work-2026091001-tracker-independence
> pnpm test:db && pnpm test:t1-proof:live


> @unit-talk/v2@0.1.0 test:db /home/griff843/code/Unit-Talk-v2/.out/worktrees/codex__work-2026091001-tracker-independence
> pnpm ci:assert-staging && tsx --test apps/api/src/database-smoke.test.ts


> @unit-talk/v2@0.1.0 ci:assert-staging /home/griff843/code/Unit-Talk-v2/.out/worktrees/codex__work-2026091001-tracker-independence
> tsx scripts/ci/assert-staging-target.ts

[assert-staging] host=127.0.0.1 ref=unidentified expected=xskgrzbteyqdufktjrjx
[assert-staging] REFUSED: target identity could not be resolved from its URL (host=127.0.0.1). Writable DB verification requires xskgrzbteyqdufktjrjx. Run it through the staging-ci GitHub environment with CI_SUPABASE_* credentials.
 ELIFECYCLE  Command failed with exit code 1.
 ELIFECYCLE  Command failed with exit code 1.
 ELIFECYCLE  Command failed with exit code 1.
 ELIFECYCLE  Command failed with exit code 1.
```

```text
$ pnpm exec tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD
Verdict: PASS
Changed files: 90
Rules matched: (none) — no R-level artifacts required for this diff
```

## Independent review

Two non-author reviews are recorded. At the earlier source 1759314ea7e34addf3cb9f6b57488d6f6e9509a4 a separate reviewer found no additional defect (528 targeted, 67 workflow and 26 packet/recovery tests, overlapping runs). At this source, the P0 coverage repair (commits 7f1635c89, 3123e1deb, 0f873aab2, 8768a4026, e75a4cfeb, d7e2a91fe, 775f79fec, 3fb23c27d, c488c8503 and 1dbd58ef3, diff 6c8497178..1dbd58ef3) was reviewed by Codex CLI in a read-only sandbox as a non-author of those commits, in eight rounds. Round 1 at 3123e1deb ended "DISPOSITION: defects found": it executed the predicate and found five shell/YAML shapes that name the evaluator without executing it (a trailing comment on an executed line, the command as an argument to echo, a heredoc payload, a false branch, and continue-on-error as an expression) still returned executed:true, plus two doc overclaims. Commit 0f873aab2 repaired all seven and added tests for each probe. Round 2 at 0f873aab2 ended "DISPOSITION: defects found": it executed the evaluator itself and showed that `node p0-workflow.cjs` exits 0 having evaluated nothing (the module exports only `evaluatePullRequest`), so every accepted shell form was a false positive; it also found a bare `require` with no call, job-level `continue-on-error`, `needs:` on a disabled job and an empty matrix accepted, and one doc overclaim. Commit 8768a4026 repaired all of these by dropping shell-form acceptance entirely and binding delegation to the entry point. Round 3 at 8768a4026 ended "DISPOSITION: defects found": with every earlier probe still refused, it found a `require` and call inside a multi-line template literal, a shadowing `const`/`function`/method named `evaluatePullRequest`, a `let` binding reassigned before the `require`, a forked action named `actions/github-script-foo`, a matrix `exclude` that excludes everything and two jobs both named `P0 Protocol` accepted, plus two doc overclaims. Commit e75a4cfeb refuses each of these (template literals blanked with comments, `const`-only bindings, redefinition refused, exact action name, any `exclude` treated as possibly empty, exactly one job per context) and the docs now enumerate what the predicate does not assess. Round 4 at e75a4cfeb ended "DISPOSITION: defects found": every earlier probe stayed refused and no false negative was found, but two bodies that load the evaluator module without calling its export were counted (a fake object property named `evaluatePullRequest` after a bare `require`, and the export reassigned on the module binding before the call), plus two doc overclaims. Commit d7e2a91fe binds the call to the `require`: exactly three call forms are accepted (inlined, destructured, or through a `const` module binding), every `require` argument must be a literal or a `const` binding of the evaluator path, and any other occurrence of the entry-point name or of a module binding refuses the body; both docs now state the accepted forms and add the untracked export-replacement family to what is not assessed. Round 5 at d7e2a91fe ended "DISPOSITION: defects found": every earlier probe stayed refused, but the comment stripper itself was the weakness — a `//` inside a quoted string erased a following mutation, a backslash-newline string continuation placed a call at a line start — and a shadowed `require`, mutations of an unbound `require(<path>)` through `Object.assign`, `Reflect.set`, a getter or `require.cache`, `eval` and `new Function`, and a duplicate or reassigned `const` path binding were counted. Commit 775f79fec replaces the stripper with a scanner that blanks every string and template literal and refuses any body with a `/` outside a string, a template substitution, a raw newline in a quote or an unterminated literal; refuses `eval`, `Function`, `with`, `import`, `module` and `globalThis`, any `require` not immediately called or with a non-literal argument, a redefinition of `require` or the entry point, and a duplicate or assigned path binding; and treats any occurrence of the entry-point name, a module binding, the path literal or a `require` of it outside the three accepted call spans as a refusal. The staged activation patch replaced its two template substitutions with concatenation so the installed consumer is readable by that rule. Round 6 at 775f79fec ended "DISPOSITION: defects found": every earlier probe stayed refused and the patch hash matched, but Unicode-escaped spellings of `require`, the entry point and a module binding were unseen by the occurrence rule and a raw carriage return inside a quote was accepted. Commit 3fb23c27d refuses any backslash, control or non-ASCII character outside a literal and treats CR like LF inside a quote. Round 7 at 3fb23c27d ended "DISPOSITION: defects found": every earlier probe stayed refused and the patch hash matched, but a property-form `require` with whitespace before the parenthesis (`holder.require (p)`, `process.mainModule.require (p)`) was counted, because the space escaped every `require(` scan while the lookbehind ignored `.require`; two stale "with comments removed" phrases remained. Commit c488c8503 requires every `require` token to be bare and immediately followed by `(`. Round 8 at c488c8503 re-executed every probe from all seven rounds and searched for further false positives; its report ends "DISPOSITION: defects found": every probe stayed refused, no false negative, no new false-positive class beyond the documented untracked-reference family (references to the loaded module obtained without naming `require`, `module`, `eval`, `Function` or `import`, none introducible by a WORK PR author because only `origin/main` is read), and one wording defect — integration.md said every accepted `require` takes "a literal argument" where the installed activation uses the unique `const` path binding. Commit 1dbd58ef3 corrects that sentence; it is docs-only and was not re-reviewed. Neither is PM merge approval, and the independent non-author review of the instruction amendment (comment 5646174137) remains a separate prerequisite that this bundle does not claim. The model-routing sidecar records an actual bounded desktop subagent; it does not claim CLI execution or whole-lane provenance.

## Repo-minted P0 coverage repair

The review on this PR (comment 5647259413) showed `evaluateRepoMintedP0Coverage` releasing on a substring match plus file existence, so appending a comment naming the evaluator to the narrow consumer returned covered:true, and showed the helper reading the working tree rather than the installed base. At this source the predicate reads `.github/workflows/p0-protocol.yml` at `origin/main` only and parses it structurally: coverage is a live, non-`continue-on-error` step of the `P0 Protocol` job on a `pull_request` trigger whose body executes `scripts/ops/tracker-independence/p0-workflow.cjs` at statement level, with the evaluator present at the same base commit. Only a step whose action is exactly `actions/github-script` (any ref) counts, in the single job producing the `P0 Protocol` context, and only when its body, with comments and template literals blanked, read literally (every string and template literal blanked; any `/`, backslash, control or non-ASCII character outside a string, a template substitution, a raw LF or CR in a quote or an unterminated literal refuses the body), calls the evaluator's `evaluatePullRequest` export through a `require` of the evaluator path in one of three statement-level forms (inlined, destructured, or through a `const` module binding) and contains nothing else that names that module or export: no `eval`, `Function`, `with`, `import`, `module` or `globalThis`, no `require` that is not immediately called with a literal or a `const` path binding, no redefinition of `require` or the entry point, no duplicate or assigned path binding, and no other occurrence of the entry-point name, a module binding, the path literal or a `require` of it; a shell `run:` step never counts, because the evaluator exports only `evaluatePullRequest` and has no CLI entry point, so `node p0-workflow.cjs` evaluates nothing. A `continue-on-error` that is anything but literal false is ignorable at step or job level, and a job that `needs:` a disabled or absent job, carries an empty matrix axis or any non-empty `exclude` is skipped. The review's mutation now returns covered:false; so do every shell form from the review rounds, a `require` and call inside a template literal, a body that redefines `evaluatePullRequest`, a reassigned `let` binding, a forked action name, an exclude-everything matrix, a duplicate `P0 Protocol` job, a fake property named after the entry point, an export reassigned or replaced before the call through a tracked or unbound reference (including `Object.assign`, `Reflect.set`, a getter, `require.cache`, `eval` and `new Function`), a computed `require` argument, a shadowed `require`, a backslash-newline string continuation, a `//` inside a string ahead of a mutation, a comment, regex literal or template substitution anywhere in the body, a Unicode-escaped identifier, a carriage return inside a quote, a shell- or JS-commented invocation, a bare `require` with no call, a `require` nested in another call or inside a string, a path with a prefix or suffix, a step under a literal-false `if`, a step in another job, a push-only trigger, an evaluator absent at the base, and an activation present only in the working tree or committed only on the branch head. The staged `p0-consumer-activation.patch` post-image is asserted to be an executed delegation, so the predicate is bound to the activation this lane proposes. The merge wrapper's `pre-merge-authorization` refuses a repo-minted head ref whose trusted-base coverage is absent, holding an existing candidate manifest to the same line; a throwing predicate is a refusal. These are local controls and are documented as such; they are not required-check enforcement, and the foundation reaches `main` through the tracker-keyed bootstrap route recorded in integration.md, which also corrects the earlier citation of a non-existent UTV2-1887 lane. Measured at this source against the real base: `origin/main` (`14124f02a`) is `covered:false` with reason "does not execute", which is the armed state this repair exists to keep.

## Runtime Verification

Actual p0-detect CLI fixtures classify new WORK-999 T3 as non-P0 with stale tokens and fetch/http/https blocked; new T1/T2 applicability also avoids a second PM gate. Historical and base-positive P0 remain protected. Actual truth CLI covers repository/legacy identities under absent, invalid, timeout, deleted and capped tracker credentials, preserving unmerged refusal. Tests cover dispatch, packet, preflight, close/finalize, scoped metadata and authenticated overrides. Unavailable, stale, wrong-identity, bot or unauthorized scope comments grant nothing.

A fresh context agent recovered mission, active work, PR and next safe action from actual repository records without network. Its stale recovery-instruction findings were corrected and rechecked. Actual fresh/post-compaction hooks pass with network tools blocked and emit current authority references. A separate complete compacted-agent experiment is not yet proven. Main-checkout instructions remain old until foundation integration.

These checks do not prove a real ordinary task and existing PR have completed protected integration and post-merge closeout. Prior head 1759314ea7e34addf3cb9f6b57488d6f6e9509a4 passed CI verify and staging DB proof in run 34698429055; those results are not attributed to this source. Final-head CI is still required.

## Remaining integration controls

The trusted-base scope guard requires its existing external authorization for nine paths: manifest/sync, scope guard/parser and their tests, scope and return-review workflows, and the return-review test file. No human verdict is fabricated and admission history is unchanged. T1 review/merge controls remain binding. The evaluator foundation precedes the recorded consumer patch; see integration.md. No cutover completion or closeout is claimed.

## Merge SHA Binding

Merge SHA: pending merge
PR: https://github.com/griff843/Unit-Talk-v2/pull/1556
Approved PR head: pending merge
Execution SHA: cf256a0478f54200e0d73ec4a246e2ff5bc4b097
