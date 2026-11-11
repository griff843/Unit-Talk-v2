# Lean Operating Mode — Standard / Protected (WORK-2026110804)

Status: **merged inactive.** The mechanism changes nothing for any PR until Griff sets the repository variables below. Default is `legacy`.

Authority: amends `OPERATING_MODEL_SONNET5.md` §8. Merge-authority changes (the merge gate, its policy inputs, required contexts, branch protection) are Griff's decision; this document is the landing, activation and rollback runbook for that decision.

## Two-step landing (bootstrap safety)

`Merge Gate`, `Executor Result Validation`, `Risk Class` and `Independent Review` check out the PR's **base** commit and load policy code from it. A workflow that required a module the base does not have would fail every PR with `MODULE_NOT_FOUND`. So, following the UTV2-1554 precedent (`merge-gate-verdict.cjs` landed before the gate used it):

1. **Step 1 PR** lands `scripts/ops/operating-model.cjs` and its unit tests only. No workflow references it. Zero behavior change.
2. **Step 2 PR** (opened after step 1 is on `main`) wires the workflows and adds this runbook.

Defense in depth: every workflow requires the module **lazily** (only when `OPERATING_MODEL=lean`) and treats `MODULE_NOT_FOUND` for that module as "legacy". Any other load error fails the check (fail-closed). `operating-model-workflows.test.ts` executes each workflow script against a base without the module.

## What the mechanism does

| | Standard | Protected |
|---|---|---|
| Classification | mechanical, by `scripts/ops/operating-model.cjs`: on the Standard allow-list **and** passes content checks | everything else |
| Gate (`Merge Gate`) | branch-protected checks green + `Independent Review` | additionally `t1-approved` label + head-bound CODEOWNER `pm-verdict/v1` |
| Manifest / preflight token / lease / tier label / scope-override / model-routing sidecar | not required | not required for the gate |
| `Executor Result Validation` | reports success (not required) | still fully validated |
| Post-merge QA | label tier, else non-lane | derived from the diff: T1 regardless of label |
| Staging DB proof, `verify`, `P0 Protocol`, kill switches, deploy gates | unchanged | unchanged |

### Standard allow-list (everything not listed is Protected)

- **Docs:** `docs/**/*.md`, except `docs/00_constitution/`, `docs/mission/`, `docs/05_operations/`, `docs/06_status/{lanes,proof,readiness}/`, and any path containing (case-insensitive) `contract`, `policy`/`policies`, `spec`, `authority`, `runbook`, `codeowners`, `standing`, `invariant`, `charter`, `readiness`, `environment`, `network`(`ing`), `backup`, `disaster`, `recovery`, `security`, `secret`, `governance`, `guardrail`, or a `dr` token (e.g. `backup-dr-policy.md`, `environment_contract.md`, `pick_spec.md`), or is `intent.md`, `CLAUDE.md`, `AGENTS.md`.
- **Newly added unit tests only:** NEW files (`status: added`) named `*.test.ts(x)` or `*.spec.ts(x)` under `apps/<app>/` or `packages/<pkg>/` (not fixtures, snapshots, or anything under `scripts/`). Tier C paths (the exact paths, prefixes and patterns in `scripts/ops/merge-risk.ts`, e.g. `packages/domain/src/**`, `packages/contracts/src/**`, `packages/config/**`, `apps/worker/**`) are vetoed before any Standard rule, so a new test, doc or any nested file under them is always Protected. Any **modified**, renamed or copied test file is Protected (an added `/* … */`, `return;` or shadowing `const test =` disables assertions without removing a line). A new test is also Protected if it uses skip/only/todo (including `{ skip: … }`), `process` in any form (`process["env"]`, `process.exit`), `globalThis`, `fetch`, `eval`/`Function(`, a non-literal `import()`/`require()`, any Node built-in other than `node:test` / `node:assert` (`http(s)`, `net`, `fs`, `child_process`, …), `createDatabaseClient` or any other DB client (`create*Client`, Supabase, `pg`, `@unit-talk/db`), or an env/secret reference.
- **UI-only components:** `.tsx`/`.css` in `apps/command-center/src/components/`, `apps/smart-form/components/`, `apps/web/src/components/`. The **full head file** is fetched and must import only React/Next presentation modules, `@/components/*`, a few `@/lib/{types,utils,cn,format,…}` helpers and `./`-relative files inside the component tree. Specifiers are parsed through comments/whitespace; any specifier containing a `..` segment or a backslash escape is Protected (including relative `../x`). The file must contain no `fetch` (any use, e.g. `fetch.call`), `globalThis`, `navigator`, computed access on `window`/`self`/`document`/`top`/`parent`/`frames`, `document.cookie`, `XMLHttpRequest`, `WebSocket`, `EventSource`, `createElement('form'…)` or non-literal `createElement`, `use server` (any quoting), form, Supabase, auth, env, storage, `dangerouslySetInnerHTML`, `eval`/`Function(`/`constructor`/`Reflect`, `require`, or dynamic import. `.css` files are also Protected on `@import`, `url(` with a scheme or `//`, `expression(`. `.scss` is not on the allow-list. Deleting a component is Protected.
- **Sensitive-word veto:** any path containing words such as `auth`, `secret`, `token`, `kill`, `switch`, `delivery`, `distribut`, `settle`, `grad(e|ing)`, `payout`, `whop`, `stripe`, `billing`, `subscri`, `payment`, `role`, `tier`, `member`, `permission`, `admin`, `restore`, `purge`, `retention`, `promotion`, `routing`, `guard`, `governance`, `merge`, `lane`, `verdict`, `override`, `action`, `confirm`, `migration`, `deploy`, `webhook`, `submit`, `cron`, `worker`, or an `env` token is Protected whatever rule it matched (full list in the module).
- Shared content checks on Standard code candidates: a write call (`insert/upsert/update/delete/rpc`) within 400 characters of a protected table name in the joined added text (multi-line aware), references to `delivery_kill_switch`/`distribution_outbox`/`distribution_receipts`/`settlement_records`, and member-PII fields all escalate.
- There are **no generated-file exemptions**: `database.types.ts`, lockfiles, `__snapshots__/` and `*.snap` are simply not on the allow-list. There is no size-based rule.
- Empty, incomplete or un-inspectable file lists and missing patches/content are Protected.
- **Reviewer escalation:** a trusted reviewer line `RISK-CLASS: PROTECTED` in any review body, review comment or issue comment makes the PR Protected. It is sticky across heads and sources for as long as that trusted review or comment exists with the line. If the line is deleted or edited away, the escalation clears at the next recompute. Anyone with write access can delete a comment. See Known limits. It is applied inside the shared loader, so `Merge Gate`, `Executor Result Validation`, `Risk Class` and the post-merge QA gate all see the same class.

### Independent Review

Trusted identity: default `chatgpt-codex-connector[bot]` (overridable with `TRUSTED_REVIEWER_LOGINS`); must be a GitHub `Bot` account and never the PR author or last pusher. The check passes **only** on the connector's summary comment:

- The pass artifact is the connector's issue comment whose body **starts with** `<!-- codex-pull-request-review-summary -->` followed on the next line by `<!-- codex-review-state:v1 {…} -->` (exactly one state marker in the body), from the trusted Bot login, reporting `commit_sha == head`, `status: completed`, `has_any_findings: false`, `has_unresolved_findings: false`. A marker anywhere else (quoted, echoed, appended) is ignored. **A bare review object never passes**, whatever its body or state; no summary = FAIL.
- Findings are P0/P1 in any trusted comment of any thread (not only the first), a P0/P1 in a trusted review body (any review state, including dismissed), a trusted review whose current state is `CHANGES_REQUESTED`, and a head-bound summary reporting findings. A dismissed review's state becomes `DISMISSED`, so dismissal clears a `CHANGES_REQUESTED`-only finding but not a P0/P1 in the body. Notations recognised include badges, `**P1**`, `(P1)`, `[P1]`, `P1:`, `Priority 1`.
- **A finding raised at head H blocks H while its trusted artifact exists.** A later clean summary at the same head does not clear it, and neither does resolving the thread. Deleting the trusted comment or review body that carries it does clear it at the next recompute, and so does the trusted author editing the P0/P1 out (an edit by another account counts as tampering and fails the check). Push a new commit and obtain a fresh clean summary for it. A finding whose commit cannot be determined is treated as raised at the head. An unresolved P0/P1 thread at any head blocks.
- A trusted artifact edited by any other account (the repository admin can edit bot comments) fails the check.
- Retry: the connector summary is an issue comment; `required-check-refresh.yml` reruns `Independent Review` and `Merge Gate` at the exact live head only when lean mode is armed and the comment is the anchored summary from the trusted Bot login. A missing Independent Review run does not stop the Merge Gate rerun. If the summary lands while the native `pull_request` Independent Review run is still in flight (so it cannot be rerun yet), that run's own `workflow_run` completion reruns Independent Review and Merge Gate once, but only when the run did not succeed and a trusted-Bot anchored summary was written at or after the run started; the rerun starts after that summary, so it cannot loop. To request a review at a new head, comment `@codex review`.
- Recompute triggers in lean mode (all at the exact live head; legacy is unchanged):
  - **Review** (`pull_request_review` submitted, edited or dismissed) and **inline review-thread comment** (`pull_request_review_comment` created, edited or deleted) both run the read-only `Independent Review` workflow's ineligible job. Its completion, via `workflow_run`, reruns Independent Review, Merge Gate, Executor Result Validation and Risk Class. No write token is ever granted to a fork-triggered run.
  - **Issue comment created:** the anchored trusted-Bot summary reruns Independent Review and Merge Gate. A trusted reviewer's `RISK-CLASS: PROTECTED` line reruns Merge Gate, Executor Result Validation, Independent Review and Risk Class.
  - **Issue comment edited or deleted:** when the comment's author uses a trusted reviewer login, it reruns those same four checks. Comments by other authors are not read by evaluation, so they trigger nothing.
- No pass, a stale head, an untrusted identity, a connector outage or more than 2,000 review artifacts all fail the check. Never neutral.

## Repository variables (all Griff-set)

| Variable | Meaning |
|---|---|
| `OPERATING_MODEL` | `lean` or anything else. Anything other than `lean` = legacy for **every** unmerged PR. |
| `LEAN_MODE_ACTIVATED_AT` | Strict ISO-8601 (`YYYY-MM-DD` or `YYYY-MM-DDTHH:MM[:SS[.fff]](Z|±HH:MM)`). Second key: lean applies only when this parses **and is not in the future**; anything else disarms lean. Recorded for audit. |
| `TRUSTED_REVIEWER_LOGINS` | Optional comma list. Default `chatgpt-codex-connector[bot]`. |

Mode is global, not per PR. At activation, open legacy PRs are evaluated by the lean gate (Protected still needs `t1-approved` + head-bound `pm-verdict/v1`, plus Independent Review); activate when few lane PRs are open.

## Activation (ordered; every step is Griff-authorized)

1. **Merge step 1** (module only; Protected).
2. **Merge step 2** (workflows + this runbook; Protected: `t1-approved` + head-bound `pm-verdict/v1`). Merging changes no behavior.
3. **Reviewer prerequisite.** Confirm on three consecutive PRs that the connector posts either a head-bound review or a summary with `commit_sha == head`.
4. **Step A (add-only branch protection).** Add `Risk Class` and `Independent Review` to the required contexts on `main`; remove nothing. Both report "not applicable" while `OPERATING_MODEL` is unset. Record the previous list (`verify`, `Executor Result Validation`, `Merge Gate`, `P0 Protocol`) in the rollback note.
5. **Rehearsal.** Set `OPERATING_MODEL=lean`, `LEAN_MODE_ACTIVATED_AT=<now>`. Open one docs-only Standard PR and one Protected PR; confirm `Risk Class`, `Independent Review` and `Merge Gate` behave per the tables above.
6. **Trial** of 5–10 Standard PRs plus every Protected PR, against the proposal's §8 criteria. Step B (removing `Executor Result Validation` from required contexts) is a separate Griff decision after the trial.

## Rollback (config change + mandatory Merge Gate rerun)

Changing the variable alone does **not** stop a PR whose `Merge Gate` already concluded green under lean: that check result stays on the PR head and branch protection keeps accepting it until the check runs again. Rollback is therefore two steps, both required:

1. Set `OPERATING_MODEL=legacy` (or delete it). Every check run from now on — including on PRs opened under lean — uses the legacy gate, which a lean PR without legacy artifacts (manifest, tier label, executor result / verdict) cannot satisfy.
2. **Immediately rerun `Merge Gate` on every open PR** so no lean-era green result survives. One command (needs `gh` with `actions:write`):

   ```bash
   gh pr list --state open --base main --json headRefOid --jq '.[].headRefOid' | while read -r sha; do
     gh run list --workflow merge-gate.yml --event pull_request --commit "$sha" --limit 1 --json databaseId --jq '.[].databaseId' |
       xargs -r -n1 gh run rerun
   done
   ```

   Then confirm with `gh pr checks <n>` that no open PR shows a green `Merge Gate` it should not have. Until this step completes, assume an open lean PR can still be merged. Closing a PR, or pushing to it, also forces re-evaluation.
3. Leave `Risk Class` and `Independent Review` in the required contexts; they report "not applicable".
4. Nothing is deleted. Protected-main checks are never disabled.

## Known limits (stated, not hidden)

- **Connector semantics are partly unverified.** Whether `has_any_findings` in the summary resets per reviewed commit is not proven. Since a review object can no longer pass, if it is cumulative a PR that once had findings cannot pass Independent Review at all (fail-closed): the remedy is a fresh PR. Codex reviews on demand (`@codex review`), not on every push.
- **Head binding of findings** uses the thread comment's `originalCommit` (then its review's commit). If GitHub returns neither, the finding is treated as raised at the current head.
- **Findings and escalations are not deletion-proof.** Evaluation reads only the review artifacts that exist at recompute time. Deleting a trusted P0/P1 comment or a `RISK-CLASS: PROTECTED` comment clears it at the next recompute; anyone with write access can delete a comment. A deletion-proof design (for example minimized/deleted-artifact detection plus a broker-applied `risk:protected` label) is pending a separate PM-governed follow-up and is not part of this change.
- **Review-thread resolve/unresolve has no GitHub Actions event** (`pull_request_review_thread` is a webhook only), so it does not trigger a recompute; this is a documented limit, not a fail-closed path. Resolving can only lower blocking (a stale result stays a FAIL, which is safe). Unresolving a P0/P1 thread from an earlier head can turn a green Independent Review red, and that is not reflected until the next recompute: any push, review, inline or trusted issue comment, or a manual `repository_dispatch` `required-check-refresh` with target `both`/`independent`. Reopen a finding with a reply comment (that is a `pull_request_review_comment` and recomputes), not by unresolving alone.
- **Merge Gate decision freshness.** Merge Gate evaluates at its own run; a finding arriving after the gate passed reruns it only through `required-check-refresh.yml`.
- **UI scan is lexical.** It inspects imports and capability markers, not semantics; a component can still render misleading UI. Server actions and lib code it could call are themselves Protected.
- **Local merge tool is not lean-aware.** `ops:merge-wrapper pr-merge` / `pre-merge-authorization.ts` still require legacy artifacts; lean Standard PRs merge with `gh pr merge --squash` against branch protection. Making the tool lean-aware is a separate Protected change.
- **Advisory lane workflows** (`tier-label-check`, `lane-check`, proof gates, …) may be red on manifest-less lean PRs; they are not required contexts.
- Protected approval reuses `t1-approved` + `pm-verdict/v1` for every Protected change. Narrowing that is a later policy decision.
- Deviations from the proposal: the 400-line enhanced-review rule and generated-file exemptions were dropped, and per-PR creation-time mode / `LEAN_MODE_DEACTIVATED_AT` were replaced by a global mode so rollback stops in-flight lean PRs.
