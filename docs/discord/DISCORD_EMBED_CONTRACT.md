# Discord Automated Message Presentation Contract

Updated: 2026-10-03 · WORK-2026100301

This contract describes the presentation implemented in `packages/domain/src/discord-presentation.ts`, the worker delivery adapter, API recap service and Discord bot. Membership, routing, access, settlement and activation contracts retain their authority. Presentation never authorizes a channel, member, promotion or trigger.

## Shared presentation

Default accent is gold `#C7A34B`, with white content and black/dark surrounding UI supplied by Discord. Every embed starts with the shared builder and Unit Talk footer. Discord controls fonts, background and field wrapping; these cannot be forced by an embed.

Mobile hierarchy: family/outcome and selection first, then market and canonical wager details, attribution, supporting evidence and optional media. Recap pages use at most six fields and one embed per message. Slash-command boards use descriptions split within the description limit.

Only actual settled outcomes use semantic accents: Win `#22C55E`, Loss `#EF4444`, Push `#9CA3AF`, Void `#64748B`, Correction `#8B5CF6`. Aggregate recaps and performance records stay gold regardless of net profit. Winners and losers use the same detail fields.

## Truth and optional data

- Public scoring confidence and High/Medium/Low confidence labels are forbidden, even when source data contains them. Capper submission input and internal settlement evidence remain separate from public presentation.
- Whitelist canonical display inputs. Never spread arbitrary pick metadata into an embed. Confidence minus implied probability is not EV or market edge.
- No invented EV, edge, probabilities, statistics, records, sportsbook, identity, prices or timestamps. Current worker pick builders do not publish these unsupported enrichments.
- Unknown fields disappear; no fake zero, default one-unit stake, Unit Talk capper attribution, TBD time or unknown placeholder. An actual measured numeric zero remains visible.
- CLV renders only from a finite canonical settlement/API measurement. `null`, unknown or a missing sample disappears. A measured `0.0%` remains visible. Stats/profile average CLV requires its canonical sample. Existing stats small-sample rules remain unchanged.
- Only source timestamps render. No rendering-time clock masquerades as posted/event/settled time.
- Optional media requires a valid HTTPS URL; absence or invalid media never blocks text delivery. No lookup or invented fallback asset is required.

## Family inventory and wiring

| Family | Implemented presentation | Existing runtime use |
| --- | --- | --- |
| Official Pick | Selection, market, odds, units, capper, known game time, thesis | Worker governed human-pick targets |
| Pick Posted | Same whitelist and brand | Worker other existing targets; slash submission confirmation uses shared base |
| Win / Loss / Push | Outcome, selection, market, P/L, odds, stake, capper, measured CLV | Existing settlement-result adapter and command recap |
| Void / Correction | Same details, correction previous/effective result | Builder only; existing grading normalizer does not wire these states |
| Daily / Weekly / Monthly Recap | Record, known net/ROI, sample, top play, every supplied settled pick; continuation pages | Existing API scheduler/manual posting and bot recap |
| Capper Record / Profile | Source record, sample, measured ROI and sampled CLV | /stats record; profile standalone builder |
| Leaderboard | Every returned ranked row, source sample/window | /leaderboard |
| Welcome | Known member and next step | Builder only |
| Trial Started / Expiring | Known expiry, approved access copy | Builder only; /trial-status uses shared brand on its existing response |
| Upgrade | Approved support path; no invented VIP+ price | /upgrade |
| Service Alert | Message, optional impact/action | Existing command unavailable/empty responses; no new event trigger |
| Access Denied / Bot Error | Private response specification | Router and command errors |
| Capper Onboarding | Canonical intake/stats/recap/contact guidance | Existing role-add onboarding handler |
| System Maintenance | Message, optional impact/action | Builder only |

Existing line-movement, steam, hedge/arbitrage/middle and injury notification
builders also consume the shared gold Service Alert presentation. Their existing
activation, detection, cooldown and routing decisions are unchanged; builder
availability does not claim those lanes are activated. Grading and ingestor
operations webhooks use the same Service Alert builder without a synthetic timestamp.
Existing grading/ingestor/worker/backup monitor scripts and operations daily-digest
and stale-lane notifications use that builder too; their destinations, schedules,
and alert conditions are preserved.
Unknown steam counts/window, first-mover book, hedge probability and guaranteed
profit are omitted instead of borrowing or defaulting metrics. Known source
bookmaker/line information remains available in these notification records.

Compatibility singular recap/leaderboard accessors return the first page for old callers. Live multi-page paths use plural builders. Builder availability is not activation.

## Size, visibility and delivery

Discord limits: title 256, description 4096, field name 256, field value 1024, at most 25 fields, combined embed text 6000 characters per message and at most 10 embeds. Shared recap pagination splits field content by Unicode code point, preserves all supplied rows and sends one embed per message. API recap continuations retain the original first-page idempotency key and add stable page suffixes; retries skip pages already sent.

No top-ten cutoff may hide losses in a supplied recap. Existing API query windows, caps, Track Only exclusions and evidence-plane exclusions remain unchanged. This presentation change does not claim complete history beyond those source boundaries.

Access denial and bot failures stay ephemeral, including failures after a public leaderboard defer: delete the deferred public response and send a private follow-up. Detailed diagnostics stay in operator logs.

Worker route checks, message nonce, receipts and dry-run behavior remain unchanged. API recap channel selection and delivery ownership remain unchanged. Missing media does not change delivery authority.

## Commercial truth

Membership authority: [Membership Product Contract](../03_product/MEMBERSHIP_PRODUCT_CONTRACT.md). VIP+ price is reserved and never synthesized; Black Label is unavailable for purchase or activation. Settled results and recaps are transparent to all member tiers. Upgrade copy must not sell settled history as exclusive paid access.

## Separate product/routing gaps

The existing grading result-channel resolver follows the original delivery receipt channel. This does not establish all-tier visibility required by membership. Resolve through a separately approved routing/access plan; this change does not reroute or create channels.

Void/correction delivery wiring, complete corrected-history aggregation and missing-stake grading behavior are outside this presentation packet. The recap-channel document's older delete/replace correction guidance also needs a policy reconciliation with append-only correction/history requirements.

QA sandbox credentials and role/channel map are absent in this local environment. Local desktop/mobile fixture rendering is evidence of presentation only, not proof of live Discord delivery or channel access.

## Related authorities

- [Discord server architecture](../03_product/DISCORD_SERVER_ARCHITECTURE_CONTRACT.md)
- [Routing](../05_operations/discord_routing.md)
- [Closing-line wiring](../05_operations/T2_CLV_SETTLEMENT_WIRING_CONTRACT.md)
- [Presentation design](discord_embed_system_spec.md)
- [Asset policy](discord_embed_system_spec_addendum_assets.md)
