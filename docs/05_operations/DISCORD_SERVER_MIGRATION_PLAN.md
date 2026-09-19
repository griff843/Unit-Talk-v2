# Discord Server Migration Plan

## 1. Authority, evidence and bounds

| Field | Value |
| --- | --- |
| Owner | Discord operations; Griff owns product ratification and reserved activation |
| Status | Proposed execution plan for PM review, UTV2-1945; **not executed** |
| Product authority | [Discord Server Architecture Contract](../03_product/DISCORD_SERVER_ARCHITECTURE_CONTRACT.md), subordinate to [Membership Product Contract](../03_product/MEMBERSHIP_PRODUCT_CONTRACT.md) for tier promises/prices |
| Input | Completed read-only `Unit-Talk-Discord-Audit-2026-09-19.md`, observed September 19, 2026, America/New_York; guild `1284478946171293736` |
| Audit baseline | `61871231560d5f2fd5eb1ddd83636179f4312423` |
| Main reviewed for finalization | `b5b26171b2245ad61aa8cb33b63e745b371db57d` |
| Evidence limitation | Role previews, channel/forum inventory and visible content; no purchase, commands, ticket creation, expiry, complete permission export or receipt/DB reconciliation |

The original audit artifact is retained by the requesting owner as `discord-audit/Unit-Talk-Discord-Audit-2026-09-19.md`, with its `audit-data.json` source inventory and screenshot index. This plan transcribes the complete non-private channel inventory and relevant observations so implementation does not depend on a machine-local screenshot path. Internal message bodies and private member information are excluded. Unknown IDs are explicitly unknown, not invented.

Observed: 10 categories, 65 channels (53 text, seven forums, four voice, one announcement), 11 visible capper spaces with 22 Official/Q&A posts, and 84 named roles plus @everyone. The target has eight categories and 25 named surfaces, including two parked reservations. Source forums/posts are not counted again as separate channels.

Since the audit baseline, main integrated the Command Center authority consolidation (#1616), readiness bookkeeping and UTV2-1943 closeout repair (#1617 plus sanctioned closeout). No intervening Discord runtime/product implementation change was found in that reviewed range. Preserve the new sole Command Center authority; no redesign or additional Discord discovery audit was performed.

**This PR edits documentation only.** No production channel/role/permission, message, command, Whop, pricing, runtime/configuration, kill switch or governance implementation is changed. The tables specify a future authorized migration; they do not authorize one.

## 2. Matrix conventions and preservation rules

Each numbered M-row is one of the 65 audit channels, exactly once. Current name/type/category/known ID are observations. Target, disposition and prerequisites are decisions for the approved blueprint.

- **H** means preserve source messages, attachments, links, attribution and correction history. This applies to every row, including empty shells until backup confirms their complete contents. Export success does not by itself authorize deletion.
- **ID keep** means retain the original channel ID and mutate only approved name/category/content/permissions later. **ID archive** means retain the old ID as a protected historical source; do not recreate it at the target. **ID hold** means make no structural change until the stated owner/dependency decision.
- **Archive A:** after Wave 0 backup, destination content/access validation and explicit operator sign-off, freeze and remove the old surface from customer navigation in Wave 4. Preserve an access-controlled archive and redirects/index links that do not expose private content. **No deletion is authorized by this plan.** Archive permissions may become narrower, never inadvertently broader.
- **Internal I:** retain outside the customer blueprint, with current restricted access until its named owner confirms least-privilege mapping. Do not bulk-sync workspace permissions or repoint diagnostics.
- **Hold U:** preserve existing configuration pending exact ID/usage/owner/dependency verification in the eventual Wave 0 execution. This is a bounded implementation prerequisite, not an invitation to reopen the customer blueprint.
- **P/V/E** are the contract audiences: P = public; V = Trial, VIP and VIP+; E = VIP+ only.
- **R0:** no canonical V2 target is identified in the audit for this source. That is not proof of no consumer. Wave 0 must enumerate actual bot/webhook/panel/link references before any move or archive.
- **R1:** preserve `discord:recaps → 1300411261854547968`; reconcile scheduler, dedupe, settlement population and corrections.
- **R2:** preserve `discord:best-bets → 1288613037539852329`; no policy/kill-switch changes.
- **R3:** preserve `discord:trader-insights → 1356613995175481405`; advanced activation remains separate.
- **R4:** `discord:official-picks` currently resolves capper-pinned destinations. Preserve forum/thread IDs and every `cappers.metadata.discord.picksChannelId` binding; do not repoint to the team board.
- **R5:** `1291234713213734912` is associated with `discord:game-threads`; verify current thread behavior, pinned references and blocked-target policy before repurposing.
- **R6:** `1356624758485287105` is associated with blocked `discord:strategy-room`; preserve ID, do not activate DM/coaching behavior.
- **R7:** `1288613114815840466` is associated with blocked `discord:exclusive-insights`; first prove no live consumers and obtain governed routing retirement. Never silently alias it to Trader Insights.
- **R8:** permanent `discord:canary → 1296531122234327100`; keep internal, preserve all routing/diagnostic dependencies.
- Automation references **AM01–AM19** name source, producer, state and owner in §5. A row with R0 or UNKNOWN still has a mandatory dependency census before action.
- Every action requires Wave 0 recovery evidence and Wave 1 effective-access proof. Access changes never silently apply broader category permissions while moving a channel.

## 3. Complete current → target channel matrix

In each row: **runtime** names routing constraints; **automation** points to the ownership matrix; **access/content** records required entitlement and content work; the final column records timing, risk and prerequisite. “Keep current” in an internal row means preserve its exact observed category/name, outside the public blueprint.

### Uncategorized

| Ref | Exact current name / ID / type | Observed purpose | Target category → channel | Disposition / reason | History / ID | Runtime / automation | Access / content migration | Timing / risk / prerequisite |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| M01 | 🫂・Members: 60<br>`UNKNOWN — voice ID not captured`<br>voice | Member counter; displayed 60, definition unverified | Internal / retained archive outside customer tree; exact placement owner-bound | INTERNALIZE — Counter is outside fixed customer blueprint | H; ID hold | R0; AM19 | Internal; no content move | Wave 4 only after counter bot/ID owner check; risk: break counter or misstate membership |

### 🏁 START HERE

| Ref | Exact current name / ID / type | Observed purpose | Target category → channel | Disposition / reason | History / ID | Runtime / automation | Access / content migration | Timing / risk / prerequisite |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| M02 | 👋・welcome<br>`1288600096682016789`<br>text | Arrival feed and onboarding links | 🏁 START HERE → 👋・start-here | RENAME — One short orientation instead of arrival-feed clutter | H; ID keep | R0; AM09 | P; retain history, publish reviewed map and remove stale claims | Wave 3 after working links/onboarding fallback; risk: stranded new members |
| M03 | 🗂️・info-center<br>`1387122550349369427`<br>forum | Hidden onboarding/server-map forum | 🏁 START HERE → 👋・start-here | CONSOLIDATE INTO — Duplicate orientation; retain existing forum history separately | H; ID archive | R0; AM09 | P target; curate readable guide, do not expose hidden private replies | Archive A after links and deleted-starter repair; risk: content loss/private disclosure |
| M04 | ❓・faq<br>`1387837517298139267`<br>forum | FAQ forum dependent on Member role | 🆘 HELP & SUPPORT → 📚・help-center | CONSOLIDATE INTO — Universal self-service without a role prerequisite | H; ID archive | R0; AM12 | P target; transcribe reviewed answers and attachment content; preserve source | Archive A after accessible help index; risk: missing cancellation/account help |
| M05 | 📢・annoucements<br>`1288601491027923041`<br>announcement | General broadcast; misspelled channel name | 🏁 START HERE → 📢・announcements | RENAME — Correct name and retain announcement subscriptions | H; ID keep | R0; AM16 | P; preserve posts, correct stale marketing | Wave 3 after announcement/follow/webhook census; risk: stale subscription references |
| M06 | 🎭・self-roles<br>`1288617566520217600`<br>text | Preference-role panels | 🏁 START HERE → 🎭・self-roles | KEEP / REFINE — Simplify preference choices without granting entitlements | H; ID keep | R0; AM13 | P; map panel IDs and duplicate role choices | Wave 1/3 after entitlement-safe selectors; risk: accidental paid grants or lost opt-outs |
| M07 | 📝・info<br>`1288601982415933491`<br>text | Static server/features introduction | 🏁 START HERE → 👋・start-here | CONSOLIDATE INTO — Eliminate duplicate orientation | H; ID archive | R0; AM09 | P; merge accurate unique instructions, drop unsupported promises | Archive A after start-here parity; risk: broken old welcome links |
| M08 | 🧊・boosts<br>`1288603032489037954`<br>text | Boost notices/perks; broken reference | 🌳 COMMUNITY → 💬・general | CONSOLIDATE INTO — No standalone boost channel in target; community acknowledgements only | H; ID archive | R0; AM19 | P; preserve history, no paid entitlement from boost | Archive A after bot reroute/disable proof; risk: automated noise or perk overgrant |
| M09 | 👮・legal-disclaimer<br>`1285611753098579968`<br>text | Rules/disclaimer | 🏁 START HERE → ⚖️・rules-responsible-play | RENAME — Combine rules and responsible-play guidance clearly | H; ID keep | R0; AM16 | P; reviewed content and accessible text; preserve old versions | Wave 3 after safety-owner review; risk: misleading claim of legal sufficiency |

### 🔓 Public Edge

| Ref | Exact current name / ID / type | Observed purpose | Target category → channel | Disposition / reason | History / ID | Runtime / automation | Access / content migration | Timing / risk / prerequisite |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| M10 | 💵・free-daily-picks<br>`1289720383767056405`<br>text | Empty advertised Free daily feed | 🔓 FREE VALUE → 💵・free-daily-picks | KEEP / REFINE — Locked Free value surface remains | H; ID keep | R0; AM06 | P; truthful availability topic; canonical Free-only designations | Wave 2 after approved Free routing and cadence owner; risk: paid leak/daily promise unfulfilled |
| M11 | 🕒・recaps<br>`1300411261854547968`<br>text | Historical automated aggregates; duplicate weekly posts | 📊 RESULTS & PROOF → 📈・recaps | RENAME — Preserve dedicated aggregate destination | H; ID keep | R1; AM05 | P; preserve original/correction history and normalized capper identity | Wave 2 after dedupe/completeness proof; risk: duplicate or wrong public record |
| M12 | 🏆・win-wall<br>`1288604565423390782`<br>text | Old member testimonial | 🌳 COMMUNITY → 💬・general | CONSOLIDATE INTO — Testimonials are community discussion, not complete results | H; ID archive | R0; AM19 | P; contextual historical link, never import testimonial as ledger data | Archive A after distinction verified; risk: selective-win marketing |

### 🔑 EXCLUSIVE ACCESS

| Ref | Exact current name / ID / type | Observed purpose | Target category → channel | Disposition / reason | History / ID | Runtime / automation | Access / content migration | Timing / risk / prerequisite |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| M13 | 💎・upgrade-to-vip<br>`1387184046680834140`<br>forum | Hidden upgrade/benefits forum | 🏁 START HERE → 💎・membership | CONSOLIDATE INTO — Single accurate membership destination | H; ID archive | R0; AM16 | P target; curate terms, correct VIP+ trial and false scarcity | Archive A after owner-approved terms and links; risk: commerce misinformation |
| M14 | 💎・vip-perks<br>`1288604187344637962`<br>text | Static VIP benefits | 🏁 START HERE → 💎・membership | RENAME — Reuse text channel as single tier/availability reference | H; ID keep | R0; AM16 | P; rewrite against Membership contract; retain version history | Wave 3 after commerce-owner validation; risk: unsupported entitlement claims |
| M15 | 💰・free-trial<br>`1288606623744397484`<br>text | $1 VIP+ trial marketed as free | 🏁 START HERE → 💎・membership | CONSOLIDATE INTO — Seven-day $1 VIP trial; no misleading free/VIP+ copy | H; ID archive | R0; AM10 | P; replace active promotion links and preserve dated source | Archive A after approved terms and expiry proof; risk: incorrect purchase expectation |
| M16 | 👑・upgrade-to-vip<br>`1288604385399541812`<br>text | Duplicate text upgrade CTA | 🏁 START HERE → 💎・membership | CONSOLIDATE INTO — One membership path | H; ID archive | R0; AM16 | P; migrate valid CTA, remove free/no-risk claim | Archive A after checkout/support links validated; risk: broken purchase navigation |
| M17 | ❓・how-to-get-vip<br>`1288605073579970610`<br>text | Whop purchase instructions | 🆘 HELP & SUPPORT → 📚・help-center | CONSOLIDATE INTO — Self-service how-to belongs in Help Center; link membership | H; ID archive | R0; AM12 | P; validate account/cancellation/access-loss instructions | Archive A after approved commerce instructions; risk: stranded paid member |

### 💼 RESOURCES

| Ref | Exact current name / ID / type | Observed purpose | Target category → channel | Disposition / reason | History / ID | Runtime / automation | Access / content migration | Timing / risk / prerequisite |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| M18 | 📚・knowledge-hub<br>`1387198398087561236`<br>forum | Public learning forum, five-topic index | 🆘 HELP & SUPPORT → 📚・help-center | CONSOLIDATE INTO — Keep public samples and basic education distinct from paid vault | H; ID archive | R0; AM17 | P; preserve public learning; link premium curriculum without moving public knowledge behind paywall | Archive A after lesson inventory/link parity; risk: loss of Free education |
| M19 | 📊・vip-results<br>`1288606187285254244`<br>text | Empty publicly visible vip-results shell | 📊 RESULTS & PROOF → ✅・results | RENAME — Complete public settled ledger, distinct from recaps | H; ID keep | R0; AM04 | P; replace VIP-implying name/topic; build canonical settled publication | Wave 2 after settlement-to-ledger proof; risk: incomplete or fabricated record |
| M20 | 🎁・giveaways<br>`1288608405921075274`<br>text | Giveaway coming-soon shell | 🏁 START HERE → 📢・announcements | CONSOLIDATE INTO — Only real authorized events need public announcements | H; ID archive | R0; AM16 | P or separately entitled event per approved terms; no perpetual promise | Archive A after GiveawayBot/active-event check; risk: lost entrant history |
| M21 | 🔑・support<br>`1285609124050108436`<br>text | Ticket Tool general/report/Whop intake panel | 🆘 HELP & SUPPORT → 🎫・support | RENAME — Universal general/account support path | H; ID keep | R0; AM12 | P; retain panel/ticket references, private ticket permissions | Wave 3 after create/assign/close/failure-path test; risk: ticket loss or privacy leak |

### 🌳 COMMUNITY

| Ref | Exact current name / ID / type | Observed purpose | Target category → channel | Disposition / reason | History / ID | Runtime / automation | Access / content migration | Timing / risk / prerequisite |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| M22 | 💬・general<br>`1288606775121285273`<br>text | General conversation | 🌳 COMMUNITY → 💬・general | KEEP / REFINE — Single public chat hub | H; ID keep | R0; AM19 | P; revised topic and moderation links | Wave 4 after moderation readiness; risk: paid picks reposted publicly |
| M23 | ⚡・sports-talk<br>`1291914211089186888`<br>forum | Public sport discussions forum | 🌳 COMMUNITY → ⚡・sports-talk | KEEP / REFINE — One sport/league topic forum | H; ID keep | R0; AM19 | P; normalize tags and preserve existing threads | Wave 4 after tag alias map; risk: lost thread navigation |
| M24 | 📊・polls-and-predictions<br>`1356613336955093163`<br>text | Empty poll/prediction channel | 🌳 COMMUNITY → ⚡・sports-talk | CONSOLIDATE INTO — Polls belong within sports topics | H; ID archive | R0; AM19 | P; move only relevant polls; no fake daily cadence | Archive A after polling-bot reference check; risk: orphaned automation |
| M25 | 📝・feedback-and-suggestions<br>`1387215789635145808`<br>forum | Feedback forum with empty generic starters | 🌳 COMMUNITY → 💡・suggestions | RENAME — Separate ideas from account support | H; ID keep | R0; AM18 | P; triage tags and private-support routing; retain posts | Wave 3/4 after support links work; risk: sensitive reports posted publicly |
| M26 | 🧠・strategy-room<br>`1356627474162913393`<br>text | Empty public strategy chat | 🌳 COMMUNITY → ⚡・sports-talk | CONSOLIDATE INTO — Public discussion in sports forum; advanced lab remains E | H; ID archive | R0; AM19 | P; migrate relevant discussion only; no VIP+ content | Archive A after linked topic ready; risk: public/private topic confusion |
| M27 | 📑・sports-news<br>`1288803006250483753`<br>text | Historical sports news links | 🌳 COMMUNITY → ⚡・sports-talk | CONSOLIDATE INTO — News contextualized in sport topics | H; ID archive | R0; AM19 | P; retain links, validate feed relevance/provenance | Archive A after feed/webhook reroute proof; risk: spam or stale news |
| M28 | 📽・social-feed<br>`1288802595699294260`<br>text | Historical automated social reposts, live-looking picks | 🌳 COMMUNITY → ⚡・sports-talk | CONSOLIDATE INTO — Only safe public news/community content belongs in sports threads | H; ID archive | R0; AM19 | P; quarantine unverified active-pick reposts; preserve source privately pending provenance review | Archive A after paid-leak/feed checks; risk: active paid content leakage |
| M29 | 🔄・level-up<br>`1289334252353228891`<br>text | Automated level notices | Internal / retained archive outside customer tree; exact placement owner-bound | INTERNALIZE — Remove engagement noise from product navigation | H; ID keep | R0; AM19 | Internal; do not elevate members or grant paid roles from levels | Wave 4 after levelling bot ownership/map; risk: silent bot failures |

### 🚨VIP ALERTS

| Ref | Exact current name / ID / type | Observed purpose | Target category → channel | Disposition / reason | History / ID | Runtime / automation | Access / content migration | Timing / risk / prerequisite |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| M30 | 🎯・alerts-feed<br>`1418224476004290620`<br>text | Empty hidden generic alerts shell | ⚡ VIP+ / VIP EDGE → 💡・trader-insights | CONSOLIDATE INTO — No duplicate alert sidebar; authorized advanced context in one feed | H; ID archive | R0; AM07 | E target; no activation or content fabrication | Archive A only after producer census and per-feature activation decision; risk: stranded consumer |
| M31 | 🔥・steam-alerts<br>`1418224521818800188`<br>text | Empty hidden steam shell | ⚡ VIP+ / VIP EDGE → 💡・trader-insights | CONSOLIDATE INTO — Steam is a Trader Insights content family | H; ID archive | R0; AM07 | E; keep unavailable until sourced movement proof | Archive A after producer/routing proof; risk: unproven alerts marketed Live |
| M32 | 🚑・injuries-shockwave<br>`1418224567075340370`<br>text | Empty hidden injury shell | ⚡ VIP+ / VIP EDGE → 💡・trader-insights | CONSOLIDATE INTO — Sourced material injury context in Trader Insights | H; ID archive | R0; AM07 | E; event/player impact attribution required | Archive A after producer census; risk: unsourced actionable claims |
| M33 | 🧪・hedge-lab<br>`1418224620913426442`<br>text | Empty hidden hedge shell | ⚡ VIP+ / VIP EDGE → 💡・trader-insights | CONSOLIDATE INTO — Advanced actionable context, not a separate channel | H; ID archive | R0; AM07 | E; personal positions stay private, no generic personalized claim | Archive A after privacy/source/mapping proof; risk: member-position disclosure |

### 💍 VIP LOUNGE & INSIGHTS

| Ref | Exact current name / ID / type | Observed purpose | Target category → channel | Disposition / reason | History / ID | Runtime / automation | Access / content migration | Timing / risk / prerequisite |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| M34 | 💬・vip-lounge<br>`1288610443723538584`<br>text | Paid conversation, topic says VIP+ | 👑 VIP • OFFICIAL PICKS → 💬・vip-lounge | MOVE — Place in VIP category with correct audience | H; ID keep | R0; AM19 | V; remove VIP+-only topic, distinguish game discussion | Wave 4 after Wave 1 grants and history permission test; risk: accidental visibility change |
| M35 | 👑・cappers-space<br>`1291911913361375372`<br>forum | 11 observed capper spaces, 22 official/Q&A posts | 👑 VIP • OFFICIAL PICKS → 👑・cappers-space | KEEP / REFINE — Preserve capper identity and official/Q&A separation | H; ID keep | R4; AM01 | V plus explicit professional function; roster/thread mapping, locked Official and open Q&A | Wave 2 after approved roster, thread IDs and lock/write proof; risk: break Human Capper delivery |
| M36 | 📺・game-day-live<br>`1291234713213734912`<br>text | Historical live-game thread | 👑 VIP • OFFICIAL PICKS → 📺・game-day-live | KEEP / REFINE — Locked PM live-event discussion surface remains | H; ID keep | R5; AM15 | V; correct VIP+ topic; preserve event threads | Wave 2/4 after thread routing/access audit; risk: orphan threads or accidental activation |
| M37 | 💡・trader-insights<br>`1356613995175481405`<br>text | Market/proof-like posts exposed to VIP | ⚡ VIP+ / VIP EDGE → 💡・trader-insights | MOVE — VIP+ intelligence only | H; ID keep | R3; AM07 | E; revoke VIP/Trial overgrant; contextualize stale/internal proof posts | Wave 1 access then Wave 4 move; risk: paid leakage or lost mapped target |
| M38 | 🆘・vip-support<br>`1390413374260514977`<br>text | Empty paid support channel | 🆘 HELP & SUPPORT → 👑・priority-support | RENAME — One Trial/VIP/VIP+ priority intake | H; ID keep | R0; AM12 | V; add verified panel, private queue and VIP+ priority metadata | Wave 3 after ticket/priority/fallback proof; risk: paid support silently unavailable |
| M39 | 🧠・Voice Room<br>`UNKNOWN — voice ID not captured`<br>voice | Paid voice room; usage and ID unknown | Internal / retained archive outside customer tree; exact placement owner-bound | UNKNOWN / OWNER DECISION — No customer voice surface in exact blueprint; disposition depends on existing sessions | H; ID hold | R0; AM19 | Hold existing access; no new grant; record event/history usage | Hold U; owner schedules retirement/internal relocation after active-session check; risk: interrupt voice service |

### 💎 VIP+ RESEARCH

| Ref | Exact current name / ID / type | Observed purpose | Target category → channel | Disposition / reason | History / ID | Runtime / automation | Access / content migration | Timing / risk / prerequisite |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| M40 | 🔥・best-bets<br>`1288613037539852329`<br>text | Old curated sample; VIP/Trial cannot view | 👑 VIP • OFFICIAL PICKS → 🔥・best-bets | MOVE — Best Bets belongs to complete VIP product | H; ID keep | R2; AM03 | V; replace S+/A+ topic; preserve historical sample with context | Wave 1 access then Wave 2 feed proof; risk: wrong audience/promotion claims |
| M41 | 📊・vipplus-insights<br>`1288613114815840466`<br>text | Legacy enhanced/test picks and Kelly claims | ⚡ VIP+ / VIP EDGE → 💡・trader-insights | CONSOLIDATE INTO — No exclusive-insights surface in final blueprint; do not copy legacy claims | H; ID archive | R7; AM07 | E target; review provenance, preserve original separately | Archive A only after governed consumer retirement; risk: blocked target accidentally activated or aliased |
| M42 | 🧠・strategy-lab<br>`1356624758485287105`<br>text | Advanced discussion and unproven coaching sample | ⚡ VIP+ / VIP EDGE → 🧠・strategy-lab | MOVE — Distinct VIP+ deeper research workspace | H; ID keep | R6; AM08 | E; remove unsupported personal AI/coaching promise; retain labelled history | Wave 4 after role and mapping checks; risk: DM/coaching activation by rename |
| M43 | 📚・knowledge-hub<br>`1288613708184162338`<br>text | Private learning/frameworks hidden from VIP | 👑 VIP • OFFICIAL PICKS → 📚・education-vault | RENAME — VIP Education Vault; preserve existing text ID | H; ID keep | R0; AM17 | V; move category, reviewed curriculum/index; no portfolio-service claim | Wave 1 access, Wave 3/4 content; risk: VIP undergrant or unverified tools |
| M44 | 🎧・Strategy Room<br>`UNKNOWN — voice ID not captured`<br>voice | VIP+ voice room; usage/ID unknown | Internal / retained archive outside customer tree; exact placement owner-bound | UNKNOWN / OWNER DECISION — Voice service not in customer target tree; preserve until owner usage decision | H; ID hold | R0; AM19 | Hold existing restricted access; no implied Black Label mapping | Hold U; schedule internalization/retirement around sessions; risk: interrupt paid workshop |

### ⚒ WORKSPACE

| Ref | Exact current name / ID / type | Observed purpose | Target category → channel | Disposition / reason | History / ID | Runtime / automation | Access / content migration | Timing / risk / prerequisite |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| M45 | 🎯・capper-onboarding<br>`1289478274615087146`<br>text | Internal capper onboarding | ⚒ WORKSPACE → 🎯・capper-onboarding (internal; keep current) | KEEP / REFINE — Separate professional intake from customer tiers | H; ID keep | R0; AM09 | Internal Capper scope; verify onboarding destination and links | Internal I; Wave 1 role mapping only after owner proof; risk: lose contributor onboarding |
| M46 | 📰・information<br>`1284479901394534492`<br>text | Internal information; owner-visible | ⚒ WORKSPACE → 📰・information (internal; keep current) | KEEP — No customer migration reason to move internal records | H; ID keep | R0; AM19 | Keep restricted; content bodies not inspected | Internal I; any later action needs owner; risk: staff data disclosure |
| M47 | 🚨・system-alerts<br>`1391813094438735883`<br>text | Empty internal system-alerts | ⚒ WORKSPACE → 🚨・system-alerts (internal; keep current) | KEEP — Empty does not prove unused diagnostic destination | H; ID keep | R0; AM19 | Keep restricted; inventory producers without copying content | Internal I; no change until alert-owner mapping; risk: monitoring blindness |

### 🎓 PARTNERSHIP

| Ref | Exact current name / ID / type | Observed purpose | Target category → channel | Disposition / reason | History / ID | Runtime / automation | Access / content migration | Timing / risk / prerequisite |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| M48 | 📜・announcements<br>`1288609649745989703`<br>text | Partnership announcement with test message | 🏁 START HERE → 📢・announcements | CONSOLIDATE INTO — One customer announcement channel | H; ID archive | R0; AM16 | P target; do not republish test as live capability; preserve source | Archive A after webhook/partner owner check; risk: false launch claim |
| M49 | 🔗・affiliate-links<br>`1288609833355968643`<br>text | Partner referral link | 🏁 START HERE → 💎・membership | CONSOLIDATE INTO — Only approved relevant offers in membership reference | H; ID archive | R0; AM16 | P; validate offer/disclosure and ownership; preserve history | Archive A after partner-owner review; risk: stale or unauthorized commerce link |
| M50 | 💬・discussion<br>`1288609040204562575`<br>text | Empty partnership discussion | Internal / retained archive outside customer tree; exact placement owner-bound | INTERNALIZE — Business partner coordination is outside customer navigation | H; ID keep | R0; AM19 | Internal assigned partner/staff scope, no paid tier grant | Wave 4 after partner owner/access confirmation; risk: loss of partner access |
| M51 | 📢・promotions<br>`1288610170641055795`<br>text | Empty partnership promotions | 🏁 START HERE → 📢・announcements | CONSOLIDATE INTO — Real reviewed promotion only through announcements | H; ID archive | R0; AM16 | P; no invented offer/cadence; preserve any discovered history | Archive A after producer/offer census; risk: unintended automated promotion |

### ⚒ WORKSPACE

| Ref | Exact current name / ID / type | Observed purpose | Target category → channel | Disposition / reason | History / ID | Runtime / automation | Access / content migration | Timing / risk / prerequisite |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| M52 | 📊・capper-picks<br>`1288612223232512132`<br>text | Internal capper submissions/picks | ⚒ WORKSPACE → 📊・capper-picks (internal; keep current) | KEEP / REFINE — Professional workspace is not the consolidated official board | H; ID keep | R0; AM01 | Internal Capper; clarify intake/review boundary; no public copy | Internal I; Wave 1 role proof; risk: publishing unapproved intake |
| M53 | 🔒・private<br>`1288616331503075441`<br>text | Private operations with recent app activity | ⚒ WORKSPACE → 🔒・private (internal; keep current) | KEEP — Preserve operational workspace | H; ID keep | R0; AM19 | Keep restricted; no content migration | Internal I; owner required for any later change; risk: expose operations |
| M54 | 📂・server-files<br>`1288616565410893836`<br>text | Internal server assets | ⚒ WORKSPACE → 📂・server-files (internal; keep current) | KEEP — Preserve asset references and access | H; ID keep | R0; AM19 | Keep restricted; no public asset migration by assumption | Internal I; dependency/owner check before later edits; risk: broken media or data leak |
| M55 | ⛔・updates<br>`1285612158964727868`<br>text | Internal updates | ⚒ WORKSPACE → ⛔・updates (internal; keep current) | KEEP — Separate internal change coordination | H; ID keep | R0; AM19 | Keep restricted; no merge into public announcements | Internal I; no structural change; risk: internal disclosure |
| M56 | 🚨・safety-notifications<br>`1288616185809866784`<br>text | Safety/moderation notices | ⚒ WORKSPACE → 🚨・safety-notifications (internal; keep current) | KEEP — Preserve moderation evidence | H; ID keep | R0; AM19 | Assigned moderation scope; no customer visibility | Internal I; owner and retention check; risk: loss of incident evidence |
| M57 | ⚙・commands<br>`1288616275601260565`<br>text | Internal command workspace | ⚒ WORKSPACE → ⚙・commands (internal; keep current) | KEEP / REFINE — Member-tools must not inherit operator commands | H; ID keep | R0; AM14 | Internal; separate customer/Capper/Operator authorization | Wave 1 command boundary proof; Internal I; risk: privileged-command leak |
| M58 | 🎫・ticket-logs<br>`1287795085848870974`<br>text | Ticket audit logs | ⚒ WORKSPACE → 🎫・ticket-logs (internal; keep current) | KEEP — Preserve confidential support history | H; ID keep | R0; AM12 | Assigned support staff only; no public migration | Internal I; ticket producer/privacy check; risk: billing/report disclosure |
| M59 | 🍦・logs<br>`1288616507315589250`<br>text | Operational logs with recent app output | ⚒ WORKSPACE → 🍦・logs (internal; keep current) | KEEP — Preserve monitoring dependencies | H; ID keep | R0; AM19 | Keep restricted; no content copy | Internal I; log owner required for later change; risk: monitoring loss |
| M60 | ✨・only-griff<br>`1296531057767878741`<br>text | Owner workspace | ⚒ WORKSPACE → ✨・only-griff (internal; keep current) | KEEP — No scope to repurpose owner-only records | H; ID keep | R0; AM19 | Owner scope preserved | Internal I; no structural change; risk: private disclosure |
| M61 | 🧪・canary-publish<br>`1296531122234327100`<br>text | Permanent delivery canary | ⚒ WORKSPACE → 🧪・canary-publish (internal; keep current) | KEEP — Canonical internal test destination must survive customer migration | H; ID keep | R8; AM01 | Internal; never customer-visible; preserve receipts/history | Internal I; ID immutable here; risk: break safe delivery verification |
| M62 | 🛠️・canary-debug<br>`1464252290700411096`<br>text | Canary debugging | ⚒ WORKSPACE → 🛠️・canary-debug (internal; keep current) | KEEP — Separate diagnostic purpose may be live | H; ID keep | R0; AM19 | Keep restricted; producer census before any later changes | Internal I; no structural change; risk: lose debugging |
| M63 | 🚨・canary-alerts<br>`1464252324733259797`<br>text | Canary alerts with recent app output | ⚒ WORKSPACE → 🚨・canary-alerts (internal; keep current) | KEEP — Preserve failure visibility | H; ID keep | R0; AM19 | Keep restricted; operator ownership must be recorded | Internal I; no structural change; risk: silent delivery failures |
| M64 | 🧱・canary-deadletter<br>`1464252369238753363`<br>text | Canary dead-letter diagnostics | ⚒ WORKSPACE → 🧱・canary-deadletter (internal; keep current) | KEEP — Preserve failed-delivery evidence | H; ID keep | R0; AM19 | Keep restricted; no deletion to clean queue appearance | Internal I; no structural change; risk: erased failure history |
| M65 | 🛋・staff-vc<br>`UNKNOWN — voice ID not captured`<br>voice | Staff voice; ID/usage unknown | ⚒ WORKSPACE → 🛋・staff-vc (internal; keep current) | KEEP — Internal voice is outside customer blueprint | H; ID hold | R0; AM19 | Keep staff-only; no content inspected | Internal I/Hold U for any later action; risk: interrupt staff coordination |

### 3.1 New target destinations and type handling

The 65-row matrix accounts for existing channels only. Three target text surfaces have no compatible retained source ID in this plan: **member-tools**, **help-center**, and **official-picks**. Their future execution packet must record actual assigned IDs and approved mappings after creation, never placeholders in live configuration. Existing FAQ/info-center/learning forums remain archives; do not claim an in-place forum-to-text conversion.

Membership reuses `1288604187344637962`; Results reuses `1288606187285254244`; Education Vault reuses `1288613708184162338`. Preserve existing sports-talk, suggestions and cappers-space forum IDs and mapped thread IDs. Category IDs and four voice IDs were not captured in the audit; resolve during authorized Wave 0 before any action. Black Label creates no channels, role, product or mapping in these launch waves.

### 3.2 Capper roster and thread register

The audit observed these pairs, not a ratified active roster:

| Observed identity | Observed posts | Known issue / execution requirement |
| --- | --- | --- |
| Griff / Griff843 | Official Picks + Q&A | September 18 bot deliveries; reconcile canonical display alias and pinned IDs without disturbing Human Capper E2E |
| Sauced | Official Picks + Q&A | Official starter deleted; preserve replies and destination |
| Vicgo | Official Picks + Q&A | Both starters deleted |
| MoneyReef | Official Picks + Q&A | Old template, current activity unknown; normalize reef tag |
| KingRo623 | Official Picks + Q&A | Both starters deleted; capper tag absent in observed set |
| Noahthegooon | Official Picks + Q&A | Both starters deleted; normalize noah tag and Q&A spacing |
| Jaybird | Official Picks + Q&A | Old templates; active status unknown |
| Dub | Official Picks + Q&A | Weak starter; no matching observed capper tag |
| Ziplock | Official Picks + Q&A | Old templates; active status unknown |
| Squirrel | Official Picks + Q&A | Old templates; active status unknown |
| Polo | Official Picks + Q&A | Old templates; no matching observed capper tag |

Eggy was a tag, not a twelfth observed space. Parlay/total/edge tags are not capper identities. Owner must record each identity's active/inactive status, canonical capper ID, Official/Q&A IDs and aliases before roster mutation. Preserve all 22 observed posts and their history pending that decision. This register is subordinate to the canonical active roster; it does not authorize publishing for every name.

## 4. Role migration and access reconciliation

Role IDs were not captured by the audit. Future execution binds exact IDs, managed-app identities, members and channel/member overwrites before any rename/merge/removal. Identical display names are not interchangeable IDs. No role is changed by this plan.

| Current role / family | Classification | Target responsibility and migration requirement |
| --- | --- | --- |
| @everyone / no paid role | KEEP | Free default. Public help/proof/community available without a special Member role; no active paid content |
| 🪄 Member | KEEP | Optional community marker only; remove public-help dependency and any paid/internal grants |
| 🕛1 week trial | MERGE | One canonical Trial role selected by exact commerce/runtime role-ID mapping; migrate active valid grants, preserve source history, never extend trial by merge |
| 🕛 Trial User | MERGE | Same canonical Trial role; remove redundant grant only after real expiry/access reconciliation proof |
| 💎 VIP Member | KEEP | Explicit VIP entitlement; all V surfaces, no E; correct Best Bets/education undergrant and Trader overgrant |
| 🔱 VIP+ Member | KEEP | Canonical `vip-plus`; all V plus E; no VIP Edge rename or new pricing |
| 🎯 UT Capper | INTERNAL | Canonical intake and capper workspace; explicit shared cappers-space professional access; remove accidental VIP+ grant. Independent paid/complimentary tier must be separately recorded |
| 👑 Owner | INTERNAL | Retain owner authority and recovery access; never use owner session as customer acceptance proof |
| 🎖️Admin | INTERNAL | Audited configuration administration; inspect actual permissions, not title. No new tier mapping |
| 🛡️ Moderator | INTERNAL | Least-privilege moderation and assigned abuse reports; no entitlement management or routine official publication |
| 👮 Staff | INVESTIGATE | Split actual duties into explicit moderated/support/operator scopes; no blanket customer tier inheritance. Preserve needed work access while mapping |
| Operator — no literal role observed | INTERNAL | Bind/create only in later authorized execution a least-privilege role matching runtime operator mapping; do not guess Staff equals Operator |
| Whop Bot | INTERNAL | Commerce-to-entitlement sync only; exact managed app identity; cannot grant internal/Admin roles |
| Unit Talk — two separate roles | INVESTIGATE | Identify each role ID, app/user ownership, integrations and grants; retain necessary publisher/command identities; never merge by display name alone |
| ⚙️ Bot | INVESTIGATE | Generic bot grouping must not be a blanket privilege route; evaluate each managed application and remove unintended member grants only after dependency proof |
| * | INVESTIGATE | 25 memberships high in hierarchy; owner/purpose/permissions unknown. Freeze new assignments, inspect all effective grants before disposition; do not delete blindly |
| 👑 Griff / 🎯 Sauced / 🎯 Vicgo | INTERNAL | Identity/notification labels tied to approved capper roster; no implicit paid membership or official-write bypass |
| 🔔 Pick Alerts Ping + Pick Alerts Ping | MERGE | One opt-in official-pick notification preference; delivery intersects V entitlement; preserve member choices and opt-out |
| 💡 Strategy Tips Ping + Strategy Tips Ping | MERGE | One opt-in strategy preference; advanced outputs intersect E; no access grant |
| 📅 Event Updates Ping + Events Ping | MERGE | One event preference; preserve subscriptions and contextual audience rules |
| Announcement Ping / News and Updates Ping | MERGE | One understandable general update choice where purposes coincide; no automatic resubscription |
| Giveaway Ping / Social Feed Ping | INVESTIGATE | Retain only for an actually maintained approved event/feed; retire unused selectors after reference/member migration |
| 🔐 Sapphire, Discohook Utils, Discobot, Ticket Tool, Ticket Support, Arcane, GiveawayBot, ServerStats, MonitoRSS, FootballBot, carl-bot, Invite Tracker, Dyno, News Alerts Bot, MEE6, StrawPoll, DISBOARD.org, DS.ME, PollBot, RT Pollmaster, Cycle | INVESTIGATE | Inventory exact managed identities, webhook/command/panel ownership and required permissions. Ticket Support may be a human support role: verify. Keep necessary services INTERNAL; retire only owner-confirmed unused integrations |
| Game Alerts / Pocketkings / Where they bet | INVESTIGATE | Names do not prove app ownership or harmlessness. Inspect role IDs, members and all grants; no access migration by assumption |
| 🔮 Server Booster / 🤝 Partner | KEEP | Cosmetic/community or explicit partner work scope only; no paid access by default |
| ⛲ Europe, ⛩️ Asia, 🗽North America, 🌴 South America, 🐘 Africa, 🐼 Oceania | KEEP | Geographic preferences only, no entitlement or internal grants |
| Fanduel, Draftkings, Betmgm, Bovada | KEEP | Sportsbook preferences only; no commerce authorization or paid access |
| 🐐 MJ / 🐐 LeBron James | KEEP | Cosmetic interests only |
| 🏈 Football Enthusiast, 🏀 Basketball Enthusiast, ⚾ Baseball Enthusiast, 🏑 Hockey Enthusiast, Esports Enthusiast | KEEP | Sport preferences; normalize selectors later, never entitlement |
| 📈 Stats Guru, Parlay Expert, Live Betting Aficionado, Prop Bet Strategist, New Bettor, Intermediate Bettor, Experienced Bettor | KEEP | Cosmetic/interests/experience only, no authority or paid grants |
| Pick Challenge Participant, Monthly Contest Entrant, Live Betting Event Player, 🏆 Contest Champ, 🎙️ Podcast Regular, 🔥 Active Contributor | KEEP | Community/event labels; no accidental tier mapping or unproven current event promise |
| Any legacy role or member-specific overwrite granting paid visibility | INVESTIGATE | Mandatory catch-all permission census. Remove unintended allow only after legitimate entitlement/work grant is reconciled; prove effective access after change |
| Black Label — no observed role | INVESTIGATE (absence confirmed in audit) | No role creation, assignment, sale or activation; future product reservation only |

**Hierarchy responsibilities:** Owner at top; narrowly assigned Admin; explicit Operator/Moderator/support functions; managed service roles placed only as high as necessary above roles they are authorized to manage; Capper professional function; VIP+/VIP/Trial entitlement roles; community/preferences/cosmetics; @everyone. Role position is not an entitlement rule. Whop and any role-sync bot must remain below privileged internal roles. Separate human support responsibility from broad Administrator. Administrative recovery access remains available without adding new customer grants.

### 4.1 Required access repairs before paid cutover

| Requirement | Observed gap | Required behavior and proof |
| --- | --- | --- |
| AR01 Trial | Both trial roles alone, and Member + Trial User, lacked paid channels | One reconciled active Trial receives every V surface and V command, priority support included; never E. Test each legacy role migration and combined-role case |
| AR02 VIP | Trader Insights visible; Best Bets/private education absent | VIP loses E and gains Best Bets and Education Vault; all capper and consolidated official views remain complete |
| AR03 VIP+ | Research visible, but advanced service/priority unproven | All V + Trader Insights + Strategy Lab; independently prove activated functions; VIP+ highest internal paid-support priority |
| AR04 Capper | Capper + Member reaches VIP+ research | Professional role alone must not resolve as VIP/VIP+. Explicit forum/workspace access only; all other customer grants require separate valid entitlement or recorded complimentary policy |
| AR05 Public help | FAQ depended on Member; info-center hidden | Default/Free, with and without Member, reaches start-here, membership, rules, help, public results/recaps and general support |
| AR06 Expiry / cancellation | DB trial expiry exists; Discord revoke not proven | Revoke all effective paid access at valid expiry, including duplicate/composite roles, stale cache and member overwrites; durable retries, drift detection, operator alarm and safe containment if removal fails |
| AR07 Commands / components | heat-signal code guard absent; deployed behavior unknown | Gate at runtime across channels, DMs and buttons, including stale/expired/ambiguous roles; public output contains only permitted settled data |
| AR08 Copy | Old $1 VIP+, free/no-risk and VIP+-only lounge/game-day wording | Approved $1 seven-day VIP trial, correct audience and availability; approved renewal/cancellation terms; no new price or claim of Live |
| AR09 Support privacy | Historic public ticket panel; priority channel empty | Private requester/assigned-agent tickets; verified tier queue; access-loss fallback through public support; never ask for billing details publicly |
| AR10 Legacy grant closure | *, duplicate Unit Talk, bot/cosmetic permissions unknown | Effective permission census for all roles/overwrites, not only main tier previews; notification/self-role paths cannot grant paid/internal access |

DB expiry alone does not revoke Discord channel visibility. The audit found best-effort role-change sync without durable repair in the inspected path and a role-based resolver that can retain stale access. This remains an **implementation gap**, not a completed migration step. Do not reopen paid access before AR06/AR07 are proven. Wave 5 handles remaining reconciliation automation, not postponement of those safety requirements.

## 5. Automation ownership matrix

States are evidence-qualified as of the audit, not promises of current deployment: **Implemented** means code exists without current end-to-end proof; **Foundation** means partial components; **Pilot** means bounded test evidence only; **Future** means target work remains; **UNKNOWN** means activity/ownership insufficiently proven; **Parked** means intentionally unavailable. No row is labeled Live from channel existence or old posts. Every future producer needs a named operational assignee before activation; the owner functions below are accountable roles, not invented staffing assignments.

| Ref / surface | Source event / canonical truth | Producer and accountable owner | Destination / required mapping | Failure visibility and current evidence state |
| --- | --- | --- | --- | --- |
| AM01 Capper Official Picks | Approved official human pick; canonical capper identity, pick, outbox and receipt | API + worker; Delivery/Capper operations | Existing capper Official thread; per-capper pinned ID plus forum validation; preserve canary | **Pilot evidence only**: Sept 18 Griff app deliveries and pinned path. All-capper completeness UNKNOWN. Missing pin/locked-thread failure becomes operator exception; no silent fallback |
| AM02 Consolidated Official Picks | Same official pick event, not a second submission; canonical feed population | Future team-board projection; Delivery owner | New official-picks channel ID and separately approved destination identity. Existing logical official-picks remains capper-pinned until governed design changes | **Future**: physical team board absent in audit. Independent publication receipt/dedupe and expected-vs-delivered reconciliation; no false lifecycle success on partial fan-out |
| AM03 Best Bets | Qualified promotion of official pick; persisted promotion decision and canonical pick | API promotion + worker; Promotion/Delivery owner | R2 fixed ID; preserve eligibility, caps, kill switches | **Implemented policy; current delivery UNKNOWN**. Old 2025 sample insufficient. Suppression/failure observable; approval is not qualification |
| AM04 Results | Settlement/correction of every published official pick; canonical settlement and original delivery identity | Future complete public-ledger publisher; Settlement owner | Results retained ID, separately approved publication mapping; never publish private Track Only/fixtures | **Future** complete ledger: source shell empty. Reconcile source counts, omissions and corrections; alert on missing result, preserve original |
| AM05 Recaps | Closed reporting window/correction version; same eligible settled population as Results | API recap/scheduler components; Reporting owner | R1 retained ID; confirm aggregation versus original-channel per-pick settlement destination | **Implemented; current scheduled health UNKNOWN**. Historical duplicates observed. Dedupe/window/version receipts, missing-data and delivery alarms; public correction trail |
| AM06 Free Daily Picks | Explicit Free designation of canonical pick/preview; approved editorial selection | Future approved Free publisher; Pick operations | Retained Free ID; R0, proposed free-picks target requires separate routing ratification | **Future**: empty in audit. No paid-feed mirroring; availability/cadence honest; missing selection means no invented post |
| AM07 Trader Insights | Activated provider movement/injury/hedge event; fresh sourced canonical data and member inputs where personal | Alert components + future feature-specific producers; Intelligence owner | R3 retained ID and approved tier-specific route; no implicit R7 alias; personal outputs private | **Foundation; current operation UNKNOWN**. Historical proof/sample posts and empty alert shells do not establish a live service. Reject stale data, visible suppression/incident, no false personalized claims |
| AM08 Strategy Lab | Reviewed research/workshop event; cited data/method and member authorization | Human research owner; individually approved tools only | Retained lab ID; R6 remains blocked until separate contract/proof | **UNKNOWN** current service, future maintained program. Disclose experimental status; disable broken tools; no automatic coaching assertion |
| AM09 Start-here / capper onboarding | Guild join or professional-role assignment; approved content and canonical identity | Bot onboarding components + Community/Capper operations | Retained start-here ID and separately validated internal capper-onboarding mapping | **Foundation**: historical welcomes, code exists; real journey untested. Static map/help fallback, internal failures; no uncontrolled repeated mentions |
| AM10 Entitlement sync / membership | Approved commerce purchase, renewal, expiry, cancellation; reconciled member entitlement/history | Whop integration, bot role events, API member-tier sync; Membership operations | Verified product→role-ID map and canonical tier mapping; customer roles only | **Foundation**: best-effort code, no proven durable repair. Durable retries, idempotency, drift report, fail-closed protected commands and access-loss support |
| AM11 Trial expiry | Canonical seven-day expiry and validated replacement entitlement | API expiry scheduler plus required Discord revocation/reconciliation; Membership operations | Exact Trial roles and all effective paid grants, including stale combinations and caches | **Foundation / gap**: DB deactivation/audit implemented; Discord removal unproven. Overdue revocation alarms and bounded remediation; no continued paid access silently accepted |
| AM12 Help / general & priority support | Private help request and validated current entitlement; ticket record and assignment | Ticket Tool or explicitly selected supported producer; Support owner | Retained support/priority IDs, private ticket categories, ticket-logs, VIP+ queue metadata; new help-center ID for static content | **Foundation** general panel; **Future** proven priority routing. Test create/assign/respond/close, unauthorized views and outage fallback; no fabricated SLA |
| AM13 Self-roles / notifications | Explicit opt-in/out plus current entitlement; preference and recipient truth | Approved preference/delivery bot; Member-experience owner | Exact preference-role IDs and interaction panels; audience intersection before mention/DM | **Foundation** panels and duplicate roles; filter delivery UNKNOWN. Idempotent membership, opt-out proof, no entitlement grants, failure visible privately/internally |
| AM14 Member-tools / commands | Authorized interaction; canonical API response and current entitlement | Discord bot; Bot owner | New member-tools ID, guild command registration and per-action guards across channels/DMs/buttons | **Implemented code/catalog, current deployment UNKNOWN**. Private error, deny ambiguous/expired tier; heat-signal gating needs reconciliation |
| AM15 Game-day-live | Real event and authorized discussion; canonical event identity if automated | Community owner; optional separately proven event-thread producer | R5 parent and thread IDs; do not infer activation from historical thread | **Foundation** historical thread; current automation UNKNOWN. Retain human discussion, stop failed automation and surface routing errors |
| AM16 Membership / announcements / rules | Approved content/version or material service event; ratified terms/product availability | Human content owner and approved publisher; Product/Community operations | Retained membership/announcement/rules IDs; verified external links | **UNKNOWN** current maintenance. Old app posts are not autonomous service evidence. Review stale claims, preserve corrections, visible contact fallback |
| AM17 Education / public samples | Reviewed lesson/version; authoritative sources and course index | Education owner; optional reference publisher | Retained Education Vault ID for V; new public Help Center index for samples | **UNKNOWN** current curriculum/automation. Broken/stale content labelled and repaired; no personal bankroll promise |
| AM18 Suggestions | Submitted idea/bug and triage decision; preserved forum discussion | Human Product owner with optional triage bot | Retained suggestions forum ID and tags; support redirect | **UNKNOWN** current triage. Record disposition, never claim a support ticket or delivery date without evidence |
| AM19 Community / internal diagnostics | Human discussion, moderation/log event or approved utility | Named Community/Operations owner per integration after census | Existing community/internal IDs; enumerate bot/webhook consumers under R0 | **UNKNOWN** completeness/health despite some recent app output. Preserve diagnostics, stop noisy utilities safely; no public internal messages |
| BL Black Label surfaces | No live source event | No producer; Griff future ownership | No new IDs, roles, commerce mapping or activation | **Parked**: FUTURE / PARKED — NOT ACTIVE, NOT PURCHASABLE |

Automation acceptance must join canonical source populations to actual messages/receipts and operator failures. An app badge, old “LIVE” heading, test result, channel name or bot online indicator is insufficient. Final activation needs deployment identity, destination/permission proof, source truth, monitored failure behavior and the applicable reserved authorization.

## 6. Non-executed migration waves

All waves below are future execution. A failed prerequisite stops the dependent wave; it does not authorize bypass or restoration of an unsafe overgrant.

| Wave | Prerequisites | Exact scope | Validation | Rollback | Customer risk / expected result |
| --- | --- | --- | --- | --- | --- |
| 0 — Backup, ownership, IDs | Separate migration authorization; approved operator and secure evidence storage | Capture category/channel/thread/role IDs, effective overwrites, managed bots/webhooks/panels, commerce mapping, active capper roster, source history and current message links; bind every M-row, AM owner and unknown | 65-source reconciliation, recoverable configuration/history export; no private evidence in public docs; verify target-ID plan and every existing runtime consumer | No mutation; retain dated snapshot and checksum; abort if inventory incomplete | Risk: incomplete backup or privacy exposure. Result: exact reversible action packet, not a new product audit |
| 1 — Entitlement corrections | Wave 0; verified expiry/revocation and command enforcement implementation; approved commerce source | AR01–AR10: one Trial mapping, complete V, E only VIP+, independent Capper, universal help, legacy grants and preference safety | Real Free/Trial/VIP/VIP+/Capper personas, combined/stale roles, expiry/cancellation, DM/button output and retry/outage tests | Restore known-correct configuration only; if that would restore an overgrant, deny affected surface temporarily and route support | Risk: paid interruption or leak. Result: correct effective access before product cutover |
| 2 — Product spine | Wave 1; canonical publication/settlement/correction proof, approved mapping changes and activation | Preserve R1/R2/R4/R5 IDs; capper roster/pairs; new team board; complete Results; Recaps; truthful Free feed; Best Bets subset | Every official pick represented in capper + team view or explicit exception; promoted subset traceable; settle win/loss/push/void/correction through public ledger and recap | Disable new projection producer; keep canonical source/receipts/history and working old destinations; restore mappings only after proof | Risk: duplicate/lost pick or result. Result: distinct complete pick and proof jobs |
| 3 — Support/onboarding | Wave 1; support staffing, approved terms and private ticket/fallback proof | Start-here, membership, self-roles, rules, new Help Center, retained general/priority intake; public learning index and education content | Fresh member navigation; purchase/access-loss/cancellation guidance; request/assign/respond/close; Trial access and VIP+ priority; privacy denial | Restore versioned links/panels/content without restoring incorrect terms or leaked permissions; keep general support reachable | Risk: stranded users or exposed account data. Result: one truthful orientation and owned support path |
| 4 — Navigation consolidation | Waves 0–3; per-row producer/history/access prerequisites; voice/partner owner decisions | Execute approved M-row moves/renames and Archive A/Internal I; preserve all mapped IDs; normalize forums; remove redundant customer navigation | Exact 23 non-parked target surfaces, with activation labels; no extra public shells; original history recoverable, links/access intact; diagnostics unaffected | Reverse category/name moves from snapshot; restore restricted archives to prior valid access when safe; never re-enable unsafe automation | Risk: broken references or permissions inherited on move. Result: exact PM navigation with retained history |
| 5 — Remaining automation reconciliation | Safety-critical AR06/AR07 already passed Wave 1; approved individual capability implementation | Durable reconciliation monitoring, public-results/recap completeness monitoring, supported notification filters, support-priority observability and onboarding maintenance | Retries/deduplication/outages; missing-result detection; opt-out; operator acknowledgement; per-capability activation evidence | Disable affected producer, keep canonical records and safe access; surface degraded state; do not replace failed automation with false Live claims | Risk: silent drift or noisy output. Result: maintained, observable product; advanced unproven capabilities remain unavailable |
| 6 — Visual polish | Functional/access waves passed; no hidden unfinished service claims | Exact emojis/names/topics, concise first messages, forum covers/tags, server profile, mobile navigation and safe links | Desktop/mobile real-persona walkthrough, readable result/correction fields, one purpose per channel, no false prices/FOMO/internal dumps | Restore approved presentation versions without changing routing or entitlements | Risk: cosmetic edits obscure truth. Result: consistent usable presentation |

No Black Label launch wave exists. Keep its two design reservations parked. Unknown voice/service ownership is resolved as an execution scheduling dependency; it does not add voice channels to the approved customer tree.

## 7. Implementation acceptance checklist

These boxes are intentionally unchecked. Documentation verification is not production acceptance. Record tester/persona, deployed SHA, configuration snapshot, timestamps, message/receipt evidence, expected/actual result and rollback outcome in the future execution proof.

### Access personas

- [ ] Free/default without Member reaches start-here, rules, membership, self-roles, Help Center, results, recaps, member-tools, Free Daily Picks, community and general support.
- [ ] Free sees the complete settled official record, including losses/corrections; cannot view active paid picks or retrieve them via commands, DMs, buttons, search previews, attachments, links or notifications.
- [ ] Trial sees **every VIP surface**, all cappers, team Official Picks, Best Bets, Game Day Live, Education Vault and priority support; cannot see Trader Insights/Strategy Lab.
- [ ] Both legacy trial migrations preserve the actual start/expiry time. At expiry, paid visibility and protected commands disappear, including stale roles/caches and duplicate role combinations; valid separately purchased entitlement is retained.
- [ ] VIP sees all official capper views, team Official Picks, Best Bets, lounge, Game Day Live, Education Vault and priority support; cannot see E content.
- [ ] VIP+ receives all VIP benefits plus Trader Insights/Strategy Lab; only proven activated capabilities are advertised; highest internal paid-support priority is measured.
- [ ] Capper alone can use approved intake and assigned professional workspace/Q&A; cannot inject Official Picks, acquire VIP+ via Capper or grant customer entitlements.
- [ ] Moderator, Operator, Admin, Unit Talk Bot and Whop Bot have only their documented functional grants; no bot/self-role path can grant privileged internal roles.
- [ ] Every legacy role/member overwrite is checked for paid access; preference/cosmetic roles grant none. No-role and multi-role tests supplement single-role previews.

### Publishing and transparent results

- [ ] A canonical official pick reaches its correct capper thread and consolidated board with matching attribution/odds/stake/time; partial failures remain visible and retry safely.
- [ ] Best Bets is a traceable qualified subset; no automatic blanket forwarding and no incomparable/fabricated confidence.
- [ ] Locked Official forum posts reject ordinary customer and Capper writes; Q&A permits authorized replies; bot posting/reopening preserves the lock.
- [ ] Approved roster has exactly one Official and one Q&A post per active capper; inactive historical records remain accessible at correct entitlement; no alias splits performance.
- [ ] Complete path is proven: Official Pick → delivery → settlement → public Results → Recap.
- [ ] Win, loss, push, void and correction scenarios reconcile to canonical records; original corrections remain visible; aggregates use correct window, population, denominator and capper identity.
- [ ] Missing source/closing data renders unavailable or suppresses unsupported claims, never fabricated zero/edge/CLV. Private Track Only, fixtures and simulations do not enter member official statistics.
- [ ] Retry/restart does not duplicate team posts/results/recaps; missing delivery generates an operator exception. Historical duplicate reports are contextualized, not silently erased.
- [ ] Free selections have explicit Free designation; “daily” has a measured operating cadence or honest availability notice. No paid feed leak through social/news migration.

### Support, operations and presentation

- [ ] Help Center is readable without Member and distinct from tickets; Suggestions does not expose account/billing/abuse details.
- [ ] General and paid intake create private owned tickets; Trial receives paid priority; VIP+ priority remains internal to the same channel.
- [ ] Support outage shows a real staffed fallback; no invented response SLA. Expired/access-loss members can still seek help.
- [ ] Preference add/remove and unsubscribe work without changing tier; notification audience is the intersection of preference and entitlement.
- [ ] Every activated AM producer has a named owner, canonical source, destination map, real-path proof and operator-visible failure/disable procedure.
- [ ] All 65 source M-rows have signed execution outcomes; preserved IDs/history, archives and links reconcile. Four unknown voice IDs and category/role IDs are resolved before action.
- [ ] The 23 non-parked customer surfaces each have their unique job; the two Black Label reservations remain FUTURE/PARKED, not sold/activated.
- [ ] Desktop/mobile navigation matches the blueprint; VIP+ naming remains compatible with `vip-plus`; no invented VIP+/Black Label prices, unsupported personalization or guaranteed outcomes.
- [ ] Per-wave rollback is exercised without restoring an overgrant or erasing canonical history. Applicable production-readiness and reserved activation requirements are separately satisfied.

## 8. Authority reconciliation ledger

Membership is the already-ratified entitlement destination. This architecture finalizes Discord organization under that authority. The new contract does not declare old implementation absent or change current runtime policy by prose.

| Existing document | Conflict or dated boundary | Product precedence / required follow-up |
| --- | --- | --- |
| `docs/03_product/MEMBER_ROLE_ACCESS_AUTHORITY.md` §§2,7–9 | March Trial includes Trader Insights; capper surfaces table conflicts with full VIP; DB expiry text coexists with unimplemented role revoke; old operator-web claims | Membership plus new architecture governs final access: Trial=VIP excluding E, capper function independent. Keep schema/sync facts as implementation evidence at stated SHA; follow-up reconcile access table, expiry and operator references |
| `docs/03_product/PLATFORM_SURFACES_AUTHORITY.md` | Older channel inventory omits consolidated board/results and carries dated LIVE/blocked claims; registry-recognition rule is not an activation approval | New architecture is final Discord product registry, indexed explicitly by authority map. Runtime recognition/activation still requires separately governed mappings and registry reconciliation. Preserve its recently consolidated Command Center entry |
| `docs/03_product/DISCORD_COMMAND_CATALOG.md` | March LIVE assertions; heat-signal described tier-gated while audit code lacks declared role guard; public leaderboard output | Catalog remains dated registration/mechanics evidence. Prove current deployment and authorization before Live; reconcile gated advanced tools and safe public settled output |
| `docs/03_product/DISCORD_RECAPS_CHANNEL_CONTRACT.md` | Rollback deletes bad report with no correction; fail-silent delivery wording; daily/weekly focus | Membership transparency supersedes deletion-as-correction. Keep original plus disclosed correction, operator-visible failures and monthly target support; preserve aggregated/per-pick destination distinction |
| `docs/03_product/TRADER_INSIGHTS_CHANNEL_CONTRACT.md` | Optional channel, sharper alternate pick feed and exclusive priority routing; dated Live claim and loose role assignment | Blueprint fixes VIP+ intelligence purpose. Official VIP coverage must not be diverted into VIP+ only. Existing routing/promotion remains unchanged until separately reconciled and proven |
| `docs/03_product/best_bets_channel_contract.md` | Selectivity/approval separation align; confidence/edge examples cannot establish truthful current metrics | Preserve aligned selectivity; this blueprint fixes VIP audience and traceable subset relationship. Do not change promotion thresholds or invent confidence |
| `docs/05_operations/discord_routing.md` | Legacy target inventory lacks capper-pinned official delivery; game-thread implementation statements are dated; exclusive-insights has no final customer surface | Preserve known IDs and blocked-target controls. Follow-up runtime contract must reconcile actual code, fan-out/team board, results/Free mappings and retirement of legacy target; no alias or activation here |
| `docs/discord/discord_message_contract_matrix.md` | March priority selection and contradictory manual confidence-floor descriptions; LIVE labels and older single-destination view | Treat as historical implementation snapshot requiring reconciliation, not current activation proof. Product demands complete official feeds plus optional promoted subset; do not infer gates from old prose |
| `docs/discord/DISCORD_EMBED_CONTRACT.md` | Dated confidence-as-percent, metadata capper attribution and generic Canary fallback; not a contract for a complete settled ledger | Current implementation must be measured at deployment SHA. New target requires truthful identity, evidence-backed metrics and clean member output; no runtime renderer edits here |
| `docs/discord/discord_embed_system_spec.md` and asset addendum | Design intent includes VIP+/Black Label Best Bets and premium recaps, optional channel decisions, unsupported metric language | Membership/blueprint supersedes tier/navigation suggestions. Reuse visual guidance only where truthful and compatible; no paid public-proof restriction or Black Label activation |
| `docs/discord/daily_cadence_spec.md` | Old outbox-driven snapshot versus scheduled design suggestions; no proven daily Free cadence | Preserve distinction between event-driven picks and windowed recaps. No guaranteed times/daily Free output until operating evidence supports them |
| `docs/discord/specs/ONBOARDING_CONTENT_ARCHITECTURE.md` | Historical content structure is not the final single-spine blueprint | Route final onboarding to start-here/membership/help-center; reconcile old links and terms during content migration, not mass-edit now |
| `docs/05_operations/PS_M1_COMMERCIAL_FOUNDATION_CONTRACT.md` and `MEMBER_TIER_MODEL_CONTRACT.md` | Older commerce/tier implementation is not authority to contradict September destination | Membership remains superior for promises; preserve current commerce/schema behavior as implementation truth and require reconciliation evidence before access rollout |
| `docs/05_operations/docs_authority_map.md` | Generic product wildcard plus older role-access “primary authority” wording does not identify the new architecture | Add explicit Membership/Discord architecture/migration entries and bounded precedence only; no unrelated governance or Command Center cleanup |

Older documents referencing deleted historical design files do not resurrect them as authority. Unknown deployment state is not resolved by choosing the newest-sounding title.

## 9. Bounded unresolved execution inputs

These are factual/operational inputs, not reopened PM product decisions:

1. Owner-confirmed active capper roster, canonical identity aliases and 22 observed thread bindings; exact repair strategy for deleted starters without history loss.
2. Four voice IDs, category/role IDs, actual managed-app identities (including duplicate Unit Talk and *), consumer references and effective member overwrites.
3. Owners and measured current activation for each AM row; actual ticket provider/queue/fallback staffing and approved commerce terms. Do not invent service levels.
4. Creation IDs and separately governed mapping/receipt design for team Official Picks, public Results publication and Free feed; distinguish current capper-pinned logical target.
5. Timing of retirement/internalization for existing voice/partner services, with safe history/access preservation; no extra customer channels added.
6. Actual runtime fixes and real-persona proof for expiry, command guards, publication completeness, corrections and preference safety.

VIP Best Bets, VIP education, VIP+ Trader Insights/Strategy Lab, Trial=VIP, all-settled public transparency, the support split, Free Daily Picks, Game Day Live, the exact blueprint and parked Black Label are settled.

## 10. Documentation verification boundary

UTV2-1945 verifies inventory cardinality/uniqueness against the saved audit source, every target surface and permission profile, locked entitlement decisions, local relative links, scope and repository gates. These checks validate this plan, not the server. Production checklist boxes stay unchecked. The PR is submitted for PM review; no Discord migration or member-delivery activation is performed.
