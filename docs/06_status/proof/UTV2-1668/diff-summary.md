# Diff summary: UTV2-1668

MERGE_SHA: 6009998c1708d6d5c7c38d6acc2139aa334c26f6

Governed terminal supersession for unmerged lanes. No runtime, domain, DB or delivery code.

| File | Change |
|---|---|
| `scripts/ops/lane-supersede.ts` | New. The governed transition: agreed PR identity, GitHub closed/unmerged verification, rejected-head match, ancestry vs GitHub current main, GitHub-attested actor authority, superseded-branch write guard, staged cross-worktree transaction, runtime-verified resource release, idempotency with conflict refusal. |
| `scripts/ops/lane-supersede.test.ts` | New. 28 regressions covering every control, the executed refusal remedy, and the production CLI entry point. |
| `scripts/ops/shared.ts` | Adds `SupersessionRecord` and the `supersession` manifest field. Tightens `TRANSITIONS`: `merged` may no longer reach any non-success terminal. |
| `scripts/ops/lane-manifest.ts` | `update --status superseded` refuses and names the governed command. |
| `docs/05_operations/LANE_MANIFEST_SPEC.md` | Documents §4.3.1 `supersession`, the fixed `claim` scope, the verification order, and the transition tightening. |

## Scope changes forced by governance

- **`scripts/ops/lease-registry.ts` dropped** — `releaseLease` is already exported, so the transaction calls it rather than modifying it. Also avoided a real conflict: UTV2-1696's orphaned lease still holds that file.
- **`package.json` dropped** — conflicted with active lane UTV2-1570 (open PR #1293). The command is production-wired as `npx tsx scripts/ops/lane-supersede.ts`, the same invocation form as `tier-classifier` and `generate-preflight-token`. A `pnpm ops:lane-supersede` alias needs a trivial follow-up once #1293 lands.

## Mutation results

| Mutation | Result |
|---|---|
| A · mandatory-input check removed | `not ok 10`, `33` — 107 pass / 2 fail |
| B · self-supersede permitted | `not ok 11` — 108 / 1 |
| C · `merged` → non-success terminal restored | `not ok 17` — 108 / 1 |
| D · lane-manifest bypass refusal removed | `not ok 31` — 108 / 1 |
| E · PR identity agreement dropped | `not ok 20` — 108 / 1 |
| F · closed/unmerged check dropped | `not ok 22` — 108 / 1 |
| G · rejected-head match dropped | `not ok 23` — 108 / 1 |
| H · ancestry check dropped | `not ok 24` — 108 / 1 |
| I · unverifiable GitHub = permission | `not ok 25` — 108 / 1 |
| J · conflicting re-run overwrite permitted | `not ok 28` — 108 / 1 |
| K · post-condition verification removed | `not ok 30` — 108 / 1 |
| L · `mergeCommit` as merge evidence | `not ok 15` — 108 / 1 |
| M · already-shipped refusal removed | `not ok 19` — 108 / 1 |
| N · actor authority check removed | `not ok 34` — 108 / 1 |
| O · ancestry vs stale local ref | `not ok 35` — 108 / 1 |
| P · unreadable remote main = permission | `not ok 35` — 108 / 1 |
| Q · superseded-branch write guard removed | `not ok 36` — 108 / 1 |
| R · receipt root per-worktree | `not ok 26`, `29` — 107 / 2 |
| Restored | **109 / 109**, 0 skipped |

Twenty-seven groups, no survivors. Mutation K survived the first battery and was closed; see the proof bundle.

## Known limitations, deliberately not addressed here

- `pnpm type-check` does not compile `scripts/ops/**`. Tracked separately.
- No `pnpm ops:lane-supersede` alias while `package.json` is locked by UTV2-1570.
- Applying the transition to the failed predecessor lane happens **after** this merges, per PM sequencing.
