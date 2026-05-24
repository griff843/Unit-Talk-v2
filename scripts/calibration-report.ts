#!/usr/bin/env tsx
/**
 * UTV2-1034: Model Calibration Baseline
 *
 * Queries picks + settlement_records for picks settled after 2026-05-11
 * (post-fix settlements after UTV2-901/903/906/879 corrections).
 *
 * Computes:
 *   - Brier score: mean squared error between predicted probability and outcome
 *   - ECE (Expected Calibration Error): 10-bucket reliability diagram
 *   - Log-loss: proper scoring rule for binary outcomes
 *
 * Segments by confidence band, sport, and model version (promotion_version).
 *
 * Usage:
 *   tsx scripts/calibration-report.ts [--after=YYYY-MM-DD] [--output=path.md] [--json]
 *
 * Default --after: 2026-05-11 (post-fix baseline)
 * Default --output: docs/06_status/proof/UTV2-1034/calibration-baseline-YYYYMMDD.md
 */

import { createClient } from '@supabase/supabase-js';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLIP_EPSILON = 0.001;
const MIN_SAMPLE_SIZE = 20;

// ── env loading ──────────────────────────────────────────────────────────────

function loadEnv() {
  const envFile = resolve(__dirname, '..', 'local.env');
  try {
    const content = readFileSync(envFile, 'utf8');
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      const val = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
      if (!process.env[key]) process.env[key] = val;
    }
  } catch {
    // no local.env — rely on process.env
  }
}

// ── types ────────────────────────────────────────────────────────────────────

interface CalibrationRow {
  pickId: string;
  confidence: number;       // 0–100 integer from picks.confidence
  result: string;           // 'won' | 'lost' | 'push'
  sportId: string | null;
  modelVersion: string | null;
  settledAt: string;
}

interface BucketStats {
  label: string;
  count: number;
  meanPredicted: number;
  actualWinRate: number;
  calibrationError: number;
}

interface CalibrationSegment {
  label: string;
  count: number;
  brierScore: number;
  ece: number;
  logLoss: number;
  winRate: number;
  meanConfidence: number;
  buckets: BucketStats[];
}

export interface CalibrationReport {
  generatedAt: string;
  afterDate: string;
  totalRows: number;
  usableRows: number;
  excludedPush: number;
  excludedNullConfidence: number;
  overall: CalibrationSegment;
  bySport: CalibrationSegment[];
  byModelVersion: CalibrationSegment[];
  byConfidenceBand: CalibrationSegment[];
  warnings: string[];
  followOnRequired: boolean;
  followOnReason: string | null;
}

// ── math ─────────────────────────────────────────────────────────────────────

function clip(p: number): number {
  return Math.max(CLIP_EPSILON, Math.min(1 - CLIP_EPSILON, p));
}

function brierScore(rows: CalibrationRow[]): number {
  if (rows.length === 0) return NaN;
  const sum = rows.reduce((acc, r) => {
    const p = clip(r.confidence / 100);
    const y = r.result === 'won' ? 1 : 0;
    return acc + (p - y) ** 2;
  }, 0);
  return sum / rows.length;
}

function logLoss(rows: CalibrationRow[]): number {
  if (rows.length === 0) return NaN;
  const sum = rows.reduce((acc, r) => {
    const p = clip(r.confidence / 100);
    const y = r.result === 'won' ? 1 : 0;
    return acc + (y * Math.log(p) + (1 - y) * Math.log(1 - p));
  }, 0);
  return -(sum / rows.length);
}

function eceWithBuckets(rows: CalibrationRow[]): { ece: number; buckets: BucketStats[] } {
  const n = rows.length;
  if (n === 0) return { ece: NaN, buckets: [] };

  const buckets: Array<CalibrationRow[]> = Array.from({ length: 10 }, () => []);
  for (const row of rows) {
    const idx = Math.min(9, Math.floor(row.confidence / 10));
    buckets[idx]!.push(row);
  }

  let weightedError = 0;
  const bucketStats: BucketStats[] = buckets.map((b, i) => {
    if (b.length === 0) {
      return {
        label: `${i * 10}–${i * 10 + 9}%`,
        count: 0,
        meanPredicted: 0,
        actualWinRate: 0,
        calibrationError: 0,
      };
    }
    const meanPredicted = b.reduce((a, r) => a + r.confidence / 100, 0) / b.length;
    const wins = b.filter((r) => r.result === 'won').length;
    const actualWinRate = wins / b.length;
    const calibrationError = Math.abs(meanPredicted - actualWinRate);
    weightedError += (b.length / n) * calibrationError;
    return {
      label: `${i * 10}–${i * 10 + 9}%`,
      count: b.length,
      meanPredicted,
      actualWinRate,
      calibrationError,
    };
  });

  return { ece: weightedError, buckets: bucketStats };
}

function buildSegment(label: string, rows: CalibrationRow[]): CalibrationSegment {
  const wins = rows.filter((r) => r.result === 'won').length;
  const { ece, buckets } = eceWithBuckets(rows);
  return {
    label,
    count: rows.length,
    brierScore: brierScore(rows),
    ece,
    logLoss: logLoss(rows),
    winRate: rows.length > 0 ? wins / rows.length : NaN,
    meanConfidence: rows.length > 0
      ? rows.reduce((a, r) => a + r.confidence, 0) / rows.length
      : NaN,
    buckets,
  };
}

// ── formatting ───────────────────────────────────────────────────────────────

function fmt(n: number, decimals = 4): string {
  if (isNaN(n)) return 'n/a';
  return n.toFixed(decimals);
}

function pct(n: number): string {
  if (isNaN(n)) return 'n/a';
  return `${(n * 100).toFixed(1)}%`;
}

function renderSegment(seg: CalibrationSegment): string {
  const lines: string[] = [
    `### ${seg.label} (n=${seg.count})`,
    '',
    `| Metric | Value |`,
    `|--------|-------|`,
    `| Brier score | ${fmt(seg.brierScore, 4)} |`,
    `| ECE (10-bucket) | ${fmt(seg.ece, 4)} |`,
    `| Log-loss | ${fmt(seg.logLoss, 4)} |`,
    `| Win rate | ${pct(seg.winRate)} |`,
    `| Mean confidence | ${pct(seg.meanConfidence / 100)} |`,
    '',
    `**Reliability diagram (10 buckets):**`,
    '',
    `| Bucket | n | Mean predicted | Actual win rate | Calibration error |`,
    `|--------|---|----------------|-----------------|-------------------|`,
  ];
  for (const b of seg.buckets) {
    if (b.count > 0) {
      lines.push(
        `| ${b.label} | ${b.count} | ${pct(b.meanPredicted)} | ${pct(b.actualWinRate)} | ${fmt(b.calibrationError, 4)} |`,
      );
    }
  }
  lines.push('');
  return lines.join('\n');
}

function renderReport(report: CalibrationReport): string {
  const lines: string[] = [
    `# Model Calibration Baseline — ${report.afterDate} onwards`,
    '',
    `**Generated:** ${report.generatedAt}  `,
    `**After date:** ${report.afterDate} (post-fix settlements)  `,
    `**Total rows queried:** ${report.totalRows}  `,
    `**Usable rows (win/loss, non-null confidence):** ${report.usableRows}  `,
    `**Excluded (push):** ${report.excludedPush}  `,
    `**Excluded (null confidence):** ${report.excludedNullConfidence}  `,
    '',
    `## Decision`,
    '',
  ];

  if (report.usableRows < MIN_SAMPLE_SIZE) {
    lines.push(
      `⚠️ **Insufficient data:** only ${report.usableRows} usable rows (minimum ${MIN_SAMPLE_SIZE} required for meaningful calibration).`,
      '',
      `Calibration metrics are shown for completeness but should not be used to make tier-label decisions.`,
      '',
    );
  } else if (report.followOnRequired) {
    lines.push(
      `🔴 **Follow-on required:** ${report.followOnReason}`,
      '',
      `A recalibration issue should be created.`,
      '',
    );
  } else {
    lines.push(`✅ **No recalibration required.** ECE ≤ 0.10 on sufficient sample.`, '');
  }

  if (report.warnings.length > 0) {
    lines.push('## Warnings', '');
    for (const w of report.warnings) lines.push(`- ${w}`);
    lines.push('');
  }

  lines.push('## Overall', '', renderSegment(report.overall));

  if (report.bySport.length > 0) {
    lines.push('## By Sport', '');
    for (const seg of report.bySport) lines.push(renderSegment(seg));
  }

  if (report.byModelVersion.length > 0) {
    lines.push('## By Model Version', '');
    for (const seg of report.byModelVersion) lines.push(renderSegment(seg));
  }

  if (report.byConfidenceBand.length > 0) {
    lines.push('## By Confidence Band', '');
    for (const seg of report.byConfidenceBand) lines.push(renderSegment(seg));
  }

  return lines.join('\n');
}

// ── main ─────────────────────────────────────────────────────────────────────

async function main() {
  loadEnv();

  const afterArg =
    process.argv.find((a) => a.startsWith('--after='))?.split('=')[1] ?? '2026-05-11';
  const jsonFlag = process.argv.includes('--json');
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const defaultOutput = resolve(
    __dirname,
    `../docs/06_status/proof/UTV2-1034/calibration-baseline-${today}.md`,
  );
  const outputPath =
    process.argv.find((a) => a.startsWith('--output='))?.split('=')[1] ?? defaultOutput;

  const supabaseUrl = process.env['SUPABASE_URL'];
  const serviceKey = process.env['SUPABASE_SERVICE_ROLE_KEY'];

  if (!supabaseUrl || !serviceKey) {
    console.error(
      'calibration-report: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.',
    );
    process.exit(1);
  }

  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Query: picks joined with settlement_records via pick_id
  const { data, error } = await supabase
    .from('settlement_records')
    .select('pick_id, result, settled_at, picks!inner(confidence, sport_id, promotion_version)')
    .gt('settled_at', afterArg)
    .not('result', 'is', null)
    .order('settled_at', { ascending: true });

  if (error) {
    console.error('calibration-report: DB query failed:', error.message);
    process.exit(1);
  }

  const rows = (data ?? []) as Array<{
    pick_id: string;
    result: string | null;
    settled_at: string;
    picks: { confidence: number | null; sport_id: string | null; promotion_version: string | null };
  }>;

  const warnings: string[] = [];
  let excludedPush = 0;
  let excludedNullConf = 0;
  const usable: CalibrationRow[] = [];

  for (const row of rows) {
    const result = row.result?.toLowerCase() ?? '';
    if (result === 'push' || result === 'void') {
      excludedPush++;
      continue;
    }
    if (row.picks.confidence === null) {
      excludedNullConf++;
      continue;
    }
    const normalizedResult = result.startsWith('won') || result === 'win' ? 'won' : 'lost';
    usable.push({
      pickId: row.pick_id,
      confidence: row.picks.confidence,
      result: normalizedResult,
      sportId: row.picks.sport_id,
      modelVersion: row.picks.promotion_version,
      settledAt: row.settled_at,
    });
  }

  if (usable.length < MIN_SAMPLE_SIZE) {
    warnings.push(
      `Only ${usable.length} usable rows — below minimum ${MIN_SAMPLE_SIZE} for reliable calibration.`,
    );
  }

  const overall = buildSegment('Overall', usable);

  // By sport
  const sports = [...new Set(usable.map((r) => r.sportId ?? 'unknown'))];
  const bySport = sports.map((s) =>
    buildSegment(s, usable.filter((r) => (r.sportId ?? 'unknown') === s)),
  );

  // By model version
  const versions = [...new Set(usable.map((r) => r.modelVersion ?? 'unknown'))];
  const byModelVersion = versions.map((v) =>
    buildSegment(`version:${v}`, usable.filter((r) => (r.modelVersion ?? 'unknown') === v)),
  );

  // By confidence band (low: <50, medium: 50-64, high: 65-79, very-high: 80+)
  const byConfidenceBand: CalibrationSegment[] = [
    buildSegment('<50%', usable.filter((r) => r.confidence < 50)),
    buildSegment('50–64%', usable.filter((r) => r.confidence >= 50 && r.confidence < 65)),
    buildSegment('65–79%', usable.filter((r) => r.confidence >= 65 && r.confidence < 80)),
    buildSegment('80%+', usable.filter((r) => r.confidence >= 80)),
  ].filter((s) => s.count > 0);

  const followOnRequired = !isNaN(overall.ece) && overall.ece > 0.1 && usable.length >= MIN_SAMPLE_SIZE;
  const followOnReason = followOnRequired
    ? `ECE = ${fmt(overall.ece, 4)} > 0.10 threshold on ${usable.length} picks — recalibration needed`
    : null;

  const report: CalibrationReport = {
    generatedAt: new Date().toISOString(),
    afterDate: afterArg,
    totalRows: rows.length,
    usableRows: usable.length,
    excludedPush,
    excludedNullConfidence: excludedNullConf,
    overall,
    bySport,
    byModelVersion,
    byConfidenceBand,
    warnings,
    followOnRequired,
    followOnReason,
  };

  if (jsonFlag) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  const markdown = renderReport(report);
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, markdown, 'utf8');
  console.log(`[calibration-report] Written to ${outputPath}`);

  if (report.followOnRequired) {
    console.warn(
      `[calibration-report] ⚠️  ECE > 0.10 — create a follow-on recalibration issue.`,
    );
  }

  if (report.usableRows < MIN_SAMPLE_SIZE) {
    console.warn(
      `[calibration-report] ⚠️  Only ${report.usableRows} usable rows — more data needed before tier-label decisions.`,
    );
  }
}

main().catch((err: unknown) => {
  console.error(
    '[calibration-report] Fatal:',
    err instanceof Error ? err.message : String(err),
  );
  process.exit(1);
});
