/**
 * Repo-owned work orders: `.ops/work/WORK-<n>.md`.
 *
 * Since the Linear workflow was retired (2026-11-25), a work order in the
 * repository is the only source of work identity, tier and acceptance
 * criteria. Lane tooling that used to read the tracker (dispatch candidates,
 * the daily digest, scope suggestion) reads these files instead.
 *
 * A work order carries a header line, e.g.
 *   `# WORK-2026112501 — Short work title`
 *   `Tier: T1 (mechanical floor: ...) · Lane type: governance · Executor: claude`
 * followed by the sections `buildTaskContract` parses (Objective, Acceptance
 * Criteria, Guardrails, Non-goals, Required Evidence, Exit Criteria).
 */
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './shared.js';

export const WORK_ORDER_ID_PATTERN = /^WORK-\d+$/u;

export function workOrderDir(root: string = ROOT): string {
  return path.join(root, '.ops', 'work');
}

export interface WorkOrder {
  identifier: string;
  title: string;
  tier: 'T1' | 'T2' | 'T3' | null;
  lane_type: string | null;
  executor: 'claude' | 'codex' | null;
  has_acceptance_criteria: boolean;
  /** Repo-relative path of the work order file. */
  path: string;
  body: string;
}

/** Parse one work order's header and body. Pure: no I/O. */
export function parseWorkOrder(identifier: string, body: string): WorkOrder {
  const id = identifier.toUpperCase();
  const titleMatch = body.match(/^#\s+(.+)$/mu);
  const rawTitle = titleMatch?.[1]?.trim() ?? id;
  const title = rawTitle.replace(new RegExp(`^${id}\\s*[—-]\\s*`, 'u'), '').trim() || rawTitle;
  const tierMatch = body.match(/^Tier:\s*(T[123])\b/imu);
  const laneMatch = body.match(/Lane type:\s*([a-z0-9-]+)/iu);
  const executorMatch = body.match(/Executor:\s*([a-z-]+)/iu);
  const executorRaw = executorMatch?.[1]?.toLowerCase() ?? '';
  return {
    identifier: id,
    title,
    tier: tierMatch?.[1] ? (tierMatch[1].toUpperCase() as 'T1' | 'T2' | 'T3') : null,
    lane_type: laneMatch?.[1] ? laneMatch[1].toLowerCase() : null,
    executor: executorRaw.startsWith('claude') ? 'claude' : executorRaw.startsWith('codex') ? 'codex' : null,
    has_acceptance_criteria: /^##\s+acceptance criteria/imu.test(body),
    path: path.posix.join('.ops', 'work', `${id}.md`),
    body,
  };
}

/** One lane's work order at `.ops/work/<ID>.md`, or `null` when there is none. */
export function readWorkOrder(identifier: string, root: string = ROOT): WorkOrder | null {
  const id = identifier.toUpperCase();
  const filePath = path.join(workOrderDir(root), `${id}.md`);
  if (!fs.existsSync(filePath)) return null;
  return parseWorkOrder(id, fs.readFileSync(filePath, 'utf8'));
}

/** Every work order in the repository, sorted by identifier. */
export function readAllWorkOrders(root: string = ROOT): WorkOrder[] {
  const dir = workOrderDir(root);
  if (!fs.existsSync(dir)) return [];
  const orders: WorkOrder[] = [];
  for (const entry of fs.readdirSync(dir).sort()) {
    const match = entry.match(/^(WORK-\d+)\.md$/u);
    if (!match?.[1]) continue;
    orders.push(parseWorkOrder(match[1], fs.readFileSync(path.join(dir, entry), 'utf8')));
  }
  return orders;
}

/**
 * Work orders with no lane yet: the dispatchable population. A work order whose
 * identifier already has a lane manifest (in any status) has been started.
 */
export function openWorkOrders(manifestIssueIds: Iterable<string>, root: string = ROOT): WorkOrder[] {
  const started = new Set([...manifestIssueIds].map((id) => id.toUpperCase()));
  return readAllWorkOrders(root).filter((order) => !started.has(order.identifier));
}
