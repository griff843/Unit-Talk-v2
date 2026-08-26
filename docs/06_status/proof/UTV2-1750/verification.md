# PROOF: UTV2-1750 — wire operational skills into dispatch routing and execution packet DoD

MERGE_SHA: 4a89cf5f42c0e7f9d35ae1f703a61893bca4d43b

## Verification

### ASSERTIONS:

1. All four operational skill files (`/lane-recovery`, `/pr-unblock`,
   `/proof-authoring`, `/mutation-test`) are committed under
   `.claude/commands/` and indexed as new rows in `CLAUDE.md`'s skills
   table.
2. `/dispatch` performs deterministic skill discovery (new Phase 1.5) before
   any executor is launched, and the execution packet's `skill_routing`
   field is the authoritative record of the skills that discovery selected.
3. `generateExecutionPacket`/`generateExecutionPacketResult`, when called
   with `enforceSufficiency: true` (the mode the standalone CLI uses, which
   is what `/dispatch`'s Phase 1.5 shells out to), refuse with code
   `INSUFFICIENT_TASK_CONTRACT` when a task contract is missing
   where-to-look, definition-of-done, or verification/self-check content —
   proven by a 4-mutation battery (removing each requirement individually,
   then removing all three together) that shows the refusal fires on
   exactly the conditions it names, not merely on any input.
4. Each of the four skills has at least one positive routing fixture (its
   trigger phrase selects the skill) and one negative fixture (an ordinary
   description of unrelated work does not select it) — 8 fixtures total.
5. A production lane fixture modeled on UTV2-1736 (objective, acceptance
   criteria, constraints, mutation boundary, where-to-look, exit criteria,
   required evidence) survives `TaskContract` parsing with all of that
   content intact, and does not falsely trigger any of the four skills.
6. A recovery-shaped fixture (ghost/stuck/parked/merged-but-unclosed lane
   language) selects `/lane-recovery`; an ordinary narrow implementation
   fixture selects no skill.
7. Routing triggers match the specified conditions: ghost/broken/parked/
   merged-but-unclosed → `/lane-recovery`; required-context/head-binding/
   merge-gate mismatch → `/pr-unblock`; proof bundle creation/correction →
   `/proof-authoring`; a control claimed by tests → `/mutation-test`; a
   fixture combining two trigger phrases selects both skills.
8. Sufficiency enforcement is opt-in (`ExecutionPacketOptions.
   enforceSufficiency`, default `false`), so `claude-exec.ts`,
   `codex-exec.ts`, and `lane-start.ts` — all out of this lane's declared
   file scope — see no behavior change; confirmed by the full repo test
   suite passing with 0 failures.

### EVIDENCE:

Focused test file, run via `pnpm exec tsx --test` (never bare `tsx`) with
`TMPDIR=/home/griff843/code/Unit-Talk-v2/.out/tmp-1752`:

```
$ TMPDIR=/home/griff843/code/Unit-Talk-v2/.out/tmp-1752 pnpm exec tsx --test scripts/ops/execution-packet.test.ts
...
1..95
# tests 95
# suites 0
# pass 95
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 1341.47767
```

`pnpm type-check` (`tsc -b tsconfig.json`) — exits 0, no diagnostics:

```
$ pnpm type-check
> @unit-talk/v2@0.1.0 type-check
> pnpm exec tsc -b tsconfig.json
```

Full repo test suite, one blocking foreground run (`TMPDIR=/home/griff843/code/Unit-Talk-v2/.out/tmp-1752 pnpm test > .out/tmp-1752/1750-test.txt 2>&1; echo exit=$?`), aggregated with
`grep -E "^# (tests|pass|fail|skipped) " .../1750-test.txt | awk '{a[$2]+=$3} END {for (k in a) print k, a[k]}'`:

```
exit=0
not ok count: 0
tests 5014
pass 5014
fail 0
skipped 0
```

This confirms the opt-in `enforceSufficiency` design does not regress any
out-of-scope caller (`claude-exec.test.ts`, `codex-exec.test.ts`,
`lane-start.test.ts` included in this aggregate).

R-level check (`pnpm exec tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD`):

```
Verdict: PASS
Changed files: 11
Rules matched: (none) — no R-level artifacts required for this diff
```

Static verification (`pnpm verify:static`, run in place of full `pnpm verify`
because the local environment's staging guard refuses `host=127.0.0.1`; CI's
`verify` check on the PR head is the authoritative full-verify receipt):

```
> @unit-talk/v2@0.1.0 verify:commands
> pnpm --filter @unit-talk/discord-bot command-manifest:check && node scripts/check-migration-versions.mjs && node scripts/lint-migrations.mjs

[command-manifest] Verified 14 command definition(s) against .../apps/discord-bot/command-manifest.json
[check-migration-versions] 7 migration file(s) verified — no duplicate versions.
[lint-migrations] Skipping schema baseline replay-root 00000000000000_baseline_live_schema.sql (snapshot, not a forward migration; fidelity verified by Live Schema Parity).
[lint-migrations] 6 migration file(s) checked — no findings.

[exited with code 0]
```

### Mutation proof (control validated by execution path, not presence)

The 4-mutation battery in `execution-packet.test.ts` (`mutation 1`–`mutation 4`)
constructs a contract that is otherwise sufficient and removes exactly one
required signal at a time, asserting `InsufficientTaskContractError.missing`
names precisely the removed requirement (and all three together on
`mutation 4`). A companion baseline test (`mutation baseline`) asserts the
unmodified, fully sufficient contract passes. All 5 are part of the 95/95
pass count above. The opt-in regression test (`sufficiency is opt-in`) proves
the same insufficient contract still produces a packet when
`enforceSufficiency` is left at its default — demonstrating the refusal only
fires where it is deliberately armed, not universally.

### Known scope note

`.ops/sync/UTV2-1750.yml` (produced by `ops:lane-start`, not edited by this
change) embeds lane-start's captured Linear task-contract text, which
mentions UTV2-1736, 1744, 1745, 1747, 1748, and 1749 in its narrative body;
`entities.issues` in that same file correctly lists only UTV2-1750. This
commit's message and this PR's body reference no UTV2 issue other than
UTV2-1750.
