'use strict';

// WORK-2026110804: pure policy logic for the Standard / Protected operating
// model (docs/05_operations/OPERATING_MODEL_SONNET5.md §8, LEAN_MODE_ACTIVATION.md).
//
// Same pattern as merge-gate-verdict.cjs: a github-script `script:` block is a
// YAML string, not a unit-testable function, so every decision worth asserting
// lives in this plain CommonJS module that the workflows require() at runtime
// from the TRUSTED base checkout. The pure functions perform no I/O; the
// loaders at the bottom take an injected `github` client.
//
// Landing: this module lands FIRST, inert, with no workflow referencing it
// (UTV2-1554 precedent). Workflows are wired in a separate later change and
// require it lazily, so a base commit without it means "legacy", never a crash.
//
// Safety posture (all enforced by operating-model.test.ts):
//   - Default is LEGACY. Lean applies only while OPERATING_MODEL=lean AND
//     LEAN_MODE_ACTIVATED_AT is a strict ISO-8601 timestamp that is not in the
//     future (two keys). Mode is global and evaluated on every check RUN:
//     setting OPERATING_MODEL to anything else makes the NEXT run of each
//     check legacy. It does NOT invalidate a Merge Gate run that already
//     concluded green under lean - that success stays on the PR head until the
//     check reruns. Rollback therefore requires rerunning Merge Gate on every
//     open lean PR (one-command procedure in LEAN_MODE_ACTIVATION.md).
//   - Classification is an ALLOW-LIST. A file is Standard only if it matches a
//     named Standard rule and passes that rule's content checks. Everything
//     else - unknown paths, generated files, snapshots, governance docs, agent
//     instructions, nested app code - is Protected. Fail-closed by construction.
//   - Escalation only goes up. A trusted reviewer's RISK-CLASS: PROTECTED line
//     anywhere on the PR is sticky.
//   - Independent Review passes only on the trusted connector's anchored
//     codex-review-state:v1 summary, from a Bot account, bound to the exact
//     head, status completed, has_any_findings=false. A bare review object
//     never passes. Any P0/P1 finding raised at the head blocks that head for
//     good (a new commit plus a fresh clean summary is required); resolving a
//     thread, deleting a comment or editing a bot comment never clears one.

const TRUSTED_REVIEWER_LOGINS_DEFAULT = Object.freeze(['chatgpt-codex-connector[bot]']);
const AUTHORIZED_REVIEWERS_DEFAULT = Object.freeze(['griff843']);
const OPERATING_MODULE_PATH = 'scripts/ops/operating-model.cjs';

// ── Operating mode ─────────────────────────────────────────────────────────

// Strict ISO-8601: a calendar date, optionally with a time and an explicit
// zone. Anything Date.parse would accept loosely ("1", "Dec 1") is rejected.
const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:\d{2}))?$/u;

function parseActivation(value, now) {
  if (typeof value !== 'string' || !ISO_TIMESTAMP.test(value.trim())) return null;
  const ms = Date.parse(value.trim());
  if (!Number.isFinite(ms)) return null;
  if (ms > now) return null; // a future activation is not armed
  return ms;
}

/**
 * Decide whether PRs are evaluated under the lean model or the legacy model.
 *
 * Global, not per PR: after rollback (OPERATING_MODEL != lean) every LATER
 * check run - including on PRs opened while lean was active - uses the legacy
 * gate, which lean PRs cannot satisfy without legacy artifacts. Check runs that
 * already concluded are not re-evaluated by this function; Merge Gate must be
 * rerun on open lean PRs (see LEAN_MODE_ACTIVATION.md, Rollback). Anything
 * malformed, or an activation time in the future, resolves to legacy.
 */
function resolveOperatingMode({ flag, activatedAt, now } = {}) {
  const normalizedFlag = typeof flag === 'string' ? flag.trim().toLowerCase() : '';
  if (normalizedFlag !== 'lean') {
    return { mode: 'legacy', reason: 'OPERATING_MODEL is not "lean"; legacy controls apply to every PR.' };
  }
  const nowMs = Number.isFinite(now) ? now : Date.now();
  if (parseActivation(activatedAt, nowMs) === null) {
    return { mode: 'legacy', reason: 'LEAN_MODE_ACTIVATED_AT is unset, not a strict ISO-8601 date, or in the future; lean mode is not armed (fail-closed).' };
  }
  return { mode: 'lean', reason: 'OPERATING_MODEL=lean and LEAN_MODE_ACTIVATED_AT is a past ISO-8601 timestamp.' };
}

// ── Risk classification (Standard allow-list; everything else Protected) ────

function normalizePath(filePath) {
  return String(filePath || '').replaceAll('\\', '/').replace(/^\.\//u, '');
}

// Any of these words anywhere in the path keeps a file off the Standard list,
// whatever rule it would otherwise match. Substring, case-insensitive: false
// positives are cheap (one more approval), false negatives are not.
const SENSITIVE_PATH_WORDS = [
  'auth', 'login', 'session', 'secret', 'credential', 'token', 'password', 'apikey', 'api-key',
  'kill', 'switch', 'delivery', 'deliver', 'distribut', 'outbox', 'receipt',
  'settle', 'grading', 'grade', 'payout', 'clv',
  'whop', 'stripe', 'billing', 'subscri', 'payment', 'checkout', 'pricing',
  'allowlist', 'capper-access', 'capper_access', 'role', 'tier', 'member', 'permission', 'admin',
  'restore', 'purge', 'retention', 'delete', 'promotion', 'routing',
  'guard', 'governance', 'guardrail', 'merge', 'lane', 'verdict', 'override', 'bypass',
  'intervention', 'correction', 'action', 'confirm', 'replay', 'migration', 'deploy', 'webhook',
  'lifecycle', 'submission', 'submit', 'cron', 'scheduler', 'worker',
];
const SENSITIVE_PATH_TOKENS = /(?:^|[/._-])\.?env(?:[/._-]|$)/iu;

function sensitivePathWord(filePath) {
  const lower = normalizePath(filePath).toLowerCase();
  if (SENSITIVE_PATH_TOKENS.test(lower)) return 'env';
  return SENSITIVE_PATH_WORDS.find(word => lower.includes(word)) || null;
}

// Docs that carry authority (constitution, mission, operations, contracts,
// policies, readiness, proof, lane state) are Protected even though they are
// Markdown.
const DOCS_EXCLUDED = [
  /^docs\/00_constitution\//u,
  /^docs\/mission\//u,
  /^docs\/05_operations\//u,
  /^docs\/06_status\/(?:lanes|proof|readiness)\//u,
  // Case-insensitive substring: backup-dr-policy, environment_contract,
  // *_spec, charter, networking ... all stay Protected.
  /(?:contract|policy|policies|spec|authority|runbook|codeowners|standing|invariant|charter|readiness|environment|networking|network|backup|disaster|recovery|security|secret|governance|guardrail)/iu,
  /(?:^|[/._-])dr(?:[/._-]|$)/iu,
  /(?:^|\/)intent\.md$/iu,
  /(?:^|\/)(?:CLAUDE|AGENTS)\.md$/iu,
];

// UI-only component directories. Files here are Standard only when their full
// head content imports no first-party component or module (only allow-listed
// packages and named @/lib helpers) and carries no
// mutation, network, auth, env or server-action capability (see scanUiContent).
const UI_COMPONENT_DIRS = Object.freeze([
  'apps/command-center/src/components/',
  'apps/smart-form/components/',
  'apps/web/src/components/',
]);

const STANDARD_RULES = Object.freeze([
  {
    id: 'docs',
    match: name => /^docs\/.+\.md$/u.test(name) && !DOCS_EXCLUDED.some(pattern => pattern.test(name)),
  },
  {
    id: 'test-addition',
    // Unit tests colocated in apps/packages only. Fixtures, helpers, snapshots,
    // e2e config and scripts/** tests (which guard the governance tooling) are
    // not on the list.
    match: name => /^(?:apps|packages)\/[^/]+\/(?:[^/]+\/)*[^/]+\.(?:test|spec)\.tsx?$/u.test(name)
      && !/(?:^|\/)(?:__snapshots__|__fixtures__|fixtures)\//u.test(name),
  },
  {
    id: 'ui-component',
    match: name => UI_COMPONENT_DIRS.some(dir => name.startsWith(dir)) && /\.(?:tsx|css)$/u.test(name)
      && !/\.(?:test|spec)\./u.test(name),
  },
]);

// Tier C paths (AGENTS.md "Tier C - stop and report before editing";
// mirrored exactly from scripts/ops/merge-risk.ts, parity asserted by
// operating-model.test.ts). Every file at or under one of these is a PM-approval
// path with no test, docs or fixture exemption, so it is VETOED before any
// Standard rule is consulted: nothing under a Tier C prefix can be Standard.
const TIER_C_EXACT_PATHS = Object.freeze([
  'packages/db/src/lifecycle.ts',
  'packages/db/src/repositories.ts',
  'packages/db/src/runtime-repositories.ts',
  'packages/db/src/database.types.ts',
  'apps/api/src/distribution-service.ts',
  'apps/api/src/submission-service.ts',
  'apps/api/src/settlement-service.ts',
  'apps/api/src/auth.ts',
  'scripts/ops/orchestration-reconciler.ts',
  'scripts/ci/file-scope-guard.ts',
  'scripts/ci/file-scope-guard.test.ts',
]);
const TIER_C_PATH_PREFIXES = Object.freeze([
  'supabase/migrations/',
  'packages/contracts/src/',
  'packages/domain/src/',
  'apps/worker/',
  '.github/workflows/',
  'docs/00_constitution/',
  'packages/config/',
]);
const TIER_C_PATH_PATTERNS = Object.freeze([
  /^apps\/api\/src\/[^/]+-service\.ts$/u,
  /^scripts\/ops\/(?:lane|merge|tier)-[^/]+(?<!\.test)\.ts$/u,
  /^docs\/05_operations\/[^/]+_(?:POLICY|SPEC)\.md$/u,
  /^\.env(?:\..*)?$/u,
  /^local\.env$/u,
]);

/** True when `filePath` is a Tier C path (exact, under a prefix, or a pattern). */
function isTierCPath(filePath) {
  const name = normalizePath(filePath);
  return TIER_C_EXACT_PATHS.includes(name)
    || TIER_C_PATH_PREFIXES.some(prefix => name.startsWith(prefix))
    || TIER_C_PATH_PATTERNS.some(pattern => pattern.test(name));
}

function standardRuleFor(filePath) {
  const name = normalizePath(filePath);
  if (!name || name.includes('..')) return null;
  // Tier C veto FIRST: no allow-list rule (tests, docs, UI) may admit it.
  if (isTierCPath(name)) return null;
  const rule = STANDARD_RULES.find(candidate => candidate.match(name));
  if (!rule) return null;
  if (sensitivePathWord(name)) return null;
  return rule.id;
}

// ── Content checks ─────────────────────────────────────────────────────────

const PROTECTED_TABLES = '(?:picks|pick_lifecycle|audit_log|delivery_kill_switch|distribution_outbox|distribution_receipts|settlement_records|member_tiers|capper_access)';
const PROTECTED_TABLE_REF = /\b(?:delivery_kill_switch|distribution_outbox|distribution_receipts|settlement_records)\b/u;
const WRITE_CALL_SRC = '\\.(?:insert|upsert|update|delete|rpc)\\s*\\(';
// Multi-line: the write call and the table may be on different lines (chained
// builders, constants, template literals). Matched over the JOINED added text
// in both orders within a bounded window.
const WRITE_NEAR_TABLE = new RegExp(`(?:${WRITE_CALL_SRC}[\\s\\S]{0,400}?\\b${PROTECTED_TABLES}\\b|\\b${PROTECTED_TABLES}\\b[\\s\\S]{0,400}?${WRITE_CALL_SRC})`, 'u');
const ENV_OR_SECRET_REF = /(?:process\.env\b|import\.meta\.env\b|\bsecrets\.[A-Z_]+|\b[A-Z][A-Z0-9_]*(?:_API_KEY|_SECRET|_TOKEN|_PASSWORD|_SERVICE_ROLE_KEY)\b|\bALLOWED_[A-Z_]+\b)/u;
const MEMBER_PII_REF = /\b(?:member_email|member_pii|discord_id|stripe_customer|customer_email)\b/u;
const NETWORK_OR_PROCESS = /(?:\bfetch\s*\(|\bchild_process\b|\bnode:child_process\b|\bspawn(?:Sync)?\s*\(|\bexec(?:Sync|File)?\s*\(|\bnew\s+WebSocket\b|\bXMLHttpRequest\b|\bhttps?\.request\s*\()/u;
// Test weakening on ADDED lines. Removed lines in a test file are handled
// separately: any removal at all makes the file Protected (add-only rule), so
// deleting an assertion, rewriting expect(...) or narrowing a matcher cannot
// stay Standard.
const WEAKENING_ADDITION = /(?:\b(?:it|test|describe|suite)\.(?:skip|only|todo)\b|\bx(?:it|test|describe)\s*\(|\bt\.(?:skip|todo)\s*\(|[{,]\s*(?:skip|todo|only)\s*:(?!\s*false\b)|\bcontinue-on-error\s*:\s*true|\bprocess\.exit\s*\()/u;

// UI component capability markers. Scanned over the WHOLE head file so an
// innocuous-looking edit to a component that already submits, fetches or
// authenticates is Protected.
// Bare global identifiers (fetch, globalThis, navigator, ...) and computed
// member access on browser globals are forbidden outright: `fetch.call(...)`,
// `globalThis['fetch']`, `navigator['sendB'+'eacon']`, `document['cookie']`
// cannot be told apart from harmless use by a regex, so any of them is
// Protected.
const UI_FORBIDDEN = /(?:\bfetch\b|\bglobalThis\b|\bnavigator\b|\b(?:window|self|top|parent|frames|opener|document|globalThis)\s*\[|\bdocument\s*\.\s*cookie\b|\bcreateElement\s*\(\s*(?:['"`]\s*form\b|[^'"`\s])|\bReflect\b|\bconstructor\b|\bFunction\s*\(|\bimport\s*\.\s*meta\b|\brequire\b|use server|\bsupabase\b|\bcreateClient\b|next-auth|\bsign(?:In|Out)\s*\(|process\.env|import\.meta\.env|\.rpc\s*\(|\.from\s*\(|\.(?:insert|upsert|update|delete)\s*\(|dangerouslySetInnerHTML|\beval\s*\(|\bnew\s+Function\b|XMLHttpRequest|WebSocket|EventSource|sendBeacon|document\.cookie|localStorage|sessionStorage|\bformAction\b|\baction\s*=\s*\{|<form\b|\baxios\b|\buseMutation\b|\bmutate(?:Async)?\s*\(|window\.location\s*=|\bwindow\.open\s*\()/u;
// Codex P2 on #1842: no import of another first-party component, by the
// `@/components/*` alias OR by a relative path, is on the allow-list. A
// harmless-looking component can wrap a mutation-capable one (a Tile rendering
// InterventionAction with action="requeue_delivery" POSTs a requeue), and the
// content scan sees only this file. Such changes are Protected; import-graph
// capability analysis is a possible future refinement, not built here.
const UI_ALLOWED_IMPORTS = /^(?:react|react-dom|next\/link|next\/image|next\/navigation|next\/dynamic|next-themes|clsx|classnames|lucide-react|class-variance-authority|tailwind-merge|framer-motion|recharts|@radix-ui\/[a-z0-9-]+|@\/lib\/(?:types|utils|cn|format|formatters|site-config))$/u;
// Whitespace and comments may legally sit between `from`/`import(` and the
// specifier; tolerate them so a comment cannot hide the specifier.
const GAP = String.raw`(?:\s|/\*[\s\S]*?\*/|//[^\n]*(?:\n|$))*`;
const IMPORT_SPECIFIERS = new RegExp(String.raw`(?:\bfrom${GAP}(['"])([^'"\n]*)\1|\bimport${GAP}\(${GAP}(['"])([^'"\n]*)\3|\bimport${GAP}(['"])([^'"\n]*)\5|\brequire${GAP}\(${GAP}(['"])([^'"\n]*)\7)`, 'gu');
const DYNAMIC_LOAD = new RegExp(String.raw`(?:\bimport${GAP}\(${GAP}[^'"\s)/]|\brequire${GAP}\(${GAP}[^'"\s)/]|\bfrom${GAP}\x60)`, 'u');
// CSS that can load remote resources (@import, url() with a scheme or a
// protocol-relative / escaped target, legacy expression()).
const CSS_FORBIDDEN = /(?:@import\b|\burl\s*\(\s*['"]?\s*(?:[a-z][a-z0-9+.-]*:|\/\/|\\)|\bexpression\s*\(|\bbehavior\s*:|-moz-binding)/iu;
// Newly added unit tests run in CI with secrets. Any process, network, FS,
// child-process, dynamic-code or DB-client reference is Protected.
const TEST_FORBIDDEN = /(?:\bprocess\b|\bglobalThis\b|\bfetch\b|\bXMLHttpRequest\b|\bWebSocket\b|\bEventSource\b|\beval\b|\bFunction\s*\(|\bconstructor\b|\bReflect\b|\bimport\s*\.\s*meta\b|\bcreateDatabaseClient\b|\bcreate[A-Za-z]*Client\b|\b[Ss]upabase|\bpostgres\b|\bnew\s+(?:Pool|Client)\b|@unit-talk\/db\b|['"]pg['"])/u;
// eslint-disable-next-line @typescript-eslint/no-require-imports -- CommonJS policy module
const NODE_BUILTINS = new Set(require('node:module').builtinModules.map(name => name.replace(/^node:/u, '')));
const TEST_ALLOWED_BUILTINS = new Set(['test', 'assert', 'assert/strict']);

function importSpecifiers(content) {
  const specifiers = [];
  for (const match of String(content).matchAll(IMPORT_SPECIFIERS)) {
    specifiers.push(match[2] ?? match[4] ?? match[6] ?? match[8]);
  }
  return specifiers.filter(spec => spec !== undefined);
}

/** Problems with a newly added unit test's content (fail-closed). */
function scanTestContent(content) {
  const problems = [];
  const text = String(content);
  const marker = text.match(TEST_FORBIDDEN);
  if (marker) problems.push(`process/network/FS/DB reference \`${marker[0]}\``);
  if (DYNAMIC_LOAD.test(text)) problems.push('non-literal import()/require()');
  for (const specifier of importSpecifiers(text)) {
    const bare = specifier.replace(/^node:/u, '');
    if (specifier.startsWith('node:') || NODE_BUILTINS.has(bare) || NODE_BUILTINS.has(bare.split('/')[0])) {
      if (!TEST_ALLOWED_BUILTINS.has(bare)) problems.push(`imports Node built-in \`${specifier}\``);
    }
    if (specifier.includes('\\') || specifier.split('/').includes('..')) problems.push(`import \`${specifier}\` escapes its directory`);
  }
  return problems;
}

/** Returns a list of problems with a UI component's full head content. */
function scanUiContent(fileName, content) {
  const problems = [];
  if (/\.css$/u.test(fileName)) {
    const css = content.match(CSS_FORBIDDEN);
    if (css) problems.push(`CSS loads an external resource \`${css[0]}\``);
  }
  if (UI_FORBIDDEN.test(content)) {
    const match = content.match(UI_FORBIDDEN);
    problems.push(`capability marker \`${match && match[0]}\``);
  }
  if (DYNAMIC_LOAD.test(content)) problems.push('non-literal import()/require()');
  for (const specifier of importSpecifiers(content)) {
    if (!specifier) {
      problems.push('empty import specifier');
      continue;
    }
    // `..` anywhere (alias or relative) and escapes are rejected outright:
    // `@/components/../app/actions/x` must not ride the alias allow-list.
    if (specifier.includes('\\') || specifier.split('/').includes('..')) {
      problems.push(`import \`${specifier}\` contains a parent-directory segment or escape`);
      continue;
    }
    if (specifier.startsWith('.')) {
      problems.push(`relative import \`${specifier}\` of a first-party module (its capabilities are not scanned)`);
      continue;
    }
    if (!UI_ALLOWED_IMPORTS.test(specifier)) problems.push(`import \`${specifier}\` is outside the UI allow-list`);
  }
  return problems;
}

function patchLines(patch) {
  const added = [];
  const removed = [];
  if (typeof patch !== 'string') return { added, removed };
  for (const line of patch.split('\n')) {
    if (line.startsWith('+++') || line.startsWith('---')) continue;
    if (line.startsWith('+')) added.push(line.slice(1));
    else if (line.startsWith('-')) removed.push(line.slice(1));
  }
  return { added, removed };
}

/**
 * Mechanically classify a PR's changed files as Standard or Protected.
 *
 * `files`: [{ filename, previous_filename?, status?, additions?, deletions?,
 *             patch?, headContent? }] - pulls.listFiles rows; `headContent` is
 * the full head blob (utf8) and is REQUIRED for ui-component files.
 *
 * Returns { class, reasons: [{file, rule, detail}], standardFiles: [{file, rule}] }.
 * A single reason makes the PR Protected. Nothing lowers a class.
 */
function classifyRisk({ files } = {}) {
  const reasons = [];
  const standardFiles = [];
  const protect = (file, rule, detail) => reasons.push({ file, rule, detail });

  if (!Array.isArray(files) || files.length === 0) {
    protect('<none>', 'no-file-list', 'Changed-file list is empty or unavailable; refusing to classify as Standard.');
    return { class: 'Protected', reasons, standardFiles };
  }

  for (const file of files) {
    const name = normalizePath(file && file.filename);
    if (!name) {
      protect('<unknown>', 'malformed-entry', 'File entry without a filename.');
      continue;
    }
    const status = String((file && file.status) || 'modified');
    const rule = standardRuleFor(name);
    if (!rule) {
      const word = sensitivePathWord(name);
      protect(name, 'not-standard-path', isTierCPath(name)
        ? 'Path is Tier C (AGENTS.md / merge-risk.ts); PM approval is required for every file under it, tests included.'
        : word
        ? `Path contains the sensitive word "${word}".`
        : 'Path is not on the Standard allow-list (docs outside governance, add-only app/package unit tests, UI-only components).');
      continue;
    }
    const previous = normalizePath(file.previous_filename);
    if (previous && previous !== name && standardRuleFor(previous) !== rule) {
      protect(previous, 'not-standard-path', `Renamed/copied from a path that is not Standard under rule ${rule}.`);
      continue;
    }

    if (rule === 'docs') {
      // Removing or editing ordinary docs is Standard; docs carry no runtime behavior.
      standardFiles.push({ file: name, rule });
      continue;
    }

    // Code rules below need the patch.
    if (status === 'removed') {
      protect(name, 'code-removed', `Deleting a ${rule} file is not Standard.`);
      continue;
    }
    const hasPatch = typeof file.patch === 'string' && file.patch.length > 0;
    if (!hasPatch) {
      protect(name, 'patch-unavailable', 'GitHub returned no patch for a changed code file; cannot inspect it.');
      continue;
    }
    const { added, removed } = patchLines(file.patch);
    const addedText = added.join('\n');
    const before = reasons.length;

    if (rule === 'test-addition') {
      // Only a NEWLY ADDED test file can be Standard. Inserting `/*`...`*/`,
      // `return;` or a shadowing `const test =` into an existing test removes
      // no line yet disables assertions, so any modified test is Protected.
      if (status !== 'added') {
        protect(name, 'test-not-new', `Test file status is "${status}"; only newly added test files are Standard (modifying an existing test can disable assertions without removing a line).`);
      }
      const testProblems = scanTestContent(addedText);
      if (testProblems.length) {
        protect(name, 'test-capability', testProblems.join('; '));
      }
      if (removed.length > 0) {
        protect(name, 'test-lines-removed', `${removed.length} line(s) removed from a test file; Standard tests are add-only (assertions cannot be removed or rewritten).`);
      }
      if (added.some(line => WEAKENING_ADDITION.test(line))) {
        protect(name, 'test-or-check-weakened', 'Adds skip/only/todo, a skip option, or process.exit.');
      }
      if (ENV_OR_SECRET_REF.test(addedText) || NETWORK_OR_PROCESS.test(addedText)) {
        protect(name, 'test-env-or-network', 'Test adds an env/secret, network or child-process reference (runs in CI with secrets).');
      }
    }

    if (rule === 'ui-component') {
      if (typeof file.headContent !== 'string') {
        protect(name, 'content-unavailable', 'Full head content of a UI component was not loaded; cannot prove it has no side effects.');
      } else {
        const problems = scanUiContent(name, file.headContent);
        if (problems.length) protect(name, 'ui-capability', problems.join('; '));
      }
    }

    // Shared content checks for every Standard code candidate.
    if (WRITE_NEAR_TABLE.test(addedText)) {
      protect(name, 'protected-table-write-path', 'Added code places a write call near a protected table name (multi-line aware).');
    }
    if ([...added, ...removed].some(line => PROTECTED_TABLE_REF.test(line))) {
      protect(name, 'protected-table-reference', 'Diff references delivery_kill_switch / distribution_outbox / distribution_receipts / settlement_records.');
    }
    if (MEMBER_PII_REF.test(addedText)) {
      protect(name, 'member-pii-reference', 'Diff references member PII fields.');
    }
    if (rule !== 'test-addition' && ENV_OR_SECRET_REF.test([...added, ...removed].join('\n'))) {
      protect(name, 'env-or-secret-reference', 'Diff adds or changes an env/secret reference.');
    }

    if (reasons.length === before) standardFiles.push({ file: name, rule });
  }

  return { class: reasons.length > 0 ? 'Protected' : 'Standard', reasons, standardFiles };
}

/** True when the PR needs the full head blob of `file` for classification. */
function needsHeadContent(file) {
  const name = normalizePath(file && file.filename);
  return standardRuleFor(name) === 'ui-component' && String(file.status || '') !== 'removed';
}

// ── Independent review ─────────────────────────────────────────────────────

// Severity markers the connector (or a human-styled bot body) may use: badge
// images, **P1**, (P1), [P1], P1:, "P1 finding", "Priority 1". Any standalone
// P0/P1 token counts; a false positive costs one more review, a false
// negative lets a P1 merge.
const P0_P1_FINDING = /(?:(?<![A-Za-z0-9_])P[01](?![A-Za-z0-9_])|\bpriority[\s:_-]*[01]\b|\bsev(?:erity)?[\s:_-]*[01]\b)/iu;
const RISK_CLASS_PROTECTED_LINE = /^\s*RISK-CLASS:\s*PROTECTED\s*$/imu;
const CODEX_STATE_MARKER = 'codex-review-state:v1';
// The connector's summary comment has a fixed shape: its body STARTS with the
// summary header comment, immediately followed by the state comment. A marker
// anywhere else (quoted, echoed, appended) is not a summary.
const CODEX_SUMMARY_HEAD = /^<!-- codex-pull-request-review-summary -->\r?\n<!-- codex-review-state:v1 (\{[^\n]*?\}) -->(?:\r?\n|$)/u;

function normLogin(login) {
  return String(login || '').trim().toLowerCase().replace(/\[bot\]$/u, '');
}

function trustedSet(trustedReviewers) {
  const list = Array.isArray(trustedReviewers) && trustedReviewers.length ? trustedReviewers : TRUSTED_REVIEWER_LOGINS_DEFAULT;
  return new Set(list.map(normLogin).filter(Boolean));
}

function actorLogin(node) {
  return (node && ((node.author && node.author.login) || (node.user && node.user.login))) || '';
}

function actorIsBot(node) {
  if (!node) return false;
  if (node.user && node.user.type) return node.user.type === 'Bot';
  if (node.author && node.author.__typename) return node.author.__typename === 'Bot';
  return false;
}

/** Body edited by someone other than a trusted reviewer => cannot be trusted. */
function editedByOther(node, trusted) {
  const editor = node && node.editor && node.editor.login;
  return Boolean(editor) && !trusted.has(normLogin(editor));
}

/**
 * Parse the connector summary state. Returns null unless the body has the
 * exact anchored shape and exactly one state marker.
 */
function parseCodexState(body) {
  const text = String(body || '');
  if (text.split(CODEX_STATE_MARKER).length !== 2) return null;
  const match = text.match(CODEX_SUMMARY_HEAD);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[1]);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function commitOid(value) {
  if (!value) return null;
  if (typeof value === 'string') return value;
  return value.oid || null;
}

/**
 * Evaluate Independent Review from GitHub-trusted artifacts only.
 *
 * reviews:  [{ id|databaseId, user:{login,type} | author:{login,__typename}, commit_id|commit:{oid},
 *              state, body, submitted_at|submittedAt, editor? }]
 * threads:  [{ isResolved, comments:[{ author:{login,__typename}, body, createdAt, editor?,
 *              originalCommit?:{oid}, pullRequestReview?:{ databaseId, commit?:{oid} } }] }]
 * comments: issue comments [{ user|author, body, updatedAt|updated_at, editor? }] - only the
 *           connector's anchored codex-review-state:v1 summary is read.
 *
 * PASS requires ALL of:
 *   - a trusted Bot connector summary (anchored marker, untampered) bound to
 *     the exact head with status=completed, has_any_findings=false and
 *     has_unresolved_findings=false. A bare review object never passes, and a
 *     missing summary is a FAIL;
 *   - no connector summary for the head reporting any finding;
 *   - no P0/P1 finding (any trusted comment in any thread, or a trusted review
 *     body / CHANGES_REQUESTED) raised at the current head, resolved or not -
 *     a finding at head H can only be cleared by a NEW head commit with a
 *     fresh clean summary. A finding whose commit cannot be determined is
 *     treated as raised at the head;
 *   - no unresolved P0/P1 thread at any head;
 *   - no trusted artifact edited by a non-trusted account.
 */
function evaluateIndependentReview({ reviews, threads, comments, headSha, prAuthorLogin, lastPusherLogin, trustedReviewers } = {}) {
  const trusted = trustedSet(trustedReviewers);
  const implementers = new Set([prAuthorLogin, lastPusherLogin].filter(Boolean).map(normLogin));
  const reasons = [];
  if (!headSha) {
    return { pass: false, reasons: ['Head SHA is unavailable; cannot bind a review to it.'], reviewers: [] };
  }
  const isTrustedLogin = node => trusted.has(normLogin(actorLogin(node)));
  const isTrustedActor = node => actorIsBot(node) && isTrustedLogin(node) && !implementers.has(normLogin(actorLogin(node)));

  const reviewCommit = new Map();
  let tampered = 0;
  let findingsAtHead = 0;
  let unresolved = 0;

  for (const review of (Array.isArray(reviews) ? reviews : []).filter(Boolean)) {
    const id = review.databaseId !== undefined ? review.databaseId : review.id;
    const commit = review.commit_id || commitOid(review.commit);
    if (id !== undefined && id !== null) reviewCommit.set(String(id), commit);
    // Findings are counted for any account using a trusted login (fail-closed).
    if (!isTrustedLogin(review)) continue;
    if (editedByOther(review, trusted)) {
      tampered += 1;
      continue;
    }
    const isFinding = P0_P1_FINDING.test(String(review.body || '')) || String(review.state || '') === 'CHANGES_REQUESTED';
    if (isFinding && (!commit || commit === headSha)) findingsAtHead += 1;
  }

  for (const thread of Array.isArray(threads) ? threads : []) {
    const threadComments = thread && Array.isArray(thread.comments) ? thread.comments : [];
    let threadHasFinding = false;
    for (const comment of threadComments) {
      if (!comment || !isTrustedLogin(comment)) continue;
      if (editedByOther(comment, trusted)) {
        tampered += 1;
        threadHasFinding = true;
        continue;
      }
      if (!P0_P1_FINDING.test(String(comment.body || ''))) continue;
      threadHasFinding = true;
      const review = comment.pullRequestReview || {};
      const commit = commitOid(comment.originalCommit)
        || commitOid(review.commit)
        || (review.databaseId !== undefined ? reviewCommit.get(String(review.databaseId)) : null)
        || null;
      if (!commit || commit === headSha) findingsAtHead += 1;
    }
    if (threadHasFinding && !thread.isResolved) unresolved += 1;
  }

  let cleanSummaries = 0;
  const reviewers = new Set();
  for (const comment of Array.isArray(comments) ? comments : []) {
    if (!comment || !isTrustedLogin(comment)) continue;
    const state = parseCodexState(comment.body);
    if (!state) continue;
    if (!isTrustedActor(comment)) continue; // a user or implementer with the login: ignored, never a pass
    if (editedByOther(comment, trusted)) {
      tampered += 1;
      continue;
    }
    const code = state.code_review && typeof state.code_review === 'object' ? state.code_review : {};
    if (code.commit_sha !== headSha) continue;
    if (code.has_any_findings !== false || code.has_unresolved_findings === true) {
      if (code.has_any_findings === true || code.has_unresolved_findings === true) findingsAtHead += 1;
      continue;
    }
    if (code.status === 'completed' && code.has_unresolved_findings === false) {
      cleanSummaries += 1;
      reviewers.add(normLogin(actorLogin(comment)));
    }
  }

  if (tampered > 0) reasons.push(`${tampered} trusted review artifact(s) were edited by a non-trusted account; they can never count as clean.`);
  if (unresolved > 0) reasons.push(`${unresolved} unresolved P0/P1 finding thread(s) from a trusted reviewer remain.`);
  if (findingsAtHead > 0) {
    reasons.push(`${findingsAtHead} P0/P1 finding(s) were raised at the current head ${headSha.slice(0, 12)} (or at an unknown commit); resolving them does not clear them. Push a new commit and obtain a fresh clean connector summary for it.`);
  }
  if (cleanSummaries === 0) {
    reasons.push(`No completed, finding-free connector summary (codex-review-state:v1) from a trusted reviewer identity (${[...trusted].join(', ')}) is bound to the current head ${headSha.slice(0, 12)}. A review object alone never passes. Request one with an "@codex review" comment.`);
  }

  return { pass: reasons.length === 0, reasons, reviewers: [...reviewers] };
}

/**
 * Reviewer escalation: a trusted reviewer raises Standard to Protected with an
 * exact `RISK-CLASS: PROTECTED` line in a review body, review comment or issue
 * comment. Sticky across heads (escalation is one-way); never lowers.
 */
function reviewerRequestsProtected({ reviews, threads, comments, trustedReviewers } = {}) {
  const trusted = trustedSet(trustedReviewers);
  const nodes = [
    ...(Array.isArray(reviews) ? reviews : []),
    ...(Array.isArray(comments) ? comments : []),
    ...(Array.isArray(threads) ? threads : []).flatMap(thread => (thread && Array.isArray(thread.comments) ? thread.comments : [])),
  ];
  return nodes.some(node => isTrustedEscalation(node, trusted));
}

function isTrustedEscalation(node, trusted) {
  return Boolean(node) && trusted.has(normLogin(actorLogin(node))) && RISK_CLASS_PROTECTED_LINE.test(String(node.body || ''));
}

/**
 * True when one artifact (a REST issue comment `{ user, body }` or a GraphQL
 * node `{ author, body }`) is a trusted reviewer escalation. This is the exact
 * predicate reviewerRequestsProtected applies, so the refresh broker can never
 * honor an escalation that classification would ignore, or vice versa.
 */
function isTrustedReviewerEscalation(node, trustedReviewers) {
  return isTrustedEscalation(node, trustedSet(trustedReviewers));
}

/**
 * True when an artifact's author uses a trusted reviewer login (any account
 * type). evaluateIndependentReview and reviewerRequestsProtected read ONLY
 * artifacts with this property (findings, summaries, escalations, tamper
 * detection), so a change to any other artifact cannot change either result.
 */
function isTrustedReviewerArtifact(node, trustedReviewers) {
  return Boolean(node) && trustedSet(trustedReviewers).has(normLogin(actorLogin(node)));
}

/**
 * True when one artifact (REST issue comment, review or inline review comment,
 * or a GraphQL node) is a P0/P1 finding from a trusted reviewer login: the
 * exact finding test evaluateIndependentReview applies (P0/P1 marker in the
 * body, or a CHANGES_REQUESTED review), counted for any account type using a
 * trusted login. The refresh broker uses it to recover a finding written while
 * a native run was in flight, so it can never ignore a finding the evaluation
 * would count.
 */
function isTrustedReviewerFinding(node, trustedReviewers) {
  if (!isTrustedReviewerArtifact(node, trustedReviewers)) return false;
  return P0_P1_FINDING.test(String(node.body || '')) || String(node.state || '') === 'CHANGES_REQUESTED';
}

// ── Lean merge-gate decision ───────────────────────────────────────────────

/**
 * Compose the lean Merge Gate verdict.
 *
 * Standard  = checks green (branch protection) + Independent Review.
 * Protected = additionally a head-bound CODEOWNER approval (t1-approved label +
 *             pm-verdict/v1 validated by merge-gate-verdict.cjs).
 * governance:pause is a hard block for every class.
 */
function evaluateLeanGate({ riskClass, labels, independentReview, protectedApprovalErrors } = {}) {
  const errors = [];
  const effectiveClass = riskClass === 'Standard' ? 'Standard' : 'Protected';
  const labelList = Array.isArray(labels) ? labels : [];

  if (labelList.includes('governance:pause')) {
    errors.push('governance:pause label is active. All merges blocked until removed by PM.');
  }
  if (!independentReview || independentReview.pass !== true) {
    const detail = independentReview && independentReview.reasons && independentReview.reasons.length
      ? independentReview.reasons.join(' ')
      : 'Independent Review did not pass.';
    errors.push(`Independent Review: ${detail}`);
  }
  if (effectiveClass === 'Protected') {
    if (!labelList.includes('t1-approved')) {
      errors.push('Protected change requires the "t1-approved" label.');
    }
    const approvalErrors = Array.isArray(protectedApprovalErrors) ? protectedApprovalErrors : ['Head-bound CODEOWNER approval was not evaluated.'];
    for (const error of approvalErrors) errors.push(String(error));
  }
  return { class: effectiveClass, errors, pass: errors.length === 0 };
}

// ── GitHub-backed loaders (injected `github`, so they are testable) ────────

const MAX_PAGES = 20;

const REVIEWS_QUERY = `
  query($owner: String!, $repo: String!, $number: Int!, $cursor: String) {
    repository(owner: $owner, name: $repo) {
      pullRequest(number: $number) {
        connection: reviews(first: 100, after: $cursor) {
          pageInfo { hasNextPage endCursor }
          nodes { databaseId state body submittedAt commit { oid } author { __typename login } editor { login } }
        }
      }
    }
  }`;

const REVIEW_THREADS_QUERY = `
  query($owner: String!, $repo: String!, $number: Int!, $cursor: String) {
    repository(owner: $owner, name: $repo) {
      pullRequest(number: $number) {
        connection: reviewThreads(first: 100, after: $cursor) {
          pageInfo { hasNextPage endCursor }
          nodes {
            isResolved
            comments(first: 100) {
              pageInfo { hasNextPage }
              nodes { body createdAt author { __typename login } editor { login } originalCommit { oid } pullRequestReview { databaseId submittedAt commit { oid } } }
            }
          }
        }
      }
    }
  }`;

const ISSUE_COMMENTS_QUERY = `
  query($owner: String!, $repo: String!, $number: Int!, $cursor: String) {
    repository(owner: $owner, name: $repo) {
      pullRequest(number: $number) {
        connection: comments(first: 100, after: $cursor) {
          pageInfo { hasNextPage endCursor }
          nodes { body updatedAt author { __typename login } editor { login } }
        }
      }
    }
  }`;

async function graphqlConnection(github, query, variables) {
  const nodes = [];
  let cursor = null;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const data = await github.graphql(query, { ...variables, cursor });
    const connection = data && data.repository && data.repository.pullRequest && data.repository.pullRequest.connection;
    if (!connection || !Array.isArray(connection.nodes)) {
      throw new Error('GraphQL response is missing the expected connection; refusing to evaluate review state.');
    }
    nodes.push(...connection.nodes);
    if (!connection.pageInfo || !connection.pageInfo.hasNextPage) return nodes;
    cursor = connection.pageInfo.endCursor;
  }
  throw new Error(`More than ${MAX_PAGES * 100} review artifacts; cannot prove none is an open P0/P1. Failing closed.`);
}

/**
 * A review thread's nested comments connection is not paginated. If GitHub
 * reports another page (or omits pageInfo / nodes), a P0/P1 finding or a
 * RISK-CLASS: PROTECTED escalation could sit past comment 100 unseen, so the
 * whole evaluation fails closed instead of reading a truncated thread.
 */
function normalizeThread(node) {
  const connection = node && node.comments;
  if (!connection || !Array.isArray(connection.nodes) || !connection.pageInfo || typeof connection.pageInfo.hasNextPage !== 'boolean') {
    throw new Error('Review thread comments connection is missing nodes or pageInfo; cannot prove the thread has no open P0/P1 or escalation. Failing closed.');
  }
  if (connection.pageInfo.hasNextPage) {
    throw new Error('A review thread has more than 100 comments; nested comments are not paginated, so an open P0/P1 or escalation could be hidden. Failing closed.');
  }
  return { isResolved: node.isResolved, comments: connection.nodes };
}

/** Collect the GitHub-trusted artifacts Independent Review and escalation read. */
async function collectIndependentReviewInputs({ github, owner, repo, prNumber }) {
  const variables = { owner, repo, number: prNumber };
  const reviews = await graphqlConnection(github, REVIEWS_QUERY, variables);
  const rawThreads = await graphqlConnection(github, REVIEW_THREADS_QUERY, variables);
  const comments = await graphqlConnection(github, ISSUE_COMMENTS_QUERY, variables);
  const threads = rawThreads.map(normalizeThread);

  const commits = await github.paginate(github.rest.pulls.listCommits, {
    owner, repo, pull_number: prNumber, per_page: 100,
  });
  const last = commits.length > 0 ? commits[commits.length - 1] : null;
  const lastPusherLogin = (last && ((last.author && last.author.login) || (last.committer && last.committer.login))) || null;
  return { reviews, threads, comments, lastPusherLogin };
}

async function loadHeadContent({ github, owner, repo, path, ref }) {
  try {
    const { data } = await github.rest.repos.getContent({ owner, repo, path, ref });
    if (!data || Array.isArray(data) || typeof data.content !== 'string') return null;
    return Buffer.from(data.content, data.encoding === 'base64' ? 'base64' : 'utf8').toString('utf8');
  } catch {
    return null; // unavailable => classifyRisk escalates (content-unavailable)
  }
}

/**
 * Resolve the operating mode and, in lean mode, classify the PR and collect
 * the review inputs. `env` carries OPERATING_MODEL, LEAN_MODE_ACTIVATED_AT and
 * TRUSTED_REVIEWER_LOGINS. Shared by every workflow so Risk Class, Independent
 * Review, Executor Result Validation, Merge Gate and the post-merge QA gate
 * always see the same class, including reviewer escalation.
 */
async function loadPullRequestPolicy({ github, owner, repo, pr, env }) {
  const mode = resolveOperatingMode({
    flag: env && env.OPERATING_MODEL,
    activatedAt: env && env.LEAN_MODE_ACTIVATED_AT,
  });
  if (mode.mode !== 'lean') return { mode, classification: null, reviewInputs: null, trustedReviewers: [] };

  const trustedReviewers = String((env && env.TRUSTED_REVIEWER_LOGINS) || '')
    .split(',').map(login => login.trim()).filter(Boolean);
  const files = await github.paginate(github.rest.pulls.listFiles, {
    owner, repo, pull_number: pr.number, per_page: 100,
  });
  for (const file of files) {
    if (needsHeadContent(file)) {
      file.headContent = await loadHeadContent({ github, owner, repo, path: file.filename, ref: pr.head.sha });
    }
  }
  const classification = classifyRisk({ files });
  if (!Number.isFinite(pr.changed_files) || files.length < pr.changed_files) {
    classification.class = 'Protected';
    classification.reasons.push({
      file: '<incomplete>',
      rule: 'incomplete-file-list',
      detail: `GitHub returned ${files.length} of ${pr.changed_files} changed files; cannot classify the whole diff.`,
    });
  }
  const reviewInputs = await collectIndependentReviewInputs({ github, owner, repo, prNumber: pr.number });
  if (reviewerRequestsProtected({ ...reviewInputs, trustedReviewers })) {
    classification.class = 'Protected';
    classification.reasons.push({ file: '<review>', rule: 'reviewer-escalation', detail: 'A trusted reviewer posted RISK-CLASS: PROTECTED.' });
  }
  return { mode, classification, reviewInputs, trustedReviewers };
}

/** Independent Review verdict for a loaded lean policy. */
function evaluatePolicyReview({ policy, pr }) {
  const inputs = policy.reviewInputs || {};
  return evaluateIndependentReview({
    reviews: inputs.reviews,
    threads: inputs.threads,
    comments: inputs.comments,
    headSha: pr && pr.head && pr.head.sha,
    prAuthorLogin: pr && pr.user && pr.user.login,
    lastPusherLogin: inputs.lastPusherLogin,
    trustedReviewers: policy.trustedReviewers,
  });
}

/**
 * Head-bound CODEOWNER approval, using the SAME validator the legacy T1 path
 * uses (merge-gate-verdict.cjs): a pm-verdict/v1 APPROVED from an authorized
 * non-bot, bound to this PR and exact head. Returns { errors: [...] }.
 */
async function validateHeadBoundApproval({ github, owner, repo, prNumber, headSha, authorizedReviewers }) {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- CommonJS module loaded by github-script
  const { parseVerdict, validateT1Verdicts } = require('./merge-gate-verdict.cjs');
  const comments = await github.paginate(github.rest.issues.listComments, {
    owner, repo, issue_number: prNumber, per_page: 100,
  });
  const verdicts = comments
    .map(comment => ({
      user: comment.user && comment.user.login,
      userType: comment.user && comment.user.type,
      parsed: parseVerdict(comment.body),
      createdAt: comment.created_at,
      htmlUrl: comment.html_url,
    }))
    .filter(verdict => verdict.parsed !== null);
  const errors = validateT1Verdicts(verdicts, {
    prNumber,
    headSha,
    authorizedReviewers: new Set(authorizedReviewers && authorizedReviewers.length ? authorizedReviewers : AUTHORIZED_REVIEWERS_DEFAULT),
  });
  return { errors: Array.from(errors) };
}

module.exports = {
  OPERATING_MODULE_PATH,
  parseCodexState,
  scanTestContent,
  TRUSTED_REVIEWER_LOGINS_DEFAULT,
  AUTHORIZED_REVIEWERS_DEFAULT,
  UI_COMPONENT_DIRS,
  STANDARD_RULES,
  resolveOperatingMode,
  standardRuleFor,
  isTierCPath,
  TIER_C_EXACT_PATHS,
  TIER_C_PATH_PREFIXES,
  TIER_C_PATH_PATTERNS,
  sensitivePathWord,
  scanUiContent,
  needsHeadContent,
  classifyRisk,
  evaluateIndependentReview,
  reviewerRequestsProtected,
  isTrustedReviewerEscalation,
  isTrustedReviewerArtifact,
  isTrustedReviewerFinding,
  evaluateLeanGate,
  collectIndependentReviewInputs,
  loadPullRequestPolicy,
  evaluatePolicyReview,
  validateHeadBoundApproval,
};
