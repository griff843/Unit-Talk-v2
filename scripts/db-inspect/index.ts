#!/usr/bin/env tsx

import {
  formatResult,
  parseCliArgs,
  printHelp,
  resolveConnectionString,
  runInspectionCommand,
} from './lib.js';

async function main(): Promise<void> {
  const args = parseCliArgs(process.argv.slice(2));

  if (args.help) {
    printHelp();
    return;
  }

  const connectionString = resolveConnectionString(args.connectionString);
  const result = await runInspectionCommand(connectionString, args);
  console.log(formatResult(result, args.format));
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[db-inspect] ${message}`);
  process.exit(1);
});
