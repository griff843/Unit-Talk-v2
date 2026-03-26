# Discord Embed System Spec — Addendum: Headshots, Logos, and Visual Assets

## Purpose

Define how headshots, team logos, and other visual assets should be used in Discord embeds.

This addendum establishes Unit Talk's visual asset policy so embeds can feel premium without becoming dependent on non-critical media.

---

## Core Principle

Visual assets are a **soft enrichment layer**.

They improve presentation, recognition, and premium feel, but they must never:

- block posting
- corrupt truth
- cause message failure
- introduce fake or mismatched visuals
- override the core text content

If an asset is missing, the embed must still render cleanly and correctly.

---

## Supported Asset Types

### 1. Player Headshots
Used for:
- player props
- player-focused alerts
- player-specific recap highlights
- premium analysis surfaces where player identity matters

### 2. Team Logos
Used for:
- team-based picks
- matchup-based picks
- recap surfaces
- game/event-related alerts

### 3. Brand / System Identity Assets
Used for:
- onboarding messages
- upgrade DMs
- recap branding
- operator/internal embeds where appropriate

---

## Asset Usage Rules

### 1. Player Props
If the pick is a player prop and a valid headshot is available:

- prefer headshot as the primary embed image or thumbnail
- optionally combine with team logo only if layout remains clean

If headshot is missing:
- do not block post
- fall back to text-only or logo-first presentation

---

### 2. Team / Game Picks
If the pick is team- or matchup-driven:

- prefer team logos
- use one logo or a clean matchup visual if supported
- do not clutter embeds with unnecessary duplicate branding

If logos are missing:
- text-only rendering is acceptable

---

### 3. Recaps
Recap embeds may use:

- team logos for top plays
- capper branding if appropriate
- light visual identity accents

Recaps should not depend on per-pick asset completeness.

---

### 4. Alerts
Alerts should use assets only when they improve scan speed.

Good examples:
- player headshot on injury alert
- team logo on game-impact alert

Bad examples:
- forcing images into every alert regardless of value
- bloating urgent alerts with decorative visuals

---

## Asset Priority Rules

When multiple valid assets are available, use this priority:

### For player props
1. player headshot
2. team logo
3. no image

### For team / game picks
1. team logo
2. matchup logo pairing if clean
3. no image

### For recaps
1. selective logos/headshots where valuable
2. branded text-first layout
3. no image

---

## Display Locations

Depending on embed family, assets may appear as:

- thumbnail
- main image
- small matchup graphic
- branded icon

Preferred default:
- use **thumbnail** for most pick embeds
- reserve **main image** for special surfaces only

This keeps messages compact and readable in Discord feeds.

---

## Missing Asset Behavior

If a headshot or logo is missing:

- do not fail the post
- do not show broken image URLs
- do not show placeholders like `missing image`
- render the embed cleanly without the asset
- optionally log missing asset state internally for future enrichment

---

## Quality Control Rules

Only use an asset if it is:

- correctly matched to the player/team
- reasonably current
- visually clean
- consistent with the embed family

Do not use:
- low-quality crops
- mismatched team/player assets
- outdated identity marks where better sources exist

---

## Source of Truth

Visual assets must be resolved through governed enrichment paths.

They must not be:
- manually hardcoded ad hoc in Discord messages
- inconsistently chosen by different modules
- treated as core business truth

Asset resolution must remain separate from scoring and promotion logic.

---

## Public vs Internal Use

### Public / premium embeds
- use assets to improve premium feel and scanning speed
- keep presentation disciplined

### Internal / operator embeds
- assets are optional and usually unnecessary
- internal embeds prioritize diagnosis over polish

---

## Best Bets Asset Policy

Best Bets should support premium visual enrichment.

Preferred behavior:
- player props → headshot thumbnail
- team/game picks → team logo thumbnail
- no asset available → still post normally

Best Bets must never be blocked by missing assets.

---

## Capper Pick Post Asset Policy

Capper-originated picks may use:
- headshots for player props
- logos for team/game picks

Asset absence must not:
- undermine capper post quality
- alter promotion eligibility
- create inconsistent message behavior

---

## Recap Asset Policy

Recaps may use assets more selectively than pick embeds.

Recommended uses:
- top play visual
- standout player headshot
- team logos for best-performing sides

Avoid:
- overloading recap posts with too many images
- making recap readability depend on asset coverage

---

## Future Enhancements (Deferred — No Contract)

This addendum supports later improvements such as:

- richer matchup cards
- branded game-day visuals
- capper identity cards
- advanced recap graphics
- Black Label-specific visual treatments

These are enhancements, not current requirements.

---

## Summary

Headshots and logos are a premium enrichment layer governed by these rules:

- use them when available
- prioritize scan speed and polish
- never block posting because of a missing asset
- never let assets override text truth
- text-first readability is the core standard
