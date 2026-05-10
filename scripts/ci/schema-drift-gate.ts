#!/usr/bin/env tsx

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  type CliArgs as DbInspectCliArgs,
  runInspectionCommand,
} from '../db-inspect/lib.js';

type DriftDirection = 'missing_in_actual' | 'missing_in_expected' | 'changed';
type DriftCollection =
  | 'relations'
  | 'columns'
  | 'constraints'
  | 'indexes'
  | 'policies'
  | 'triggers'
  | 'extensions';

interface DriftEntry {
  key: string;
  expected: unknown | null;
  actual: unknown | null;
}

interface CollectionDiff {
  missing_in_actual: DriftEntry[];
  missing_in_expected: DriftEntry[];
  changed: DriftEntry[];
}

interface CompareReport {
  generated_at: string;
  expected_label: string;
  actual_label: string;
  compared_schema: string;
  drift_detected: boolean;
  drift_count: number;
  diff: Record<DriftCollection, CollectionDiff>;
}

interface ParsedArgs {
  reportPath: string;
  artifactDir: string;
  expectedDbUrl: string | null;
  actualDbUrl: string | null;
  schema: string;
  inspectLimit: number;
  allowedDriftKeys: Set<string>;
  allowedExtensions: Set<string>;
}

interface DriftFinding {
  collection: DriftCollection;
  direction: DriftDirection;
  key: string;
  expected: unknown | null;
  actual: unknown | null;
  allowed: boolean;
  reason: string;
}

interface DriftDiagnosticsPaths {
  expectedDiagnostics: string | null;
  expectedSchema: string | null;
  actualDiagnostics: string | null;
  actualSchema: string | null;
  actualTables: string[];
}

interface DriftGateResult {
  schema_version: 1;
  run_at: string;
  report_path: string;
  artifact_dir: string;
  compared_schema: string;
  expected_label: string;
  actual_label: string;
  verdict: 'PASS' | 'FAIL' | 'INFRA';
  exit_code: 0 | 1 | 3;
  drift_detected: boolean;
  total_findings: number;
  unauthorized_count: number;
  allowed_count: number;
  allowed_findings: DriftFinding[];
  unauthorized_findings: DriftFinding[];
  diagnostics: DriftDiagnosticsPaths;
}

const MAX_TABLE_DIAGNOSTICS = 5;

function parseArgs(argv: string[]): ParsedArgs {
  let reportPath = '';
  let artifactDir = '';
  let expectedDbUrl: string | null = null;
  let actualDbUrl: string | null = null;
  let schema = 'public';
  let inspectLimit = 200;
  const allowedDriftKeys = new Set<string>();
  const allowedExtensions = new Set<string>();

  for (let index = 2; index < argv.length; index += 1) {
    const token = argv[index];
    const next = argv[index + 1];

    if (token === '--report' && next) {
      reportPath = path.resolve(next);
      index += 1;
      continue;
    }
    if (token === '--artifact-dir' && next) {
      artifactDir = path.resolve(next);
      index += 1;
      continue;
    }
    if (token === '--expected-db-url' && next) {
      expectedDbUrl = next;
      index += 1;
      continue;
    }
    if (token === '--actual-db-url' && next) {
      actualDbUrl = next;
      index += 1;
      continue;
    }
    if (token === '--schema' && next) {
      schema = next;
      index += 1;
      continue;
    }
    if (token === '--inspect-limit' && next) {
      inspectLimit = Number.parseInt(next, 10);
      index += 1;
      continue;
    }
    if (token === '--allow-drift' && next) {
      allowedDriftKeys.add(next);
      index += 1;
      continue;
    }
    if (token === '--allow-extension' && next) {
      allowedExtensions.add(next);
      index += 1;
      continue;
    }

    throw new Error(`Unknown argument: ${token}`);
  }

  if (!reportPath) {
    throw new Error('Missing required --report <path> argument.');
  }
  if (!Number.isFinite(inspectLimit) || inspectLimit <= 0) {
    throw new Error(`Invalid --inspect-limit value: ${inspectLimit}`);
  }

  return {
    reportPath,
    artifactDir: artifactDir || path.dirname(reportPath),
    expectedDbUrl,
    actualDbUrl,
    schema,
    inspectLimit,
    allowedDriftKeys,
    allowedExtensions,
  };
}

function readCompareReport(reportPath: string): CompareReport {
  if (!fs.existsSync(reportPath)) {
    throw new Error(`Compare report not found: ${reportPath}`);
  }

  return JSON.parse(fs.readFileSync(reportPath, 'utf8')) as CompareReport;
}

export function flattenFindings(report: CompareReport): DriftFinding[] {
  const findings: DriftFinding[] = [];
  const directions: DriftDirection[] = ['missing_in_actual', 'missing_in_expected', 'changed'];

  for (const collection of Object.keys(report.diff) as DriftCollection[]) {
    for (const direction of directions) {
      for (const entry of report.diff[collection][direction]) {
        findings.push({
          collection,
          direction,
          key: entry.key,
          expected: entry.expected,
          actual: entry.actual,
          allowed: false,
          reason: 'deny_by_default',
        });
      }
    }
  }

  return findings;
}

export function classifyFindings(
  findings: DriftFinding[],
  allowConfig: {
    allowedDriftKeys?: Set<string>;
    allowedExtensions?: Set<string>;
  } = {},
): DriftFinding[] {
  const allowedDriftKeys = allowConfig.allowedDriftKeys ?? new Set<string>();
  const allowedExtensions = allowConfig.allowedExtensions ?? new Set<string>();

  return findings.map((finding) => {
    const scopedKey = `${finding.collection}:${finding.key}`;

    if (allowedDriftKeys.has(scopedKey)) {
      return { ...finding, allowed: true, reason: 'explicit_drift_allowlist' };
    }

    if (finding.collection === 'extensions' && allowedExtensions.has(finding.key)) {
      return { ...finding, allowed: true, reason: 'allowed_extension' };
    }

    return finding;
  });
}

export function extractAffectedTables(findings: DriftFinding[], schema = 'public'): string[] {
  const tables = new Set<string>();

  for (const finding of findings) {
    if (finding.collection === 'extensions') {
      continue;
    }

    const parts = finding.key.split('.');
    if (parts[0] !== schema) {
      continue;
    }

    if (finding.collection === 'relations' && parts[1]) {
      tables.add(parts[1]);
      continue;
    }

    if (parts[1]) {
      tables.add(parts[1]);
    }
  }

  return [...tables].sort((left, right) => left.localeCompare(right)).slice(0, MAX_TABLE_DIAGNOSTICS);
}

function writeJson(filePath: string, value: unknown): string {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  return filePath;
}

async function inspectAndWrite(
  connectionString: string,
  args: DbInspectCliArgs,
  outputPath: string,
): Promise<string> {
  const result = await runInspectionCommand(connectionString, args);
  return writeJson(outputPath, result);
}

async function collectDiagnostics(
  args: ParsedArgs,
  report: CompareReport,
  unauthorizedFindings: DriftFinding[],
): Promise<DriftDiagnosticsPaths> {
  const diagnostics: DriftDiagnosticsPaths = {
    expectedDiagnostics: null,
    expectedSchema: null,
    actualDiagnostics: null,
    actualSchema: null,
    actualTables: [],
  };

  if (!args.expectedDbUrl || !args.actualDbUrl) {
    return diagnostics;
  }
  if (unauthorizedFindings.length === 0) {
    return diagnostics;
  }

  const expectedBasePath = path.join(args.artifactDir, 'expected-diagnostics.json');
  const expectedSchemaPath = path.join(args.artifactDir, 'expected-schema.json');
  const actualBasePath = path.join(args.artifactDir, 'actual-diagnostics.json');
  const actualSchemaPath = path.join(args.artifactDir, 'actual-schema.json');

  try {
    diagnostics.expectedDiagnostics = await inspectAndWrite(
      args.expectedDbUrl,
      {
        command: 'diagnostics',
        connectionString: args.expectedDbUrl,
        format: 'json',
        help: false,
        limit: args.inspectLimit,
        schema: report.compared_schema,
        table: undefined,
      },
      expectedBasePath,
    );
    diagnostics.expectedSchema = await inspectAndWrite(
      args.expectedDbUrl,
      {
        command: 'schema',
        connectionString: args.expectedDbUrl,
        format: 'json',
        help: false,
        limit: args.inspectLimit,
        schema: report.compared_schema,
        table: undefined,
      },
      expectedSchemaPath,
    );
    diagnostics.actualDiagnostics = await inspectAndWrite(
      args.actualDbUrl,
      {
        command: 'diagnostics',
        connectionString: args.actualDbUrl,
        format: 'json',
        help: false,
        limit: args.inspectLimit,
        schema: report.compared_schema,
        table: undefined,
      },
      actualBasePath,
    );
    diagnostics.actualSchema = await inspectAndWrite(
      args.actualDbUrl,
      {
        command: 'schema',
        connectionString: args.actualDbUrl,
        format: 'json',
        help: false,
        limit: args.inspectLimit,
        schema: report.compared_schema,
        table: undefined,
      },
      actualSchemaPath,
    );

    const affectedTables = extractAffectedTables(unauthorizedFindings, args.schema);
    for (const table of affectedTables) {
      const targetPath = path.join(args.artifactDir, `actual-table-${table}.json`);
      await inspectAndWrite(
        args.actualDbUrl,
        {
          command: 'table',
          connectionString: args.actualDbUrl,
          format: 'json',
          help: false,
          limit: args.inspectLimit,
          schema: report.compared_schema,
          table,
        },
        targetPath,
      );
      diagnostics.actualTables.push(targetPath);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    writeJson(path.join(args.artifactDir, 'schema-drift-gate-diagnostics-error.json'), {
      generated_at: new Date().toISOString(),
      message,
    });
    console.warn(`[schema-drift-gate] diagnostics capture failed: ${message}`);
  }

  return diagnostics;
}

export function buildGateResult(
  report: CompareReport,
  findings: DriftFinding[],
  diagnostics: DriftDiagnosticsPaths,
  args: Pick<ParsedArgs, 'reportPath' | 'artifactDir'>,
): DriftGateResult {
  const allowedFindings = findings.filter((finding) => finding.allowed);
  const unauthorizedFindings = findings.filter((finding) => !finding.allowed);
  const verdict: DriftGateResult['verdict'] = unauthorizedFindings.length > 0 ? 'FAIL' : 'PASS';

  return {
    schema_version: 1,
    run_at: new Date().toISOString(),
    report_path: args.reportPath,
    artifact_dir: args.artifactDir,
    compared_schema: report.compared_schema,
    expected_label: report.expected_label,
    actual_label: report.actual_label,
    verdict,
    exit_code: verdict === 'PASS' ? 0 : 1,
    drift_detected: report.drift_detected,
    total_findings: findings.length,
    unauthorized_count: unauthorizedFindings.length,
    allowed_count: allowedFindings.length,
    allowed_findings: allowedFindings,
    unauthorized_findings: unauthorizedFindings,
    diagnostics,
  };
}

function printSummary(result: DriftGateResult): void {
  console.log('\nSchema drift gate');
  console.log('='.repeat(17));
  console.log(`Verdict:    ${result.verdict}`);
  console.log(`Schema:     ${result.compared_schema}`);
  console.log(`Expected:   ${result.expected_label}`);
  console.log(`Actual:     ${result.actual_label}`);
  console.log(`Findings:   ${result.total_findings}`);
  console.log(`Allowed:    ${result.allowed_count}`);
  console.log(`Unauthorized: ${result.unauthorized_count}`);

  if (result.unauthorized_findings.length > 0) {
    console.log('\nUnauthorized drift');
    for (const finding of result.unauthorized_findings) {
      console.log(`- ${finding.collection} ${finding.direction} ${finding.key}`);
    }
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv);
  const report = readCompareReport(args.reportPath);
  const findings = classifyFindings(flattenFindings(report), {
    allowedDriftKeys: args.allowedDriftKeys,
    allowedExtensions: args.allowedExtensions,
  });
  const unauthorizedFindings = findings.filter((finding) => !finding.allowed);
  const diagnostics = await collectDiagnostics(args, report, unauthorizedFindings);
  const result = buildGateResult(report, findings, diagnostics, args);
  const resultPath = writeJson(path.join(args.artifactDir, 'schema-drift-gate-result.json'), result);

  printSummary(result);
  console.log(`Result:     ${path.relative(process.cwd(), resultPath)}`);

  process.exitCode = result.exit_code;
}

const entrypointPath = process.argv[1] ? path.resolve(process.argv[1]) : null;
const isEntrypoint =
  entrypointPath !== null && fileURLToPath(import.meta.url) === entrypointPath;

if (isEntrypoint) {
  main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    const artifactDir = (() => {
      try {
        return parseArgs(process.argv).artifactDir;
      } catch {
        return path.join(process.cwd(), 'artifacts', 'schema-parity');
      }
    })();
    const result: DriftGateResult = {
      schema_version: 1,
      run_at: new Date().toISOString(),
      report_path: '',
      artifact_dir: artifactDir,
      compared_schema: 'unknown',
      expected_label: 'unknown',
      actual_label: 'unknown',
      verdict: 'INFRA',
      exit_code: 3,
      drift_detected: false,
      total_findings: 0,
      unauthorized_count: 0,
      allowed_count: 0,
      allowed_findings: [],
      unauthorized_findings: [],
      diagnostics: {
        expectedDiagnostics: null,
        expectedSchema: null,
        actualDiagnostics: null,
        actualSchema: null,
        actualTables: [],
      },
    };
    writeJson(path.join(artifactDir, 'schema-drift-gate-result.json'), {
      ...result,
      error: message,
    });
    console.error(`[schema-drift-gate] ${message}`);
    process.exit(3);
  });
}
