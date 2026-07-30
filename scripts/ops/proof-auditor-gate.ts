import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
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
    // UTV2-1630: a writable DB claim can NEVER be satisfied by text in a proof
    // file. TAP pasted into markdown proves a test ran somewhere, against some
    // database — it cannot show WHICH. A production run and an isolated run
    // produce identical text; a hand-typed TAP block plus a fabricated project
    // ref previously returned verdict=PASS here.
    //
    // The only acceptable evidence is the CI-produced ci-db-proof-receipt/v2,
    // verified in the required `verify` context by
    // scripts/ci/verify-db-proof-receipt.ts against its own GITHUB_* values.
    if (requiresCiProducedReceipt(command)) {
      failures.push(
        `Writable DB execution cannot be proven by proof-file text: ${command}. ` +
          'It requires the CI-produced ci-db-proof-receipt/v2 artifact, verified in ' +
          'the required `verify` context. Pasted or hand-authored TAP is never sufficient.',
      );
      continue;
    }

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

// UTV2-1630: run the CLI only when this module IS the entrypoint.
//
// Previously the block below executed at module-evaluation time, so merely
// importing this file ran the gate with no arguments, printed
// "Missing required argument: --proof-dir" and set a failing exit code. That
// made the module untestable and unreusable — importing `requiresIsolatedTarget
// Attestation` from a test aborted the whole test file.
function isCliEntrypoint(): boolean {
  // Compare resolved real paths rather than matching on filename. An
  // endsWith('/proof-auditor-gate.ts') test is defeated by any rename, copy,
  // symlink, or compiled .js invocation — and it fails OPEN: the CLI simply
  // does not run, producing no output and exit 0, which reads as a silent PASS.
  const invoked = process.argv[1];
  if (!invoked) return false;
  try {
    return realpathSync(invoked) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isCliEntrypoint()) {
  const options = parseArgs(process.argv.slice(2));
  const result = createResult(options);

  if (options.json) {
    console.log(JSON.stringify(result));
  } else {
    printHumanReadable(result);
  }

  process.exitCode = result.verdict === 'PASS' ? 0 : 1;
}


/**
 * Commands whose execution can only be proven by a CI-produced receipt.
 *
 * These touch a writable database, so "a test ran and printed TAP" says nothing
 * about which project it ran against — the exact gap that let a production run
 * satisfy the T1 proof gate as well as an isolated one.
 */
export function requiresCiProducedReceipt(command: string): boolean {
  return /\b(test:db|test:live-db|test:t1-proof:live|ci:db-smoke)\b/u.test(command);
}
