// UTV2-428 â€" Standardized module UI patterns
// Always import from '@/components/ui', never from individual files.

export { MetricsCard } from './MetricsCard';
export type {} from './MetricsCard';

export { DataTable } from './DataTable';
export type { Column } from './DataTable';

export { DetailPane } from './DetailPane';
export { DetailPane as DetailPanel } from './DetailPane';

export { HealthBadge } from './HealthBadge';

export { LiveEventFeed } from './LiveEventFeed';
export type { LiveEventFeedEvent } from './LiveEventFeed';

export { PipelineFlow } from './PipelineFlow';

export { ProviderHealthCard } from './ProviderHealthCard';

export { Sparkline } from './Sparkline';

export { LoadingState } from './LoadingState';

export { EmptyState } from './EmptyState';

// UNI-101 — Agents + Intelligence + Ops workspace UI primitives
export { AgentCard } from './AgentCard';
export type { AgentCardProps, AgentStatus } from './AgentCard';

export { LogDrawer } from './LogDrawer';
export type { LogDrawerProps } from './LogDrawer';

export { StatCard } from './StatCard';
export type { StatCardProps } from './StatCard';

export { ConfirmDialog } from './ConfirmDialog';
export type { ConfirmDialogProps } from './ConfirmDialog';

// Pre-existing ui primitives — re-exported for convenience
export { Breadcrumb } from './Breadcrumb';
export { Button } from './Button';
export { Card } from './Card';
export { StatusBadge } from './StatusBadge';
export { Table, TableHead, TableBody, Th, Td } from './Table';
