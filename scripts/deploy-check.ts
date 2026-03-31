import { execSync } from 'node:child_process';

interface CheckResult {
  name: string;
  passed: boolean;
  detail?: string;
}

const results: CheckResult[] = [];

// Step 1: Run pnpm verify
console.log('--- Running pnpm verify ---');
try {
  execSync('pnpm verify', { stdio: 'inherit', timeout: 600_000 });
  results.push({ name: 'pnpm verify', passed: true });
} catch {
  results.push({ name: 'pnpm verify', passed: false, detail: 'pnpm verify failed' });
}

// Step 2: Check required env vars
const REQUIRED_ENV_VARS = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'] as const;

for (const varName of REQUIRED_ENV_VARS) {
  const value = process.env[varName]?.trim();
  if (value && value.length > 0) {
    results.push({ name: `env ${varName}`, passed: true });
  } else {
    results.push({ name: `env ${varName}`, passed: false, detail: `${varName} is not set or empty` });
  }
}

// Summary
console.log('\n--- Deploy Check Summary ---');
let allPassed = true;
for (const r of results) {
  const status = r.passed ? 'PASS' : 'FAIL';
  const detail = r.detail ? ` (${r.detail})` : '';
  console.log(`  [${status}] ${r.name}${detail}`);
  if (!r.passed) allPassed = false;
}

if (allPassed) {
  console.log('\nAll checks passed. Ready to deploy.');
  process.exit(0);
} else {
  console.log('\nSome checks failed. Not ready to deploy.');
  process.exit(1);
}
