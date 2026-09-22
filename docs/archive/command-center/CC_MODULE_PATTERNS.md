# Command Center Module UI Patterns

**Issue:** UTV2-428
**Date:** 2026-04-07
**Status:** Active — shipped with UTV2-428
**Authority:** This document is the canonical reference for Command Center component patterns. All workspace pages must use these components. Pages that diverge must be corrected before merge.

---

## Section 1 — Pattern Overview

Six standardized components live in `apps/command-center/src/components/ui/`. All must be imported from `@/components/ui` — never from individual files.

| Component | Purpose | React type | Props summary |
|---|---|---|---|
| `MetricsCard` | Display a single KPI with optional trend | Server (no state) | `label`, `value`, `trend?`, `trendLabel?`, `loading?` |
| `DataTable<T>` | Generic typed sortable data table | Client (sort state) | `columns`, `data`, `loading?`, `emptyMessage?` |
| `DetailPane` | Expandable/collapsible content section | Client (open/closed state) | `title`, `children`, `defaultOpen?` |
| `HealthBadge` | Color-coded status pill | Server (no state) | `status`, `label?` |
| `LoadingState` | Skeleton shimmer grid for table-like loading | Server (no state) | `rows?`, `columns?` |
| `EmptyState` | Centered empty message with optional CTA | Server (no state) | `message`, `detail?`, `action?` |

---

## Section 2 — Component Usage Rules

### MetricsCard

Use `MetricsCard` for all single-value KPI displays across any workspace. Never build ad-hoc stat boxes.

- `value` accepts `string | number` — format numbers before passing (e.g. `"84.2%"`, `"$1,204"`)
- `trend` is optional — omit when trend data is unavailable; do not default to `'flat'` when unknown
- `trendLabel` should be concise human text (e.g. `"+3 vs last week"`, `"vs. 30-day avg"`)
- Set `loading={true}` while data is fetching — shows skeleton shimmer, avoids layout shift
- Group multiple `MetricsCard` components in a CSS grid: `grid grid-cols-2 gap-4` or `grid-cols-4 gap-4`

```tsx
import { MetricsCard } from '@/components/ui';

<MetricsCard
  label="Win Rate"
  value="68.4%"
  trend="up"
  trendLabel="+2.1pp vs last week"
/>
```

### DataTable

Use `DataTable<T>` for all tabular data. Never use raw `<table>` elements or the legacy `Table`/`Th`/`Td` primitives on new pages.

- Define `Column<T>[]` outside the component to avoid recreation on every render
- The `render` function on a column receives `(val, row)` — use it for badges, links, and formatted values
- `loading` shows skeleton rows matching column count — pass it while data is fetching
- `emptyMessage` defaults to `"No data available."` — override with context-specific text
- No pagination — operator tables are expected to be small (< 500 rows)
- Sorting is client-side, ascending first on first click, toggled on repeat clicks

```tsx
import { DataTable } from '@/components/ui';
import type { Column } from '@/components/ui';

type Pick = { id: string; status: string; score: number };

const columns: Column<Pick>[] = [
  { key: 'id', label: 'ID' },
  { key: 'status', label: 'Status' },
  { key: 'score', label: 'Score', render: (val) => `${val}/100` },
];

<DataTable columns={columns} data={picks} loading={isLoading} emptyMessage="No picks found." />
```

### DetailPane

Use `DetailPane` for any expandable section that holds detail content (lifecycle history, score breakdown, raw metadata). Do not use it for top-level navigation or primary content.

- `defaultOpen={true}` for the first pane in a set; leave others closed
- Content inside a `DetailPane` must not have its own outer card border — the pane already provides the border
- Smooth expand uses `max-h` transition — content with highly variable height will animate correctly up to 2000px

```tsx
import { DetailPane } from '@/components/ui';

<DetailPane title="Score Breakdown" defaultOpen={true}>
  <p className="text-sm text-gray-400">Edge: 72 / Trust: 68 / Readiness: 81</p>
</DetailPane>
```

### HealthBadge

Use `HealthBadge` for system health, channel status, worker state, and any binary/trinary health signal. Do not use it for pick lifecycle states — use `StatusBadge` for those.

- `status` is one of: `'healthy' | 'warning' | 'error' | 'unknown'`
- `label` overrides the default capitalized status text — use when the domain term differs (e.g. `label="Live"` for healthy)
- Never use `HealthBadge` for pick approval or promotion status — those use their own domain language

```tsx
import { HealthBadge } from '@/components/ui';

<HealthBadge status="healthy" />
<HealthBadge status="warning" label="Degraded" />
<HealthBadge status="error" label="Circuit Open" />
```

### LoadingState

Use `LoadingState` as a page-level or section-level placeholder while async data resolves.

- Default: 3 rows × 4 columns — override for the specific layout context
- Use inside a `Suspense` boundary or as an `else` branch of a loading boolean
- Do not use `LoadingState` for inline loading within a component that already has `loading` prop — use the component's own skeleton

```tsx
import { LoadingState } from '@/components/ui';

{isLoading ? <LoadingState rows={5} columns={6} /> : <DataTable ... />}
```

### EmptyState

Use `EmptyState` when a list or table has no rows after a successful fetch. Never show `EmptyState` while loading.

- `message` should name the entity and explain the absence (e.g. `"No held picks in queue."`)
- `detail` adds a secondary explanation line for context (e.g. `"Picks appear here when placed on hold during review."`)
- `action` provides an optional CTA link — use sparingly, only when a clear next step exists
- Do not use `EmptyState` for error conditions — errors get their own inline error text or alert component

```tsx
import { EmptyState } from '@/components/ui';

<EmptyState
  message="No exceptions found."
  detail="Exceptions appear here when delivery fails or picks stall in validation."
  action={{ label: 'Go to Review Queue', href: '/review' }}
/>
```

---

## Section 3 — Loading / Empty / Error State Rules

| Scenario | Component to use | Notes |
|---|---|---|
| Data fetch in progress (page-level) | `LoadingState` | Use `rows`/`columns` matching the expected layout |
| Data fetch in progress (table) | `DataTable` with `loading={true}` | Renders skeleton rows inline |
| Data fetch in progress (metric) | `MetricsCard` with `loading={true}` | Renders skeleton shimmer card |
| Fetch succeeded, zero rows | `EmptyState` | Explain the absence; add `action` only if there is a clear next step |
| Fetch failed / error | Inline error text or a dedicated alert | `EmptyState` is NOT for errors — errors need explicit error messaging |
| Stale / volume-limited data | Data + inline volume warning | Show N count; warn when volume is below threshold (Research: N < 100) |

**Rule:** Never show `EmptyState` while `loading` is true. Never show skeleton while data is loaded and empty.

---

## Section 4 — Tailwind Color Conventions

These color conventions are consistent across all Command Center components and must not be overridden per-workspace.

| Status / Intent | Tailwind classes | Component |
|---|---|---|
| Healthy / Success | `bg-emerald-500/20 text-emerald-400 border-emerald-500/30` | `HealthBadge status="healthy"` |
| Warning / Degraded | `bg-yellow-500/20 text-yellow-400 border-yellow-500/30` | `HealthBadge status="warning"` |
| Error / Broken | `bg-red-500/20 text-red-400 border-red-500/30` | `HealthBadge status="error"` |
| Unknown / Absent | `bg-gray-700/40 text-gray-400 border-gray-700` | `HealthBadge status="unknown"` |
| Trend up | `text-emerald-400` | `MetricsCard trend="up"` |
| Trend down | `text-red-400` | `MetricsCard trend="down"` |
| Trend flat | `text-gray-500` | `MetricsCard trend="flat"` |
| Card / pane container | `border-gray-800 bg-gray-900/50` | `MetricsCard`, `DetailPane`, `Card` |
| Table row hover | `hover:bg-gray-800/30` | `DataTable` rows |
| Table header text | `text-gray-400 uppercase tracking-wide text-xs` | `DataTable` column headers |
| Body text (primary) | `text-white` or `text-gray-200` | Value displays |
| Body text (secondary) | `text-gray-400` | Labels, descriptions |
| Body text (tertiary) | `text-gray-500` | Metadata, disabled items |

**Dark theme only.** The Command Center runs in dark mode (`html.dark`). Do not add light-mode variants. Do not use non-gray neutral scales.

---

## Section 5 — Naming and Import Rules

### Always import from the barrel

```tsx
// Correct
import { MetricsCard, DataTable, HealthBadge, DetailPane, LoadingState, EmptyState } from '@/components/ui';
import type { Column } from '@/components/ui';

// Wrong — do not import from individual files
import { MetricsCard } from '@/components/ui/MetricsCard';
```

### Component naming conventions

- Component names are PascalCase and match the filename exactly
- Props interfaces are named `<ComponentName>Props` and are not exported unless consumed externally
- The `Column<T>` type from `DataTable` is exported and can be imported from `@/components/ui`

### File location rule

All shared UI primitives live in `apps/command-center/src/components/ui/`. Workspace-specific components that use these primitives live in `apps/command-center/src/components/` (one level up) or in workspace-specific subdirectories if warranted.

### No cross-app imports

Command Center components must not import from `@unit-talk/*` packages. They are pure React + Tailwind components.

### Client vs Server discipline

- `MetricsCard`, `HealthBadge`, `LoadingState`, `EmptyState` — server components (no `'use client'`, no `useState`)
- `DataTable`, `DetailPane` — client components (have `'use client'` directive, use `useState`)
- Do not add client-side state to server components
- Do not add `'use client'` to components that have no interactive state

---

## Changelog

| Date | Change | Issue |
|---|---|---|
| 2026-04-07 | Initial pattern library — 6 components shipped | UTV2-428 |
