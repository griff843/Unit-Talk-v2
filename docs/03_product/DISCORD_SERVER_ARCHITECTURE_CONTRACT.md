# Discord Server Architecture Contract

## Metadata and authority

| Field | Value |
| --- | --- |
| Owner | Griff — product owner; Discord operations owns configuration execution |
| Status | PM-approved target architecture; this implementation contract is submitted for PM review under UTV2-1945 |
| Scope | Final customer navigation, channel jobs, access, publishing boundaries, and migration acceptance for guild `1284478946171293736` |
| Authority | Canonical destination for Discord server architecture when this PR is ratified; not proof of current availability |
| Ratification dependency | Griff's supplied September 19, 2026 blueprint and locked decisions; governed review of this contract. Production migration and delivery activation require separate authorized execution |
| Membership authority | [Membership Product Contract](MEMBERSHIP_PRODUCT_CONTRACT.md) remains authoritative for tier promises, prices, transparency and activation |
| Implementation authority | Current code and exact-SHA evidence, [role/access mechanics](MEMBER_ROLE_ACCESS_AUTHORITY.md), [routing](../05_operations/discord_routing.md), [command catalog](DISCORD_COMMAND_CATALOG.md), and [embed contract](../discord/DISCORD_EMBED_CONTRACT.md) describe their bounded implementation domains |
| Operations companion | [Discord Server Migration Plan](../05_operations/DISCORD_SERVER_MIGRATION_PLAN.md) — complete channel accounting, roles, dependencies, waves and tests |
| Readiness | [Production Readiness Contract](../05_operations/T1_PRODUCTION_READINESS_CONTRACT.md) remains the only overall readiness authority |

This contract adds no deployment, purchase, role grant, runtime target, or kill-switch permission. It does not modify the membership contract. The target is derived from the completed **Unit-Talk-Discord-Audit-2026-09-19.md**, not another discovery exercise. The migration plan records the evidence boundary and conflicts with older documents.

## 1. Product principles

Use a short, predictable navigation path from orientation to proof, membership, paid picks and support. Each surface has one job; avoid duplicate sales, result, alert and support channels. Names, topics and first messages must explain that job on mobile without exposing internal implementation details.

Preserve capper identity and fast access to all paid official picks. Publish a complete settled record, including losses, pushes, voids and disclosed corrections. Give operators traceable automation and actionable failures. Premium presentation means concise, consistent and supported content, not fabricated precision, engagement filler, false urgency or guaranteed outcomes.

The truthful value progression is Free proof after settlement; Trial complete VIP for its valid duration; VIP all official picks, core community and education; VIP+ additional actionable intelligence around those bets; Black Label future personalized portfolio and risk services. A higher tier is never a reason to withhold an official pick promised to VIP.

## 2. Exact PM target tree

```text
🏁 START HERE
  👋・start-here
  📢・announcements
  💎・membership
  🎭・self-roles
  ⚖️・rules-responsible-play

📊 RESULTS & PROOF
  ✅・results
  📈・recaps
  🤖・member-tools

🔓 FREE VALUE
  💵・free-daily-picks

🌳 COMMUNITY
  💬・general
  ⚡・sports-talk              [forum]
  💡・suggestions              [forum]

🆘 HELP & SUPPORT
  📚・help-center
  🎫・support
  👑・priority-support

👑 VIP • OFFICIAL PICKS
  👑・cappers-space            [forum]
  🎯・official-picks
  🔥・best-bets
  💬・vip-lounge
  📺・game-day-live
  📚・education-vault

⚡ VIP+ / VIP EDGE
  💡・trader-insights
  🧠・strategy-lab

⬛ BLACK LABEL                 [PARKED / FUTURE]
  ⬛・black-label-desk
  🏛・syndicate-room
```

Eight categories, 25 named target surfaces, three forums. The last category and its two surfaces are **FUTURE / PARKED — NOT ACTIVE, NOT PURCHASABLE**; they are architectural reservations, not instructions to create channels or roles now. No new customer voice channel is part of this blueprint. Internal workspace, diagnostics, private tickets and retained archives sit outside the customer tree and remain protected.

The literal category label `VIP+ / VIP EDGE` preserves the blueprint. It does **not** ratify a public tier rename: customer tier references remain VIP+, and canonical `vip-plus` remains unchanged. Do not publish a separate VIP Edge plan or price.

## 3. Access and action profiles

The channel catalog's audience and permission profile are normative together. A viewer permission is not a posting permission. Trial means an unexpired, reconciled entitlement. P = public member audience (Free, Trial, VIP, VIP+); V = Trial + VIP + VIP+; E = VIP+ only. Internal roles do not manufacture customer membership.

| Profile | View | Send/top-level posts | Create threads/forum posts | Reply | React | Bot, Capper, Moderator, Operator/Admin behavior |
| --- | --- | --- | --- | --- | --- | --- |
| REF | Catalog audience | Named content owner through Operator; approved publishing bot | No member-created threads; Operator only when explicitly needed for navigation | No member replies | Viewers, except interactive controls require their own authorization | Bot publishes reviewed reference versions; Capper contributes through owner, not direct posting; Moderator handles safety; Operator maintains content/links; Admin configures |
| FEED | Catalog audience | Approved canonical producer only | No customer or Capper threads; producer/Operator only for controlled updates | No customer or Capper replies | Viewers | Bot publishes canonical data; Capper uses intake, never injects picks; Moderator handles abuse without rewriting performance; Operator repairs through source/correction workflow; Admin configures |
| CHAT | Catalog audience | Authorized human viewers | Operator/Moderator may create focused threads; members may reply, not create extra sidebar surfaces | Authorized viewers | Authorized viewers | Bot only approved utility/moderation, no filler; Capper participates as identified contributor; Moderator moderates; Operator/Admin maintain |
| FORUM | Catalog audience | Forum posts by authorized viewers | Authorized viewers, subject to required tags and guidelines | Authorized viewers | Authorized viewers | Bot may label/route approved workflows; Capper same audience rules; Moderator triages and locks; Operator/Admin maintain |
| CAPPER | V plus explicit Capper workspace function | Bot/Operator creates roster posts; canonical producer writes Official Picks; Capper/member conversation only in Q&A | Bot/Operator only | Q&A: V and authorized cappers; Official Picks: canonical bot only | Viewers in active threads; archived-thread limits apply | See §5: locked Official Picks, open Q&A, no Capper Manage Threads; Moderator/Operator privileges are audited, not permission to inject official picks |
| TOOLS | P; output separately gated | Approved command responses only; no general member chat | None | No free-form replies; authorized interactions only | Disabled for command output | Bot checks caller's current entitlement per action; Capper intake remains internal; Moderator cannot bypass output authorization; Operator diagnostic commands remain internal |
| TICKET | Catalog audience sees entry panel | Support producer/Operator maintains panel | Only authorized ticket workflow creates private ticket surfaces | Requester and assigned support agents in private ticket only | Panel controls only; ticket reactions as support policy permits | Bot validates identity/tier; Capper has no special access to others' tickets; Moderator assigned abuse cases; Operator assigned support; Admin audited configuration |
| PARKED | No customer access | None | None | None | None | No bot producer, Capper grant, role sale, activation or launch obligation; owner retains design reservation only |

**Internal access matrix.** Public rows are P, paid rows V or E. Scope-based internal access is for work, not an upgrade.

| Persona | P | V | E | Private support / internal workspace | Authority boundary |
| --- | --- | --- | --- | --- | --- |
| Free/default | Yes | No | No | Own general-support ticket only | No Member role prerequisite for public help/proof |
| Trial | Yes | All | No | Own priority ticket | Seven consecutive days; effective expiry revokes paid access |
| VIP | Yes | All | No | Own priority ticket | Includes Best Bets, all cappers and Education Vault |
| VIP+ | Yes | All | All | Own priority ticket, highest paid queue priority | Every VIP entitlement remains included |
| Capper | Yes | Cappers-space professional workspace only; other V surfaces require independent entitlement | No, unless independently entitled | Assigned capper onboarding/intake workspace | Professional access to the shared forum necessarily exposes its shared posts; this limited operational grant is explicit, not VIP/VIP+ membership |
| Moderator | Yes | Assigned moderation scope | Assigned moderation scope only | Assigned reports/tickets and moderation logs | No billing/entitlement grant or canonical pick publication power |
| Operator | Yes | Assigned delivery/support/content operations scope | Assigned operations scope | Assigned operations and support queues | Runtime operator mapping must be explicit; not inferred from Staff name |
| Admin / Owner | Administrative access | Administrative access | Administrative access | Audited administration | Technical override does not authorize manual falsification, activation or pricing changes |
| Unit Talk Bot | Only required destinations | Only required destinations | Only separately activated required destinations | Approved intake/diagnostic APIs and channels | Least privilege; no blanket Administrator; publisher/command identity mappings verified by IDs |
| Whop Bot | Commerce/access function only | No pick feed read/post permission needed | No intelligence read/post permission needed | Approved entitlement lifecycle only | May manage only approved customer entitlement roles below its role; never Staff/Admin/Capper |

Discord role allows can combine across roles and overwrites. Removing one entitlement role is insufficient if another legacy role or member overwrite still grants access. Acceptance must check effective permissions, not just role names. Administrative and moderation accounts are not substitutes for real customer tests.

## 4. Channel catalog

All target states below are **Future target / migration required**, except Black Label **Parked**. An existing channel or historic bot message is not an independently proven Live implementation of its final job. The evidence-qualified component states appear in the migration plan's automation matrix. Each row inherits the complete action profile in §3, including Capper, Moderator and Operator/Admin behavior.

| Canonical surface | Category | Type | Audience / profile | Unique purpose and recurring content | Content / automation owner and safe failure |
| --- | --- | --- | --- | --- | --- |
| 👋・start-here | 🏁 START HERE | Text | P / REF | One short arrival checklist and server map: rules, membership, preferences, proof, picks and help | Community operations; reviewed onboarding publisher. Broken onboarding leaves a static working map and support link; no repeated welcome flood |
| 📢・announcements | 🏁 START HERE | Announcement | P / REF | Material service, product and scheduled community notices | Product operations publishes reviewed updates; timestamp/correct stale notices; no invented launch claims or automatic mass mentions |
| 💎・membership | 🏁 START HERE | Text | P / REF | One truthful tier comparison, availability and approved purchase/cancellation guidance | Commerce owner supplies approved terms; operations publishes. If checkout/access uncertain, show unavailable and support; never invent price or promise instant delivery |
| 🎭・self-roles | 🏁 START HERE | Text | P / REF | Sports/capper/alert notification preferences, including opt-out | Member-experience owner; approved preference bot. Controls alter preferences only; failures acknowledged privately and surfaced internally |
| ⚖️・rules-responsible-play | 🏁 START HERE | Text | P / REF | Server rules, responsible-play guidance and approved legal notices | Community/safety owner; reviewed static copy. Missing review blocks claims of legal completeness; support/report route stays visible |
| ✅・results | 📊 RESULTS & PROOF | Text | P / FEED | Complete settled official-pick ledger; individual outcomes and linked corrections | Settlement/publication owner; canonical settlement-to-public producer. Missing delivery is an operator exception; never omit losses or infer success |
| 📈・recaps | 📊 RESULTS & PROOF | Text | P / FEED | Daily, weekly, monthly statements and supported capper/sport/market aggregates | Reporting owner; canonical recap producer. Dedupe by defined window/version, surface delay; zero activity is not a fabricated record |
| 🤖・member-tools | 📊 RESULTS & PROOF | Text | P / TOOLS | Discover and invoke help, settled statistics, recap, membership status and activated tier-sensitive tools | Discord bot owner; per-action runtime authorization. Unavailable/error response is private; no raw diagnostics or paid data leakage |
| 💵・free-daily-picks | 🔓 FREE VALUE | Text | P / FEED | Explicitly designated Free selections/previews, distinct from paid active feed | Editorial/pick operations selects canonical Free designation; separate approved distribution mapping. Empty audit channel: no daily guarantee until cadence proven; publish only when a valid Free selection exists |
| 💬・general | 🌳 COMMUNITY | Text | P / CHAT | General member conversation and community introductions | Community/moderation owner; human-led. No automatic reproduction of active paid picks; route sports topics to sports-talk and account issues to support |
| ⚡・sports-talk | 🌳 COMMUNITY | Forum | P / FORUM | Sport/league conversations, relevant news and polls within topic posts | Community/moderation owner; human-led with optional approved feed. Stop a failed/noisy feed, preserve discussion, avoid paid-feed syndication |
| 💡・suggestions | 🌳 COMMUNITY | Forum | P / FORUM | Product ideas, general feedback and non-sensitive reproducible bugs | Product operations triages visibly without promising a ship date. Private/account details move to support; bot failure cannot claim ticket creation |
| 📚・help-center | 🆘 HELP & SUPPORT | Text | P / REF | Universal self-service answers, navigation, billing steps, notification help and public learning samples | Support content owner publishes versioned index/answers. Maintain readable text and support fallback, not attachment-only or Member-gated help |
| 🎫・support | 🆘 HELP & SUPPORT | Text | P / TICKET | General/account/billing/report intake, especially Free; always usable when paid access is missing | Support owner; approved private-ticket producer. On failure show staffed fallback contact/process approved by owner; do not expose billing details in channel |
| 👑・priority-support | 🆘 HELP & SUPPORT | Text | V / TICKET | One paid intake for Trial/VIP/VIP+; VIP+ highest internal queue priority | Support owner; entitlement-aware queue. No separate VIP+ support channel, invented SLA or silent drop; general support remains access-loss fallback |
| 👑・cappers-space | 👑 VIP • OFFICIAL PICKS | Forum | V + Capper function / CAPPER | Capper-specific Official Picks and Q&A, roster directory and performance navigation | Capper operations owns roster; canonical worker publishes. Missing pin/invalid thread fails closed and alerts operator; never reroute blindly |
| 🎯・official-picks | 👑 VIP • OFFICIAL PICKS | Text | V / FEED | Consolidated team-wide view of every official paid pick, with capper/source links | Delivery owner; future team-board projection. Independently track delivery or explicit exception for every pick; never replace capper destination |
| 🔥・best-bets | 👑 VIP • OFFICIAL PICKS | Text | V / FEED | Scarce, traceable promoted subset of official plays deserving extra attention | Promotion/delivery owner; governed qualification and canonical publisher. Qualification missing/failed means no Best Bet; approval alone is insufficient |
| 💬・vip-lounge | 👑 VIP • OFFICIAL PICKS | Text | V / CHAT | Paid community conversation beyond individual live games | Community owner; human-led. Keep event traffic in game-day-live and confidential support out of chat |
| 📺・game-day-live | 👑 VIP • OFFICIAL PICKS | Text with event threads | V / CHAT | Live-event discussion/reactions grouped by event, distinct from general lounge | Community owner creates/moderates event threads; automated event provisioning requires separate proven mapping. Human discussion can operate without claiming live-feed automation |
| 📚・education-vault | 👑 VIP • OFFICIAL PICKS | Text | V / REF | Maintained paid curriculum, recorded teaching and approved reference tools | Education owner reviews/indexes lessons; no personalized staking/portfolio service implied by generic education. Remove stale claims while preserving historical references |
| 💡・trader-insights | ⚡ VIP+ / VIP EDGE | Text | E / FEED | Actionable, sourced market/line/injury/hedge/middle context around bets, each capability activated separately | Intelligence owner; approved provider-to-alert producer. Stale/untrusted/missing inputs suppress actionable output and alert operator; no “sharp money” or personalized claim without evidence |
| 🧠・strategy-lab | ⚡ VIP+ / VIP EDGE | Text | E / CHAT | Deeper analytical discussion, methods, case studies and supported workshops | Research/community owner; human-led, activated tools only. Label experiments; personalized outputs private and authorized; no unproven AI coach or automatic wagering promise |
| ⬛・black-label-desk | ⬛ BLACK LABEL | Text reservation | None / PARKED | Future individual portfolio/risk/concierge service; no recurring output promised now | Griff future product ownership; no producer, sale, role or channel activation |
| 🏛・syndicate-room | ⬛ BLACK LABEL | Text reservation | None / PARKED | Future private portfolio/risk collaboration and high-touch sessions | Griff future product ownership; no producer, sale, role or channel activation |

## 5. Forum contracts

### Cappers-space

Maintain one Official Picks post and one Q&A / Discussion post for each **owner-confirmed active capper**, tied to canonical capper identity and stable thread IDs. Existing 11 names are an observed directory, not 11 authorized active publishers.

Names: `🎯 {Display Name} — Official Picks` and `💬 {Display Name} — Q&A / Discussion`. Use one canonical capper identity tag plus a post-kind tag (`Official Picks` or `Q&A`); add `Inactive / Historical` on retired entries. Display names may change but persisted identity, attribution and historical links must not split (including Griff / Griff843 / GRIFF). Map existing abbreviations and unmatched tags before removal.

A maintained roster index links both posts plus the capper's public settled performance in results/member-tools. Official threads remain paid while they contain active or historical paid-feed discussion. Free performance navigation must link to a safe settled projection, not a thread that also contains active picks.

**Enforcement:** forum posts inherit parent permissions; do not invent per-thread role overwrites. Keep Official Picks threads locked, with only the publishing service and audited thread managers able to write; keep Q&A unlocked for the authorized audience. Capper roles must not receive Manage Threads merely to answer Q&A. The bot must preserve the lock while posting/unarchiving, and tests must prove ordinary members/cappers cannot inject posts. Thread managers' technical privileges require audit and operational separation. See [Discord thread permissions and locked threads](https://docs.discord.com/developers/topics/threads). If the deployed client/API cannot preserve this behavior, block forum publication pending implementation proof; do not silently change the blueprint or substitute delete-after-post moderation.

Bot/Operator creates the two roster posts; members/cappers cannot create extra forum posts. Q&A is conversational, not an alternate canonical pick intake. All official picks originate through the approved intake and publication pipeline. Deleted starters require a restored navigation/index message or a carefully mapped replacement post; do not erase replies or break pinned destination IDs to repair presentation.

Inactive cappers are removed from the active roster, retained as historical, and have delivery disabled through a separately governed runtime change. Archive/lock their posts only after unresolved picks and corrections are accounted for. Never delete their losing history. Confirm the active roster, canonical IDs and thread mappings in migration Wave 0.

### Sports-talk

Retain one public forum. Use one consistent sport taxonomy with optional league tags, avoiding duplicate sport/league aliases presented as equivalent choices. Members may create appropriately tagged posts and reply. News/polls become posts here, not new sidebar channels. Moderators merge by linking and locking redundant discussions without destroying history. No active paid official-feed syndication; member opinions must not be branded official picks.

### Suggestions

One suggestion or non-sensitive product issue per post, tagged by kind and triage state. Members create/reply; moderators route; Product operations owns acknowledgement and disposition. State labels communicate received/under review/planned/closed without fabricated delivery dates. Account, billing, abuse details and private logs go to support. Closing an idea preserves the discussion and reason.

## 6. Pick and result invariants

1. **Capper Official Picks → consolidated Official Picks → selective Best Bets** are three views/jobs of canonical picks, not three independent submissions. Preserve capper attribution, original odds/stake/time, canonical internal correlation and links. A promotion may add visibility; it cannot remove the baseline official feed.
2. Current logical `discord:official-picks` resolves a **capper-pinned destination** in the Human Capper path. It is not evidence of a team-wide board. Do not repoint it to the new board and strand capper threads. A separately reviewed projection/routing design must track both destinations and failures without duplicate lifecycle transitions.
3. Best Bets must be a qualified subset, never every approved pick or a new “confidence” scale. Current promotion policy/source remains implementation authority; this contract neither changes thresholds nor authorizes activation. Missing/calibration-incomparable confidence, edge or ROI is never invented.
4. **Results = transactions; Recaps = statements.** Results publishes every eligible settled official pick, including losses, pushes, voids and corrections. Recaps aggregates that reconciled population by explicit window/timezone and supported breakdowns. Private Track Only picks, fixtures and simulations are not member official records.
5. Public fields include supported capper identity, event/market/selection, recorded odds, stake units, outcome, units won/lost, record and ROI with denominators/window. CLV requires canonical closing evidence; no data means unavailable, not zero. No internal diagnostic IDs/state dumps in member embeds; traceability stays behind safe links and receipts.
6. Corrections retain original history and disclose corrected values/reason/version, updating affected aggregates idempotently. Never delete a losing or inaccurate record merely to improve performance presentation. Privacy/legal removals require their own policy and preserved audit, not a statistics cleanup shortcut.
7. No unsettled paid picks, open-position details or paid intelligence reach Free through result pages, previews, search, attachments, buttons, command responses, DMs, social cross-posts or notification excerpts.
8. Every expected publication has success evidence or an operator-visible pending/failure exception. No empty channel or clean screenshot proves completeness.

## 7. Commands and notifications

Member-tools is the discoverable entry point, not the security boundary. Runtime authorization must apply in every channel, DM, component callback and cached response. Re-evaluate effective entitlement and expiry on each protected action; fail closed on ambiguity. Responses default private; only explicitly approved settled/public output may be public.

| Command family | Target entitlement | Location/output | Reconciliation required |
| --- | --- | --- | --- |
| Help, upgrade guidance, own trial status | P | member-tools; private personal status | Replace stale VIP+ trial/Black Label availability claims; never expose another member's account |
| Settled stats, leaderboard, recap/results lookup | P | member-tools; private by default, approved public settled aggregates only | Prove settled-only population, identity, completeness, correction and fixture exclusion; catalog's public leaderboard is an explicit exception requiring validation |
| Active official-pick/member functions | V | private response in authorized contexts | Trial expiry and actual runtime gates, not channel placement |
| Heat/line movement, advanced analytics and activated decision support | E | private; no public paid output | Audit found `heat-signal` without declared requiredRoles despite catalog tier-gated wording; deployed enforcement UNKNOWN |
| Pick intake | Capper function | Approved internal intake/Smart Form or authorized private command confirmation | Must use canonical API; forum write rights are not submission authorization |
| Operational diagnostics/alerts setup | Operator | Internal workspace/private | Verify configured operator role; no broad Staff fallback or public raw state |

The March command catalog's nine LIVE labels are historical assertions. This lane does not deploy, register or invoke commands. Advanced capabilities remain unavailable until their individual evidence and activation requirements pass.

Four separate role families: customer entitlements; internal functions; opt-in notifications/preferences; cosmetic/community roles. Notification roles grant **no paid visibility**, commands or internal permissions. Delivery intersects a valid entitlement with opt-in preference. Consolidate duplicate pick/strategy/event ping names after ID/member/panel mapping, retaining opt-outs. Start with understandable sport and event/official-pick choices; capper and advanced filters only when wired and proven. No blanket everyone/here pings, engagement spam or implied membership from a preference role.

## 8. Reconciliation and execution boundary

The companion plan is the only migration procedure derived by this lane. It accounts for all 65 source channels, roles, automation, waves and acceptance. Older conflicting tier/navigation rules are superseded for **target product design** by Membership plus this approved blueprint; current code, blocked-target controls, evidence standards and reserved activation remain unchanged.

Do not mutate Discord from this contract PR. Ratification establishes the destination. A future authorized migration must pass the access, data-truth, routing, rollback and real-persona checks before claiming a surface functional or Live.
