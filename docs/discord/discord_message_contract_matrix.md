# Discord Message Contract Matrix

Updated: 2026-10-03 · WORK-2026100301

Presentation source: [Discord Embed Contract](DISCORD_EMBED_CONTRACT.md). Routing source: [Discord routing](../05_operations/discord_routing.md), [server architecture](../03_product/DISCORD_SERVER_ARCHITECTURE_CONTRACT.md) and current route-resolution code. This supersedes the March matrix's stale live-target and score-threshold claims; it grants no activation.

| Runtime surface | Shared presentation | Routing/access authority retained |
| --- | --- | --- |
| Worker governed human picks | Official Pick, gold | Existing outbox target resolution and kill switches |
| Worker other admitted targets | Pick Posted, gold | Existing route gate; no new targets |
| Grading settled result | Semantic settled embed | Existing receipt-derived result channel |
| API recap | Gold summary and all supplied rows, paged | Existing recap channel resolver and dry-run policy |
| /stats, /recap, /results | Gold record/recap boards | Existing command role/API authorization |
| /leaderboard | Gold paged board | Existing approved public-success path |
| /trial-status, /upgrade | Gold membership guidance | Existing member truth, approved terms |
| Onboarding | Gold capper guidance | Existing role-add handler |
| Denied/error | Gold private response | Ephemeral transport, no access change |

Blocked targets remain blocked: `discord:trader-insights`, `discord:exclusive-insights`, `discord:game-threads`, `discord:strategy-room`. Do not infer permission from an available builder or obsolete design example.

The membership contract requires settled-result transparency across tiers. Current receipt-derived result routing does not establish it. This is an outstanding routing/product gap, not authorization to reroute production messages.

Builder-only families and all known policy/wiring gaps are enumerated in the embed contract. Scoring confidence is internal; it never renders publicly.
