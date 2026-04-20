# Fibery Automation Scripts

These scripts are designed to be pasted into Fibery Automation Rules as Script actions.

## Setup in Fibery

For each automation:
1. Open Workspace Map → Controls database → Automation Rules
2. Click "+ Add Automation Rule"
3. Set the trigger to "On Schedule" with the specified interval
4. Add filter: "Where Name is not empty"
5. Set action to "Script"
6. Select all default code (Ctrl+A) and replace with the script content
7. Save

## Automations

| # | Name | Schedule | Script File |
|---|------|----------|-------------|
| 1 | Daily Stale Item Audit | Daily 9:00 AM | `1-stale-item-audit.js` |
| 2 | Daily Missing Governance Audit | Daily 9:00 AM | `2-governance-gaps-audit.js` |
| 3 | Weekly Control Review Reminder | Weekly Monday 8:00 AM | `3-weekly-control-review.js` |
| 4 | Daily Hygiene Digest | Daily 10:00 AM | `4-hygiene-digest.js` |

## Important Notes

- All scripts are **read-only** — zero write-back to source entities
- Scripts only create/update Document entities with audit reports
- The "On Schedule" trigger passes matched Controls via `args.currentEntities`
- Scripts ignore the trigger entities and run their own queries
- Each script uses a guard (`args.currentEntities[0]`) to only execute once per trigger batch
