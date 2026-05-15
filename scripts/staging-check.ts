import { pathToFileURL } from 'node:url';
import { collectStagingParityChecks } from './deploy-check.js';

function printSummary(results: { name: string; passed: boolean; detail?: string }[]): boolean {
  console.log('\n--- Staging Parity Check Summary ---');
  let allPassed = true;
  for (const result of results) {
    const status = result.passed ? 'PASS' : 'FAIL';
    const detail = result.detail ? ` (${result.detail})` : '';
    console.log(`  [${status}] ${result.name}${detail}`);
    if (!result.passed) allPassed = false;
  }
  return allPassed;
}

async function main() {
  const results = collectStagingParityChecks();
  const allPassed = printSummary(results);

  if (allPassed) {
    console.log('\nStaging parity checks passed. Ready to deploy.');
    process.exit(0);
  }

  console.log('\nStaging parity checks failed. Not ready to deploy.');
  process.exit(1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main();
}
