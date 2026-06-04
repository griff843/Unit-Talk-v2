import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

type Verdict = 'PASS' | 'FAIL';

type GateResult = {
  verdict: Verdict;
  proofDir: string;
  sha: string | null;
  failures: string[];
  warnings: string[];
  checkedAt: string;
};

type CliOptions = {
  proofDir: string | null;
  sha: string | null;
  rLevel: string | null;
  requiredExecutedCommands: string[];
  json: boolean;
};

const PLACEHOLDERS = ['TODO', 'TBD', 'PLACEHOLDER', 'INSERT HERE', 'your SHA here', 'FILL IN'];
const REQUIRED_SECTIONS = ['## Summary', '## Evidence', '## Verification'];
const SHA_PATTERN = /^[0-9a-fA-F]{40}$/;
const WARNING_SIZE_BYTES = 100 * 1024;

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    proofDir: null,
    sha: null,
    rLevel: null,
    requiredExecutedCommands: [],
    json: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === '--proof-dir') {
      options.proofDir = argv[index + 1] ?? null;
      index += 1;
      continue;
    }

    if (arg === '--sha') {
      options.sha = argv[index + 1] ?? null;
      index += 1;
      continue;
    }

    if (arg === '--r-level') {
      options.rLevel = argv[index + 1] ?? null;
      index += 1;
      continue;
    }

    if (arg === '--require-executed-command') {
      const command = argv[index + 1] ?? '';
      if (command.trim()) {
        options.requiredExecutedCommands.push(command.trim());
      }
      index += 1;
      continue;
    }

    if (arg === '--json') {
      options.json = true;
    }
  }

  return options;
}

function listFiles(proofDir: string): string[] {
  return readdirSync(proofDir, { withFileTypes: true })
    .filter(entry => entry.isFile())
    .map(entry => path.join(proofDir, entry.name));
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function hasCommandReference(content: string, command: string): boolean {
  return new RegExp(escapeRegExp(command), 'i').test(content);
}

function hasNodeTestExecutionEvidence(content: string): boolean {
  return (
    /(^|\n)\s*#\s+pass\s+[1-9][0-9]*\b/i.test(content) &&
    /(^|\n)\s*#\s+fail\s+0\b/i.test(content) &&
    /(^|\n)\s*#\s+skipped\s+0\b/i.test(content)
  );
}

function hasCommandExecutionEvidence(content: string, command: string): boolean {
  return hasCommandReference(content, command) && hasNodeTestExecutionEvidence(content);
}

function createResult(options: CliOptions): GateResult {
  const proofDir = options.proofDir ?? '';
  const failures: string[] = [];
  const warnings: string[] = [];

  if (!options.proofDir) {
    failures.push('Missing required argument: --proof-dir <dir>');
  }

  if (options.sha !== null && !SHA_PATTERN.test(options.sha)) {
    failures.push('Invalid --sha: expected a 40-character hex string');
  }

  if (options.rLevel !== null && !/^r[1-9][0-9]*$/i.test(options.rLevel)) {
    failures.push('Invalid --r-level: expected r1, r2, ...');
  }

  if (failures.length > 0) {
    return {
      verdict: 'FAIL',
      proofDir,
      sha: options.sha,
      failures,
      warnings,
      checkedAt: new Date().toISOString(),
    };
  }

  if (!existsSync(proofDir) || !statSync(proofDir).isDirectory()) {
    failures.push(`Proof dir does not exist: ${proofDir}`);
    return {
      verdict: 'FAIL',
      proofDir,
      sha: options.sha,
      failures,
      warnings,
      checkedAt: new Date().toISOString(),
    };
  }

  const allFiles = listFiles(proofDir);
  const markdownFiles = allFiles.filter(filePath => filePath.toLowerCase().endsWith('.md'));
  if (markdownFiles.length === 0) {
    failures.push(`Proof dir contains no markdown files: ${proofDir}`);
  }

  const fileContents = allFiles.map(filePath => ({
    filePath,
    content: readFileSync(filePath, 'utf8'),
    size: statSync(filePath).size,
  }));

  for (const file of fileContents) {
    for (const placeholder of PLACEHOLDERS) {
      if (file.content.includes(placeholder)) {
        failures.push(`Placeholder text found in ${path.basename(file.filePath)}: ${placeholder}`);
      }
    }

    if (file.filePath.toLowerCase().endsWith('.md') && file.size > WARNING_SIZE_BYTES) {
      warnings.push(`Markdown file exceeds 100KB: ${path.basename(file.filePath)}`);
    }
  }

  if (!fileContents.some(file => REQUIRED_SECTIONS.some(section => file.content.includes(section)))) {
    failures.push('No required markdown section found: expected ## Summary, ## Evidence, or ## Verification');
  }

  if (options.sha !== null && !fileContents.some(file => file.content.includes(options.sha ?? ''))) {
    // Downgraded to warning: the exact HEAD SHA cannot be embedded in the proof file
    // at commit time due to a circular dependency (SHA is only known after commit).
    // The runtime-verifier-gate uses the same advisory-only pattern. See UTV2-985.
    warnings.push(`SHA ${options.sha} not found in proof files (advisory only — circular dependency makes exact-SHA embedding impossible at commit time)`);
  }

  if (options.rLevel?.toLowerCase() === 'r2') {
    const hasDeterminism = fileContents.some(file => file.content.toLowerCase().includes('determinism'));
    if (!hasDeterminism) {
      failures.push('R-level r2 requires a determinism keyword reference');
    }
  }

  for (const command of options.requiredExecutedCommands) {
    const matchingFiles = fileContents.filter(file => hasCommandReference(file.content, command));

    if (matchingFiles.length === 0) {
      failures.push(`Required executed command not referenced in proof files: ${command}`);
      continue;
    }

    if (!matchingFiles.some(file => hasCommandExecutionEvidence(file.content, command))) {
      failures.push(
        `Required executed command lacks node:test pass evidence: ${command} (expected '# pass <n>', '# fail 0', and '# skipped 0')`,
      );
    }
  }

  return {
    verdict: failures.length > 0 ? 'FAIL' : 'PASS',
    proofDir,
    sha: options.sha,
    failures,
    warnings,
    checkedAt: new Date().toISOString(),
  };
}

function printHumanReadable(result: GateResult): void {
  console.log(`Proof auditor gate checked: ${result.proofDir}`);
  console.log(`SHA: ${result.sha ?? 'not provided'}`);

  if (result.failures.length > 0) {
    console.log('');
    console.log('Failures:');
    for (const failure of result.failures) {
      console.log(`- ${failure}`);
    }
  }

  if (result.warnings.length > 0) {
    console.log('');
    console.log('Warnings:');
    for (const warning of result.warnings) {
      console.log(`- ${warning}`);
    }
  }

  console.log('');
  console.log(`Verdict: ${result.verdict}`);
}

const options = parseArgs(process.argv.slice(2));
const result = createResult(options);

if (options.json) {
  console.log(JSON.stringify(result));
} else {
  printHumanReadable(result);
}

process.exitCode = result.verdict === 'PASS' ? 0 : 1;
