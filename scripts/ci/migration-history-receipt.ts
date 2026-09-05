/**
 * UTV2-1822 — the single definition of "this migration file executes nothing".
 *
 * Historical version receipts restore local/remote migration-history correspondence
 * without re-executing DDL the baseline snapshot already contains. Several gates need
 * to agree on which files those are, and they must agree for the same reason: a gate
 * that decided independently could exempt a file another gate still executes.
 *
 * The predicate is deliberately NOT "the filename looks like a receipt" or "the header
 * is present". It is "the header is present AND there is nothing here but comments".
 * The header alone is a claim; the second half is the fact. A file that declares itself
 * a receipt and then carries SQL is the exact thing these gates exist to catch, so it
 * must fail the predicate rather than be waved through by its own assertion.
 */
import { readFileSync } from 'node:fs';

export const RECEIPT_HEADER = '-- MIGRATION-HISTORY-RECEIPT';

/** True when the file declares itself a receipt AND contains no executable statement. */
export function isNonExecutableReceipt(migrationPath: string): boolean {
  let content: string;
  try {
    content = readFileSync(migrationPath, 'utf8');
  } catch {
    return false;
  }
  return declaresReceipt(content) && !hasExecutableContent(content);
}

export function declaresReceipt(content: string): boolean {
  return content.startsWith(RECEIPT_HEADER);
}

/** Any line that is not blank and not a `--` comment counts as executable content. */
export function hasExecutableContent(content: string): boolean {
  return content
    .split('\n')
    .some((line) => line.trim() !== '' && !line.trimStart().startsWith('--'));
}
