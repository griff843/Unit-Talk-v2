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
 * The complete set of functions a management statement may call.
 *
 * This is an allowlist, and it is the control that actually decides whether a
 * SELECT can write. The alternative — a denylist of dangerous functions —
 * cannot work here, because the set of write-capable functions reachable from
 * a SELECT is open-ended: `setval`, `nextval`, `set_config`,
 * `pg_advisory_lock`, `pg_terminate_backend`, `pg_replication_slot_advance`,
 * any `SECURITY DEFINER` function a future migration adds, and any extension
 * installed later. A list of the ones someone remembered is a list that a new
 * one is not on.
 *
 * Every entry below is either a pure scalar/aggregate or a stable catalog
 * read, and every one is needed by a statement this repository actually ships
 * (`storage-health.ts`). Adding an entry is a deliberate act: it must be
 * non-volatile and must not write, take a lock, reach the filesystem or reach
 * the network.
 *
 * `pg_ls_waldir` is on the list and `pg_ls_dir` is not, which looks
 * inconsistent and is not: the former reports WAL segment names and sizes — a
 * database metric the WAL pressure gauge is built on — while the latter reads
 * an arbitrary directory.
 */
const READ_ONLY_FUNCTION_ALLOWLIST: ReadonlySet<string> = new Set([
  // Scalars and aggregates.
  'coalesce',
  'nullif',
  'greatest',
  'least',
  'count',
  'sum',
  'min',
  'max',
  'avg',
  'round',
  'format',
  // Time. `now()` is stable within a transaction and writes nothing.
  'now',
  'extract',
  'date_trunc',
  // Catalog and size introspection.
  'to_regclass',
  'pg_total_relation_size',
  'pg_relation_size',
  'pg_indexes_size',
  'pg_ls_waldir',
  'current_setting',
]);

/**
 * Words that may legally be followed by `(` without being a function call.
 *
 * Without this the extractor would read `values (...)`, `in (...)` and
 * `union all (...)` as calls to functions named `values`, `in` and `all`, and
 * every shipped statement would be refused.
 *
 * `set` is deliberately **absent**, so `set_config(...)` — a write dressed as
 * a function — reaches the allowlist check and is refused there.
 */
const NON_CALL_KEYWORDS: ReadonlySet<string> = new Set([
  'select',
  'from',
  'where',
  'and',
  'or',
  'not',
  'in',
  'on',
  'using',
  'exists',
  'case',
  'when',
  'then',
  'else',
  'end',
  'over',
  'filter',
  'partition',
  'by',
  'order',
  'group',
  'having',
  'limit',
  'offset',
  'fetch',
  'only',
  'all',
  'any',
  'some',
  'distinct',
  'is',
  'between',
  'like',
  'ilike',
  'similar',
  'union',
  'except',
  'intersect',
  'values',
  'array',
  'row',
  'cast',
  'as',
  'with',
  'table',
  'explain',
  'returning',
  'lateral',
  'join',
  'natural',
  'inner',
  'left',
  'right',
  'full',
  'cross',
  'interval',
  'at',
  'time',
  'zone',
]);

/** The only schema a qualified call may name. */
const ALLOWED_FUNCTION_SCHEMA = 'pg_catalog';

type SqlToken = { kind: 'ident' | 'dot' | 'lparen' | 'rparen' | 'other'; value: string };

/**
 * Splits already-stripped SQL into just enough token kinds to tell a function
 * call from everything else. Literals and comments are gone by this point, so
 * the input is code only.
 */
function tokenize(code: string): SqlToken[] {
  const tokens: SqlToken[] = [];
  let i = 0;
  while (i < code.length) {
    const ch = code[i] as string;
    if (/\s/.test(ch)) {
      i += 1;
      continue;
    }
    if (/[A-Za-z_]/.test(ch)) {
      let j = i + 1;
      while (j < code.length && /[A-Za-z0-9_$]/.test(code[j] as string)) j += 1;
      tokens.push({ kind: 'ident', value: code.slice(i, j) });
      i = j;
      continue;
    }
    if (ch === '.') {
      tokens.push({ kind: 'dot', value: '.' });
      i += 1;
      continue;
    }
    if (ch === '(') {
      tokens.push({ kind: 'lparen', value: '(' });
      i += 1;
      continue;
    }
    if (ch === ')') {
      tokens.push({ kind: 'rparen', value: ')' });
      i += 1;
      continue;
    }
    tokens.push({ kind: 'other', value: ch });
    i += 1;
  }
  return tokens;
}

/**
 * Rejects the statement unless every function it calls is allowlisted.
 *
 * Three shapes look like calls and are not, and each is skipped deliberately
 * rather than by accident:
 *
 *  - a keyword before `(` — `values (...)`, `in (...)`, `interval` — see
 *    `NON_CALL_KEYWORDS`;
 *  - an alias column list — `... ) as t(table_name, domain)` and the
 *    `AS`-less `... ) t(a, b)`. Both are recognised by what precedes the
 *    alias, so `t(...)` in any other position is still treated as a call;
 *  - a bare parenthesised expression or subquery, where `(` follows an
 *    operator, a comma or another `(` rather than a name.
 */
function assertOnlyAllowlistedFunctionCalls(code: string, reject: (why: string) => never): void {
  const tokens = tokenize(code);

  for (let i = 0; i < tokens.length; i += 1) {
    if (tokens[i]?.kind !== 'lparen') continue;

    const name = tokens[i - 1];
    if (!name || name.kind !== 'ident') continue;

    const before = tokens[i - 2];

    // Alias column list: `) as t(...)` or `) t(...)`.
    if (before && (before.kind === 'rparen' || before.value.toLowerCase() === 'as')) continue;

    const lower = name.value.toLowerCase();
    if (NON_CALL_KEYWORDS.has(lower)) continue;

    // A qualified call: `schema.fn(...)`. Only `pg_catalog` is permitted, so a
    // call into an application schema cannot be laundered through a prefix.
    if (before?.kind === 'dot') {
      const schema = tokens[i - 3];
      const schemaName = schema?.kind === 'ident' ? schema.value.toLowerCase() : null;
      if (schemaName !== ALLOWED_FUNCTION_SCHEMA) {
        reject(
          `calls "${schemaName ?? '?'}.${lower}" — only ${ALLOWED_FUNCTION_SCHEMA}-qualified calls are allowed`,
        );
      }
    }

    if (!READ_ONLY_FUNCTION_ALLOWLIST.has(lower)) {
      reject(`calls "${lower}", which is not on the read-only function allowlist`);
    }
  }
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

  // The load-bearing control on what a SELECT may *do*. A denylist of known
  // dangerous functions is not one: `select setval('s', 1)` opens with SELECT,
  // matches no statement keyword (`setval` is not the whole word `set`), and
  // writes. So every function call is extracted and checked against an
  // allowlist, and anything not on it is refused whether or not anyone thought
  // of it in advance.
  assertOnlyAllowlistedFunctionCalls(withoutTrailing, reject);
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
