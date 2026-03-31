/**
 * Notion Checkpoint Sync
 *
 * Reads docs/06_status/PROGRAM_STATUS.md and creates a checkpoint page
 * in Notion with extracted milestone status, test counts, gate status,
 * open risks, and key capabilities.
 *
 * Usage:
 *   npx tsx scripts/notion-sync.ts
 *
 * Required env vars:
 *   NOTION_API_KEY       — Notion integration token
 *   NOTION_DATABASE_ID   — Target database ID for checkpoint pages
 *
 * Additive-only: creates new pages, never updates or deletes existing content.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const NOTION_API_KEY = process.env.NOTION_API_KEY;
const NOTION_DATABASE_ID = process.env.NOTION_DATABASE_ID;

if (!NOTION_API_KEY) {
  console.error('ERROR: NOTION_API_KEY is not set. Set it in local.env or as an environment variable.');
  process.exit(1);
}

if (!NOTION_DATABASE_ID) {
  console.error('ERROR: NOTION_DATABASE_ID is not set. Set it in local.env or as an environment variable.');
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Read PROGRAM_STATUS.md
// ---------------------------------------------------------------------------

const statusPath = resolve(import.meta.dirname ?? __dirname, '..', 'docs', '06_status', 'PROGRAM_STATUS.md');
let statusContent: string;
try {
  statusContent = readFileSync(statusPath, 'utf-8');
} catch (err) {
  console.error(`ERROR: Could not read PROGRAM_STATUS.md at ${statusPath}`);
  console.error(err);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Extraction helpers
// ---------------------------------------------------------------------------

function extractLastUpdated(content: string): string {
  const match = content.match(/^## Last Updated\s*\n\n(.+)/m);
  return match?.[1]?.trim() ?? 'unknown';
}

function extractCurrentStateTable(content: string): Record<string, string> {
  const result: Record<string, string> = {};
  const section = content.match(/## Current State\s*\n\n\|[^\n]+\n\|[^\n]+\n([\s\S]*?)(?=\n##|\n---)/);
  if (!section) return result;
  const rows = section[1].trim().split('\n');
  for (const row of rows) {
    const cells = row.split('|').map(c => c.trim()).filter(Boolean);
    if (cells.length >= 2) {
      result[cells[0]] = cells[1];
    }
  }
  return result;
}

function extractGateStatus(content: string): Array<{ gate: string; status: string; notes: string }> {
  const gates: Array<{ gate: string; status: string; notes: string }> = [];
  const section = content.match(/## Gate Notes[^\n]*\n\n\|[^\n]+\n\|[^\n]+\n([\s\S]*?)(?=\n###|\n---|\n##)/);
  if (!section) return gates;
  const rows = section[1].trim().split('\n');
  for (const row of rows) {
    const cells = row.split('|').map(c => c.trim()).filter(Boolean);
    if (cells.length >= 2) {
      gates.push({ gate: cells[0], status: cells[1], notes: cells[2] ?? '' });
    }
  }
  return gates;
}

function extractOpenRisks(content: string): Array<{ risk: string; severity: string; status: string }> {
  const risks: Array<{ risk: string; severity: string; status: string }> = [];
  const section = content.match(/## Open Risks\s*\n\n\|[^\n]+\n\|[^\n]+\n([\s\S]*?)(?=\n---|\n##)/);
  if (!section) return risks;
  const rows = section[1].trim().split('\n');
  for (const row of rows) {
    const cells = row.split('|').map(c => c.trim()).filter(Boolean);
    if (cells.length >= 3) {
      risks.push({ risk: cells[0], severity: cells[1], status: cells[2] });
    }
  }
  return risks;
}

function extractKeyCapabilitiesSummary(content: string): string[] {
  const summaries: string[] = [];
  const section = content.match(/## Key Capabilities[^\n]*\n([\s\S]*?)(?=\n---|\n## (?!#))/);
  if (!section) return summaries;
  const headings = section[1].matchAll(/^### (.+)/gm);
  for (const h of headings) {
    summaries.push(h[1].trim());
  }
  return summaries;
}

// ---------------------------------------------------------------------------
// Extract data
// ---------------------------------------------------------------------------

const lastUpdated = extractLastUpdated(statusContent);
const currentState = extractCurrentStateTable(statusContent);
const gates = extractGateStatus(statusContent);
const openRisks = extractOpenRisks(statusContent);
const openRiskCount = openRisks.filter(r => /open/i.test(r.status)).length;
const capabilities = extractKeyCapabilitiesSummary(statusContent);

const today = new Date().toISOString().slice(0, 10);
const pageTitle = `Unit Talk V2 Checkpoint -- ${today}`;

// ---------------------------------------------------------------------------
// Build Notion page body blocks
// ---------------------------------------------------------------------------

type NotionBlock = Record<string, unknown>;

function heading2(text: string): NotionBlock {
  return {
    object: 'block',
    type: 'heading_2',
    heading_2: { rich_text: [{ type: 'text', text: { content: text } }] },
  };
}

function paragraph(text: string): NotionBlock {
  return {
    object: 'block',
    type: 'paragraph',
    paragraph: { rich_text: [{ type: 'text', text: { content: text } }] },
  };
}

function bulletItem(text: string): NotionBlock {
  return {
    object: 'block',
    type: 'bulleted_list_item',
    bulleted_list_item: { rich_text: [{ type: 'text', text: { content: text } }] },
  };
}

const children: NotionBlock[] = [];

// Last updated
children.push(heading2('Last Updated'));
children.push(paragraph(lastUpdated));

// Current state
children.push(heading2('Current State'));
for (const [field, value] of Object.entries(currentState)) {
  children.push(bulletItem(`${field}: ${value}`));
}

// Gate status
children.push(heading2('Gate Status'));
for (const g of gates) {
  const notes = g.notes ? ` (${g.notes})` : '';
  children.push(bulletItem(`${g.gate}: ${g.status}${notes}`));
}

// Open risks
children.push(heading2(`Open Risks (${openRiskCount} open)`));
for (const r of openRisks) {
  children.push(bulletItem(`[${r.severity}] ${r.risk} -- ${r.status}`));
}

// Key capabilities
children.push(heading2('Key Capabilities'));
for (const cap of capabilities) {
  children.push(bulletItem(cap));
}

// ---------------------------------------------------------------------------
// Create Notion page
// ---------------------------------------------------------------------------

async function createCheckpointPage(): Promise<void> {
  // Dynamic import so the script fails gracefully at the env-check stage
  // if the package is not installed yet.
  const { Client } = await import('@notionhq/client');
  const notion = new Client({ auth: NOTION_API_KEY });

  const response = await notion.pages.create({
    parent: { database_id: NOTION_DATABASE_ID! },
    properties: {
      title: {
        title: [{ text: { content: pageTitle } }],
      },
    },
    children: children as Parameters<typeof notion.pages.create>[0]['children'],
  });

  console.log(`Checkpoint page created: ${(response as { url?: string }).url ?? response.id}`);
}

createCheckpointPage().catch((err) => {
  console.error('ERROR: Failed to create Notion checkpoint page.');
  console.error(err);
  process.exit(1);
});
