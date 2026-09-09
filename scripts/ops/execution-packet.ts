import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
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
  readConfiguredEnvValue,
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
  /**
   * Deterministic operational-skill routing (UTV2-1750). Computed once, here,
   * from the task contract's full text -- never from executor judgment -- so
   * two runs against the same contract always select the same skills.
   */
  skill_routing: SkillRoutingResult;
  closeout_instructions: string[];
  repo_brief: string;
  source_of_truth: {
    linear_url: string;
    branch: string;
    manifest_path: string;
  };
  generated_at: string;
}

export type TaskContractSourceKind = 'linear-issue-snapshot' | 'local-description';

export interface LinearTaskSource {
  identifier: string;
  title: string;
  url: string;
  description: string;
}

export interface TaskContract {
  schema_version: 1;
  issue_id: string;
  objective: string;
  acceptance_criteria: string[];
  guardrails: string[];
  non_goals: string[];
  required_evidence: string[];
  exit_criteria: string[];
  /**
   * Description sections no whitelist consumed. Carried so the prompt can show
   * the complete issue rather than silently discarding the remainder.
   */
  unmapped_sections: string[];
  source: {
    /**
     * Where the task contract's text came from (tracker independence, ratified
     * 2026-09-05).
     *
     *   'linear-issue-snapshot' -- captured from the tracker API
     *   'local-description'     -- authored in the repository, as a
     *                              `--description` / `--description-file`
     *                              value or `.ops/work/<ID>.md`
     *
     * Both are equally valid work orders. The KIND is recorded rather than
     * assumed so an executor and a reviewer can always tell which one they are
     * reading, and so the tracker-captured shape is never claimed for text that
     * never came from a tracker.
     */
    kind: TaskContractSourceKind;
    issue_url: string;
    title: string;
    description: string;
    captured_at: string;
    description_sha256: string;
  };
  contract_hash: string;
}

export type ExecutionPacketResult =
  | { ok: true; packet: ExecutionPacket }
  | {
      ok: false;
      code:
        | 'EXECUTION_PACKET_INVALID'
        | 'LANE_CONTRACT_CONFLICT'
        | 'INSUFFICIENT_TASK_CONTRACT';
      issue_id: string;
      branch: string;
      message: string;
      /**
       * Present only on LANE_CONTRACT_CONFLICT. Both hashes travel so the
       * operator can reconcile without re-deriving which root held what.
       */
      contracts?: Array<{ root: string; contract_hash: string }>;
      /**
       * Present only on INSUFFICIENT_TASK_CONTRACT. Names exactly which
       * mandatory packet content is absent, so the caller can go add the
       * missing section rather than re-read a generic message.
       */
      missing?: string[];
    };

/**
 * A skill slug plus the condition, in the operator's own words, that selects
 * it. Kept next to `SKILL_ROUTING_SPECS` -- not restated -- for the same
 * reason `CONTRACT_FIELD_SPECS` is a single table above: a second copy is
 * exactly how one of them drifts silently from the other.
 */
export interface SkillRoutingResult {
  /** Skill slugs selected for this task contract, e.g. "/lane-recovery". */
  selected_skills: string[];
  /** skill slug -> the trigger condition that matched, one entry per selection. */
  reasons: Record<string, string>;
  /**
   * Always present, even when `selected_skills` is empty -- an empty
   * selection must say so explicitly rather than leave the executor to infer
   * routing never ran (UTV2-1750 DoD 7).
   */
  note: string;
}

type LinearFetchRunner = typeof spawnSync;

export interface DispatchPacketOptions {
  root?: string;
  linearToken?: string;
  runner?: LinearFetchRunner;
  /** See `ExecutionPacketOptions.enforceSufficiency`. Defaults to false. */
  enforceSufficiency?: boolean;
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

/**
 * One entry per operational skill /dispatch can route to (UTV2-1750, DoD 7).
 * `pattern` is matched against the task contract's full text -- objective,
 * every structured field, and unmapped residue -- case-insensitively.
 *
 * This table is the ONLY place these trigger conditions are stated. Restating
 * the routing prose from `.claude/commands/dispatch.md` here, or vice versa,
 * is exactly the "mirror beside the thing it must match" pattern this module
 * has already paid for once (see `CONTRACT_FIELD_SPECS`'s own comment); a test
 * asserts the wording stays anchored to this table instead.
 */
interface SkillRoutingSpec {
  readonly skill: string;
  readonly pattern: RegExp;
  /** The trigger condition, in the operator's own words -- becomes the reason. */
  readonly trigger: string;
}

const SKILL_ROUTING_SPECS: readonly SkillRoutingSpec[] = [
  {
    skill: '/lane-recovery',
    pattern:
      /\b(ghost lane|parked lane|merged[- ]but[- ]unclosed|lane is (?:stuck|broken)|stuck lane|broken lane|leaked? lease|lease leak|manifest (?:drift|drifted|disagrees|diverged))\b/iu,
    trigger: 'a lane is broken, ghosted, parked, or merged-but-unclosed',
  },
  {
    skill: '/pr-unblock',
    pattern:
      /\b(required[- ]context|head[- ]binding|headrefoid|merge gate (?:mismatch|refus\w*)|stale head|pr is blocked|pull request is blocked|executor result validation)\b/iu,
    trigger: 'a required-context, head-binding, or merge-gate mismatch',
  },
  {
    skill: '/proof-authoring',
    // Deliberately NOT a bare "proof bundle" or "evidence bundle" match --
    // nearly every lane's required-evidence content mentions a proof bundle
    // as ordinary boilerplate ("attached to the proof bundle"), which made
    // this fire on almost any contract with a Required evidence section. The
    // trigger is creating or CORRECTING a bundle, not merely referencing one.
    pattern:
      /\b(correct(?:ing)? the proof( bundle)?|proof bundle (?:is|was) (?:missing|invalid|wrong|rejected)|verification\.md (?:is|was) (?:missing|invalid|wrong)|proof-authoring|proof (?:auditor|gate) (?:fail|failed|reject|rejected))\b/iu,
    trigger: 'proof bundle creation or correction',
  },
  {
    skill: '/mutation-test',
    pattern:
      /\b(mutation test|vacuous test|prove the control|inversion test|kill the mutation|control (?:claimed|guarded) by (?:a )?tests?)\b/iu,
    trigger: 'a control claimed by tests',
  },
];

/** Exposed so a test can assert the routing table stays the single source. */
export function skillRoutingSpecsForTest(): readonly SkillRoutingSpec[] {
  return SKILL_ROUTING_SPECS;
}

/**
 * Every word of the task contract that could carry a routing trigger or a
 * sufficiency signal -- objective, every structured field, and residue the
 * whitelist did not classify. Unmapped content is deliberately included:
 * excluding it would mean a genuine trigger phrase (or a "where to look"
 * section) sitting in unclassified prose could never be found.
 */
export function taskContractFullText(contract: TaskContract): string {
  return [
    contract.objective,
    ...contract.acceptance_criteria,
    ...contract.guardrails,
    ...contract.non_goals,
    ...contract.required_evidence,
    ...contract.exit_criteria,
    ...contract.unmapped_sections,
  ].join('\n');
}

/**
 * Deterministic skill discovery (UTV2-1750). Pure function of the task
 * contract's text -- no executor judgment, no randomness -- so /dispatch and
 * this module always agree, and re-running against the same contract always
 * selects the same skills. Multiple skills may be selected when triggers
 * genuinely overlap; an empty selection still returns an explicit `note`
 * rather than silence.
 */
export function deriveSkillRouting(contract: TaskContract): SkillRoutingResult {
  const text = taskContractFullText(contract);
  const selected: string[] = [];
  const reasons: Record<string, string> = {};
  for (const spec of SKILL_ROUTING_SPECS) {
    if (spec.pattern.test(text)) {
      selected.push(spec.skill);
      reasons[spec.skill] = spec.trigger;
    }
  }
  return {
    selected_skills: selected,
    reasons,
    note:
      selected.length > 0
        ? `Matched ${selected.length} operational skill trigger(s) deterministically from the task contract.`
        : 'No operational skill trigger matched this task contract; continuing dispatch without a routed skill.',
  };
}

/**
 * Structured refusal for a task contract that is internally VALID (passes
 * `assertTaskContract`) but does not carry enough content for an executor to
 * work from unattended: where to find the relevant files, what "done" means,
 * and how the work will be checked. A contract can satisfy every existing
 * structural rule and still be three sentences with no pointer to a single
 * file -- this refusal exists to catch exactly that (UTV2-1750 DoD 3).
 */
export class InsufficientTaskContractError extends Error {
  readonly code = 'INSUFFICIENT_TASK_CONTRACT';
  constructor(
    readonly issueId: string,
    readonly missing: string[],
  ) {
    super(
      `task contract for ${issueId} is missing required packet content: ${missing.join(', ')}`,
    );
    this.name = 'InsufficientTaskContractError';
  }
}

const WHERE_TO_LOOK_RE =
  /where[- ]to[- ]look|files? to (?:read|check|modify)|read these files/iu;
const DEFINITION_OF_DONE_RE =
  /definition of done|\bdod\b|done when|success criteria/iu;
const VERIFICATION_SELF_CHECK_RE =
  /self[- ]check|verification|\bverify\b|test plan/iu;

/**
 * Refuses with `INSUFFICIENT_TASK_CONTRACT` when the contract lacks
 * where-to-look, definition-of-done, or verification/self-check content.
 * Definition-of-done and verification each also accept their existing
 * structured-field equivalent (`exit_criteria`, `required_evidence`) so a
 * contract that already states them structurally is not forced to repeat
 * itself in prose -- but `acceptance_criteria` alone (already mandatory via
 * `assertTaskContract`) does not satisfy this on its own, or this check could
 * never fire for a contract that lacks the other two.
 */
export function assertSufficientTaskContract(
  contract: TaskContract,
  issueId: string = contract.issue_id,
): void {
  const text = taskContractFullText(contract);
  const missing: string[] = [];
  if (!WHERE_TO_LOOK_RE.test(text)) missing.push('where_to_look');
  if (
    contract.exit_criteria.length === 0 &&
    !DEFINITION_OF_DONE_RE.test(text)
  ) {
    missing.push('definition_of_done');
  }
  if (
    contract.required_evidence.length === 0 &&
    !VERIFICATION_SELF_CHECK_RE.test(text)
  ) {
    missing.push('verification_self_check');
  }
  if (missing.length > 0) {
    throw new InsufficientTaskContractError(issueId, missing);
  }
}

/**
 * Options for `generateExecutionPacket`/`generateExecutionPacketResult`.
 *
 * `enforceSufficiency` defaults to false. `claude-exec.ts`, `codex-exec.ts`,
 * and `lane-start.ts` call these functions directly against contracts
 * predating UTV2-1750's where-to-look/definition-of-done/verification
 * requirement, and are out of this lane's file scope -- enforcing by default
 * would refuse packets those callers have relied on for a long time. The
 * standalone CLI (`main()`, below) is the one caller that turns enforcement
 * ON: `/dispatch`'s Phase 1.5 skill-discovery step runs that CLI as a
 * preflight gate BEFORE any executor is launched, which is where
 * `INSUFFICIENT_TASK_CONTRACT` is meant to stop a lane (UTV2-1750 DoD 3).
 */
export interface ExecutionPacketOptions {
  enforceSufficiency?: boolean;
}

export function generateExecutionPacket(
  manifest: LaneManifest,
  env: NodeJS.ProcessEnv = process.env,
  suppliedTaskContract?: TaskContract,
  root: string = ROOT,
  options: ExecutionPacketOptions = {},
): ExecutionPacket {
  const issueId = manifest.issue_id;
  const tier = manifest.tier ?? 'unknown';
  const expectedProofPaths = manifest.expected_proof_paths ?? [];
  const verificationPlan = buildVerificationPlan(manifest, env);
  const taskContract = suppliedTaskContract ?? readTaskContract(issueId, root);
  assertTaskContract(taskContract, issueId);
  if (options.enforceSufficiency) {
    assertSufficientTaskContract(taskContract, issueId);
  }
  const skillRouting = deriveSkillRouting(taskContract);

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
    skill_routing: skillRouting,
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

export function generateExecutionPacketResult(
  manifest: LaneManifest,
  env: NodeJS.ProcessEnv = process.env,
  suppliedTaskContract?: TaskContract,
  root: string = ROOT,
  options: ExecutionPacketOptions = {},
): ExecutionPacketResult {
  try {
    return {
      ok: true,
      packet: generateExecutionPacket(
        manifest,
        env,
        suppliedTaskContract,
        root,
        options,
      ),
    };
  } catch (error) {
    // Route through the ONE failure classifier both entry points share.
    // This function used to hand-roll its own catch that always reported
    // EXECUTION_PACKET_INVALID, so a LANE_CONTRACT_CONFLICT or an
    // INSUFFICIENT_TASK_CONTRACT thrown on this path would have been
    // misreported as the generic code -- restating classification logic
    // beside `executionPacketFailure` is exactly the "second copy drifts"
    // pattern this module has already paid for once.
    return executionPacketFailure(manifest, error);
  }
}

function executionPacketFailure(
  manifest: LaneManifest,
  error: unknown,
): ExecutionPacketResult {
  const message = `Execution packet refused: ${error instanceof Error ? error.message : String(error)}`;
  // A divergent-contract refusal is a distinct, actionable condition. Collapsing
  // it into the generic invalid-packet code loses the one fact the operator
  // needs: which roots disagree, and on what hashes.
  if (error instanceof TaskContractConflictError) {
    return {
      ok: false,
      code: 'LANE_CONTRACT_CONFLICT',
      issue_id: manifest.issue_id,
      branch: manifest.branch,
      message,
      contracts: error.hashes,
    };
  }
  // Same reasoning: an insufficient contract is actionable in a way the
  // generic code is not -- it names exactly which sections to go add.
  if (error instanceof InsufficientTaskContractError) {
    return {
      ok: false,
      code: 'INSUFFICIENT_TASK_CONTRACT',
      issue_id: manifest.issue_id,
      branch: manifest.branch,
      message,
      missing: error.missing,
    };
  }
  return {
    ok: false,
    code: 'EXECUTION_PACKET_INVALID',
    issue_id: manifest.issue_id,
    branch: manifest.branch,
    message,
  };
}

function normalizeHeading(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * Sentinel key for description content that appears BEFORE the first heading.
 *
 * Deliberately not a valid markdown heading, so a real `## ...` in an issue can
 * never collide with it and no whitelist can accidentally consume it.
 */
export const PREAMBLE_KEY = '(description preamble)';

/**
 * One heading as it actually appeared in the description.
 *
 * Identity is the occurrence, never the normalized text. Keying by normalized
 * text merged two unrelated sections that happen to normalize alike -- e.g.
 * `## Notes` / `### Details` followed later by a top-level `## Details`. The
 * shared entry accumulated both bodies, the nested one was marked consumed as a
 * descendant of `notes`, and the independent `## Details` body vanished from
 * the contract and the prompt (UTV2-1747 review finding P2/headings).
 */
interface SectionOccurrence {
  /** Stable identity for this occurrence; unique within one parse. */
  id: number;
  /** Normalized lookup key. Many occurrences may share one. */
  key: string;
  /**
   * The heading exactly as authored, minus the leading `#`s and surrounding
   * whitespace. Case, punctuation, backticks and flag prefixes are preserved:
   * residue rendered from the normalized key turned `## Never run --force`
   * into `never run force:`, rewriting a load-bearing prohibition while this
   * module claimed to carry unclassified content verbatim.
   */
  raw: string;
  level: number;
  lines: string[];
  /**
   * Parallel to `lines`: the id of the DEEPEST occurrence that owns each line.
   * An ancestor's `lines` deliberately include every descendant's heading and
   * body, so without per-line ownership there is no way to hand a nested
   * RECOGNIZED section to its own contract field without also leaving a copy
   * inside the ancestor's field. Ownership makes that subtraction exact.
   */
  lineOwners: number[];
  /** Occurrence ids nested beneath this one, in document order. */
  descendants: number[];
}

interface ParsedSections {
  occurrences: SectionOccurrence[];
}

function parseSections(markdown: string): ParsedSections {
  const occurrences: SectionOccurrence[] = [];
  let preamble: SectionOccurrence | null = null;
  const add = (key: string, raw: string, level: number): SectionOccurrence => {
    const occurrence: SectionOccurrence = {
      id: occurrences.length,
      key,
      raw,
      level,
      lines: [],
      lineOwners: [],
      descendants: [],
    };
    occurrences.push(occurrence);
    return occurrence;
  };
  // Open ancestors, outermost first. A line belongs to the deepest heading AND
  // to every heading above it: an `## Acceptance criteria` parent whose items
  // live under `### Functional` used to end up empty, because any heading -- at
  // any level -- replaced `current`. With the parent empty and
  // hasAcceptanceHeading true, the fallback was disabled and the contract was
  // refused for "missing acceptance criteria" while the criteria sat one level
  // down. Descendants are recorded so that consuming a parent also consumes
  // them, which keeps the same content from being duplicated into residue.
  const open: SectionOccurrence[] = [];
  // A line inside a fenced code block is never a heading, and neither is an
  // indented code line. The previous regex ran against `rawLine.trim()`, so
  // BOTH were misread: a shell comment such as `# do not run this in prod`
  // inside a ``` block opened a section, swallowed the rest of the fence as
  // its body, and split the fence in half. Where the description also carried
  // a real acceptance heading the legacy whole-description fallback was
  // disabled, so that text reached the executor with its `#` stripped and its
  // fence broken -- turning a prohibition into ordinary prose. An unterminated
  // fence deliberately runs to end of input: treating the remainder as code is
  // the fail-closed reading, since promoting it to headings is what corrupts
  // the work order.
  let fence: FenceState | null = null;
  const pushContent = (rawLine: string): void => {
    if (open.length > 0) {
      const deepest = open[open.length - 1]!;
      for (const owner of open) {
        owner.lines.push(rawLine);
        owner.lineOwners.push(deepest.id);
      }
    } else {
      preamble ??= add(PREAMBLE_KEY, PREAMBLE_KEY, 0);
      preamble.lines.push(rawLine);
      preamble.lineOwners.push(preamble.id);
    }
  };
  for (const rawLine of markdown.split(/\r?\n/u)) {
    if (fence !== null) {
      if (fenceClosedBy(rawLine, fence)) fence = null;
      pushContent(rawLine);
      continue;
    }
    const opened = fenceOpenedBy(rawLine);
    if (opened) {
      fence = opened;
      pushContent(rawLine);
      continue;
    }
    // Up to three leading spaces is still a heading; four or more is code.
    const heading = /^ {0,3}(#{1,6})\s+(.+?)\s*$/u.exec(rawLine);
    if (heading) {
      const level = (heading[1] ?? '').length;
      const raw = (heading[2] ?? '').trim();
      const key = normalizeHeading(raw);
      while (open.length > 0 && (open[open.length - 1]?.level ?? 0) >= level) {
        open.pop();
      }
      const occurrence = add(key, raw, level);
      for (const ancestor of open) {
        // The subheading line itself is content of its parent; without it the
        // parent loses the fact that the subsection exists at all. It is OWNED
        // by the subsection, so subtracting that subsection removes its heading
        // along with its body.
        ancestor.lines.push(rawLine);
        ancestor.lineOwners.push(occurrence.id);
        if (!ancestor.descendants.includes(occurrence.id)) {
          ancestor.descendants.push(occurrence.id);
        }
      }
      open.push(occurrence);
      continue;
    }
    // Content before the first heading used to be discarded outright: `current`
    // was null, so the line was dropped with no residue. Issues routinely open
    // with the load-bearing sentence -- the objective, or a prohibition --
    // before any `##`, and that text never reached the executor. It is now
    // captured under a sentinel key and travels as residue like any other
    // unconsumed section.
    pushContent(rawLine);
  }
  return { occurrences };
}

/**
 * The heading whitelist for every contract field, in ONE place.
 *
 * This table is the single source for two things that must never disagree:
 * which headings each field extracts, and which headings are RESERVED so an
 * enclosing section cannot also swallow them. The first version of this fix
 * restated the reserved set as its own literal list, and that list silently
 * omitted `guardrails`, the four `non goals` spellings and `required
 * evidence`. A `### Non-goals` nested under `## Acceptance criteria` was then
 * left inside the acceptance ancestor AND extracted by the non-goals pass, so
 * the same text became both a thing to do and a thing not to do -- a
 * contradictory, silently widened work order.
 *
 * Restating a list beside the thing it must mirror is what produced that bug,
 * so the mirror is gone: field extraction and reservation both read this
 * table, and `packetContractFieldSpecs()` exposes it so a test can assert
 * there is no third copy.
 */
interface ContractFieldSpec {
  readonly headings: readonly string[];
  /** `non goals` matches by prefix, so reservation must too. */
  readonly prefix: boolean;
}

const CONTRACT_FIELD_SPECS: readonly ContractFieldSpec[] = [
  { headings: ['objective', 'required outcome'], prefix: false },
  { headings: ['acceptance criteria', 'acceptance criterion'], prefix: false },
  { headings: ['exit criteria'], prefix: false },
  { headings: ['guardrails'], prefix: false },
  {
    headings: ['non goals', 'non-goals', 'out of scope', 'explicitly out of scope'],
    prefix: true,
  },
  { headings: ['required evidence', 'evidence'], prefix: false },
];

/**
 * Exposed so a test can drive the extraction path directly and prove the
 * unreserved-heading guard in `sectionLines` actually fires. Not part of the
 * module's API surface for callers.
 */
export function packetParseSectionsForTest(markdown: string): ParsedSections {
  return parseSections(markdown);
}

/** See `packetParseSectionsForTest`. */
export function packetSectionLinesForTest(
  parsed: ParsedSections,
  headings: string[],
  prefix = false,
): string[] {
  return sectionLines(parsed, headings, prefix);
}

/** Exposed so tests can prove extraction and reservation share one table. */
export function packetContractFieldSpecs(): readonly ContractFieldSpec[] {
  return CONTRACT_FIELD_SPECS;
}

/**
 * Does a normalized section `key` match a normalized heading `value`?
 *
 * This rule had THREE copies -- one in the reservation predicate and two in
 * `sectionLines` -- and a fix applied to one of them left the other two on the
 * old behaviour. It lives here once now, for the same reason the heading table
 * does.
 *
 * A prefix match must end on a word boundary: bare `startsWith` captured
 * `## Non goalsetting framework` as `non goals`.
 */
function headingMatches(key: string, value: string, prefix: boolean): boolean {
  if (key === value) return true;
  if (!prefix || !key.startsWith(value)) return false;
  return key.length === value.length || key[value.length] === ' ';
}

/**
 * Leading indentation width in columns, expanding tabs to the next 4-column
 * stop as CommonMark does.
 *
 * Matching ` {4,}` alone missed tab-indented code entirely, so a tab-indented
 * block -- including a tab-indented fence, which is not a fence by the
 * three-space rule -- fell through to the paragraph collapse and produced
 * `# do not run in prod pnpm destroy`: the comment swallowing the command,
 * byte-identical to what the mutation that kills G13 produces. Found by an
 * independent review AFTER this bundle declared the class closed.
 */
function indentWidth(rawLine: string): number {
  let width = 0;
  for (const ch of rawLine) {
    if (ch === ' ') width += 1;
    else if (ch === '\t') width += 4 - (width % 4);
    else break;
  }
  return width;
}

/**
 * The fence state machine, in ONE place. It was duplicated verbatim in
 * `parseSections` and `sectionItems` with no test guarding their equivalence --
 * the same "restating a list beside the thing it must mirror" antipattern that
 * produced the reservation bug this module documents above.
 */
const FENCE_RE = /^ {0,3}(`{3,}|~{3,})(.*)$/u;

interface FenceState {
  readonly char: string;
  readonly len: number;
}

/** The fence a line opens, or null if it opens none. */
function fenceOpenedBy(rawLine: string): FenceState | null {
  const match = FENCE_RE.exec(rawLine);
  if (!match) return null;
  const marker = match[1] ?? '';
  const info = match[2] ?? '';
  // A backtick fence's info string may not itself contain a backtick.
  if (marker[0] === '`' && info.includes('`')) return null;
  return { char: marker[0]!, len: marker.length };
}

/** True when `rawLine` closes `fence`: same char, at least as long, no info. */
function fenceClosedBy(rawLine: string, fence: FenceState): boolean {
  const match = FENCE_RE.exec(rawLine);
  const marker = match?.[1] ?? '';
  return (
    marker.length >= fence.len &&
    marker[0] === fence.char &&
    (match?.[2] ?? '').trim() === ''
  );
}

/**
 * True when `key` is claimed directly by some contract field. A nested
 * occurrence carrying such a key belongs to THAT field, never to whichever
 * ancestor happens to enclose it -- see `sectionLines`' reservation handling.
 */
function isContractFieldHeading(key: string): boolean {
  return CONTRACT_FIELD_SPECS.some((spec) =>
    spec.headings.some((heading) => {
      return headingMatches(key, normalizeHeading(heading), spec.prefix);
    }),
  );
}

/**
 * Look a field spec up by its first heading. Extraction sites go through this
 * so they cannot name a heading the reservation set does not know about.
 */
function fieldSpec(firstHeading: string): ContractFieldSpec {
  const spec = CONTRACT_FIELD_SPECS.find(
    (candidate) => candidate.headings[0] === firstHeading,
  );
  if (!spec) {
    throw new Error(
      `execution-packet: no contract field spec registered for "${firstHeading}"`,
    );
  }
  return spec;
}

function sectionLines(
  parsed: ParsedSections,
  headings: string[],
  prefix = false,
  matched?: number[],
  /**
   * When set, descendants whose key is claimed by a DIFFERENT contract field
   * are subtracted from this section's lines and left unconsumed, so the field
   * that actually owns them can take them. Without this, a `### Acceptance
   * criteria` nested under `## Objective` was emitted twice: once inside the
   * objective (whose `lines` contain the whole subtree) and again by the
   * acceptance extraction, whose per-call consumed-set could not see that the
   * objective pass had already taken it.
   */
  isReserved: (key: string) => boolean = isContractFieldHeading,
): string[] {
  const wanted = headings.map(normalizeHeading);
  // Fail closed on the drift this whole table exists to prevent. A heading
  // extraction accepts but reservation does not know is exactly the bug that
  // made a nested non-goal into an acceptance criterion, and no test that
  // enumerates the table can see it -- the drifted heading is, by definition,
  // absent from the table. So the check lives here, on the path every
  // extraction takes, rather than in a test that inspects the source text.
  for (const value of wanted) {
    if (!isReserved(value)) {
      throw new Error(
        `execution-packet: heading "${value}" is used for extraction but is ` +
          `not reserved. Add it to CONTRACT_FIELD_SPECS instead of passing it ` +
          `directly, or nested occurrences of it will bleed into their ancestor.`,
      );
    }
  }
  const byId = new Map(parsed.occurrences.map((o) => [o.id, o]));
  const claimsOwnKey = (occurrence: SectionOccurrence): boolean =>
    wanted.some((value) => headingMatches(occurrence.key, value, prefix));
  // EVERY matching occurrence contributes, not just the first. A description
  // that opens `## Acceptance criteria` with an empty lead-in and then repeats
  // the heading with the real content used to yield the empty first occurrence
  // and refuse the task as missing acceptance criteria -- a regression against
  // the normalized-key merge this parser replaced.
  const collected: string[] = [];
  const consumedHere = new Set<number>();
  let found = false;
  for (const occurrence of parsed.occurrences) {
    // A nested occurrence already travels inside its ancestor's lines; taking
    // it again would duplicate that text in the rendered section.
    if (consumedHere.has(occurrence.id)) continue;
    if (
      !wanted.some((value) => headingMatches(occurrence.key, value, prefix))
    ) {
      continue;
    }
    found = true;
    matched?.push(occurrence.id);
    consumedHere.add(occurrence.id);

    // Descendants reserved by a DIFFERENT contract field are not ours to take.
    // Subtracting a reserved descendant also subtracts everything beneath it,
    // otherwise its own children would survive as orphaned lines here.
    const reserved = new Set<number>();
    for (const childId of occurrence.descendants) {
      const child = byId.get(childId);
      if (!child) continue;
      if (reserved.has(childId)) continue;
      if (!isReserved(child.key)) continue;
      if (claimsOwnKey(child)) continue;
      reserved.add(childId);
      for (const nested of child.descendants) reserved.add(nested);
    }

    // Consuming a parent consumes what is nested beneath it. Those lines are
    // already carried in the parent's own content, so leaving the children
    // unconsumed would repeat the same text in "Additional issue content".
    // Reserved descendants are the exception: they stay unconsumed so their
    // own field claims them, and they are never left to residue either.
    for (const child of occurrence.descendants) {
      if (reserved.has(child)) continue;
      matched?.push(child);
      consumedHere.add(child);
    }

    if (reserved.size === 0) {
      collected.push(...occurrence.lines);
    } else {
      occurrence.lines.forEach((line, index) => {
        if (!reserved.has(occurrence.lineOwners[index] ?? occurrence.id)) {
          collected.push(line);
        }
      });
    }
  }
  return found ? collected : [];
}

/**
 * Sections the whitelists did not consume (UTV2-1734 review finding B1).
 *
 * Once a description carries an exact `## Acceptance criteria` heading, only
 * the six recognised headings were kept and everything else was discarded with
 * no residue. Measured across the live board, 14 of 18 sectioned descriptions
 * lost more than a fifth of their content and one lost 77% — including, on
 * UTV2-1383, the single line forbidding a blanket UPDATE against production.
 *
 * The prompt then rendered `(none declared)` for the missing fields, which is
 * an affirmative false claim rather than an omission, while instructing the
 * executor not to go and read the issue. That is a safety reduction against
 * today's behaviour, where an executor with no contract reads the issue itself.
 *
 * Nothing from the description is dropped now: unrecognised sections travel
 * with the contract and are rendered verbatim.
 */
function unmappedSections(
  parsed: ParsedSections,
  consumed: number[][],
): Array<{ heading: string; lines: string[] }> {
  const taken = new Set<number>();
  for (const group of consumed) {
    for (const id of group) taken.add(id);
  }
  // Ids a contract FIELD actually claimed. Distinct from `taken` below, which
  // also absorbs descendants suppressed merely because a surviving ancestor
  // already carries them -- those must still render inside that ancestor.
  const consumedByField = new Set<number>(taken);
  // A surviving ancestor already carries its descendants' lines, so emitting the
  // descendants again would repeat the same text in the prompt.
  for (const occurrence of parsed.occurrences) {
    if (taken.has(occurrence.id)) continue;
    for (const child of occurrence.descendants) taken.add(child);
  }
  const out: Array<{ heading: string; lines: string[] }> = [];
  for (const occurrence of parsed.occurrences) {
    if (taken.has(occurrence.id)) continue;
    // Residue carries the heading AS AUTHORED. Rendering `occurrence.key` here
    // lowercased it and stripped punctuation, backticks and flag prefixes, so
    // `## Never run --force` reached the executor as `never run force:`.
    const heading = occurrence.raw;

    // A descendant that a contract field already claimed must not reappear
    // inside this surviving ancestor's residue. The ancestor's `lines` carry
    // the whole subtree, so the claimed descendant is subtracted by line
    // ownership -- the same subtraction `sectionLines` performs -- leaving the
    // recognized child in exactly one place: its own contract field.
    const claimed = new Set<number>();
    for (const childId of occurrence.descendants) {
      if (consumedByField.has(childId)) claimed.add(childId);
    }
    const lines =
      claimed.size === 0
        ? occurrence.lines
        : occurrence.lines.filter(
            (_line, index) =>
              !claimed.has(occurrence.lineOwners[index] ?? occurrence.id),
          );

    // A section with an empty body still carries meaning in its HEADING --
    // "## DO NOT TOUCH PRODUCTION" followed only by a subheading used to vanish
    // entirely, taking the prohibition with it. Keep the heading as residue.
    if (lines.every((line) => !line.trim())) {
      out.push({ heading, lines: [] });
      continue;
    }
    out.push({ heading, lines });
  }
  return out;
}

function sectionItems(lines: string[]): string[] {
  const items: string[] = [];
  let paragraph: string[] = [];
  const flushParagraph = (): void => {
    const value = paragraph.join(' ').replace(/\s+/gu, ' ').trim();
    if (value) items.push(value);
    paragraph = [];
  };

  // A fenced block is ONE item and keeps its newlines. Collapsing it with the
  // surrounding paragraph whitespace put a shell comment and the command it
  // warns about on the same line -- `# do not run this in prod pnpm test:db` --
  // where the `#` silently comments out the command. Preserving the heading's
  // `#` (see `parseSections`) is not enough on its own if the block is then
  // flattened here; both halves are required for a fenced command to survive
  // into the work order meaning what it meant in the issue.
  //
  // The same reasoning applies one indentation level in. A block indented four
  // or more spaces is an indented code block, and a fence indented that far
  // (the ordinary way to nest code under a list item) is not a fence at all by
  // the three-space rule above -- so both used to fall through to the
  // paragraph collapse and produce exactly the damage this comment describes:
  // `# indented shell comment pnpm verify`. Indented runs are therefore held
  // verbatim as one item too.
  let fence: FenceState | null = null;
  let fenced: string[] = [];
  let indented: string[] = [];
  const flushIndented = (): void => {
    while (indented.length > 0 && indented[indented.length - 1]!.trim() === '') {
      indented.pop();
    }
    if (indented.length > 0) items.push(indented.join('\n'));
    indented = [];
  };

  for (const rawLine of lines) {
    const isIndentedCode =
      rawLine.trim() !== '' && indentWidth(rawLine) >= 4;
    if (indented.length > 0) {
      // A blank line does not end an indented block; a non-indented,
      // non-blank line does.
      if (isIndentedCode || rawLine.trim() === '') {
        indented.push(rawLine);
        continue;
      }
      flushIndented();
    } else if (isIndentedCode && fence === null) {
      flushParagraph();
      indented.push(rawLine);
      continue;
    }
    if (fence !== null) {
      fenced.push(rawLine);
      if (fenceClosedBy(rawLine, fence)) {
        items.push(fenced.join('\n'));
        fenced = [];
        fence = null;
      }
      continue;
    }
    const opened = fenceOpenedBy(rawLine);
    if (opened) {
      flushParagraph();
      fence = opened;
      fenced = [rawLine];
      continue;
    }
    const line = rawLine.trim();
    if (!line) {
      flushParagraph();
      continue;
    }
    const listItem = /^(?:[-*+] |\d+[.)]\s+)(?:\[[ xX]\]\s*)?(.*)$/u.exec(line);
    if (listItem) {
      flushParagraph();
      const value = (listItem[1] ?? '').trim();
      if (value) items.push(value);
      continue;
    }
    paragraph.push(line);
  }
  // An unterminated fence still travels verbatim rather than being dropped or
  // silently reflowed into the previous paragraph.
  if (fenced.length > 0) items.push(fenced.join('\n'));
  flushIndented();
  flushParagraph();
  return items;
}

function taskContractHash(
  contract: Omit<TaskContract, 'contract_hash'>,
): string {
  return createHash('sha256').update(JSON.stringify(contract)).digest('hex');
}

export function buildTaskContract(
  source: LinearTaskSource,
  capturedAt = packetTimestamp(),
  kind: TaskContractSourceKind = 'linear-issue-snapshot',
): TaskContract {
  const issueId = source.identifier.trim().toUpperCase();
  const title = source.title.trim();
  const description = source.description.trim();
  const parsed = parseSections(description);
  const consumed: number[] = [];
  const objectiveItems = sectionItems(
    sectionLines(parsed, [...fieldSpec('objective').headings], fieldSpec('objective').prefix, consumed),
  );
  const objective = objectiveItems.join('\n') || title;
  const explicitAcceptance = sectionItems(
    sectionLines(
      parsed,
      [...fieldSpec('acceptance criteria').headings],
      fieldSpec('acceptance criteria').prefix,
      consumed,
    ),
  );
  // A THIRD mirror of the heading list lived here, restating the acceptance
  // spec beside the table and using `.includes` rather than the shared match
  // rule -- so an alias added to the table was silently not recognised here,
  // re-enabling the legacy whole-description fallback. Found by an independent
  // review while this bundle claimed "the mirror is gone".
  const acceptanceSpec = fieldSpec('acceptance criteria');
  const hasAcceptanceHeading = parsed.occurrences.some((occurrence) =>
    acceptanceSpec.headings.some((heading) =>
      headingMatches(occurrence.key, normalizeHeading(heading), acceptanceSpec.prefix),
    ),
  );
  const exitCriteria = sectionItems(
    sectionLines(
      parsed,
      [...fieldSpec('exit criteria').headings],
      fieldSpec('exit criteria').prefix,
      consumed,
    ),
  );

  // Existing issues predate the heading convention. Preserve their complete
  // work order verbatim instead of inventing criteria or bulk-migrating state.
  const acceptanceCriteria =
    explicitAcceptance.length > 0
      ? explicitAcceptance
      : !hasAcceptanceHeading && description
        ? [description]
        : [];

  // Tracker independence (ratified 2026-09-05). A fourth, independent copy of
  // the identity rule lived here. `WORK-###` is a legal repo-owned work
  // identity, so a local work order must be admitted -- otherwise the local
  // source added below can never actually produce a contract.
  //
  // This is still a CLOSED set: an arbitrary identifier is refused exactly as
  // before. `shared.ts`'s ISSUE_PATTERN is the authority for what a work
  // identity may be; this mirrors it deliberately rather than importing it,
  // because execution-packet is consumed in contexts that do not load shared's
  // path constants.
  if (!/^(?:UTV2|WORK)-\d+$/u.test(issueId)) {
    throw new Error(
      `task contract has an invalid issue identity: ${source.identifier}`,
    );
  }
  if (!objective) {
    throw new Error(`task contract for ${issueId} is missing an objective`);
  }
  if (acceptanceCriteria.length === 0) {
    throw new Error(
      `task contract for ${issueId} is missing acceptance criteria`,
    );
  }

  const content: Omit<TaskContract, 'contract_hash'> = {
    schema_version: 1,
    issue_id: issueId,
    objective,
    acceptance_criteria: acceptanceCriteria,
    guardrails: sectionItems(
      sectionLines(
        parsed,
        [...fieldSpec('guardrails').headings],
        fieldSpec('guardrails').prefix,
        consumed,
      ),
    ),
    non_goals: sectionItems(
      sectionLines(
        parsed,
        [...fieldSpec('non goals').headings],
        fieldSpec('non goals').prefix,
        consumed,
      ),
    ),
    required_evidence: sectionItems(
      sectionLines(
        parsed,
        [...fieldSpec('required evidence').headings],
        fieldSpec('required evidence').prefix,
        consumed,
      ),
    ),
    exit_criteria: exitCriteria,
    unmapped_sections: unmappedSections(parsed, [consumed]).map((entry) => {
      // Flattening with join(' ') plus whitespace collapse silently rewrote
      // multiline commands, fenced code, tables and paragraph boundaries -- and
      // contradicted this module's own claim to carry residue verbatim. Lines
      // are preserved as authored; only leading and trailing blank lines go.
      const body = entry.lines
        .join('\n')
        .replace(/^\s*\n+/u, '')
        .replace(/\n+\s*$/u, '');
      // The heading is emitted EXACTLY as authored. Appending `:` rewrote
      // `Never run command --force!` into `Never run command --force!:`,
      // which contradicts the verbatim-residue guarantee and can alter a
      // heading that is itself a command.
      return body ? `${entry.heading}\n${body}` : entry.heading;
    }),
    source: {
      kind,
      issue_url: source.url.trim(),
      title,
      description,
      captured_at: capturedAt,
      description_sha256: createHash('sha256')
        .update(description)
        .digest('hex'),
    },
  };
  return { ...content, contract_hash: taskContractHash(content) };
}

function isStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) && value.every((entry) => typeof entry === 'string')
  );
}

/**
 * Structured refusal for task-contract defects.
 *
 * Carries a machine-readable `code` and the issue id so a caller can act on the
 * failure instead of parsing a message string, and so a stale contract never
 * surfaces as an anonymous TypeError.
 */
export class TaskContractError extends Error {
  readonly code: string;
  readonly issueId: string;
  constructor(code: string, issueId: string, message: string) {
    super(message);
    this.name = 'TaskContractError';
    this.code = code;
    this.issueId = issueId;
  }
}

export function assertTaskContract(
  contract: unknown,
  expectedIssueId?: string,
): asserts contract is TaskContract {
  if (!contract || typeof contract !== 'object') {
    throw new Error('task contract is missing or not an object');
  }
  const value = contract as Partial<TaskContract>;
  const issueId = expectedIssueId ?? value.issue_id ?? '(unknown issue)';
  if (value.schema_version !== 1 || value.issue_id !== issueId) {
    throw new Error(`task contract identity mismatch for ${issueId}`);
  }
  if (typeof value.objective !== 'string' || !value.objective.trim()) {
    throw new Error(`task contract for ${issueId} is missing an objective`);
  }
  if (
    !isStringArray(value.acceptance_criteria) ||
    value.acceptance_criteria.length === 0
  ) {
    throw new Error(
      `task contract for ${issueId} is missing acceptance criteria`,
    );
  }
  // A contract generated before unmapped_sections existed passes every check
  // above and then dies on `contract.unmapped_sections.length` inside
  // renderTaskContract -- a bare TypeError with no issue id and no remedy. That
  // is fail-open followed by an unstructured crash. Refuse it here instead,
  // structurally, naming the issue and the fix.
  if (
    !isStringArray(value.unmapped_sections)
  ) {
    throw new TaskContractError(
      'stale_contract_missing_unmapped_sections',
      issueId,
      `task contract for ${issueId} predates unmapped_sections and is stale; ` +
        `regenerate it with ops:lane-start so no description content is dropped`,
    );
  }
  for (const field of [
    'guardrails',
    'non_goals',
    'required_evidence',
    'exit_criteria',
  ] as const) {
    if (!isStringArray(value[field])) {
      throw new Error(
        `task contract for ${issueId} is missing the ${field} array`,
      );
    }
  }
  // Tracker independence: a repo-authored work order is a first-class source.
  // The rest of the assertion is UNCHANGED -- title, description, capture time
  // and the description hash are still all required, so a local contract is
  // held to the same integrity bar as a captured one.
  if (
    !value.source ||
    (value.source.kind !== 'linear-issue-snapshot' &&
      value.source.kind !== 'local-description') ||
    typeof value.source.issue_url !== 'string' ||
    typeof value.source.title !== 'string' ||
    typeof value.source.description !== 'string' ||
    typeof value.source.captured_at !== 'string' ||
    typeof value.source.description_sha256 !== 'string'
  ) {
    throw new Error(
      `task contract for ${issueId} is missing a valid source snapshot ` +
        '(kind must be linear-issue-snapshot or local-description)',
    );
  }
  if (
    createHash('sha256').update(value.source.description).digest('hex') !==
    value.source.description_sha256
  ) {
    throw new Error(
      `task contract source hash verification failed for ${issueId}`,
    );
  }
  const contractHash = value.contract_hash;
  const { contract_hash: _contractHash, ...content } = value as TaskContract;
  if (
    typeof contractHash !== 'string' ||
    !/^[0-9a-f]{64}$/u.test(contractHash) ||
    taskContractHash(content) !== contractHash
  ) {
    throw new Error(`task contract hash verification failed for ${issueId}`);
  }
}

export function buildSyncYmlWithTaskContract(
  issueId: string,
  contract: TaskContract,
  existingContent?: string,
): string {
  assertTaskContract(contract, issueId);
  const parsed = existingContent?.trim()
    ? parseYaml(existingContent)
    : {
        version: 1,
        approval: { allow_multiple_issues: false, skip_sync_required: false },
        entities: { issues: [issueId], findings: [], controls: [], proofs: [] },
      };
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`sync record for ${issueId} is malformed`);
  }
  return stringifyYaml({
    ...(parsed as Record<string, unknown>),
    task_contract: contract,
  });
}

function curlConfigValue(value: string): string {
  if (/\r|\n/u.test(value)) {
    throw new Error('Linear API token contains an invalid newline');
  }
  return value.replaceAll('\\', '\\\\').replaceAll('"', '\\"');
}

export function fetchLinearTaskSource(
  issueId: string,
  token: string,
  runner: LinearFetchRunner = spawnSync,
): LinearTaskSource {
  if (!token.trim()) {
    throw new Error(
      `LINEAR_API_TOKEN or LINEAR_API_KEY is required to capture the task contract for ${issueId}`,
    );
  }
  const query = `
    query LaneTaskContract($id: String!) {
      issue(id: $id) { identifier title url description }
    }
  `;
  const result = runner(
    'curl',
    [
      '--config',
      '-',
      '--fail-with-body',
      '--silent',
      '--show-error',
      '--request',
      'POST',
      'https://api.linear.app/graphql',
      '--header',
      'Content-Type: application/json',
      '--data-binary',
      JSON.stringify({ query, variables: { id: issueId } }),
    ],
    {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: 'pipe',
      timeout: 15_000,
      input: `header = "Authorization: ${curlConfigValue(token)}"\n`,
    },
  );
  if (result.error || result.status !== 0) {
    throw new Error(
      `failed to capture Linear task contract for ${issueId}: ${result.error?.message ?? result.stderr ?? `curl exit ${result.status}`}`,
    );
  }
  const payload = JSON.parse(String(result.stdout ?? '{}')) as {
    data?: { issue?: LinearTaskSource | null };
    errors?: Array<{ message?: string }>;
  };
  if (payload.errors?.length) {
    throw new Error(
      `failed to capture Linear task contract for ${issueId}: ${payload.errors.map((entry) => entry.message ?? 'unknown Linear error').join('; ')}`,
    );
  }
  const issue = payload.data?.issue;
  if (!issue || issue.identifier.toUpperCase() !== issueId) {
    throw new Error(
      `failed to capture Linear task contract for ${issueId}: issue identity mismatch or missing issue`,
    );
  }
  return {
    identifier: issue.identifier.toUpperCase(),
    title: issue.title ?? '',
    url: issue.url ?? '',
    description: issue.description ?? '',
  };
}


/**
 * The repository-owned work-order location for a lane with no tracker issue
 * (tracker independence, ratified 2026-09-05).
 *
 * A file here is the SAME artifact a tracker description would have been: a
 * markdown body whose sections `buildTaskContract` already knows how to parse.
 * Nothing about the contract's required shape is relaxed -- objective,
 * acceptance criteria, guardrails, non-goals, required evidence and exit
 * criteria are still all extracted and still all required downstream.
 */
export function localTaskSourcePath(issueId: string, root: string = ROOT): string {
  return path.join(root, '.ops', 'work', `${issueId}.md`);
}

/**
 * Build a task source from repo-authored text instead of the tracker API.
 *
 * `description` wins over `descriptionFile`, which wins over the conventional
 * `.ops/work/<ID>.md`. Returns `null` when none of the three is present, so a
 * caller can fall through to the tracker rather than being forced into one
 * source or the other.
 */
export function readLocalTaskSource(
  issueId: string,
  options: { description?: string; descriptionFile?: string; root?: string } = {},
): LinearTaskSource | null {
  const root = options.root ?? ROOT;
  let description: string | null = null;
  let origin = '';

  if (options.description && options.description.trim()) {
    description = options.description;
    origin = 'flag:--description';
  } else if (options.descriptionFile && options.descriptionFile.trim()) {
    const filePath = path.isAbsolute(options.descriptionFile)
      ? options.descriptionFile
      : path.join(root, options.descriptionFile);
    if (!fs.existsSync(filePath)) {
      throw new Error(`--description-file does not exist: ${options.descriptionFile}`);
    }
    description = fs.readFileSync(filePath, 'utf8');
    origin = `file:${options.descriptionFile}`;
  } else {
    const conventional = localTaskSourcePath(issueId, root);
    if (fs.existsSync(conventional)) {
      description = fs.readFileSync(conventional, 'utf8');
      origin = `file:${relativeWorkPath(issueId)}`;
    }
  }

  if (description === null) return null;
  if (!description.trim()) {
    throw new Error(`local task contract for ${issueId} is empty (${origin})`);
  }

  // The first `# ` heading, when present, is the title -- the same role the
  // tracker's title field plays. Absent one, the identifier stands in, exactly
  // as `buildTaskContract` already falls back to the title for the objective.
  const titleMatch = description.match(/^#\s+(.+)$/mu);
  return {
    identifier: issueId.toUpperCase(),
    title: titleMatch ? titleMatch[1].trim() : issueId.toUpperCase(),
    url: origin,
    description,
  };
}

function relativeWorkPath(issueId: string): string {
  return path.join('.ops', 'work', `${issueId}.md`);
}

export function captureOrReadTaskContract(
  issueId: string,
  token: string,
  root: string = ROOT,
  runner: LinearFetchRunner = spawnSync,
  localSource: { description?: string; descriptionFile?: string } = {},
): TaskContract {
  const syncPath = path.join(root, '.ops', 'sync', `${issueId}.yml`);
  if (fs.existsSync(syncPath)) {
    const existing = fs.readFileSync(syncPath, 'utf8');
    if (/(?:^|\n)task_contract:\s*(?:\n|\{)/u.test(existing)) {
      return readTaskContract(issueId, root);
    }
  }
  // Tracker independence (ratified 2026-09-05). A repo-authored work order is
  // preferred over the tracker when one is explicitly supplied, and is the only
  // source available when there is no credential -- which is what previously
  // made a FIRST capture impossible without Linear and stranded delegation on a
  // transient `curl ETIMEDOUT`.
  //
  // Precedence is deliberate: explicit flags beat the conventional file, and
  // both beat the tracker. Falling back to the tracker AFTER an explicit local
  // source was given would silently ignore what the operator authored.
  const local = readLocalTaskSource(issueId, { ...localSource, root });
  if (local) {
    return buildTaskContract(local, packetTimestamp(), 'local-description');
  }
  return buildTaskContract(fetchLinearTaskSource(issueId, token, runner));
}

/** First value that is a non-empty string; `''` when there is none. */
export function firstNonEmpty(
  ...values: Array<string | undefined | null>
): string {
  for (const value of values) {
    // A whitespace-only value is not a usable token: `fetchLinearTaskSource`
    // rejects it via `token.trim()`, so selecting it here would strand the
    // caller instead of falling through to the next candidate. Emptiness is
    // judged on the trimmed form; the ORIGINAL value is returned unchanged.
    if (typeof value === 'string' && value.trim() !== '') return value;
  }
  return '';
}

/**
 * Two valid but different work orders for one lane is unresolvable state: the
 * executor may already be acting on either. Refuse structurally rather than
 * pick one, which would silently discard the other.
 */
export class TaskContractConflictError extends Error {
  readonly code = 'lane_contract_conflict';
  constructor(
    readonly issueId: string,
    readonly hashes: Array<{ root: string; contract_hash: string }>,
  ) {
    super(
      `lane ${issueId} has ${hashes.length} different valid task contracts: ` +
        hashes.map((h) => `${h.root} ${h.contract_hash}`).join(' vs ') +
        `. Refusing to choose. Reconcile them deliberately.`,
    );
    this.name = 'TaskContractConflictError';
  }
}

/**
 * A contract that is present but does not validate (a stale snapshot predating
 * unmapped_sections, a hash that no longer matches its content) is reported as
 * absent so it can be recaptured. Only a *valid* pair can conflict.
 */
export function readValidTaskContractAt(
  root: string,
  issueId: string,
): TaskContract | null {
  const syncPath = path.join(root, '.ops', 'sync', `${issueId}.yml`);
  if (!fs.existsSync(syncPath)) return null;
  if (
    !/(?:^|\n)task_contract:\s*(?:\n|\{)/u.test(
      fs.readFileSync(syncPath, 'utf8'),
    )
  ) {
    return null;
  }
  try {
    return readTaskContract(issueId, root);
  } catch {
    return null;
  }
}

export interface TaskContractResolution {
  contract: TaskContract;
  fetched: boolean;
  /** Index into the `roots` argument, or -1 for a fresh Linear capture. */
  rootIndex: number;
}

/**
 * Resolve one work order across every root that may hold one, WITHOUT making
 * Linear a dependency of a lane that already has a contract.
 *
 * `roots` is in precedence order: the first root holding a valid contract wins
 * when all agree. Any two valid contracts with different hashes are a refusal,
 * never a silent overwrite. Capture happens only when no root has one, and it
 * is the sole network call.
 */
export function resolveTaskContractAcrossRoots(
  issueId: string,
  roots: string[],
  token: string,
  runner: LinearFetchRunner = spawnSync,
): TaskContractResolution {
  const found: Array<{ root: string; index: number; contract: TaskContract }> =
    [];
  roots.forEach((root, index) => {
    const contract = readValidTaskContractAt(root, issueId);
    if (contract) found.push({ root, index, contract });
  });

  const distinct = new Set(found.map((entry) => entry.contract.contract_hash));
  if (distinct.size > 1) {
    throw new TaskContractConflictError(
      issueId,
      found.map((entry) => ({
        root: entry.root,
        contract_hash: entry.contract.contract_hash,
      })),
    );
  }

  const winner = found[0];
  if (winner) {
    return { contract: winner.contract, fetched: false, rootIndex: winner.index };
  }
  // Tracker independence (ratified 2026-09-05). Before reaching for the tracker,
  // look for a repo-authored work order in each root, in the SAME precedence
  // order the roots were given. This is what lets a first capture succeed with
  // no credential and no network -- the observed live failure mode was a
  // transient `curl ETIMEDOUT` on a metadata fetch aborting a lane start whose
  // work needed nothing from the tracker at all.
  for (const [index, root] of roots.entries()) {
    const local = readLocalTaskSource(issueId, { root });
    if (local) {
      return {
        contract: buildTaskContract(local, packetTimestamp(), 'local-description'),
        fetched: false,
        rootIndex: index,
      };
    }
  }
  return {
    contract: buildTaskContract(fetchLinearTaskSource(issueId, token, runner)),
    fetched: true,
    rootIndex: -1,
  };
}

/**
 * Merge against the DESTINATION's own sync record, never a different root's.
 * The control checkout holds legacy records with no contract and no accumulated
 * entities; merging a lane worktree's write against those replaced the branch's
 * findings, controls and proofs with the control copy's.
 */
export function syncContentForDestination(
  destRoot: string,
  issueId: string,
  contract: TaskContract,
): string {
  const syncPath = path.join(destRoot, '.ops', 'sync', `${issueId}.yml`);
  const existing = fs.existsSync(syncPath)
    ? fs.readFileSync(syncPath, 'utf8')
    : undefined;
  return buildSyncYmlWithTaskContract(issueId, contract, existing);
}

/** Persist one contract to every root, each merged against its own record. */
export function persistTaskContractToRoots(
  issueId: string,
  contract: TaskContract,
  roots: string[],
): void {
  for (const root of roots) {
    const syncDir = path.join(root, '.ops', 'sync');
    fs.mkdirSync(syncDir, { recursive: true });
    fs.writeFileSync(
      path.join(syncDir, `${issueId}.yml`),
      syncContentForDestination(root, issueId, contract),
      'utf8',
    );
  }
}

/**
 * Executor-facing compatibility path. A pre-contract lane captures exactly one
 * authoritative snapshot at dispatch time, persists it in the control checkout
 * and lane worktree, and then goes through the same strict packet validator as
 * every newly started lane.
 */
export function generateDispatchExecutionPacketResult(
  manifest: LaneManifest,
  env: NodeJS.ProcessEnv = process.env,
  options: DispatchPacketOptions = {},
): ExecutionPacketResult {
  const root = options.root ?? ROOT;
  try {
    // `??` only skips null/undefined. `readConfiguredEnvValue` returns '' for a
    // key it cannot resolve, so an empty LINEAR_API_TOKEN in local.env/.env
    // short-circuited the chain and capture refused as tokenless even though
    // LINEAR_API_KEY was configured. Truthy fallback, matching lane-start's
    // `linearTaskToken()`.
    const token = firstNonEmpty(
      options.linearToken,
      env['LINEAR_API_TOKEN'],
      env['LINEAR_API_KEY'],
      readConfiguredEnvValue('LINEAR_API_TOKEN'),
      readConfiguredEnvValue('LINEAR_API_KEY'),
    );

    const laneCwd = manifest.execution_location?.cwd ?? manifest.worktree_path;
    const laneRoot = path.isAbsolute(laneCwd)
      ? laneCwd
      : path.resolve(root, laneCwd);
    const laneRootExists = laneRoot !== root && fs.existsSync(laneRoot);

    // Resolve across BOTH roots before writing either. Reading only the control
    // copy and then persisting it to the lane silently replaced a lane's
    // authoritative work order -- the executor may already be acting on it --
    // while `lane-start` refused the identical conflict.
    const resolution = resolveTaskContractAcrossRoots(
      manifest.issue_id,
      laneRootExists ? [laneRoot, root] : [root],
      token,
      options.runner ?? spawnSync,
    );
    const contract = resolution.contract;

    persistTaskContractToRoots(
      manifest.issue_id,
      contract,
      laneRootExists ? [root, laneRoot] : [root],
    );

    return generateExecutionPacketResult(manifest, env, contract, root, {
      enforceSufficiency: options.enforceSufficiency,
    });
  } catch (error) {
    return executionPacketFailure(manifest, error);
  }
}

export function readTaskContract(
  issueId: string,
  root: string = ROOT,
): TaskContract {
  const syncPath = path.join(root, '.ops', 'sync', `${issueId}.yml`);
  if (!fs.existsSync(syncPath)) {
    throw new Error(
      `task contract is absent: sync record not found at ${syncPath}`,
    );
  }
  const parsed = parseYaml(fs.readFileSync(syncPath, 'utf8')) as {
    task_contract?: unknown;
  } | null;
  if (!parsed?.task_contract) {
    throw new Error(
      `task contract is absent from ${syncPath}; refusing to dispatch without a work order`,
    );
  }
  assertTaskContract(parsed.task_contract, issueId);
  return parsed.task_contract;
}

/**
 * Control characters must never reach the rendered prompt. The prompt is passed
 * as an argv element to `spawnSync`, and Node rejects an argument containing a
 * NUL byte with a bare TypeError -- crashing the dispatch instead of dropping a
 * line, which is strictly worse than the content loss this module exists to
 * prevent. An earlier revision used a NUL-prefixed sentinel and did exactly
 * that. Stripped defensively here so no future sentinel or pasted issue content
 * can reintroduce it.
 */
function stripControlChars(value: string): string {
  // eslint-disable-next-line no-control-regex
  return value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/gu, '');
}

export function renderTaskContract(contract: TaskContract): string {
  assertTaskContract(contract);
  const hasUnmapped = contract.unmapped_sections.length > 0;
  // Provenance, so the executor can judge staleness. A cached contract is served
  // without re-fetching, and the prompt tells the executor not to infer the task
  // elsewhere -- without these lines it has no way to know the snapshot is old.
  const provenance = [
    `Source issue: ${contract.source.issue_url}`,
    `Captured at: ${contract.source.captured_at}`,
  ].join('\n');
  // "(none declared)" is an assertion, not an omission. When the description
  // carried sections no whitelist consumed, the honest statement is that the
  // field was not extracted — and the content itself is rendered below, so the
  // executor is never told a guardrail does not exist when one does.
  const render = (values: string[]): string =>
    values.length > 0
      ? values.map((value) => `- ${value}`).join('\n')
      : hasUnmapped
        ? '- (not extracted — see "Additional issue content" below)'
        : '- (none declared)';
  return stripControlChars([
    `## Authoritative task contract (integrity hash ${contract.contract_hash})`,
    '',
    'This is the captured work order. Do not infer a replacement task from the branch name, file scope, an existing PR, or the repo brief.',
    '',
    provenance,
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
    // Everything the whitelists did not classify, verbatim. Without this the
    // prompt asserted a complete work order while having dropped up to 77% of
    // the description — including, on one live lane, the only line forbidding
    // a production mutation.
    ...(contract.unmapped_sections.length > 0
      ? [
          '',
          '### Additional issue content (not classified)',
          'These sections were not mapped to a field above. They are part of the work order.',
          '',
          ...contract.unmapped_sections.flatMap((entry) => {
            const nl = entry.indexOf('\n');
            // A multiline section is emitted with its body verbatim rather than
            // folded into one bullet: indenting it to satisfy markdown list
            // syntax would alter the very commands, code blocks and tables this
            // residue exists to carry intact.
            if (nl === -1) return [`- ${entry}`];
            return [`- ${entry.slice(0, nl)}`, ...entry.slice(nl + 1).split('\n'), ''];
          }),
        ]
      : []),
  ].join('\n'));
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

  // A newly admitted lane has no captured contract yet, so the strict packet
  // gate refused -- which made the policy-required standalone command unusable
  // on exactly the lanes it exists to preview. Route through the same
  // authoritative capture-and-persist the dispatch path uses, then apply the
  // identical strict validator. This is the one place a capture may happen from
  // this entry point; it is not a second, looser packet definition.
  //
  // This CLI is the ONE caller that enforces task-contract sufficiency
  // (UTV2-1750 DoD 3) -- it is what `/dispatch`'s Phase 1.5 skill-discovery
  // step runs as a preflight gate before any executor is launched. See
  // `ExecutionPacketOptions.enforceSufficiency` for why other callers
  // (claude-exec.ts, codex-exec.ts, lane-start.ts) do not.
  const result = generateDispatchExecutionPacketResult(readManifest(issueId), process.env, {
    enforceSufficiency: true,
  });
  if (!result.ok) {
    emitJson(result);
    process.exitCode = 1;
    return;
  }
  const packet = result.packet;
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
