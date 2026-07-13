# Memory-to-Skill Knowledge Promotion Framework

**Status:** DRAFT — PM ratification required before treated as binding process
**Date:** 2026-07-13
**Linear:** UTV2-1498
**Tier:** T3 — docs/process, no runtime surface, no product code changes, no deploy

---

## Purpose

The orchestrator's auto-memory system (`~/.claude/projects/*/memory/`) accumulates operational lessons across sessions — corrections, confirmed approaches, and recurring gotchas — but it is per-user, per-machine, and outside version control. A lesson that only lives in memory is invisible to anyone reading the repo directly, disappears if memory is cleared or migrated, and cannot be reviewed or ratified by PM the way a committed doc can. This framework defines when and how a recurring memory-only lesson gets promoted into a permanent, versioned, repo-tracked doc or skill.

## Current memory-only recurring lessons (identified 2026-07-13)

These are real examples of the class of lesson this framework exists to promote — each has already recurred at least once, meaning at least one session had to rediscover it the hard way before it was captured:

1. **CLI flag conventions differ per script, and guessing wrong wastes a full round-trip.** Examples hit repeatedly: `scripts/ops/lease-registry.ts release` requires `--issue` as a flag, not positional; `scripts/ops/lane-manifest.ts update` takes the issue ID positionally but needs `--` before flags in some invocations; `scripts/ops/lane-finalize.ts` requires `--issue` as a flag. None of this is documented in one place — each script's own `usage()`/`--help` text is the only source of truth, and it's scattered across a dozen files.
2. **`gh pr edit --body`/`--add-label` can silently fail** on an unrelated GraphQL side-query (`Projects (classic) is being deprecated...repository.pullRequest.projectCards`) even when the actual intended mutation would otherwise succeed. The reliable fallback is the REST API directly (`gh api repos/OWNER/REPO/pulls/N -X PATCH --input <json>` for body edits; `gh api repos/OWNER/REPO/issues/N/labels` for labels).
3. **Branch discipline forbids cross-issue references** in PR title, PR body, and commit messages (enforced by `scripts/ops/branch-discipline-guard.ts` / `.github/workflows/branch-discipline-guard.yml`) — but file *content* (docs, code comments) is not scanned, only those three commit/PR metadata surfaces. Writing "see UTV2-XXXX" in a commit message for context is an easy, repeatable mistake.
4. **A lane's own manifest content is only trusted as of its first-committed snapshot on that branch** (`resolveTrustedManifests()` in `scripts/ci/file-scope-guard.ts`) — widening `file_scope_lock`/`expected_proof_paths` in a *later* commit on the same branch does not take effect for the File scope lock check without an externally authorized `scope-override/v1` comment. This is a load-bearing, non-obvious mechanical property that every lane author eventually collides with.
5. **T2 self-approval is structurally impossible via `gh pr review --approve`** — GitHub itself rejects it when author and reviewer are the same identity, regardless of what any doc claims about "the orchestrator's own review satisfying T2 approval." The actual working path is an `executor-result/v1` PR comment plus a manual `gh workflow run merge-gate.yml -f pull_number=<N>` dispatch, since Merge Gate's `issue_comment` trigger only re-evaluates on `PM_VERDICT:` comments, not `EXECUTOR_RESULT:` ones.
6. **`.ops/leases/<ISSUE>.json` is not released by normal lane-close/truth-close automation** — only the merge lock (`.ops/merge-lock.json`) gets released. A closed-and-truth-closed lane can still leave an `active` lease behind that blocks `ops:substrate-guard` for an unrelated later lane, requiring a manual `scripts/ops/lease-registry.ts release`.

## Promotion criteria

A memory-only lesson should be promoted to a committed doc/skill when **any** of the following hold:

- **Recurrence:** the same gotcha has already had to be rediscovered in more than one session (not merely "this seems likely to recur" — actual repeat evidence).
- **Mechanical, not narrative:** the lesson describes a fact about how a script, workflow, or gate actually behaves (a flag name, a trust boundary, a silent failure mode) — not a one-off judgment call or a preference that only applies to a specific past decision.
- **Blast radius beyond the current session:** getting it wrong would cost another session (human or agent) the same diagnostic round-trip this session paid — CLI usage errors, CI gate false-fails, and structurally-impossible-but-undocumented paths all qualify.
- **Contradicts or extends an existing doc:** if current documentation (a spec, a CLAUDE.md, a script's own `--help`) claims something the memory entry proves is inaccurate or incomplete (e.g., a documented merge-authority path that doesn't actually work), the doc is stale and must be corrected, not just noted in memory.

A lesson does **not** need promotion when it is:
- A one-off judgment call specific to a single past decision with no general applicability.
- Already fully covered by an existing doc, spec, or script's own `--help`/usage text (in which case the fix is "read the existing doc," not "write a new one").
- Purely about user preference/style with no mechanical content (these belong in memory's `feedback` type and stay there — they are legitimately session-to-session guidance, not repo truth).

## Docs location and process

Promoted lessons land in one of two places depending on shape, matching the existing doc taxonomy (`docs/05_operations/docs_authority_map.md`):

1. **An unfixed condition** (a real gap, quirk, or false-fail that hasn't been code-fixed yet) → a row in `docs/06_status/KNOWN_DEBT.md`, following its existing schema (ID, area, title, impact, Linear link or justification, evidence, status). This dashboard already exists and already serves exactly this purpose for code-level debt; operational/CLI-discovery debt belongs in the same table, not a separate one.
2. **A stable, correct mechanical fact worth restating for future readers** (e.g., "these three CLI scripts require `--issue` as a flag, not positional") → a short reference note in the most relevant existing operational doc (e.g., `docs/05_operations/LANE_MANIFEST_SPEC.md` for manifest-CLI conventions, `docs/CODEBASE_GUIDE.md` for cross-cutting orchestration facts) rather than a new standalone doc per lesson. Avoid creating a growing pile of single-purpose docs; extend what already exists at its natural location.

This framework does not introduce a new doc-creation ceremony. The process is: notice a lesson meets the promotion criteria above → find its natural existing home (KNOWN_DEBT.md for unfixed conditions, the relevant spec/guide for stable facts) → add it there in a normal lane, same as any other doc edit.

## Review cadence

- **Ad hoc, at session-close:** the natural trigger point is already built into practice — this session's own memory-writing rules ("save a feedback/project memory whenever a correction or confirmation lands") already produce candidate lessons continuously. The additional discipline this framework adds is: before writing a memory-only entry for something that meets the promotion criteria above, also open (or add to) a `KNOWN_DEBT.md` row or the relevant spec doc in the same lane, rather than letting it live in memory alone.
- **Periodic backlog sweep:** no fixed calendar cadence is proposed here, since this project's actual operating rhythm is lane-driven, not calendar-driven (see `docs/05_operations/OPERATING_MODEL_SONNET5.md`). Instead, the trigger is threshold-based: when a new orchestrator session's memory directory accumulates entries whose content overlaps materially with `KNOWN_DEBT.md`'s existing scope (i.e., a `feedback`-type memory that is really describing an unfixed operational condition, not a preference), that session should promote it before doing unrelated work — the same discipline already applied ad hoc in this document's own "Current memory-only recurring lessons" section above.

## What this framework does NOT do

- It does not migrate or delete existing memory entries — memory remains the source of session-specific behavioral guidance (preferences, confirmed approaches) per its own type taxonomy; this framework only concerns the subset of memory that describes durable, mechanical, repo-relevant facts.
- It does not create a new automation, script, or CI gate. No product code changes, no deploy — this is a documentation/process framework only, per this issue's own tier (T3) and acceptance criteria.
- It does not require or imply a fixed review meeting or calendar cadence; the trigger is content-based (does a new lesson meet the promotion criteria), not time-based.
