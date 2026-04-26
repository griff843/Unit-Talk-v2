import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { existsSync } from 'node:fs';
import type { QAResult, LedgerEntry } from './types.js';

/**
 * Persistent ledger tracking QA outcomes across runs.
 * Detects regressions (PASS → FAIL transitions) and deduplicates issues.
 */
export class QALedger {
  private readonly ledgerPath: string;
  private entries: LedgerEntry[] = [];

  constructor(ledgerDir: string) {
    this.ledgerPath = join(ledgerDir, 'ledger.json');
  }

  async load(): Promise<void> {
    if (existsSync(this.ledgerPath)) {
      const raw = await readFile(this.ledgerPath, 'utf-8');
      this.entries = JSON.parse(raw) as LedgerEntry[];
    }
  }

  async save(): Promise<void> {
    await mkdir(dirname(this.ledgerPath), { recursive: true });
    await writeFile(this.ledgerPath, JSON.stringify(this.entries, null, 2), 'utf-8');
  }

  async record(result: QAResult): Promise<{ isRegression: boolean; entry: LedgerEntry }> {
    await this.load();

    const id = `${result.product}/${result.surface}/${result.flow}/${result.persona}`;
    const existing = this.entries.find((e) => e.id === id);

    const isRegression =
      existing !== undefined &&
      existing.status === 'PASS' &&
      (result.status === 'FAIL' || result.status === 'ERROR');

    if (existing) {
      existing.lastSeen = result.timestamp;
      existing.occurrences += 1;
      existing.status = result.status;
      if (isRegression) existing.regression = true;
      await this.save();
      return { isRegression, entry: existing };
    }

    const entry: LedgerEntry = {
      id,
      product: result.product,
      surface: result.surface,
      flow: result.flow,
      persona: result.persona,
      firstSeen: result.timestamp,
      lastSeen: result.timestamp,
      occurrences: 1,
      status: result.status,
      regression: false,
    };

    this.entries.push(entry);
    await this.save();
    return { isRegression: false, entry };
  }

  getAll(): LedgerEntry[] {
    return [...this.entries];
  }

  getRegressions(): LedgerEntry[] {
    return this.entries.filter((e) => e.regression);
  }
}
