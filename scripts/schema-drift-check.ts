import { checkSchemaDrift } from '../apps/api/src/model-health-scanner.js';

async function main(): Promise<void> {
  const result = await checkSchemaDrift();

  console.log(JSON.stringify(result, null, 2));

  if (result.status !== 'healthy') {
    console.error(`Schema drift detected. ${result.remediation}`);
    process.exitCode = 1;
  }
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
