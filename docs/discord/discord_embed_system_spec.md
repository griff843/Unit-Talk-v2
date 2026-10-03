# Unit Talk Discord Automated Message Design System

Updated: 2026-10-03 · WORK-2026100301

The [Discord Embed Contract](DISCORD_EMBED_CONTRACT.md) is the implementation-aligned presentation reference. Canonical membership, Discord access, routing and settlement contracts govern policy. This document replaces the older design examples that permitted confidence-derived EV and unrelated target colors.

## Premium presentation

Use gold `#C7A34B` as the default accent, white content and the Discord dark surface. The platform controls typography/background; the bot supplies a short family title, selection/outcome, sparse labeled details and Unit Talk footer. Use sentence case and factual, calm copy. Avoid developer routing/scoring explanations in member messages.

Lead with the member's decision or outcome. Pick messages show selection, market, odds, units and real capper, with source game time and thesis when available. Settled messages give losses the same detail as wins. Only actual Win/Loss/Push/Void/Correction states receive semantic colors.

Recaps remain gold, show sample/window alongside record and measured financial results, and retain every supplied settled row through continuation pages. Do not hide losing picks behind a top-play highlight. Page numbering and <=6 fields support mobile reading.

## Truth rules

No public confidence or High/Medium/Low confidence language. No confidence-derived EV/edge, invented probabilities, capper statistics, book, timestamp, stake or prices. Null/unknown values disappear. Measured zero remains visible. Average CLV needs a canonical measurement and sample; source-free CLV trends are absent.

Use the pure shared builders and bot transport helpers instead of independent embed colors. Media is optional HTTPS enrichment; text works without assets. Private denials/errors remain private even when a successful command normally posts publicly.

## Launch families

Official Pick, Pick Posted, Win, Loss, Push, Void, Correction, Daily/Weekly/Monthly Recap, Capper Record/Profile, Leaderboard, Welcome, Trial Started/Expiring, Upgrade, Service Alert, Access Denied, Bot Error, Capper Onboarding and System Maintenance have shared specifications/builders.

Consult the contract's wiring table before describing a family as live. Welcome, automated trial lifecycle, maintenance, profile, Void and Correction builders do not introduce triggers. Market movement, injury, hedge, middling and other older illustrative families are not activated by this packet.

## Approval boundary

No new channels, permissions, tier access, commercial terms, promotions, scoring or settlement changes. VIP+ terms remain reserved; Black Label remains parked and unpurchasable. Report settled-results transparency/routing disagreements for PM resolution.

## Verification

Deterministic tests cover source confidence exclusion, missing/zero CLV, optional fields/media, outcome distinctions, private errors, commercial copy and long recap preservation. Inspect actual serialized builder fixtures at desktop/mobile widths; use Discord sandbox only when configured and authorized. Local previews cannot prove Discord access or transport.
