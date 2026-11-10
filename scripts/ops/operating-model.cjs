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
//     LEAN_MODE_ACTIVATED_AT is a valid timestamp (two keys). Mode is global and
//     evaluated on every run: setting OPERATING_MODEL to anything else returns
//     every unmerged PR to the legacy gate immediately (emergency stop).
//   - Classification is an ALLOW-LIST. A file is Standard only if it matches a
//     named Standard rule and passes that rule's content checks. Everything
//     else - unknown paths, generated files, snapshots, governance docs, agent
//     instructions, nested app code - is Protected. Fail-closed by construction.
//   - Escalation only goes up. A trusted reviewer's RISK-CLASS: PROTECTED line
//     anywhere on the PR is sticky.
//   - Independent Review passes only on a TRUSTED reviewer pass bound to the
//     exact head that is newer than every P0/P1 finding ever raised on the PR.
//     Resolving a thread, dismissing a review or editing a bot comment never
//     clears a finding by itself.

const TRUSTED_REVIEWER_LOGINS_DEFAULT = Object.freeze(['chatgpt-codex-connector[bot]']);
const AUTHORIZED_REVIEWERS_DEFAULT = Object.freeze(['griff843']);
const OPERATING_MODULE_PATH = 'scripts/ops/operating-model.cjs';

// ── Operating mode ─────────────────────────────────────────────────────────

function parseTime(value) {
  if (typeof value !== 'string' || value.trim() === '') return null;
  const ms = Date.parse(value.trim());
  return Number.isFinite(ms) ? ms : null;
}

/**
 * Decide whether PRs are evaluated under the lean model or the legacy model.
 *
 * Global, not per PR: rollback (OPERATING_MODEL != lean) immediately returns
 * every unmerged PR - including ones opened while lean was active - to the
 * legacy gate, which they cannot satisfy without legacy artifacts. That is the
 * intended emergency stop. Anything malformed resolves to legacy.
 */
function resolveOperatingMode({ flag, activatedAt } = {}) {
  const normalizedFlag = typeof flag === 'string' ? flag.trim().toLowerCase() : '';
  if (normalizedFlag !== 'lean') {
    return { mode: 'legacy', reason: 'OPERATING_MODEL is not "lean"; legacy controls apply to every PR.' };
  }
  if (parseTime(activatedAt) === null) {
    return { mode: 'legacy', reason: 'LEAN_MODE_ACTIVATED_AT is unset or invalid; lean mode is not armed (fail-closed).' };
  }
  return { mode: 'lean', reason: 'OPERATING_MODEL=lean and LEAN_MODE_ACTIVATED_AT is set.' };
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
  /(?:CONTRACT|POLICY|SPEC|AUTHORITY|RUNBOOK|CODEOWNERS|STANDING|INVARIANT|CHARTER|READINESS)/u,
  /(?:^|\/)intent\.md$/iu,
  /(?:^|\/)(?:CLAUDE|AGENTS)\.md$/iu,
];

// UI-only component directories. Files here are Standard only when their full
// head content imports nothing outside the component tree and carries no
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

function standardRuleFor(filePath) {
  const name = normalizePath(filePath);
  if (!name || name.includes('..')) return null;
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
const UI_FORBIDDEN = /(?:\bfetch\s*\(|['"]use server['"]|\bsupabase\b|\bcreateClient\b|next-auth|\bsign(?:In|Out)\s*\(|process\.env|import\.meta\.env|\.rpc\s*\(|\.from\s*\(|\.(?:insert|upsert|update|delete)\s*\(|dangerouslySetInnerHTML|\beval\s*\(|\bnew\s+Function\b|XMLHttpRequest|WebSocket|EventSource|sendBeacon|document\.cookie|localStorage|sessionStorage|\bformAction\b|\baction\s*=\s*\{|<form\b|\baxios\b|\buseMutation\b|\bmutate(?:Async)?\s*\(|window\.location\s*=|\bwindow\.open\s*\()/u;
const UI_ALLOWED_IMPORTS = /^(?:react|react-dom|next\/link|next\/image|next\/navigation|next\/dynamic|next-themes|clsx|classnames|lucide-react|class-variance-authority|tailwind-merge|framer-motion|recharts|@radix-ui\/[a-z0-9-]+|@\/components\/[A-Za-z0-9_./-]+|@\/lib\/(?:types|utils|cn|format|formatters|site-config))$/u;
const IMPORT_SPECIFIERS = /(?:\bfrom\s*['"]([^'"]+)['"]|\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)|\bimport\s+['"]([^'"]+)['"]|\brequire\s*\(\s*['"]([^'"]+)['"]\s*\))/gu;
const DYNAMIC_LOAD = /(?:\bimport\s*\(\s*[^'"\s)]|\brequire\s*\(\s*[^'"\s)])/u;

function posixDirname(p) {
  const index = p.lastIndexOf('/');
  return index < 0 ? '' : p.slice(0, index);
}

function resolveRelative(fromFile, specifier) {
  const parts = posixDirname(fromFile).split('/').filter(Boolean);
  for (const segment of specifier.split('/')) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..') {
      if (parts.length === 0) return null;
      parts.pop();
    } else parts.push(segment);
  }
  return parts.join('/');
}

/** Returns a list of problems with a UI component's full head content. */
function scanUiContent(fileName, content) {
  const problems = [];
  const root = UI_COMPONENT_DIRS.find(dir => fileName.startsWith(dir));
  if (UI_FORBIDDEN.test(content)) {
    const match = content.match(UI_FORBIDDEN);
    problems.push(`capability marker \`${match && match[0]}\``);
  }
  if (DYNAMIC_LOAD.test(content)) problems.push('non-literal import()/require()');
  for (const match of content.matchAll(IMPORT_SPECIFIERS)) {
    const specifier = match[1] || match[2] || match[3] || match[4];
    if (!specifier) continue;
    if (specifier.startsWith('.')) {
      const resolved = resolveRelative(fileName, specifier);
      if (!resolved || !root || !(`${resolved}/`.startsWith(root) || resolved.startsWith(root))) {
        problems.push(`relative import outside the component tree \`${specifier}\``);
      }
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
      protect(name, 'not-standard-path', word
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
      if (status === 'renamed' || status === 'copied') {
        protect(name, 'test-renamed', 'Renamed/copied test files are not add-only.');
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

const P0_P1_FINDING = /(?:!\[P[01][^\]]*\]|\bP[01]\b\s*(?:Badge|:|-|\])|\[P[01]\]|\bP[01]\s+(?:finding|issue|bug|blocker)\b)/iu;
const RISK_CLASS_PROTECTED_LINE = /^\s*RISK-CLASS:\s*PROTECTED\s*$/imu;
const CODEX_STATE_MARKER = 'codex-review-state:v1';

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

function parseCodexState(body) {
  const text = String(body || '');
  const index = text.indexOf(CODEX_STATE_MARKER);
  if (index < 0) return null;
  const start = text.indexOf('{', index);
  const end = text.indexOf('-->', index);
  if (start < 0 || end < 0 || end < start) return null;
  try {
    return JSON.parse(text.slice(start, end).trim());
  } catch {
    return null;
  }
}

/**
 * Evaluate Independent Review from GitHub-trusted artifacts only.
 *
 * reviews:  [{ id|databaseId, user:{login,type} | author:{login,__typename}, commit_id|commit:{oid},
 *              state, body, submitted_at|submittedAt, editor? }]
 * threads:  [{ isResolved, comments:[{ author:{login,__typename}, body, createdAt, editor?,
 *              pullRequestReview?:{ databaseId, submittedAt } }] }]
 * comments: issue comments [{ user|author, body, updated_at|updatedAt, editor? }] - only the
 *           connector's codex-review-state:v1 summary is read.
 *
 * PASS requires a head-bound clean pass P from a trusted bot (a review at the
 * head with no P0/P1 of its own, or the connector summary reporting a completed
 * review of the head with has_any_findings=false) such that:
 *   - no P0/P1 thread is unresolved;
 *   - every P0/P1 finding ever raised (thread or review body, any head, any
 *     state including dismissed, resolved or not) predates P and is not part of P;
 *   - no trusted artifact was edited by a non-trusted account.
 * Everything else fails closed.
 */
function evaluateIndependentReview({ reviews, threads, comments, headSha, prAuthorLogin, lastPusherLogin, trustedReviewers } = {}) {
  const trusted = trustedSet(trustedReviewers);
  const implementers = new Set([prAuthorLogin, lastPusherLogin].filter(Boolean).map(normLogin));
  const reasons = [];
  if (!headSha) {
    return { pass: false, reasons: ['Head SHA is unavailable; cannot bind a review to it.'], reviewers: [] };
  }
  const isTrustedActor = node => actorIsBot(node) && trusted.has(normLogin(actorLogin(node))) && !implementers.has(normLogin(actorLogin(node)));

  const reviewRows = (Array.isArray(reviews) ? reviews : []).filter(Boolean).map(review => ({
    raw: review,
    id: review.databaseId !== undefined ? review.databaseId : review.id,
    commit: review.commit_id || (review.commit && review.commit.oid) || null,
    state: String(review.state || ''),
    body: String(review.body || ''),
    time: parseTime(review.submitted_at || review.submittedAt),
    trustedActor: isTrustedActor(review),
    tampered: editedByOther(review, trusted),
  }));
  const reviewTime = new Map(reviewRows.filter(row => row.id !== undefined && row.id !== null).map(row => [String(row.id), row.time]));

  const findings = [];
  let unresolved = 0;
  for (const row of reviewRows) {
    if (!row.trustedActor) continue;
    if (row.tampered) {
      findings.push({ source: 'review-body-edited', reviewId: row.id, time: Infinity });
    } else if (P0_P1_FINDING.test(row.body) || row.state === 'CHANGES_REQUESTED') {
      findings.push({ source: 'review-body', reviewId: row.id, time: row.time === null ? Infinity : row.time });
    }
  }
  for (const thread of Array.isArray(threads) ? threads : []) {
    const first = thread && Array.isArray(thread.comments) ? thread.comments[0] : null;
    if (!first || !trusted.has(normLogin(actorLogin(first)))) continue;
    const tampered = editedByOther(first, trusted);
    if (!tampered && !P0_P1_FINDING.test(String(first.body || ''))) continue;
    const reviewId = first.pullRequestReview ? first.pullRequestReview.databaseId : undefined;
    const time = reviewId !== undefined && reviewTime.has(String(reviewId))
      ? reviewTime.get(String(reviewId))
      : parseTime(first.pullRequestReview && first.pullRequestReview.submittedAt) ?? parseTime(first.createdAt);
    findings.push({ source: tampered ? 'thread-edited' : 'thread', reviewId, time: tampered || time === null ? Infinity : time });
    if (!thread.isResolved) unresolved += 1;
  }

  const findingReviewIds = new Set(findings.map(finding => String(finding.reviewId)).filter(id => id !== 'undefined'));
  const passes = [];
  for (const row of reviewRows) {
    if (!row.trustedActor || row.tampered || row.commit !== headSha || row.time === null) continue;
    if (row.state !== 'COMMENTED' && row.state !== 'APPROVED') continue;
    if (P0_P1_FINDING.test(row.body) || findingReviewIds.has(String(row.id))) continue;
    passes.push({ kind: 'review', reviewId: row.id, time: row.time, login: normLogin(actorLogin(row.raw)) });
  }
  for (const comment of Array.isArray(comments) ? comments : []) {
    if (!comment || !isTrustedActor(comment)) continue;
    const state = parseCodexState(comment.body);
    if (!state) continue;
    const code = state.code_review || {};
    if (editedByOther(comment, trusted)) {
      findings.push({ source: 'summary-edited', time: Infinity });
      continue;
    }
    if (code.commit_sha !== headSha) continue;
    if (code.has_unresolved_findings === true) {
      reasons.push('The connector summary reports unresolved findings at the current head.');
    }
    const time = parseTime(comment.updatedAt || comment.updated_at);
    if (code.status === 'completed' && code.has_any_findings === false && time !== null) {
      passes.push({ kind: 'summary', reviewId: undefined, time, login: normLogin(actorLogin(comment)) });
    }
  }

  if (unresolved > 0) reasons.push(`${unresolved} unresolved P0/P1 finding thread(s) from a trusted reviewer remain.`);

  const latest = passes.reduce((best, candidate) => (!best || candidate.time > best.time ? candidate : best), null);
  if (!latest) {
    reasons.push(`No clean pass by a trusted reviewer identity (${[...trusted].join(', ')}) is bound to the current head ${headSha.slice(0, 12)}. Request one with an "@codex review" comment; the connector's review or summary reruns this check.`);
  } else {
    const stale = findings.filter(finding => !(finding.time < latest.time) || (finding.reviewId !== undefined && String(finding.reviewId) === String(latest.reviewId)));
    if (stale.length > 0) {
      reasons.push(`${stale.length} P0/P1 finding(s) (or edited trusted artifacts) are not followed by a later clean trusted review of the current head; resolving a thread does not clear it.`);
    }
  }

  return { pass: reasons.length === 0, reasons, reviewers: [...new Set(passes.map(pass => pass.login))] };
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
  return nodes.some(node => node && trusted.has(normLogin(actorLogin(node))) && RISK_CLASS_PROTECTED_LINE.test(String(node.body || '')));
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
              nodes { body createdAt author { __typename login } editor { login } pullRequestReview { databaseId submittedAt } }
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

/** Collect the GitHub-trusted artifacts Independent Review and escalation read. */
async function collectIndependentReviewInputs({ github, owner, repo, prNumber }) {
  const variables = { owner, repo, number: prNumber };
  const reviews = await graphqlConnection(github, REVIEWS_QUERY, variables);
  const rawThreads = await graphqlConnection(github, REVIEW_THREADS_QUERY, variables);
  const comments = await graphqlConnection(github, ISSUE_COMMENTS_QUERY, variables);
  const threads = rawThreads.map(node => ({ isResolved: node.isResolved, comments: (node.comments && node.comments.nodes) || [] }));

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
  TRUSTED_REVIEWER_LOGINS_DEFAULT,
  AUTHORIZED_REVIEWERS_DEFAULT,
  UI_COMPONENT_DIRS,
  STANDARD_RULES,
  resolveOperatingMode,
  standardRuleFor,
  sensitivePathWord,
  scanUiContent,
  needsHeadContent,
  classifyRisk,
  evaluateIndependentReview,
  reviewerRequestsProtected,
  evaluateLeanGate,
  collectIndependentReviewInputs,
  loadPullRequestPolicy,
  evaluatePolicyReview,
  validateHeadBoundApproval,
};
