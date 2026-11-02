# WORK-2026110201 Diff Summary

MERGE_SHA: pending merge

The member `/help` embed now shows only `/stats`, `/leaderboard`, and `/trial-status`, using the packet's exact descriptions and support links. `/trial-status` now uses the prepared copy for Free, Trial, VIP, VIP+, and Black Label; Capper guidance points to the Smart Form. Tier resolution, role guards, command registration, and private response behavior are unchanged.

Changed implementation files:

- `apps/discord-bot/src/commands/help.ts`
- `apps/discord-bot/src/commands/trial-status.ts`
- `apps/discord-bot/src/discord-bot-foundation.test.ts`

The foundation tests assert exact rendered member text, both support channels, every tier description, form-based Capper instructions, and that `/pick` does not reappear in member help.

Before: `/help` advertised operator/deferred commands, `/pick`, `/upgrade`, and `/recap`; Free promised recaps and active picks; Capper guidance directed members to `/pick`.

After: `/help` contains exactly the three prepared member entries and support links; Free copy makes no recap or active-pick promise; Capper copy links to the Unit Talk pick form under a **Submitting picks** heading (review correction `eece61514`).
