import fs from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import {
  CANONICAL_PRODUCTION_SUPABASE_PROJECT_REF,
  extractProjectRefFromUrl,
} from '@unit-talk/db/target-identity';
import { assertStagingTarget } from '../ci/assert-staging-target.js';
import { validateExecutionCwd } from './lane-execution.js';
import {
  ROOT,
  emitJson,
  parseArgs,
  readManifest,
  type LaneManifest,
} from './shared.js';

export interface ExecutionPacket {
  issue_id: string;
  title: string;
  project: string;
  tier: string;
  lane_type: string;
  branch: string;
  execution_location: string;
  cwd: string;
  cwd_guard_command: string;
  worktree_entrypoint: string;
  dependency_setup: {
    package_install: string;
    setup_command: string | null;
    main_checkout_control_only: boolean;
  };
  allowed_file_scope: string[];
  tier_c_warnings: string[];
  blockers: string[];
  task_contract: TaskContract;
  required_verification: string[];
  verification_plan?: VerificationPlan;
  expected_proof_paths: string[];
  closeout_instructions: string[];
  repo_brief: string;
  source_of_truth: {
    linear_url: string;
    branch: string;
    manifest_path: string;
  };
  generated_at: string;
}

export interface LinearTaskSource {
  identifier: string;
  title: string;
  url: string;
  description: string;
}

/**
 * How each part of the contract was obtained. Recorded so a reader can tell a
 * criterion lifted from an explicit `## Acceptance Criteria` heading from one
 * derived structurally out of a legacy description (UTV2-1732 R2). Both are
 * real issue content; they differ in how confidently they were labelled.
 */
export interface TaskContractExtraction {
  objective_source: 'heading:objective' | 'issue-title';
  acceptance_source:
    | 'heading:acceptance-criteria'
    | 'heading:exit-criteria'
    | 'heading:required-outcome'
    | 'derived:description-obligations';
}

export interface TaskContract {
  schema_version: 1;
  issue_id: string;
  objective: string;
  extraction: TaskContractExtraction;
  acceptance_criteria: string[];
  guardrails: string[];
  non_goals: string[];
  required_evidence: string[];
  exit_criteria: string[];
  source: {
    kind: 'linear-issue-snapshot';
    issue_url: string;
    title: string;
    description: string;
    captured_at: string;
    description_sha256: string;
  };
  contract_hash: string;
}

export interface VerificationPlan {
  mode: 'static-only' | 'writable-isolated' | 'production-read-only';
  static_command: 'pnpm verify:static';
  focused_test_command: string;
  live_db_status: 'authorized-isolated' | 'blocked-deferred' | 'read-only-only';
  writable_live_db_command: string | null;
  production_read_only_guard_command: string | null;
  reason: string;
}

const TEST_TIMESTAMP = '2000-01-01T00:00:00.000Z';

const EXECUTION_LOCATION_MAP: Record<string, string> = {
  claude: 'Claude Code (interactive)',
  'codex-cli': 'Codex CLI (autonomous)',
  'codex-cloud': 'Codex Cloud (autonomous)',
};

const TIER_VERIFICATION_MAP: Record<string, string[]> = {
  T1: ['type-check', 'test', 'test:db', 'runtime-proof', 'evidence-bundle'],
  T2: ['type-check', 'test', 'issue-specific verification'],
  T3: ['type-check', 'test'],
};

export function generateExecutionPacket(
  manifest: LaneManifest,
  env: NodeJS.ProcessEnv = process.env,
  suppliedTaskContract?: TaskContract,
): ExecutionPacket {
  const issueId = manifest.issue_id;
  const tier = manifest.tier ?? 'unknown';
  const expectedProofPaths = manifest.expected_proof_paths ?? [];
  const verificationPlan = buildVerificationPlan(manifest, env);
  const taskContract = suppliedTaskContract ?? readTaskContract(issueId);
  assertTaskContract(taskContract, issueId);
  if (manifest.task_packet_hash && manifest.task_packet_hash !== taskContract.contract_hash) {
    throw new Error(
      `task contract hash does not match manifest task_packet_hash for ${issueId}; refusing mutable work-order drift`,
    );
  }

  return {
    issue_id: issueId,
    title: issueId,
    project: 'Unit Talk V2',
    tier,
    lane_type: manifest.lane_type ?? 'unknown',
    branch: manifest.branch,
    execution_location: deriveExecutionLocation(manifest.executor),
    cwd: manifest.execution_location?.cwd ?? manifest.worktree_path,
    cwd_guard_command: `cd "${manifest.execution_location?.cwd ?? manifest.worktree_path}"`,
    worktree_entrypoint: `cd "${manifest.execution_location?.cwd ?? manifest.worktree_path}" && pnpm install --frozen-lockfile`,
    dependency_setup: {
      package_install:
        manifest.execution_location?.package_install ?? 'required',
      setup_command:
        manifest.execution_location?.setup_command ??
        'pnpm install --frozen-lockfile',
      main_checkout_control_only:
        manifest.execution_location?.main_checkout_control_only ?? true,
    },
    allowed_file_scope: [...(manifest.file_scope_lock ?? [])],
    tier_c_warnings: collectTierCWarnings(manifest.file_scope_lock ?? []),
    blockers: [...(manifest.blocked_by ?? [])],
    task_contract: taskContract,
    required_verification: buildRequiredVerification(tier, expectedProofPaths),
    verification_plan: verificationPlan,
    expected_proof_paths: [...expectedProofPaths],
    closeout_instructions: buildCloseoutInstructions(
      issueId,
      tier,
      verificationPlan,
    ),
    repo_brief: loadRepoBrief(),
    source_of_truth: {
      linear_url: `https://linear.app/unit-talk-v2/issue/${issueId}`,
      branch: manifest.branch,
      manifest_path: `docs/06_status/lanes/${issueId}.json`,
    },
    generated_at: packetTimestamp(),
  };
}

function normalizeHeading(value: string): string {
  return value.trim().toLowerCase().replaceAll(/[^a-z0-9]+/g, ' ').trim();
}

/**
 * One markdown scanner shared by both extraction paths.
 *
 * Heading detection and fence tracking previously lived only in the derived
 * path, so `## Acceptance Criteria` — the path most issues actually use — still
 * ingested fenced code-block bodies, and a `#` comment inside a fence was read
 * as a heading and silently TERMINATED the section, dropping every criterion
 * after it. A silently truncated work order is the failure this lane exists to
 * eliminate, so both paths now walk the document through here.
 *
 * Emits one record per content line, already annotated with the section it
 * belongs to and whether it sits inside a fence.
 */
interface ScannedLine {
  text: string;
  heading: string | null;
  isListItem: boolean;
  listBody: string;
  indent: number;
  isHeading: boolean;
  headingDepth?: number;
}

function scanMarkdown(markdown: string): ScannedLine[] {
  const lines = markdown.split(/\r?\n/);
  const out: ScannedLine[] = [];
  let fenceChar: string | null = null;
  let fenceLen = 0;
  let fenceOpenedAt = -1;
  let htmlBlock = false;
  let htmlTag = '';
  let heading: string | null = null;
  let lastWasListItem = false;
  let lastWasParagraph = false;
  let headingDepth = 0;

  for (let i = 0; i < lines.length; i += 1) {
    const raw = lines[i] ?? '';
    const line = raw.trim();
    const indent = raw.length - raw.trimStart().length;

    // ── fences ──────────────────────────────────────────────────────────────
    // Closing requires the SAME character and a run at least as long as the
    // opener. Tracking only the character let a ``` close a ```` fence, which
    // reopened the document mid-code-block: junk was ingested and everything
    // after was dropped.
    const fenceMatch = /^(`{3,}|~{3,})/u.exec(line);
    if (fenceMatch) {
      const marker = fenceMatch[1] ?? '';
      const char = marker[0] ?? '';
      const len = marker.length;
      if (fenceChar === null) {
        fenceChar = char;
        fenceLen = len;
        fenceOpenedAt = i + 1;
      } else if (char === fenceChar && len >= fenceLen) {
        fenceChar = null;
        fenceLen = 0;
        fenceOpenedAt = -1;
      }
      continue;
    }
    if (fenceChar !== null) continue;

    // ── HTML blocks ─────────────────────────────────────────────────────────
    // A `## heading` inside <details> is markup, not a section boundary.
    // Treating it as one terminated the section and dropped every criterion
    // after it.
    if (!htmlBlock) {
      const open = /^<([a-zA-Z][\w-]*)(?:\s[^>]*)?>/u.exec(line);
      // Paired block tags are tracked to their closing tag, NOT to the next
      // blank line. CommonMark ends an HTML block at a blank line, which makes
      // a `## heading` inside <details> a real heading — it then terminates the
      // surrounding section and silently orphans every criterion after the
      // block. For a work order, losing a criterion is worse than being
      // slightly stricter than CommonMark.
      if (open && !/^<!--/u.test(line)) {
        htmlBlock = true;
        htmlTag = (open[1] ?? '').toLowerCase();
      }
    }
    if (htmlBlock) {
      if (new RegExp(`^</${htmlTag}\\s*>`, 'iu').test(line)) {
        htmlBlock = false;
        htmlTag = '';
      }
      continue;
    }
    if (/^<!--/u.test(line)) continue;

    // ── indented code ───────────────────────────────────────────────────────
    // Four-space blocks are code unless they continue a list item.
    const isListItem = /^(?:[-*+] |\d+[.)]\s+)/u.test(line);
    if (indent >= 4 && !isListItem && !lastWasParagraph) continue;

    // ── headings ────────────────────────────────────────────────────────────
    const atx = /^#{1,6}\s+(.+?)\s*$/u.exec(line);
    if (atx) {
      heading = (atx[1] ?? '').replace(/[*_`]/gu, '').trim();
      headingDepth = (/^(#{1,6})/u.exec(line)?.[1] ?? '#').length;
      lastWasParagraph = false;
      out.push({ text: '', heading, isListItem: false, listBody: '', indent: 0, isHeading: true, headingDepth });
      continue;
    }
    // Setext only promotes a PARAGRAPH line. A `---` after a list item is a
    // thematic break; treating it as an underline consumed the item.
    const next = (lines[i + 1] ?? '').trim();
    // Setext underlines a paragraph line. Requiring a PRECEDING paragraph was
    // too strict — a setext heading opening a document has none — while
    // allowing it after a list item made `---` swallow the last item. The right
    // guard is: this line is not a list item, and neither was the one before.
    if (line && !isListItem && !lastWasListItem && /^(?:={2,}|-{2,})$/u.test(next)) {
      heading = line.replace(/[*_`]/gu, '').trim();
      headingDepth = next.startsWith('=') ? 1 : 2;
      lastWasParagraph = false;
      i += 1;
      out.push({ text: '', heading, isListItem: false, listBody: '', indent: 0, isHeading: true, headingDepth });
      continue;
    }
    if (!line || /^(?:-{3,}|={3,}|\*{3,})$/u.test(line)) {
      lastWasParagraph = false;
      lastWasListItem = false;
      out.push({ text: '', heading, isListItem: false, listBody: '', indent, isHeading: false, headingDepth });
      continue;
    }

    const listMatch = /^(?:[-*+] |\d+[.)]\s+)(?:\[[ xX]\]\s*)?(.*)$/u.exec(line);
    lastWasParagraph = !listMatch;
    lastWasListItem = Boolean(listMatch);
    out.push({
      text: line,
      heading,
      isListItem: Boolean(listMatch),
      listBody: (listMatch?.[1] ?? '').trim(),
      indent,
      isHeading: false,
      headingDepth,
    });
  }

  // An unterminated fence silently swallows the rest of the document. Refusing
  // is the only safe outcome: a truncated work order is indistinguishable from
  // a complete one to the executor that receives it.
  if (fenceChar !== null) {
    throw new Error(
      `unterminated code fence opened at line ${fenceOpenedAt}; ` +
        'refusing to derive a task contract from a document that cannot be parsed unambiguously',
    );
  }
  return out;
}

/**
 * Collect items from named sections.
 *
 * A list item may wrap onto following lines, and a nested item under a parent
 * ending in `:` belongs to that parent — flattening `- Do not:` and
 * `  - delete the outbox table` into two independent criteria inverts the
 * second one's meaning.
 */
function collectItems(lines: ScannedLine[], accept: (line: ScannedLine) => boolean): string[] {
  const items: string[] = [];
  let paragraph: string[] = [];
  let current: { text: string; indent: number } | null = null;

  const flushParagraph = (): void => {
    const value = paragraph.join(' ').replace(/\s+/gu, ' ').trim();
    paragraph = [];
    if (value && !NON_PROSE.test(value)) items.push(value);
  };
  const flushItem = (): void => {
    if (current && current.text.trim()) items.push(current.text.replace(/\s+/gu, ' ').trim());
    current = null;
  };

  for (const line of lines) {
    if (line.isHeading || !accept(line)) {
      flushParagraph();
      flushItem();
      continue;
    }
    if (!line.text) {
      flushParagraph();
      flushItem();
      continue;
    }
    if (NON_PROSE.test(line.text)) {
      // A table row or a quoted aside ends the current thought rather than
      // merging into it — a "> note: NOT a requirement" must never be glued
      // onto a real criterion.
      flushParagraph();
      flushItem();
      continue;
    }
    if (line.isListItem) {
      flushParagraph();
      if (current && line.indent > current.indent && /:$/u.test(current.text.trim())) {
        current.text = `${current.text} ${line.listBody}`;
        continue;
      }
      flushItem();
      current = { text: line.listBody, indent: line.indent };
      continue;
    }
    if (current && line.indent > current.indent) {
      current.text = `${current.text} ${line.text}`; // wrapped continuation
      continue;
    }
    flushItem();
    paragraph.push(line.text);
  }
  flushParagraph();
  flushItem();
  return items.filter(Boolean);
}

function sectionItems(markdown: string, headings: string[]): string[] {
  const wanted = new Set(headings.map(normalizeHeading));
  return collectItems(
    scanMarkdown(markdown),
    (line) => Boolean(line.heading) && wanted.has(normalizeHeading(line.heading ?? '')),
  );
}

function sectionBody(markdown: string, headings: string[]): string {
  const wanted = new Set(headings.map(normalizeHeading));
  return scanMarkdown(markdown)
    .filter((line) => !line.isHeading && line.heading && wanted.has(normalizeHeading(line.heading)))
    .map((line) => line.text)
    .filter(Boolean)
    .join('\n')
    .trim();
}

/**
 * Layout and commentary, never obligations: table rows, HTML comments,
 * thematic breaks, and blockquotes. A blockquote is an aside about the work and
 * frequently contains an obligation verb while asserting the opposite of a
 * requirement.
 */
const NON_PROSE = /^(?:\||<!--|>|-{3,}$|={3,}$)/u;
const EXCLUDED_SECTION =
  /^(?:explicitly\s+)?(?:excluded|out of scope|non[- ]goals?|scope\s*[—-]\s*excluded|also excluded)\b/iu;
const METADATA_SECTION =
  /^(?:ownership|authority|review budget|sequencing|provenance|tier|links?|references?|reviewers?)\b/iu;
const OBLIGATION =
  /\b(?:must|must not|shall|required|require[sd]?|cannot|may not|do not|never|ensure|verify|prove)\b/iu;
const REFERENCE_ONLY =
  /^(?:\[[^\]]*\]\([^)]*\)|@[\w-]+|UTV2-\d+|https?:\/\/\S+)[.,;]?$/iu;
const CODE_FRAGMENT = /^[`~]|[;{}]\s*$|^(?:const|let|var|function|import|export|return)\s/u;

/**
 * Requirement-bearing lines from the WHOLE description, for issues that predate
 * the heading convention.
 *
 * Exclusion skipping is genuinely sticky: `scanMarkdown` reports heading depth,
 * so `### Also excluded` under `## Explicitly EXCLUDED` stays skipped. An
 * earlier version computed stickiness from the new heading's own text, which
 * made it always false and promoted exclusions into acceptance — inverting
 * their meaning, which is exactly what the comment claimed could not happen.
 */
function deriveRequirementLines(markdown: string): string[] {
  const scanned = scanMarkdown(markdown);
  const skipped = new Set<string>();
  let excludedDepth: number | null = null;
  for (const line of scanned) {
    if (!line.isHeading || !line.heading) continue;
    const depth = line.headingDepth ?? 1;
    if (excludedDepth !== null && depth > excludedDepth) {
      // Deeper than the excluded heading: still inside it.
      skipped.add(line.heading);
      continue;
    }
    excludedDepth = null;
    if (EXCLUDED_SECTION.test(line.heading) || METADATA_SECTION.test(line.heading)) {
      skipped.add(line.heading);
      excludedDepth = depth;
    }
  }

  const items = collectItems(scanned, (line) => !line.heading || !skipped.has(line.heading));
  const derived: string[] = [];
  for (const value of items) {
    if (!OBLIGATION.test(value)) continue;
    const bare = value.replace(/[*_`]/gu, '').trim();
    if (!bare || REFERENCE_ONLY.test(bare) || CODE_FRAGMENT.test(value) || NON_PROSE.test(value)) continue;
    if (/^[A-Z][\w .-]{0,28}:\s/u.test(bare) && !OBLIGATION.test(bare.split(':').slice(1).join(':'))) continue;
    if (!derived.includes(value)) derived.push(value);
  }
  return derived;
}

function taskContractHash(contract: Omit<TaskContract, 'contract_hash'>): string {
  return createHash('sha256').update(JSON.stringify(contract)).digest('hex');
}

export function buildTaskContract(
  source: LinearTaskSource,
  expectedProofPaths: string[] = [],
  capturedAt = packetTimestamp(),
): TaskContract {
  const issueId = source.identifier.trim().toUpperCase();
  const description = source.description.trim();
  const objectiveSection = sectionBody(description, ['objective', 'required outcome']);
  const objective = objectiveSection || source.title.trim();
  const acceptanceCriteria = sectionItems(description, ['acceptance criteria', 'acceptance criterion']);
  const exitCriteria = sectionItems(description, ['exit criteria']);
  const requiredOutcome = sectionItems(description, ['required outcome']);
  const headingAcceptance = acceptanceCriteria.length > 0
    ? acceptanceCriteria
    : exitCriteria.length > 0
      ? exitCriteria
      : requiredOutcome;

  // UTV2-1732 R2: heading conventions are optional. When none matched, derive
  // the obligations structurally from the description rather than refusing a
  // lane whose issue predates the convention.
  const derivedAcceptance = headingAcceptance.length > 0 ? [] : deriveRequirementLines(description);
  const effectiveAcceptance = headingAcceptance.length > 0 ? headingAcceptance : derivedAcceptance;

  const acceptanceSource: TaskContractExtraction['acceptance_source'] =
    acceptanceCriteria.length > 0
      ? 'heading:acceptance-criteria'
      : exitCriteria.length > 0
        ? 'heading:exit-criteria'
        : requiredOutcome.length > 0
          ? 'heading:required-outcome'
          : 'derived:description-obligations';
  const objectiveSource: TaskContractExtraction['objective_source'] =
    objectiveSection ? 'heading:objective' : 'issue-title';

  if (!objective) {
    throw new Error(`task contract for ${issueId || '(unknown issue)'} is missing an objective`);
  }
  // Still fails closed: an issue carrying no obligations anywhere yields nothing
  // to derive, and no executor may be dispatched against an empty work order.
  if (effectiveAcceptance.length === 0) {
    throw new Error(
      `task contract for ${issueId || '(unknown issue)'} is missing acceptance criteria: ` +
        'no acceptance/exit/required-outcome section and no requirement lines in the description',
    );
  }

  const guardrails = sectionItems(description, ['guardrails']);
  const explicitNonGoals = sectionItems(description, ['non goals', 'non-goals', 'out of scope']);
  const nonGoals = explicitNonGoals.length > 0
    ? explicitNonGoals
    : guardrails.filter((entry) => /\b(?:do not|must not|never|no direct)\b/iu.test(entry));
  const explicitEvidence = sectionItems(description, ['required evidence', 'evidence']);
  const requiredEvidence = [
    ...explicitEvidence,
    ...expectedProofPaths.map((proofPath) => `Produce and validate ${proofPath}`),
  ];
  if (requiredEvidence.length === 0) {
    requiredEvidence.push(...effectiveAcceptance.filter((entry) => /\b(?:proofs?|evidence|tests?|reviews?|verif(?:y|ies|ied|ication)|coverage|regression)\b/iu.test(entry)));
  }

  const content: Omit<TaskContract, 'contract_hash'> = {
    schema_version: 1,
    issue_id: issueId,
    objective,
    extraction: { objective_source: objectiveSource, acceptance_source: acceptanceSource },
    acceptance_criteria: effectiveAcceptance,
    guardrails,
    non_goals: nonGoals,
    required_evidence: requiredEvidence,
    exit_criteria: exitCriteria.length > 0 ? exitCriteria : effectiveAcceptance,
    source: {
      kind: 'linear-issue-snapshot',
      issue_url: source.url,
      title: source.title.trim(),
      description,
      captured_at: capturedAt,
      description_sha256: createHash('sha256').update(description).digest('hex'),
    },
  };
  return { ...content, contract_hash: taskContractHash(content) };
}

/**
 * Integrity/drift check — NOT tamper-resistance (UTV2-1732 R5).
 *
 * The hash is re-derived from the same record it validates, so it detects
 * corruption, partial writes, and accidental drift between the sync record and
 * the manifest. It does not defend against a deliberate editor: anyone who can
 * rewrite `.ops/sync/<issue>.yml` can also recompute the hash and update
 * `task_packet_hash`. Executor tampering is bounded by the identity refusal in
 * `recordReworkCorrections` and by review of `.ops/sync/*` in the PR diff, not
 * by this function. Do not describe it as immutable.
 */
export function assertTaskContract(contract: TaskContract, issueId = contract.issue_id): void {
  if (contract.schema_version !== 1 || contract.issue_id !== issueId) {
    throw new Error(`task contract identity mismatch for ${issueId}`);
  }
  if (!contract.objective.trim()) {
    throw new Error(`task contract for ${issueId} is missing an objective`);
  }
  if (!Array.isArray(contract.acceptance_criteria) || contract.acceptance_criteria.length === 0) {
    throw new Error(`task contract for ${issueId} is missing acceptance criteria`);
  }
  // `extraction` became required when provenance was added. A contract stored
  // before that carries none, passes the hash check (the hash was computed over
  // the old shape), and then crashes `renderTaskContract`. Validate it here so
  // the failure lands inside the caller's try/catch as a structured refusal
  // instead of an uncaught TypeError at render time.
  // Every field the renderer dereferences must be validated here, not just the
  // one a reviewer happened to name. `extraction` was validated in isolation
  // while guardrails, non_goals, required_evidence, exit_criteria and source
  // were still dereferenced unchecked — a byte-identical crash one field over.
  for (const field of ['guardrails', 'non_goals', 'required_evidence', 'exit_criteria'] as const) {
    if (!Array.isArray(contract[field])) {
      throw new Error(`task contract for ${issueId} is missing the ${field} array; re-run \`pnpm ops:lane-start\` to recapture it`);
    }
  }
  if (!contract.source || typeof contract.source.issue_url !== 'string' || typeof contract.source.description !== 'string') {
    throw new Error(`task contract for ${issueId} is missing its Linear source snapshot; re-run \`pnpm ops:lane-start\` to recapture it`);
  }
  if (
    !contract.extraction ||
    typeof contract.extraction.objective_source !== 'string' ||
    typeof contract.extraction.acceptance_source !== 'string'
  ) {
    throw new Error(
      `task contract for ${issueId} predates extraction provenance; ` +
        're-run `pnpm ops:lane-start` to recapture it',
    );
  }
  const { contract_hash: contractHash, ...content } = contract;
  if (!/^[0-9a-f]{64}$/iu.test(contractHash) || taskContractHash(content) !== contractHash) {
    throw new Error(`task contract hash verification failed for ${issueId}`);
  }
}

export function buildSyncYmlWithTaskContract(issueId: string, contract: TaskContract): string {
  assertTaskContract(contract, issueId);
  return stringifyYaml({
    version: 1,
    approval: {
      allow_multiple_issues: false,
      skip_sync_required: false,
    },
    entities: {
      issues: [issueId],
      findings: [],
      controls: [],
      proofs: [],
    },
    task_contract: contract,
  });
}

export function readTaskContract(issueId: string, root: string = ROOT): TaskContract {
  const syncPath = path.join(root, '.ops', 'sync', `${issueId}.yml`);
  if (!fs.existsSync(syncPath)) {
    throw new Error(`task contract is absent: sync record not found at ${syncPath}`);
  }
  const parsed = parseYaml(fs.readFileSync(syncPath, 'utf8')) as { task_contract?: TaskContract } | null;
  if (!parsed?.task_contract) {
    throw new Error(`task contract is absent from ${syncPath}; refusing to dispatch an executor without a work order`);
  }
  assertTaskContract(parsed.task_contract, issueId);
  return parsed.task_contract;
}

export function renderTaskContract(contract: TaskContract): string {
  assertTaskContract(contract);
  const render = (values: string[]): string =>
    values.length > 0 ? values.map((value) => `- ${value}`).join('\n') : '- (none declared)';
  return [
    `## Authoritative task contract (integrity hash ${contract.contract_hash})`,
    '',
    'This is your work order. Do not infer the task from the branch name, the',
    'file scope, an existing PR, or the repo brief. If this contract and the',
    'repository disagree, this contract wins. You may not rewrite it.',
    '',
    `Objective source: ${contract.extraction.objective_source}; ` +
      `acceptance source: ${contract.extraction.acceptance_source}.`,
    '',
    '### Objective',
    contract.objective,
    '',
    '### Acceptance criteria',
    render(contract.acceptance_criteria),
    '',
    '### Guardrails',
    render(contract.guardrails),
    '',
    '### Non-goals',
    render(contract.non_goals),
    '',
    '### Required evidence',
    render(contract.required_evidence),
    '',
    '### Exit criteria',
    render(contract.exit_criteria),
    '',
    'The contract above was captured before execution. Do not replace it by inferring from the branch, file scope, PR body, repo brief, or a later Linear query.',
  ].join('\n');
}

function buildVerificationPlan(
  manifest: LaneManifest,
  env: NodeJS.ProcessEnv,
): VerificationPlan {
  const fileScopeLock = manifest.file_scope_lock ?? [];
  const staging = assertStagingTarget(env);

  if (staging.ok) {
    return {
      mode: 'writable-isolated',
      static_command: 'pnpm verify:static',
      focused_test_command: buildFocusedTestCommand(fileScopeLock, true),
      live_db_status: 'authorized-isolated',
      writable_live_db_command:
        'pnpm ci:assert-staging && pnpm test:live-db',
      production_read_only_guard_command: null,
      reason:
        'The configured target passed the non-production identity guard and is authorized for writable live-DB verification.',
    };
  }

  const production = extractProjectRefFromUrl(env['SUPABASE_URL']);
  const productionReadOnly =
    env['UNIT_TALK_DB_ACCESS_MODE'] === 'production-read-only' &&
    production.projectRef === CANONICAL_PRODUCTION_SUPABASE_PROJECT_REF &&
    Boolean(env['SUPABASE_ANON_KEY']) &&
    !env['SUPABASE_SERVICE_ROLE_KEY'];

  if (productionReadOnly) {
    return {
        mode: 'production-read-only',
        static_command: 'pnpm verify:static',
        focused_test_command: buildFocusedTestCommand(fileScopeLock, false),
        live_db_status: 'read-only-only',
        writable_live_db_command: null,
        production_read_only_guard_command:
          'test -n "$SUPABASE_ANON_KEY" && test -z "${SUPABASE_SERVICE_ROLE_KEY:-}"',
        reason:
          'The configured target is canonical production and is authorized only for mechanically classified read-only observation.',
    };
  }

  return {
        mode: 'static-only',
        static_command: 'pnpm verify:static',
        focused_test_command: buildFocusedTestCommand(fileScopeLock, false),
        live_db_status: 'blocked-deferred',
        writable_live_db_command: null,
        production_read_only_guard_command: null,
    reason: `Writable live-DB proof is blocked/deferred: ${staging.reason}`,
  };
}

function buildFocusedTestCommand(
  fileScopeLock: string[],
  includeCredentialedDatabaseTests: boolean,
): string {
  const credentialedDatabaseTests = loadCredentialedDatabaseTests();
  const testPaths = fileScopeLock
    .filter((filePath) => /\.test\.[cm]?[jt]sx?$/u.test(filePath))
    .filter(
      (filePath) =>
        includeCredentialedDatabaseTests ||
        !credentialedDatabaseTests.has(filePath),
    )
    .sort();
  if (testPaths.length === 0) {
    return 'Run the issue-specific focused test command declared by the lane';
  }
  return `pnpm exec tsx --test ${testPaths.map(shellQuote).join(' ')}`;
}

function loadCredentialedDatabaseTests(): Set<string> {
  const inventoryPath = path.join(
    ROOT,
    'docs',
    '05_operations',
    'db-writer-classification.json',
  );
  const inventory = JSON.parse(fs.readFileSync(inventoryPath, 'utf8')) as {
    credentialed_tests?: Array<{ path?: string }>;
  };
  if (!Array.isArray(inventory.credentialed_tests)) {
    throw new Error(
      'DB writer classification is missing credentialed_tests; refusing to generate an unsafe focused-test command',
    );
  }
  return new Set(
    inventory.credentialed_tests
      .map((entry) => entry.path)
      .filter((entry): entry is string => Boolean(entry)),
  );
}

function buildCloseoutInstructions(
  issueId: string,
  tier: string,
  verificationPlan: VerificationPlan,
): string[] {
  const instructions = [
    `Run static verification: ${verificationPlan.static_command}`,
    `Run focused issue tests: ${verificationPlan.focused_test_command}`,
  ];

  if (verificationPlan.mode === 'writable-isolated') {
    instructions.push(
      `Run guarded isolated writable verification: ${verificationPlan.writable_live_db_command}`,
    );
  } else if (verificationPlan.mode === 'production-read-only') {
    instructions.push(
      `Run the production read-only identity preflight: ${verificationPlan.production_read_only_guard_command}`,
      'Run only explicitly classified production-read-only observations; writable live-DB proof remains blocked/deferred.',
    );
  } else {
    instructions.push(
      `Record writable live-DB proof as blocked/deferred: ${verificationPlan.reason}`,
    );
  }

  instructions.push(
    'Run npx tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD',
    `Open PR with title matching feat(ops): ${issueId} description`,
    `Apply tier label: gh pr edit <PR-number> --add-label tier:${tier}`,
    `After merge, run pnpm ops:lane-finalize -- --issue ${issueId} --pr <PR-number-or-url> --json`,
    'Run pnpm ops:orchestration-reconcile --current --json after closeout',
  );

  return instructions;
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

export function printExecutionPacket(manifest: LaneManifest): void {
  emitJson(generateExecutionPacket(manifest));
}

export function assertExecutionPacketCwd(
  packet: Pick<ExecutionPacket, 'cwd'>,
  actualCwd = process.cwd(),
): void {
  const errors = validateExecutionCwd(packet.cwd, actualCwd);
  if (errors.length > 0) {
    throw new Error(errors.join('; '));
  }
}

function deriveExecutionLocation(executor: LaneManifest['executor']): string {
  if (!executor) {
    return 'Unknown';
  }

  return EXECUTION_LOCATION_MAP[executor] ?? 'Unknown';
}

function collectTierCWarnings(fileScopeLock: string[]): string[] {
  const warnings: string[] = [];

  for (const filePath of fileScopeLock) {
    if (filePath.startsWith('apps/worker/')) {
      warnings.push(
        `Tier C path requires PM approval before editing: ${filePath} (apps/worker/)`,
      );
      continue;
    }
    if (filePath === '.github/workflows/proof-coverage-guard.yml') {
      warnings.push(
        `Tier C self-amendment path requires PM approval before editing: ${filePath}`,
      );
      continue;
    }
    if (filePath.startsWith('packages/domain/')) {
      warnings.push(
        `Tier C path requires PM approval before editing: ${filePath} (packages/domain/)`,
      );
      continue;
    }
    if (filePath.startsWith('packages/config/')) {
      warnings.push(
        `Tier C path requires PM approval before editing: ${filePath} (packages/config/)`,
      );
      continue;
    }
    if (/^supabase\/migrations\/[^/]+\.sql$/u.test(filePath)) {
      warnings.push(
        `Tier C migration path requires PM approval before editing: ${filePath}`,
      );
      continue;
    }
    if (
      [
        'apps/api/src/auth.ts',
        'apps/api/src/distribution-service.ts',
        'packages/db/src/database.types.ts',
        'packages/db/src/lifecycle.ts',
        'packages/db/src/repositories.ts',
        'packages/db/src/runtime-repositories.ts',
      ].includes(filePath)
    ) {
      warnings.push(
        `Tier C path requires PM approval before editing: ${filePath}`,
      );
    }
  }

  return warnings;
}

function buildRequiredVerification(
  tier: string,
  expectedProofPaths: string[],
): string[] {
  const values = [...(TIER_VERIFICATION_MAP[tier] ?? ['type-check', 'test'])];

  for (const proofPath of expectedProofPaths) {
    if (!values.includes(proofPath)) {
      values.push(proofPath);
    }
  }

  return values;
}

function loadRepoBrief(): string {
  if (
    process.env.UNIT_TALK_TEST_MODE === '1' ||
    process.env.NODE_ENV === 'test'
  ) {
    return '[test-brief-stub]';
  }
  try {
    const briefPath = path.join(ROOT, '.claude', 'agent-brief.md');
    return fs.readFileSync(briefPath, 'utf8');
  } catch {
    return '[agent-brief.md not found — check .claude/agent-brief.md exists in repo root]';
  }
}

function packetTimestamp(): string {
  if (
    process.env.UNIT_TALK_TEST_MODE === '1' ||
    process.env.NODE_ENV === 'test'
  ) {
    return TEST_TIMESTAMP;
  }

  return new Date().toISOString();
}

function main(): void {
  const { positionals, bools } = parseArgs(process.argv.slice(2));
  const issueId = positionals[0];
  if (!issueId) {
    throw new Error(
      'Usage: npx tsx scripts/ops/execution-packet.ts <ISSUE-ID> [--enforce-cwd]',
    );
  }

  const packet = generateExecutionPacket(readManifest(issueId));
  if (bools.has('enforce-cwd')) {
    assertExecutionPacketCwd(packet);
  }
  emitJson(packet);
}

const argv1 = process.argv[1] ?? '';
if (argv1 && import.meta.url === pathToFileURL(path.resolve(argv1)).href) {
  try {
    main();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    emitJson({
      ok: false,
      code: 'execution_packet_error',
      message,
      cwd: ROOT,
    });
    process.exit(1);
  }
}
