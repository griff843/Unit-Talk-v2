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
  maxAgeHours: number;
  json: boolean;
};

const PLACEHOLDERS = ['TODO', 'TBD', '_TBD', 'PLACEHOLDER', 'INSERT HERE', 'FILL IN', '<fill-in>'];
const REQUIRED_SECTION_PATTERNS = [/^##\s+Pre-merge/m, /^##\s+Runtime\s+Verif/im, /^##\s+Verif/im];
const SHA_PATTERN = /^[0-9a-fA-F]{40}$/;
const DEFAULT_MAX_AGE_HOURS = 48;

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    proofDir: null,
    sha: null,
    maxAgeHours: DEFAULT_MAX_AGE_HOURS,
    json: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--proof-dir') {
      options.proofDir = argv[i + 1] ?? null;
      i++;
    } else if (arg === '--sha') {
      options.sha = argv[i + 1] ?? null;
      i++;
    } else if (arg === '--max-age-hours') {
      const val = Number(argv[i + 1]);
      if (!Number.isNaN(val) && val > 0) options.maxAgeHours = val;
      i++;
    } else if (arg === '--json') {
      options.json = true;
    }
  }

  return options;
}

function findRuntimeVerificationFiles(proofDir: string): string[] {
  return readdirSync(proofDir, { withFileTypes: true })
    .filter(e => e.isFile() && e.name.toLowerCase().endsWith('.md'))
    .filter(e => {
      const n = e.name.toLowerCase();
      return n.includes('runtime') || n.includes('verification') || n.includes('verify');
    })
    .map(e => path.join(proofDir, e.name));
}

function hasRequiredSection(content: string): boolean {
  return REQUIRED_SECTION_PATTERNS.some(pattern => pattern.test(content));
}

function isStale(filePath: string, maxAgeHours: number): boolean {
  const stat = statSync(filePath);
  const ageMs = Date.now() - stat.mtimeMs;
  return ageMs > maxAgeHours * 60 * 60 * 1000;
}

function createResult(options: CliOptions): GateResult {
  const proofDir = options.proofDir ?? '';
  const failures: string[] = [];
  const warnings: string[] = [];

  if (!options.proofDir) {
    failures.push('Missing required argument: --proof-dir <dir>');
    return { verdict: 'FAIL', proofDir, sha: options.sha, failures, warnings, checkedAt: new Date().toISOString() };
  }

  if (options.sha !== null && !SHA_PATTERN.test(options.sha)) {
    failures.push('Invalid --sha: expected a 40-character hex string');
    return { verdict: 'FAIL', proofDir, sha: options.sha, failures, warnings, checkedAt: new Date().toISOString() };
  }

  if (!existsSync(proofDir) || !statSync(proofDir).isDirectory()) {
    failures.push(`Proof dir does not exist: ${proofDir}`);
    return { verdict: 'FAIL', proofDir, sha: options.sha, failures, warnings, checkedAt: new Date().toISOString() };
  }

  const rvFiles = findRuntimeVerificationFiles(proofDir);

  if (rvFiles.length === 0) {
    const allMd = readdirSync(proofDir, { withFileTypes: true })
      .filter(e => e.isFile() && e.name.toLowerCase().endsWith('.md'));
    if (allMd.length === 0) {
      failures.push(`No markdown files found in proof dir: ${proofDir}`);
    } else {
      failures.push(
        `No runtime-verification file found. Expected a file with "runtime", "verification", or "verify" in name. Found: ${allMd.map(e => e.name).join(', ')}`,
      );
    }
    return { verdict: 'FAIL', proofDir, sha: options.sha, failures, warnings, checkedAt: new Date().toISOString() };
  }

  for (const filePath of rvFiles) {
    const content = readFileSync(filePath, 'utf8');
    const name = path.basename(filePath);

    for (const placeholder of PLACEHOLDERS) {
      if (content.includes(placeholder)) {
        failures.push(`Placeholder text "${placeholder}" found in ${name}`);
      }
    }

    if (!hasRequiredSection(content)) {
      failures.push(`${name} missing required verification section (expected ## Pre-merge, ## Runtime Verification, or ## Verification)`);
    }

    if (options.sha !== null && !content.includes(options.sha)) {
      failures.push(`SHA ${options.sha} not found in ${name} — proof may not be bound to this commit`);
    }

    if (isStale(filePath, options.maxAgeHours)) {
      warnings.push(`${name} was last modified more than ${options.maxAgeHours}h ago — consider refreshing`);
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
  console.log(`Runtime verifier gate: ${result.proofDir}`);
  console.log(`SHA: ${result.sha ?? 'not provided'}`);

  if (result.failures.length > 0) {
    console.log('\nFailures:');
    for (const f of result.failures) console.log(`  - ${f}`);
  }

  if (result.warnings.length > 0) {
    console.log('\nWarnings:');
    for (const w of result.warnings) console.log(`  - ${w}`);
  }

  console.log(`\nVerdict: ${result.verdict}`);
}

const options = parseArgs(process.argv.slice(2));
const result = createResult(options);

if (options.json) {
  console.log(JSON.stringify(result));
} else {
  printHumanReadable(result);
}

process.exitCode = result.verdict === 'PASS' ? 0 : 1;
