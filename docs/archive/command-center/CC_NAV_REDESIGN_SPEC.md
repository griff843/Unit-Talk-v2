# Command Center Nav Redesign Spec

**Issue:** UTV2-427
**Date:** 2026-04-07
**Status:** Ratified
**Authority:** This document specifies the primary navigation structure for the Command Center four-workspace model. It gates Phase 2 UI implementation work. Implementation in `apps/command-center` must align with this spec.

---

## 1. Nav Pattern Decision

**Pattern chosen: Left sidebar workspace switcher**

**Justification:**

The four workspaces (Research, Decision, Operations, Intelligence) are distinct working contexts, not sequential steps in a flow. Operators will spend extended time within a single workspace before switching. A left sidebar:

- Keeps the workspace switcher always visible without consuming vertical scroll space
- Allows secondary within-workspace navigation to exist as tabs or sub-nav within the main content area rather than competing with the primary switcher
- Scales to the eventual full module count per workspace (8–10 items per workspace in the ratified IA) without truncation
- Is consistent with the desktop-first constraint — sidebar nav is appropriate for the operator dashboard form factor

**Rejected alternatives:**

| Pattern | Reason rejected |
|---|---|
| Top nav (horizontal tabs) | 4 workspace labels at top-level plus per-workspace secondary items would overflow at typical operator monitor widths. Top nav also reduces vertical content space on data-dense pages. |
| Tab bar (bottom) | Bottom tab bars are a mobile pattern. This surface is desktop-first. No benefit on a 1440px+ operator display. |

---

## 2. Workspace Switcher Design

### Four workspace items

```
[ Research ]
[ Decision ]
[ Operations ]
[ Intelligence ]
```

Exactly four items. No additional top-level items. The sidebar width is fixed at 200px.

### Visual hierarchy

- Workspace name: 14px, medium weight, left-aligned
- Active workspace: highlighted background (`bg-gray-800`), white text
- Inactive workspaces: gray text (`text-gray-400`), hover state (`text-gray-200`, `bg-gray-800/50`)
- Active workspace shows its secondary nav items (links to individual pages within the workspace) indented below the workspace name
- Inactive workspaces show only the workspace name — no sub-items visible

### Workspace icons

Each workspace has a single identifying icon rendered left of the workspace label. Icons are from the same icon set used in the existing UI (SVG inline or a consistent icon library). Icon size: 16px.

| Workspace | Icon concept |
|---|---|
| Research | Magnifying glass / search |
| Decision | Bar chart / score breakdown |
| Operations | Gear / settings |
| Intelligence | Sparkle / analytics |

Icons serve as visual anchors, not primary affordances. Text labels are always present.

### Secondary nav (within active workspace)

Secondary nav items appear as indented links below the active workspace label. They are not visible for inactive workspaces.

**Research secondary nav:**
- Prop Explorer (`/research/props`)
- Line-Shopper (`/research/lines`)
- Player Card (`/research/players`)
- Matchup Card (`/research/matchups`)
- Hit Rate (`/research/hit-rate`) — shell with volume warning badge
- Trend Filters (`/research/trends`) — disabled, "Coming soon" tooltip

**Decision secondary nav:**
- Score Breakdown (`/decision/scores`)
- Promotion Preview (`/decision/preview`)
- Routing Preview (`/decision/routing`)
- Board Saturation (`/decision/board`)
- Review History (`/decisions`) — existing route, renamed label
- Hedge Overlays (`/decision/hedges`) — shell, empty state valid

**Operations secondary nav:**
- Dashboard (`/`) — existing route
- Readiness / Health Scorecard (`/burn-in`) — existing route, renamed label
- Picks List (`/picks-list`) — existing route
- Review Queue (`/review`) — existing route
- Held Picks (`/held`) — existing route
- Exceptions (`/exceptions`) — existing route
- Intervention Log (`/interventions`) — existing route, renamed label

**Intelligence secondary nav:**
- Performance (`/performance`) — existing route
- Form Windows (`/intelligence`) — existing route, renamed label
- Scoring Calibration (`/intelligence/calibration`) — shell
- ROI by Tier / Capper / Market (`/intelligence/roi`) — shell with volume warning badge

---

## 3. Persistent Context Model

**What stays visible across all workspace switches:**

| Element | Location | Rationale |
|---|---|---|
| "Unit Talk — Command Center" header | Top of sidebar, above workspace switcher | Identity anchor; never hidden |
| Workspace switcher (all 4 items) | Left sidebar, full height | Primary navigation is always accessible |
| Operator identity / session indicator | Bottom of sidebar | Contextual for the operator; low-priority but persistent |

**What does not persist across workspace switches:**

- Secondary nav items are scoped to the active workspace only
- Page-level filters (pick status filters, date range selectors) reset on workspace switch — they are page state, not global state
- Auto-refresh state resets on navigation

**No global pick context panel is introduced in this spec.** A persistent pick context pane (pin-a-pick pattern) is not ratified and must not be implemented here.

---

## 4. Desktop-First Layout

### Primary layout structure

```
+--sidebar (200px fixed)--+--main content (flex-1, min-w-0)----------+
| Unit Talk                |                                           |
| Command Center           |  [page content area]                      |
|                          |                                           |
| [ Research ]             |                                           |
|   Prop Explorer          |                                           |
|   Line-Shopper           |                                           |
|   Player Card            |                                           |
|   Matchup Card           |                                           |
|   Hit Rate [shell]       |                                           |
|   Trend Filters [soon]   |                                           |
|                          |                                           |
| [ Decision ]             |                                           |
| [ Operations ]           |                                           |
| [ Intelligence ]         |                                           |
|                          |                                           |
| [operator identity]      |                                           |
+--------------------------+-------------------------------------------+
```

- Sidebar: `w-[200px] flex-shrink-0 h-screen sticky top-0 overflow-y-auto`
- Main: `flex-1 min-w-0 min-h-screen overflow-y-auto`
- Body: `flex flex-row` (replaces current single-column layout)

**Minimum supported viewport:** 1280px width. The sidebar does not collapse at this breakpoint.

### Mobile constraints (documented, not implemented)

Mobile implementation is deferred. When implemented:
- Sidebar collapses to icon-only strip at widths below 768px, with a hamburger toggle to expand
- Secondary nav items are hidden when sidebar is collapsed; selecting a workspace icon opens a fly-out panel showing secondary items
- The workspace switcher icon strip is always visible on mobile — the four icons remain the persistent affordance
- No bottom tab bar; the icon sidebar is the mobile primary nav

These constraints are noted here so the component is structured to accommodate future collapse behavior (e.g., sidebar width is a prop, labels can be conditionally hidden).

---

## 5. Route Mapping

All existing routes remain accessible. No routes are removed. The table below shows how existing routes map into the workspace model and what label changes apply.

### Existing routes → workspace assignment

| Current route | Current nav label | Workspace | Ratified label | Status |
|---|---|---|---|---|
| `/` | Dashboard | Operations | Dashboard | Keep |
| `/burn-in` | Burn-In | Operations | Readiness / Health Scorecard | Rename label |
| `/picks-list` | Picks | Operations | Picks List | Rename label (minor) |
| `/review` | Review | Operations | Review Queue | Rename label |
| `/held` | Held | Operations | Held Picks | Rename label |
| `/exceptions` | Exceptions | Operations | Exceptions | Keep |
| `/interventions` | Audit | Operations | Intervention Log | Rename label |
| `/decisions` | Decisions | Decision | Review History | Rename label, move to Decision workspace |
| `/performance` | Performance | Intelligence | Performance | Keep label, Intelligence workspace |
| `/intelligence` | Intelligence | Intelligence | Form Windows | Rename label |

### New stub routes (shell pages — no data, no write surfaces)

| Route | Workspace | Rationale |
|---|---|---|
| `/research` | Research | Workspace home — placeholder until Prop Explorer implemented |
| `/research/props` | Research | Prop Explorer stub |
| `/research/lines` | Research | Line-Shopper stub |
| `/research/players` | Research | Player Card stub |
| `/research/matchups` | Research | Matchup Card stub |
| `/research/hit-rate` | Research | Hit Rate stub (shell — volume warning) |
| `/research/trends` | Research | Trend Filters stub (disabled — blocked) |
| `/decision` | Decision | Workspace home — placeholder |
| `/decision/scores` | Decision | Score Breakdown stub |
| `/decision/preview` | Decision | Promotion Preview stub |
| `/decision/routing` | Decision | Routing Preview stub |
| `/decision/board` | Decision | Board Saturation stub |
| `/decision/hedges` | Decision | Hedge Overlays stub (shell) |
| `/intelligence/calibration` | Intelligence | Scoring Calibration stub (shell) |
| `/intelligence/roi` | Intelligence | ROI stub (shell — volume warning) |

Stub pages render a title and a "Coming soon — data source not yet connected" notice. They do not make API calls and introduce no write surfaces.

---

## 6. Implementation Notes

### Component structure

```
apps/command-center/src/components/
  WorkspaceSidebar.tsx    ← new: primary nav component (this issue)
  NavLinks.tsx            ← existing: retained for backward compat but no longer used in layout
```

`WorkspaceSidebar` is a client component (`'use client'`). It uses `usePathname()` from `next/navigation` to determine the active workspace and active secondary item.

### Layout change

`layout.tsx` changes from a single `<header>` with horizontal `NavLinks` to a `flex flex-row` body with the `WorkspaceSidebar` on the left and `<main>` on the right.

The existing `NavLinks` component is retained in the repository — it is not deleted — because it may be referenced in tests or used as a fallback. It is no longer rendered in `layout.tsx`.

### No new write surfaces

`WorkspaceSidebar` is read-only navigation. No server actions, no POST calls, no form submissions. The sidebar renders links only.

### Stub page pattern

Each stub page is a `page.tsx` with `export default function Page()` returning a minimal shell:
- Page title (h1)
- Workspace label (small text)
- "Coming soon — not yet connected" notice for blocked or unimplemented modules
- "Shell — data volume required" notice for shell-only modules

No data fetching. No API calls. No loading states.

---

## 7. Acceptance Checklist

- [x] Nav pattern decided: left sidebar workspace switcher
- [x] Workspace switcher defined: 4 items (Research / Decision / Operations / Intelligence)
- [x] Secondary nav defined per workspace
- [x] Persistent context model defined
- [x] Desktop-first layout specified, mobile constraints documented
- [x] Route mapping complete — all existing routes preserved
- [x] Stub routes defined for new workspace pages
- [x] No new write surfaces
- [x] Label renames from ratification applied (Burn-In → Readiness / Health Scorecard, Audit → Intervention Log, Decisions → Review History)
