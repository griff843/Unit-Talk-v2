import { BlockError } from './result.js';
import type { ParsedArgs } from '../types.js';

export function parseArgs(argv: string[], allowedFlags: string[]): ParsedArgs {
  const allowed = new Set(allowedFlags);
  const flags: Record<string, string> = {};
  const bools = new Set<string>();
  const positionals: string[] = [];

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith('--')) {
      positionals.push(arg);
      continue;
    }

    const flag = arg.slice(2);
    if (!allowed.has(flag)) {
      throw new BlockError(`unknown flag --${flag}`);
    }
    const next = argv[index + 1];
    if (next !== undefined && !next.startsWith('--')) {
      flags[flag] = next;
      index += 1;
    } else {
      bools.add(flag);
    }
  }

  return { positionals, flags, bools };
}
