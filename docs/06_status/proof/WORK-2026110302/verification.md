# PROOF: WORK-2026110302

MERGE_SHA: pending merge

Issue: WORK-2026110302
Tier: T1
Verified source SHA: b7952b0eef57bf73ec8c3065a2c5d2dd11854378

result: partial — static and focused proof complete locally; exact-head CI, staging DB proof and Griff's T1 verdict pending

## Verification

Status: INCOMPLETE — review candidate. No approval, merge, live DB proof or lane closeout is claimed.

Executor note: the lane manifest routes this lane to `codex-cli`. The Codex attempt on 2026-11-16
(`model-routing.json`) exited 0 without an implementation. This implementation was written by
Claude in a project thread at Griff's "proceed" (2026-11-21). `model-routing.json` is left as the
historical Codex observation and does not describe this code.

Scope: the nine approved paths plus four Griff authorized on 2026-11-21 in the project thread
(decision cards): `docs/05_operations/executable-wiring-baseline.json` (remove the now-stale
`delivery-adapters.test.ts` baseline entry so the wiring check passes once it is registered),
`apps/api/src/t1-proof-work-2026110302-artwork-metadata-live.test.ts` and its
`docs/05_operations/db-writer-classification.json` entry (staging metadata-shape proof), and
`apps/discord-bot/src/discord-design-system.test.ts` (test data only: its sample image moves from
`assets.example` to an allowlisted host, because that test asserted the any-host behaviour this
lane removes).

Not copied: the v2 protected-path request and its independent-review findings live in
`.out/discord-artwork-presentation-20261102/` on Griff's main checkout and were not reachable from
the cloud session. They still need copying into this directory.

ASSERTIONS:
- [x] Domain host guard: `allowedMediaUrl` accepts only https on `cdn.nba.com`, `img.mlbstatic.com`, `a.espncdn.com`, `assets.nhle.com` (frozen constant); refuses `cms.nhl.bamgrid.com`, http, credentials, foreign, suffix-spoofed, subdomain, non-default port and malformed URLs. Every embed builder, including the result recap, goes through it (`packages/domain/src/discord-presentation.test.ts`, 17/17).
- [x] Worker gate: only `buildDiscordMessagePayload` changed; a thumbnail passes only when `metadata.thumbnailVerified === true`; an unverified thumbnail is dropped while the Discord message still sends (`apps/worker/src/delivery-adapters.test.ts`, 29/29).
- [x] Resolver binds by participant ID; selection-text matching and `listByType` scanning removed; player verified only when a fresh `resolveHeadshot` returns `confirmed` with exactly the stored URL; team uses its own `logo_url`; game totals give none; returns `{ url, verified }`; no `updateMetadata` (`apps/api/src/pick-asset-resolver.test.ts`, 17/17).
- [x] One overall 5s artwork budget covers the participant lookup and the re-resolve; a never-returning matcher at the default budget lets submission complete at ~5s with no thumbnail and `thumbnailVerified` absent.
- [x] Submission passes the resolved participant ID at both call sites (primary and shadow), sets `thumbnailVerified` only from the resolver, and strips caller-supplied `thumbnailUrl`/`thumbnailVerified` before persisting (`apps/api/src/submission-service.test.ts`, 112/112 including 7 new).
- [x] Regressions fail on unmodified main and pass after (see EVIDENCE). `player-enrichment-service.ts` not edited.
- [x] Mutations (a) selection-text matching, (b) unconditional worker thumbnail, (c) any-host `mediaUrl` each fail tests (`mutations/`).
- [x] Rendered-embed before/after fixtures (`rendered-embeds/`): shared, unverified, legacy, caller-supplied and dead-host images render no thumbnail after, every embed still sends, verified image renders.
- [x] New tests registered in root `package.json` (`test:apps-api-core`, `test:apps-rest`, `test:domain-analytics`) and reached by `pnpm verify` (executable-wiring verdict PASS, 0 new unwired).
- [x] No change to targets, kill switches, outbox, receipts, audience, entitlement, delivery timing or Track Only gating; no schema change, no new media host, no production write.
- [ ] Exact-head `pnpm verify` green in CI (local run: static stage green except two root-only `proof-check` mktemp fixtures, below; live stage needs staging credentials).
- [ ] Exact-head `Writable DB proof (staging only)` CI job green, including the new metadata-shape suite with no skip.
- [ ] Copy of the v2 protected-path request and review findings.
- [ ] Merge SHA binding, Griff `t1-approved` label and exact-head `pm-verdict/v1` APPROVED.

## EVIDENCE:

Regressions on unmodified main (`regression/main-*.txt`). The domain and resolver test files fail at
import on main because the new exports do not exist yet, so the behaviours were also probed against
main's own API (`regression/probes/`):

```
main resolver probe (resolvePickThumbnailUrl on main):
not ok 1 - ambiguous name: two "Smith" players must give no thumbnail
not ok 2 - last-name-only match must give no thumbnail
not ok 3 - unrelated player: a pick on Bronny must not show LeBron
not ok 4 - shared stored URL must give no thumbnail
not ok 5 - dead NHL host must give no thumbnail
not ok 6 - two-team total must give no thumbnail
# pass 0  # fail 6

main domain probe (buildPickPresentation on main):
not ok 1 - dead NHL host must render no thumbnail
not ok 2 - foreign host must render no thumbnail
not ok 3 - suffix-spoofed host must render no thumbnail

main worker (delivery-adapters.test.ts with new tests): # pass 25 # fail 4
not ok 25 - drops an unverified thumbnail and still builds the embed
not ok 26 - drops a thumbnail flagged with a non-boolean verified value
not ok 28 - drops a verified dead-host NHL thumbnail
not ok 29 - an unverified thumbnail is dropped while the Discord message still sends

main submission (WORK-2026110302 tests): # pass 0 # fail 7
not ok 1 - a last-name-only selection never attaches a thumbnail
not ok 2 - the selection text never substitutes an unrelated player's photo
not ok 3 - a verified headshot for the resolved participant is persisted with thumbnailVerified
not ok 4 - caller-supplied thumbnailUrl and thumbnailVerified are stripped before persisting
not ok 5 - a caller-supplied thumbnailVerified cannot upgrade an unverified resolver result
not ok 6 - a resolver that never returns cannot hold submission past the 5s artwork budget
not ok 7 - shadow submissions strip caller artwork and use the same verified resolver

main write-back (apps/api/src/pick-asset-resolver.ts:49-52 on main):
participants.updateMetadata(playerMatch.id, { headshot_url: resolvedHeadshot }).catch(() => {});
```

After (`regression/head-*.txt`):

```
packages/domain/src/discord-presentation.test.ts   # pass 17  # fail 0
apps/worker/src/delivery-adapters.test.ts          # pass 29  # fail 0
apps/api/src/pick-asset-resolver.test.ts           # pass 17  # fail 0
apps/api/src/submission-service.test.ts            # pass 112 # fail 0
```

Mutations (`mutations/`):

```
a-selection-text-matching        submission-service.test.ts  # fail 2
b-unconditional-worker-thumbnail delivery-adapters.test.ts   # fail 3
c-any-host-mediaUrl              discord-presentation.test.ts # fail 8; delivery-adapters.test.ts # fail 1; pick-asset-resolver.test.ts # fail 2
```

Rendered embeds (`rendered-embeds/`, `thumbnail` field; every case `sends=true`):

```
case                          before-main                         after
shared-url-unverified         cdn.nba.com/.../2544.png            null
legacy-no-flag                cdn.nba.com/.../2544.png            null
caller-supplied-foreign-host  example.com/someone-else.png        null
dead-nhl-host                 cms.nhl.bamgrid.com/.../8478402.jpg null
verified-headshot             cdn.nba.com/.../2544.png            cdn.nba.com/.../2544.png
```

Local `pnpm verify:static` (cloud session, `local.env` copied from `.env.example`):

```
automation-coverage verdict=PASS; executable-wiring verdict=PASS (new=0)
lint PASS; type-check PASS; build PASS
pnpm test: pass 8028, fail 2, skipped 12
  fail: scripts/ops/proof-check.test.ts "a command that cannot be a commit is allowed even when no
  temp file can be allocated" and "a real commit still fails closed when no temp file can be
  allocated" — fixture asserts mktemp fails under a read-only TMPDIR; the session runs as root
  (uid 0), so mktemp succeeds. Environmental; file untouched by this lane.
test:production-post-migration, smart-form verify, verify:commands: PASS
```

`pnpm test:live-db` and the new staging suite were not run locally (no staging credentials; the
suite skips without `CI_FIXTURE_RUN_ID` and asserts the staging host before any privileged client).

## Merge SHA Binding

Merge SHA: pending merge
PR: pending
