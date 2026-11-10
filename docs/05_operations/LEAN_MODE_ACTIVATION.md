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
| Post-merge QA | non-lane (no tier) | derived as T1 |
| Staging DB proof, `verify`, `P0 Protocol`, kill switches, deploy gates | unchanged | unchanged |

### Standard allow-list (everything not listed is Protected)

- **Docs:** `docs/**/*.md`, except `docs/00_constitution/`, `docs/mission/`, `docs/05_operations/`, `docs/06_status/{lanes,proof,readiness}/`, and any file whose name contains `CONTRACT`, `POLICY`, `SPEC`, `AUTHORITY`, `RUNBOOK`, `CODEOWNERS`, `STANDING`, `INVARIANT`, `CHARTER`, `READINESS`, or is `intent.md`, `CLAUDE.md`, `AGENTS.md`.
- **Add-only unit tests:** files named `*.test.ts(x)` or `*.spec.ts(x)` under `apps/<app>/` or `packages/<pkg>/` (not fixtures, snapshots, or anything under `scripts/`). Any removed line, rename, skip/only/todo (including `{ skip: … }`), `process.exit`, env/secret reference, network or child-process use makes the file Protected.
- **UI-only components:** `.tsx`/`.css` in `apps/command-center/src/components/`, `apps/smart-form/components/`, `apps/web/src/components/`. The **full head file** is fetched and must import only React/Next presentation modules, `@/components/*`, a few `@/lib/{types,utils,cn,format,…}` helpers and relative files inside the component tree, and contain no fetch, server action, form, Supabase, auth, env, storage, `dangerouslySetInnerHTML`, `eval` or dynamic import. Deleting a component is Protected.
- **Sensitive-word veto:** any path containing words such as `auth`, `secret`, `token`, `kill`, `switch`, `delivery`, `distribut`, `settle`, `grad(e|ing)`, `payout`, `whop`, `stripe`, `billing`, `subscri`, `payment`, `role`, `tier`, `member`, `permission`, `admin`, `restore`, `purge`, `retention`, `promotion`, `routing`, `guard`, `governance`, `merge`, `lane`, `verdict`, `override`, `action`, `confirm`, `migration`, `deploy`, `webhook`, `submit`, `cron`, `worker`, or an `env` token is Protected whatever rule it matched (full list in the module).
- Shared content checks on Standard code candidates: a write call (`insert/upsert/update/delete/rpc`) within 400 characters of a protected table name in the joined added text (multi-line aware), references to `delivery_kill_switch`/`distribution_outbox`/`distribution_receipts`/`settlement_records`, and member-PII fields all escalate.
- There are **no generated-file exemptions**: `database.types.ts`, lockfiles, `__snapshots__/` and `*.snap` are simply not on the allow-list. There is no size-based rule.
- Empty, incomplete or un-inspectable file lists and missing patches/content are Protected.
- **Reviewer escalation:** a trusted reviewer line `RISK-CLASS: PROTECTED` in any review body, review comment or issue comment makes the PR Protected for good (sticky across heads). It is applied inside the shared loader, so `Merge Gate`, `Executor Result Validation`, `Risk Class` and the post-merge QA gate all see the same class.

### Independent Review

Trusted identity: default `chatgpt-codex-connector[bot]` (overridable with `TRUSTED_REVIEWER_LOGINS`); must be a GitHub `Bot` account and never the PR author or last pusher. The check passes only when a **clean pass bound to the exact head** exists and it is **later than every P0/P1 finding ever raised on the PR**:

- A clean pass is either a trusted review at the head with no P0/P1 of its own (body or threads), or — for clean PRs, on which the connector posts no review — the connector's `codex-review-state:v1` summary comment reporting `status: completed`, `has_any_findings: false` for `commit_sha == head`.
- Findings are P0/P1 threads and P0/P1 / `CHANGES_REQUESTED` review bodies, at any head and in any state including dismissed. **Resolving a thread or dismissing a review never clears a finding**; only a later clean pass at the current head does. An unresolved P0/P1 thread blocks regardless.
- A trusted artifact edited by any other account (the repository admin can edit bot comments) is treated as an unclearable finding.
- Retry: a bot review fires `pull_request_review`; the connector summary is an issue comment. `required-check-refresh.yml` reruns `Independent Review` and `Merge Gate` at the exact live head on either. To request a review at a new head, comment `@codex review`.
- No pass, a stale head, an untrusted identity, a connector outage or more than 2,000 review artifacts all fail the check. Never neutral.

## Repository variables (all Griff-set)

| Variable | Meaning |
|---|---|
| `OPERATING_MODEL` | `lean` or anything else. Anything other than `lean` = legacy for **every** unmerged PR. |
| `LEAN_MODE_ACTIVATED_AT` | ISO-8601 UTC. Second key: lean applies only when this is a valid timestamp. Recorded for audit. |
| `TRUSTED_REVIEWER_LOGINS` | Optional comma list. Default `chatgpt-codex-connector[bot]`. |

Mode is global, not per PR. At activation, open legacy PRs are evaluated by the lean gate (Protected still needs `t1-approved` + head-bound `pm-verdict/v1`, plus Independent Review); activate when few lane PRs are open.

## Activation (ordered; every step is Griff-authorized)

1. **Merge step 1** (module only; Protected).
2. **Merge step 2** (workflows + this runbook; Protected: `t1-approved` + head-bound `pm-verdict/v1`). Merging changes no behavior.
3. **Reviewer prerequisite.** Confirm on three consecutive PRs that the connector posts either a head-bound review or a summary with `commit_sha == head`.
4. **Step A (add-only branch protection).** Add `Risk Class` and `Independent Review` to the required contexts on `main`; remove nothing. Both report "not applicable" while `OPERATING_MODEL` is unset. Record the previous list (`verify`, `Executor Result Validation`, `Merge Gate`, `P0 Protocol`) in the rollback note.
5. **Rehearsal.** Set `OPERATING_MODEL=lean`, `LEAN_MODE_ACTIVATED_AT=<now>`. Open one docs-only Standard PR and one Protected PR; confirm `Risk Class`, `Independent Review` and `Merge Gate` behave per the tables above.
6. **Trial** of 5–10 Standard PRs plus every Protected PR, against the proposal's §8 criteria. Step B (removing `Executor Result Validation` from required contexts) is a separate Griff decision after the trial.

## Rollback (config only; no code revert)

1. Set `OPERATING_MODEL=legacy` (or delete it). From the next check run, **every unmerged PR** — including ones opened under lean — is evaluated by the legacy gate. A lean PR without legacy artifacts (manifest, tier label, executor result / verdict) is blocked, i.e. stopped. To force re-evaluation immediately, push or re-run `Merge Gate` on open PRs (or close them).
2. Leave `Risk Class` and `Independent Review` in the required contexts; they report "not applicable".
3. Nothing is deleted. Protected-main checks are never disabled.

## Known limits (stated, not hidden)

- **Connector semantics are partly unverified.** Whether `has_any_findings` in the summary resets per reviewed commit is not proven; if it is cumulative, a PR that once had findings can only pass via a later review object at the head (fail-closed, may need a human re-review request). Codex reviews on demand (`@codex review`), not on every push.
- **Merge Gate decision freshness.** Merge Gate evaluates at its own run; a finding arriving after the gate passed reruns it only through `required-check-refresh.yml`.
- **UI scan is lexical.** It inspects imports and capability markers, not semantics; a component can still render misleading UI. Server actions and lib code it could call are themselves Protected.
- **Local merge tool is not lean-aware.** `ops:merge-wrapper pr-merge` / `pre-merge-authorization.ts` still require legacy artifacts; lean Standard PRs merge with `gh pr merge --squash` against branch protection. Making the tool lean-aware is a separate Protected change.
- **Advisory lane workflows** (`tier-label-check`, `lane-check`, proof gates, …) may be red on manifest-less lean PRs; they are not required contexts.
- Protected approval reuses `t1-approved` + `pm-verdict/v1` for every Protected change. Narrowing that is a later policy decision.
- Deviations from the proposal: the 400-line enhanced-review rule and generated-file exemptions were dropped, and per-PR creation-time mode / `LEAN_MODE_DEACTIVATED_AT` were replaced by a global mode so rollback stops in-flight lean PRs.
