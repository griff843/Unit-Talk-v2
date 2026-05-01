'use client';

import React from 'react';
import { useMemo, useState } from 'react';
import { Button, Card, ConfirmDialog } from '@/components/ui';
import { useSecurityMonitoring } from '@/hooks/useSecurityMonitoring';

type OperatorRole = 'ADMIN' | 'OPERATOR' | 'VIEWER';
type OpsTab = 'audit' | 'security' | 'emergency';

interface AuditRow {
  id: string;
  actor: string;
  action: string;
  resource: string;
  timestamp: string;
  outcome: 'success' | 'warning' | 'denied';
}

const AUDIT_ROWS: AuditRow[] = [
  {
    id: 'audit-1',
    actor: 'VerificationLead',
    action: 'confirm_preview_release',
    resource: 'ops.safe-mode',
    timestamp: '2026-04-30T17:49:00.000Z',
    outcome: 'success',
  },
  {
    id: 'audit-2',
    actor: 'CodexFrontend',
    action: 'open_agent_log',
    resource: 'agents.runtime-watch',
    timestamp: '2026-04-30T17:43:00.000Z',
    outcome: 'success',
  },
  {
    id: 'audit-3',
    actor: 'ClaudeGovernance',
    action: 'request_policy_override',
    resource: 'ops.freeze-system',
    timestamp: '2026-04-30T17:39:00.000Z',
    outcome: 'warning',
  },
  {
    id: 'audit-4',
    actor: 'guest-session',
    action: 'invoke_admin_control',
    resource: 'ops.freeze-system',
    timestamp: '2026-04-30T17:31:00.000Z',
    outcome: 'denied',
  },
];

function severityTone(severity: 'critical' | 'high' | 'medium' | 'low') {
  if (severity === 'critical') return 'border-rose-500/40 bg-rose-500/10 text-rose-100';
  if (severity === 'high') return 'border-orange-400/40 bg-orange-500/10 text-orange-100';
  if (severity === 'medium') return 'border-amber-400/40 bg-amber-500/10 text-amber-100';
  return 'border-sky-400/40 bg-sky-500/10 text-sky-100';
}

function outcomeTone(outcome: AuditRow['outcome']) {
  if (outcome === 'denied') return 'text-rose-300';
  if (outcome === 'warning') return 'text-amber-200';
  return 'text-emerald-300';
}

function buildAuditCsv(rows: AuditRow[]) {
  const header = ['actor', 'action', 'resource', 'timestamp', 'outcome'];
  const body = rows.map((row) => [row.actor, row.action, row.resource, row.timestamp, row.outcome]);
  return [header, ...body]
    .map((columns) => columns.map((value) => `"${String(value).replaceAll('"', '""')}"`).join(','))
    .join('\n');
}

export function normalizeRole(value?: string): OperatorRole {
  if (value === 'ADMIN' || value === 'OPERATOR') return value;
  return 'VIEWER';
}

export function filterAuditRows(rows: AuditRow[], query: string) {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return rows;

  return rows.filter((row) =>
    row.actor.toLowerCase().includes(normalized) ||
    row.action.toLowerCase().includes(normalized) ||
    row.resource.toLowerCase().includes(normalized) ||
    row.outcome.toLowerCase().includes(normalized),
  );
}

export function OpsWorkspace({
  role,
  initialTab = 'audit',
}: {
  role: OperatorRole;
  initialTab?: OpsTab;
}) {
  const { events } = useSecurityMonitoring();
  const [activeTab, setActiveTab] = useState<OpsTab>(initialTab);
  const [auditQuery, setAuditQuery] = useState('');
  const [confirmAction, setConfirmAction] = useState<'Enable Safe Mode' | 'Freeze System' | null>(null);
  const [lastConfirmedAction, setLastConfirmedAction] = useState<string | null>(null);

  const filteredAuditRows = useMemo(() => filterAuditRows(AUDIT_ROWS, auditQuery), [auditQuery]);
  const isAdmin = role === 'ADMIN';

  const exportAudit = () => {
    const csv = buildAuditCsv(filteredAuditRows);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'ops-audit-export.csv';
    anchor.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="flex flex-col gap-6">
      <section className="cc-surface p-6">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-[11px] uppercase tracking-[0.24em] text-[var(--cc-text-muted)]">Ops</p>
            <h2 className="mt-3 text-3xl font-semibold tracking-[-0.05em] text-[var(--cc-text-primary)]">
              Audit truth, security pressure, and emergency controls in one operational rail.
            </h2>
          </div>
          <div className="rounded-full border border-white/8 bg-white/[0.03] px-4 py-2 text-xs uppercase tracking-[0.18em] text-[var(--cc-text-secondary)]">
            Active role: {role}
          </div>
        </div>
      </section>

      <div className="flex flex-wrap gap-2">
        {(['audit', 'security', 'emergency'] as OpsTab[]).map((tab) => {
          const active = activeTab === tab;

          return (
            <button
              key={tab}
              type="button"
              onClick={() => setActiveTab(tab)}
              className={`rounded-full border px-4 py-2 text-sm capitalize transition-colors ${active ? 'border-[var(--cc-accent)] bg-[var(--cc-accent)]/15 text-[var(--cc-text-primary)]' : 'border-[var(--cc-border-subtle)] text-[var(--cc-text-secondary)] hover:bg-white/[0.03]'}`}
            >
              {tab}
            </button>
          );
        })}
      </div>

      {activeTab === 'audit' ? (
        <Card title="Audit">
          <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <input
              value={auditQuery}
              onChange={(event) => setAuditQuery(event.currentTarget.value)}
              placeholder="Filter actor, action, resource, or outcome"
              className="w-full rounded-2xl border border-[var(--cc-border-subtle)] bg-white/[0.03] px-4 py-3 text-sm text-[var(--cc-text-primary)] outline-none transition-colors focus:border-[var(--cc-accent)] md:max-w-sm"
            />
            <Button variant="secondary" onClick={exportAudit}>Export CSV</Button>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-white/8 text-[11px] uppercase tracking-[0.18em] text-[var(--cc-text-muted)]">
                <tr>
                  <th className="py-2 pr-4">Actor</th>
                  <th className="py-2 pr-4">Action</th>
                  <th className="py-2 pr-4">Resource</th>
                  <th className="py-2 pr-4">Timestamp</th>
                  <th className="py-2">Outcome</th>
                </tr>
              </thead>
              <tbody>
                {filteredAuditRows.map((row) => (
                  <tr key={row.id} className="border-b border-white/5 last:border-b-0">
                    <td className="py-3 pr-4 text-[var(--cc-text-primary)]">{row.actor}</td>
                    <td className="py-3 pr-4 text-[var(--cc-text-secondary)]">{row.action}</td>
                    <td className="py-3 pr-4 font-mono text-[var(--cc-text-secondary)]">{row.resource}</td>
                    <td className="py-3 pr-4 text-[var(--cc-text-secondary)]">{new Date(row.timestamp).toLocaleString()}</td>
                    <td className={`py-3 font-medium uppercase ${outcomeTone(row.outcome)}`}>{row.outcome}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ) : null}

      {activeTab === 'security' ? (
        <Card title="Security">
          <div className="space-y-3">
            {events.map((event) => (
              <div key={event.id} className={`rounded-[22px] border p-4 ${severityTone(event.severity)}`}>
                <div className="flex flex-col gap-2 lg:flex-row lg:items-start lg:justify-between">
                  <div>
                    <p className="text-[11px] uppercase tracking-[0.2em]">{event.severity}</p>
                    <p className="mt-2 text-base font-semibold">{event.title}</p>
                    <p className="mt-2 text-sm opacity-90">{event.detail}</p>
                  </div>
                  <div className="text-xs uppercase tracking-[0.18em] opacity-80">
                    <div>{event.actor}</div>
                    <div className="mt-2">{new Date(event.timestamp).toLocaleTimeString()}</div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </Card>
      ) : null}

      {activeTab === 'emergency' ? (
        <Card title="Emergency">
          <div className="rounded-[24px] border border-rose-500/40 bg-rose-500/10 p-6">
            <p className="text-[11px] uppercase tracking-[0.24em] text-rose-200">Emergency Controls</p>
            <h3 className="mt-3 text-2xl font-semibold tracking-[-0.04em] text-rose-50">High-impact controls are confirmation-gated and role-restricted.</h3>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-rose-100/85">
              These controls intentionally require exact-action confirmation before they can fire. Non-admin operators can inspect the state here, but they cannot trigger the action surface.
            </p>

            {lastConfirmedAction ? (
              <div className="mt-5 rounded-2xl border border-emerald-400/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-100">
                Last confirmed action: {lastConfirmedAction}
              </div>
            ) : null}

            <div className="mt-6 grid gap-4 md:grid-cols-2">
              {isAdmin ? (
                <>
                  <Button variant="danger" className="min-h-16 text-base" onClick={() => setConfirmAction('Enable Safe Mode')}>
                    Enable Safe Mode
                  </Button>
                  <Button variant="danger" className="min-h-16 text-base" onClick={() => setConfirmAction('Freeze System')}>
                    Freeze System
                  </Button>
                </>
              ) : (
                <div className="rounded-2xl border border-dashed border-rose-300/30 bg-black/10 px-4 py-5 text-sm text-rose-50/85 md:col-span-2">
                  Admin role required to render emergency actions.
                </div>
              )}
            </div>
          </div>
        </Card>
      ) : null}

      {confirmAction ? (
        <ConfirmDialog
          action={confirmAction}
          confirmText="Type the exact action name before the control unlocks."
          onConfirm={() => {
            setLastConfirmedAction(confirmAction);
            setConfirmAction(null);
          }}
          onClose={() => setConfirmAction(null)}
        />
      ) : null}
    </div>
  );
}
