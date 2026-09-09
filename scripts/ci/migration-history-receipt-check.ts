/**
 * UTV2-1822 — CLI wrapper around isNonExecutableReceipt, for shell-based gates.
 *
 * Exit 0  → the file is a verified non-executable historical version receipt.
 * Exit 1  → it is not, and must be held to the ordinary migration requirements.
 *
 * Shell gates need the same answer the TypeScript gates get, from the same code.
 * Re-implementing the predicate in bash is how the two would drift apart, and a
 * drift in this direction means a file one gate treats as inert gets executed by
 * another.
 */
import { isNonExecutableReceipt } from './migration-history-receipt.ts';

const target = process.argv[2];
if (!target) {
  console.error('usage: migration-history-receipt-check.ts <migration-path>');
  process.exit(2);
}
process.exit(isNonExecutableReceipt(target) ? 0 : 1);
