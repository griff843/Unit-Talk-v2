# PROOF: WORK-2026092901

MERGE_SHA: 2139ebe071fdf68c9f65a3d0172e63f78b72617d

> Pre-merge the merge row is intentionally the placeholder; the Execution SHA row carries the
> verified implementation identity. `post-merge-lane-close.yml` rebinds merge authority only
> after GitHub supplies the merged-PR attestation.

Generated at: 2026-09-29T15:45:00.000Z
Issue: WORK-2026092901
Tier: T1
Lane type: runtime
Branch: claude/work-2026092901-official-picks-exactly-once
Head SHA: 6b7ea5733b37f747bfae660d61a881dc55d322cf
Execution SHA: 6b7ea5733b37f747bfae660d61a881dc55d322cf
Diff base: f81c65e57c60d9fd6968aa711ebab6e52183dd22
result: pass

> Makes it safe to release exactly one intentionally delivery-eligible official pick: members see
> only genuinely delivered official picks, a Discord post cannot be sent twice, the message is an
> official pick and not a canary, and releasing `official-picks` releases no recap. It changes no
> kill switch, no containment setting and no data.

## ASSERTIONS:

Each box is asserted by a named test at the Execution SHA.

### A. Member pick truth (server-side)

- [x] A member-visible official pick is `posted` or `settled`, `delivery-eligible`, **and** carries a
      server-allowlist `authorized` delivery decision read through the one strict reader. Track Only
      picks, fixtures, scanner rows and queued or refused picks are excluded. Asserted by
      `the contracts predicate admits exactly the member-visible cases` (`member-picks.test.ts`).
- [x] `GET /api/member/picks` returns only such picks, and projects metadata to capper, sport,
      eventName, eventTime and thesis only. Asserted by `GET /api/member/picks returns only
      posted/settled authorized official picks` and `member metadata is projected to …`.
- [x] The route fails closed: a missing status is 400, and a repository without the reader is 503.
- [x] **The route is not public.** It is dispatched below the API auth gate. An anonymous request
      and an unconfigured bearer token are 401; an authenticated generic submitter or worker key is
      403; neither response contains any pick id or content. The Discord bot's service key
      (`submitter:discord-bot`) and an operator key read exactly the member-visible picks. Asserted
      by `anonymous GET /api/member/picks is refused with 401 and leaks no pick`, `an authenticated
      key that is neither operator nor the Discord bot is refused with 403`, `the Discord bot service
      key and an operator key read exactly the member-visible picks` and `canReadMemberPicks admits
      only an operator or the Discord bot service identity`.

### B. Exactly-once delivery

- [x] **The double-post window is closed.** An abort, a throw, a 5xx or a watchdog timeout
      *after the request was issued* is never re-posted. Asserted by `(a)`, `(a2)`, `(b)` and
      `(c)` (`official-picks-exactly-once.test.ts`).
- [x] Delivered-then-confirm-failure: the next claim confirms from the ledger with **zero new
      POSTs** — `(d)`. Crash or reclaim with an unresolved attempt dead-letters with zero POSTs — `(e)`.
- [x] An existing sent receipt refuses dispatch with zero POSTs — `(g)`. An audit repository that
      cannot read the ledger refuses with zero POSTs — `(h)`.
- [x] Only an audited operator reconciliation through the ambiguous attempt allows one fresh post —
      `(i)`. A 4xx is a definite non-delivery, not ambiguous — `(f2)`.
- [x] Every official-pick POST carries the row's `nonce` with `enforce_nonce: true` — `adapter:
      every official-pick POST carries the row nonce with enforce_nonce`.
- [x] Retry refuses `ALREADY_DELIVERED` on a sent receipt or a ledger delivered marker, refuses an
      ambiguous attempt without `confirmedNotDelivered`, records the reconciliation before resetting
      the row, and returns 503 on an unreadable ledger (`official-picks-release-controls.test.ts`).
- [x] Replay cannot target official-picks (2 pins in `replay-failed-delivery.test.ts`).

### C. Official-pick presentation

- [x] Footer "Unit Talk | Official Picks", never the Canary footer. Market, Odds (bare American
      price), Units, Capper, Game Time, Thesis; no confidence, edge, implied probability, record or
      CLV. The canary lane keeps its footer (`official-picks-embed.test.ts`, 10 tests).
- [x] **Game Time is always rendered.** An eventless or manual pick, an empty time or an
      unparseable time shows the `OFFICIAL_GAME_TIME_UNKNOWN` fallback (the "to be determined"
      marker exported from `delivery-adapters.ts`); a pick with `eventTime` or `gameTime` shows that
      time. Asserted by the three Game Time tests in `official-picks-embed.test.ts`: the eventless
      and manual cases, the real-time case, and the exact field order `Market, Odds, Units, Capper,
      Game Time, Thesis`.

### D. Recap containment

- [x] Recaps about human-capper picks are stopped unless **both** `official-picks` and
      `human-capper-recaps` are released. A missing row, an explicit kill or a missing repository is
      stopped. Asserted by the five `recap gate:` tests.
- [x] Releasing `official-picks` alone does not release the settlement recap — `settlement recap:
      official-picks released alone does not release the recap`.
- [x] The kill-switch route accepts the recap control; a release requires a reason; engaging never
      does.
- [x] The UTV2-1923 tests that pinned "releasing `official-picks` releases the recap" now release
      both controls, which is the new contract. `t1-proof-utv2-1923-human-capper-delivery.test.ts`:
      49 pass, 0 fail.

### Nothing else changed

- [x] No migration, no row written by this change, no kill switch or containment setting touched.

## MUTATION CONTROLS:

Each mutation was applied and the file restored byte-identical afterwards (`git status --porcelain`
empty). They were measured on the lane's first implementation commit `809462886`. The lane was then
restarted to move its live proof into an already-classified live-proof file. `git diff --stat
809462886 6b7ea5733b37f747bfae660d61a881dc55d322cf -- apps packages package.json` shows that only
the live-proof files, `package.json`, and Command Center files merged to `main` by another lane
differ, plus the UTV2-1923 test's release helper (it now also releases `human-capper-recaps`). Every file mutated below is byte-identical at the Execution SHA.

| Mutation | Suites | Observed |
|---|---|---|
| M1 — `isLedgerGovernedTarget` returns false (ledger off) | exactly-once + embed | **12 fail** / 18 pass |
| M2 — `enforce_nonce: false` | exactly-once + embed | **2 fail** / 28 pass |
| M3 — recap gate follows `official-picks` only | release-controls | **3 fail** / 15 pass |
| M4 — member predicate ignores the delivery authorization | member-picks | **3 fail** / 7 pass |
| M5 — Game Time dropped when no time is known (the previous behavior) | embed | **2 fail** / 8 pass |
| M6 — member route dispatched outside the auth gate | member-picks | **2 fail** / 12 pass |
| M7 — access policy admits any submitter or worker key | member-picks | **2 fail** / 12 pass |
| Baseline | all four | 58 pass / 0 fail |

M5–M7 were measured at the Execution SHA `6b7ea5733b37f747bfae660d61a881dc55d322cf` and each file was restored
byte-identical afterwards.

## EVIDENCE:

Measured read-only against production `zfzdnfwdarxucxtaojxm` on 2026-09-29. Nothing was written.

The member predicate, applied with the Database reader's own narrowing:

```sql
select left(id::text,8) pick, status, metadata->>'distributionMode' mode,
       metadata->'deliveryAuthorization'->>'decision' decision,
       metadata->'deliveryAuthorization'->>'version' ver,
       metadata->'deliveryAuthorization'->>'authority' authority
from picks
where status in ('posted','settled')
  and metadata->>'distributionMode' = 'delivery-eligible'
  and metadata->'deliveryAuthorization'->>'decision' = 'authorized'
order by created_at desc;
-- ed0ed43c | posted  | delivery-eligible | authorized | human-capper-delivery/v1 | server-allowlist
-- 816a84c7 | settled | delivery-eligible | authorized | human-capper-delivery/v1 | server-allowlist
```

```sql
select
 (select count(*) from picks where status in ('posted','settled'))                                        as posted_or_settled_all,     -- 25594
 (select count(*) from picks where status in ('posted','settled') and metadata ? 'distributionMode')        as governed_posted_or_settled, -- 2
 (select count(*) from picks where status in ('posted','settled') and metadata->>'distributionMode'='track-only') as track_only_posted_or_settled, -- 0
 (select count(*) from picks where metadata->>'distributionMode'='track-only')                              as track_only_all,            -- 7
 (select count(*) from audit_log where action like 'distribution.dispatch_%')                               as dispatch_ledger_rows,      -- 0
 (select count(*) from delivery_kill_switch where target='human-capper-recaps')                             as recap_control_rows;        -- 0
```

Of 25,594 posted or settled picks, the member route admits exactly the two genuinely delivered
official picks; the 25,592 others (fixtures and historical scanner rows) and all 7 Track Only
picks are excluded. The ledger starts empty, so no existing row is reinterpreted. The recap control
has no row and therefore reads as killed.

```text
focused suites at the Execution SHA
official-picks-exactly-once.test.ts   pass 23 fail 0
official-picks-embed.test.ts          pass 10 fail 0
dispatch-ledger.test.ts               pass 10 fail 0
member-picks.test.ts                  pass 14 fail 0
official-picks-release-controls.test.ts pass 18 fail 0
replay-failed-delivery.test.ts        pass 18 fail 0
delivery-adapters.test.ts             pass 8  fail 0
worker-runtime.test.ts                pass 75 fail 0
recap-service.test.ts                 pass 27 fail 0
server.test.ts                        pass 60 fail 0
grading-service.test.ts               pass 99 fail 0
http-integration.test.ts              pass 27 fail 0
```

## Verification

- [x] `pnpm type-check` — exit 0 at the Execution SHA.
- [x] `pnpm lint` (eslint over every changed `.ts` file) — exit 0.
- [x] `pnpm test` — exit 0 at the Execution SHA: 7192 pass, 0 fail, 1 skipped (after `pnpm build`). At the previous Execution SHA `fcaabcf82` every test file referenced by `package.json` was also run independently: 317 files, 0 failing; this change adds no test file.
- [x] `pnpm exec tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD` — Verdict PASS,
      33 changed files, rules matched: lifecycle-fsm; r4-fault-report advisory only [PM-gated].
- [x] The two live read cases in `apps/api/src/t1-proof-work-2026092802-track-only-intent-live.test.ts`
      (an existing, classified live proof, so no new credentialed test is introduced) run under `test:t1-proof:live` inside CI's staging environment; locally `SUPABASE_URL` is the
      containment placeholder, so it cannot run here.

## Runtime Verification

The runtime evidence is the read-only production measurement above plus the live staging proof in
CI. No production write, kill-switch change, containment change or deploy was made. Releasing
`official-picks` remains Griff's decision under `DELIVERY_KILL_SWITCH.md` §8.

## Merge SHA Binding

Merge SHA: 2139ebe071fdf68c9f65a3d0172e63f78b72617d
PR: pending
Execution SHA: 6b7ea5733b37f747bfae660d61a881dc55d322cf
