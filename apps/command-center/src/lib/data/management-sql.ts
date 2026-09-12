/**
 * Read-only policy for SQL sent over the Supabase **Management** API.
 *
 * The Command Center is a web server that holds an account-scoped Supabase
 * personal access token. That token is not the service-role key: it can run
 * arbitrary SQL against the project, including DDL, and it is not constrained
 * by RLS. `storage-health.ts` needs it because disk, WAL and backup facts are
 * only available through the management plane.
 *
 * Nothing in the app has ever sent user input to that endpoint — every
 * statement is a literal in the source. The risk is not injection today, it is
 * the *shape* of the capability: a helper that takes a `string` invites a
 * future caller to build one, and the blast radius of getting that wrong once
 * is the production database. So the capability is narrowed here, structurally,
 * rather than left to reviewer vigilance:
 *
 *   - Callers cannot pass SQL at all. They pass a key into a frozen registry
 *     declared at module load (see `defineReadOnlyQueries`).
 *   - Every registry entry is parsed at definition time and must be a single
 *     read-only statement. A mutating statement throws while the module is
 *     being imported, so it fails at build/boot, not at request time.
 *
 * This is a client-side control and it is the load-bearing one, because it is
 * the one this repository can prove. Callers should *also* ask the server to
 * enforce read-only, but a request flag is only as good as the remote's
 * handling of it and this codebase has no way to verify that.
 */

export class SqlPolicyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SqlPolicyError';
  }
}

/**
 * Statements that change data, schema, or permissions.
 *
 * Matched as whole words, so `updated_at` and `inserted_at` — both of which
 * appear in real column names here — are not mistaken for `update`/`insert`.
 */
const FORBIDDEN_KEYWORDS = [
  'insert',
  'update',
  'delete',
  'merge',
  'upsert',
  'truncate',
  'drop',
  'alter',
  'create',
  'replace',
  'grant',
  'revoke',
  'comment',
  'copy',
  'call',
  'do',
  'vacuum',
  'analyze',
  'reindex',
  'cluster',
  'refresh',
  'lock',
  'set',
  'reset',
  'begin',
  'commit',
  'rollback',
  'savepoint',
  'listen',
  'notify',
  'prepare',
  'execute',
  'deallocate',
  'discard',
  'security',
] as const;

/**
 * Strips comments and string/identifier literals before the statement is
 * inspected.
 *
 * Without this, a keyword inside a quoted literal would trip the check, and —
 * far worse in the other direction — `--` or a dollar-quoted body could hide
 * one from it.
 */
function stripNonCode(sql: string): string {
  let out = '';
  let i = 0;

  while (i < sql.length) {
    const rest = sql.slice(i);

    // Line comment.
    if (rest.startsWith('--')) {
      const end = sql.indexOf('\n', i);
      i = end === -1 ? sql.length : end;
      continue;
    }

    // Block comment (Postgres nests them).
    if (rest.startsWith('/*')) {
      let depth = 1;
      i += 2;
      while (i < sql.length && depth > 0) {
        if (sql.startsWith('/*', i)) {
          depth += 1;
          i += 2;
        } else if (sql.startsWith('*/', i)) {
          depth -= 1;
          i += 2;
        } else {
          i += 1;
        }
      }
      continue;
    }

    // Dollar-quoted body: $tag$ ... $tag$. This is how a function body would
    // smuggle a mutation past a naive scan, so it is removed wholesale.
    const dollar = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/.exec(rest);
    if (dollar) {
      const tag = dollar[0];
      const end = sql.indexOf(tag, i + tag.length);
      if (end === -1) {
        throw new SqlPolicyError('unterminated dollar-quoted string');
      }
      out += ' ';
      i = end + tag.length;
      continue;
    }

    // Single-quoted literal or double-quoted identifier ('' / "" escape).
    if (rest.startsWith("'") || rest.startsWith('"')) {
      const quote = rest[0] as string;
      i += 1;
      let closed = false;
      while (i < sql.length) {
        if (sql[i] === quote) {
          if (sql[i + 1] === quote) {
            i += 2;
            continue;
          }
          i += 1;
          closed = true;
          break;
        }
        i += 1;
      }
      if (!closed) {
        throw new SqlPolicyError('unterminated quoted string');
      }
      out += ' ';
      continue;
    }

    out += sql[i];
    i += 1;
  }

  return out;
}

/**
 * Throws unless `sql` is a single read-only statement.
 *
 * Fails closed: anything this function cannot confidently classify as a
 * read is rejected, including an empty statement, several statements, or a
 * leading keyword it does not recognise.
 */
export function assertSingleReadOnlyStatement(name: string, sql: string): void {
  const code = stripNonCode(sql).trim();
  const reject = (why: string): never => {
    throw new SqlPolicyError(`management query "${name}" is not read-only: ${why}`);
  };

  if (!code) {
    reject('statement is empty');
  }

  // One statement only. A trailing semicolon is the conventional terminator and
  // is allowed; a semicolon with anything after it is a second statement, which
  // is how a read would be turned into a read plus a write.
  const withoutTrailing = code.replace(/;\s*$/, '');
  if (withoutTrailing.includes(';')) {
    reject('contains more than one statement');
  }

  if (!/^(select|with|table|values|explain)\b/i.test(withoutTrailing)) {
    reject(`must begin with SELECT, WITH, TABLE, VALUES or EXPLAIN`);
  }

  // `WITH ... AS ( ... )` accepts data-modifying CTEs, and `SELECT ... INTO`
  // creates a table, so a valid opening keyword is not on its own sufficient.
  for (const keyword of FORBIDDEN_KEYWORDS) {
    if (new RegExp(`\\b${keyword}\\b`, 'i').test(withoutTrailing)) {
      reject(`contains "${keyword.toUpperCase()}"`);
    }
  }

  if (/\bselect\b[\s\S]*\binto\b/i.test(withoutTrailing)) {
    reject('contains SELECT ... INTO');
  }

  // `pg_read_file`, `lo_import`/`lo_export` and `dblink` reach outside the
  // database from inside a SELECT. `pg_ls_waldir` is deliberately absent: it
  // reports WAL segment names and sizes, which is a database metric, not a
  // filesystem read, and the WAL pressure gauge is built on it.
  if (/\b(pg_read_file|pg_read_binary_file|pg_ls_dir|lo_import|lo_export|dblink|pg_sleep)\s*\(/i.test(withoutTrailing)) {
    reject('calls a filesystem, network or sleep function');
  }
}

/**
 * Declares the complete set of statements a module may send, validating each
 * one as it is declared.
 *
 * The returned object is frozen and its keys are the only thing a caller can
 * name, so the set of statements the process can ever issue is fixed at import
 * time and visible in one place.
 */
export function defineReadOnlyQueries<K extends string>(
  entries: Record<K, string>,
): Readonly<Record<K, string>> {
  for (const [name, sql] of Object.entries(entries) as Array<[K, string]>) {
    assertSingleReadOnlyStatement(name, sql);
  }
  return Object.freeze({ ...entries });
}
