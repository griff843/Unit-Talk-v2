/**
 * UTV2-1614 — `ops:proof-rebind`: surgical SHA rebinding for proof bundles.
 *
 * WHY THIS EXISTS
 * ---------------
 * `ops:proof-generate --merge-sha` conflates two unrelated operations:
 *
 *   1. GENERATE — build proof artifacts from a template. Destructive by design.
 *   2. REBIND   — update SHA fields inside artifacts that already exist.
 *
 * `generateProofArtifacts` writes `verification.md` from
 * `buildRuntimeVerification(input)` and only skips the overwrite when
 * `hasVerificationShaBindingMarkers(previousContent)` finds an anchor. A bundle
 * whose verification.md lacks that anchor is therefore replaced by a template —
 * captured live-DB output, TAP blocks and reviewer findings are destroyed —
 * while `sha_binding.merge_sha` can still be left stale. That is the UTV2-1614
 * defect. It has already destroyed one bundle in practice.
 *
 * This module never templates. It only rewrites explicitly enumerated binding
 * regions, and proves that every byte outside those regions is unchanged.
 *
 * SAFETY PROPERTIES (each is enforced, not documented)
 * ----------------------------------------------------
 *  - Binding regions are an allowlist. A field not on the list is never written.
 *  - Everything outside the binding regions must be byte-identical; the write is
 *    refused if it is not.
 *  - Identity and ancestry are validated against GitHub before any write. The
 *    identity core is the shared `MergedPrAttestation` shape the UTV2-1722
 *    evidence contract (proof-schema.ts) and ops:truth-check consume — this
 *    tool does not maintain a parallel notion of merge authority.
 *  - --apply is allowlisted to bundles affirmatively classified `static` by the
 *    contract's own profile rules (manifest lane_type first, authored
 *    proof_profile second, conflicts and unknowns refuse). app-runtime,
 *    migration, legacy and unclassifiable bundles are PREVIEW-ONLY here.
 *  - A preview enumerates every field and file that would change, and writes
 *    nothing.
 *  - sha256 of every file is recorded before and after.
 *  - Each file is replaced by temp-file + fsync + atomic rename, so the original
 *    bytes are never touched until a complete replacement exists on disk.
 *  - Bundle-level all-or-nothing is enforced by in-process restore, and is
 *    therefore guaranteed only against JS-level failures during a run. It is NOT
 *    a durability guarantee. Between two renames the process can be ended by
 *    SIGINT (operator Ctrl-C), SIGTERM (CI cancellation, timeout kill), SIGKILL,
 *    or host crash — in that window one file may be rebound and another not.
 *    No signal handler is installed: a handler that ran mid-rename could itself
 *    interleave with the write it is trying to undo, which is a worse failure
 *    mode than a clean partial. Recovery is deterministic instead — see
 *    PARTIAL-BUNDLE RECOVERY below.
 *
 * PARTIAL-BUNDLE RECOVERY
 * -----------------------
 * If a run is interrupted, the bundle may have some files rebound and some not.
 * Recover by re-running the SAME command without --apply first:
 *
 *   pnpm ops:proof-rebind --issue <ID> --pr <N> --merge-sha <SHA> \
 *     --approved-head <SHA> [--execution-sha <SHA>]
 *
 * The preview reports, per file, `changed: false` for anything already bound and
 * `changed: true` for anything still stale. Re-running with --apply completes
 * the transaction: a rebind is idempotent, so already-bound files are a no-op
 * and only the remaining files are written. No manual repair is required, and
 * nothing is ever double-applied. If the preview instead REFUSES, the bundle was
 * left structurally invalid and must be repaired under its own governed change —
 * this tool will not invent missing structure.
 *  - On failure every touched file — including the one that failed — is
 *    restored and re-verified, and any file that could not be recovered is
 *    reported explicitly rather than folded into a blanket success claim.
 *
 * THREE DISTINCT SHA CLASSES
 * --------------------------
 * These are routinely conflated, which is how a bundle ends up describing code
 * that does not exist at the SHA it names:
 *
 *   execution_sha     the commit the tests/evidence were actually produced at
 *   approved_head_sha the PR head that review and PM approval were bound to
 *   merge_sha         the squash commit on the protected branch
 *
 * For a squash merge the approved head is NOT an ancestor of the merge commit —
 * they are different objects with different trees. Any ancestry check that
 * assumes otherwise is wrong, so identity is validated via the PR record.
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { emitJson, getFlag, parseArgs, ROOT } from './shared.js';
import {
  declaredProfileForLaneType,
  type EvidenceProofProfile,
  type MergedPrAttestation,
} from './proof-schema.js';

export type ShaClass = 'execution_sha' | 'approved_head_sha' | 'merge_sha';

export interface ShaSet {
  execution_sha: string | null;
  approved_head_sha: string;
  merge_sha: string;
}

export interface BindingChange {
  file: string;
  locator: string;
  sha_class: ShaClass;
  before: string | null;
  after: string;
}

export interface FileChecksum {
  file: string;
  sha256_before: string;
  sha256_after: string;
  bytes_before: number;
  bytes_after: number;
  changed: boolean;
}

export interface RebindResult {
  ok: boolean;
  code:
    | 'proof_rebind_preview'
    | 'proof_rebind_applied'
    | 'proof_rebind_noop'
    | 'proof_rebind_refused'
    | 'proof_rebind_rolled_back';
  issue_id: string;
  shas: ShaSet;
  changes: BindingChange[];
  checksums: FileChecksum[];
  structural_repairs?: Array<{ file: string; locator: string; action: string }>;
  errors: string[];
  rollback?: {
    performed: boolean;
    restored_files: string[];
    checksums_match: boolean;
    possibly_corrupted?: string[];
  };
}

const SHA_PATTERN = /^[0-9a-f]{40}$/;

export function sha256(content: string): string {
  return crypto.createHash('sha256').update(content, 'utf8').digest('hex');
}

/**
 * The ONLY non-SHA values a binding row may legitimately carry before the merge
 * commit exists. Anything else in a SHA-valued row is malformed, not stale, and
 * a rebind must never overwrite a value it cannot account for: silently
 * replacing an unrecognised value is indistinguishable from destroying evidence.
 */
export const PRE_MERGE_PLACEHOLDERS = new Set([
  'pending merge',
  // The repository's canonical CI-resolved sentinels. These are not invented
  // here: they are the union of SENTINEL_VALUES in
  // packages/invariants/src/merge-sha-binding.ts and SENTINELS in
  // scripts/ci/proof-binding-validator.ts, which explicitly ALLOW them to be
  // stored in evidence.json and resolve them at runtime. Rejecting them would
  // have refused 25 real bundles. A test asserts this set stays a superset of
  // both sources, so the alignment is enforced rather than asserted in prose.
  'set-by-ci',
  'set_by_ci',
  'validated-by-ci-at-runtime',
  'pending',
  'tbd',
  'unknown',
  'null',
  'undefined',
]);

export type BindingValueKind = 'sha' | 'canonical' | 'placeholder' | 'foreign' | 'empty' | 'malformed';

/**
 * A canonical GitHub pull-request URL and nothing else. The owner/repo classes
 * are the real GitHub ones: an owner is alphanumerics and single hyphens, never
 * leading, trailing or consecutive, and at most 39 characters; a repository
 * additionally allows `.` and `_`. Looser classes accepted `a_b`, `a-`, `a--b`
 * and over-length owners, so a URL that is not a real PR URL passed as
 * canonical.
 */
// The negative lookahead caps the TOTAL owner length at 39. Bounding the
// component repetitions instead counted alphanumeric runs, not characters, so a
// 41-character hyphenated owner passed as canonical.
const GITHUB_PR_OWNER = '(?![A-Za-z0-9-]{40})[A-Za-z0-9](?:-?[A-Za-z0-9])*';
const GITHUB_PR_REPO = '[A-Za-z0-9][A-Za-z0-9._-]*';
const GITHUB_PR_URL = new RegExp(
  `^https://github\\.com/${GITHUB_PR_OWNER}/${GITHUB_PR_REPO}/pull/[1-9]\\d*$`,
);

/**
 * Strips markdown code ticks ONLY when they are balanced. An unbalanced tick —
 * `` Merge SHA: `<40hex> `` — is malformed: stripping the stray tick makes the
 * value look valid, and the rewrite then ERASES the tick, which is a byte
 * change to a value the tool never accounted for.
 */
function stripBalancedTicks(raw: string): { bare: string; unbalanced: boolean } {
  const trimmed = raw.trim();
  const lead = (trimmed.match(/^`+/) ?? [''])[0].length;
  const trail = (trimmed.match(/`+$/) ?? [''])[0].length;
  if (lead === 0 && trail === 0) return { bare: trimmed, unbalanced: false };
  if (lead > 0 && lead === trail && trimmed.length > lead + trail) {
    return { bare: trimmed.slice(lead, trimmed.length - trail).trim(), unbalanced: false };
  }
  // The load-bearing part is returning the value UNSTRIPPED: it still carries
  // its stray tick, so it can no longer match a 40-hex SHA or a placeholder and
  // classification rejects it on its own. The `unbalanced` flag makes that
  // outcome explicit at the call sites rather than incidental.
  return { bare: trimmed, unbalanced: true };
}

export interface BindingValueVerdict {
  kind: BindingValueKind;
  /** Normalised 40-hex value; only set when `kind` is `sha`. */
  sha?: string;
  /** The raw value with surrounding whitespace and markdown ticks removed. */
  bare: string;
}

/**
 * Classifies an existing SHA-valued binding value (the top-level `MERGE_SHA:`
 * line or a canonical row inside the binding section) BEFORE it is replaced.
 * A value that is neither a 40-hex SHA nor a recognised pre-merge placeholder
 * is refused rather than overwritten.
 */
export function classifyBindingValue(raw: string): BindingValueVerdict {
  const { bare, unbalanced } = stripBalancedTicks(raw);
  if (bare === '') return { kind: 'empty', bare };
  if (unbalanced) return { kind: 'malformed', bare };
  if (/^[0-9a-fA-F]{40}$/.test(bare)) return { kind: 'sha', sha: bare.toLowerCase(), bare };
  if (PRE_MERGE_PLACEHOLDERS.has(bare.toLowerCase())) return { kind: 'placeholder', bare };
  return { kind: 'malformed', bare };
}

/**
 * Classifies an existing `PR:` row value before it can be replaced. The row is
 * writable, so a value that names a DIFFERENT pull request must refuse rather
 * than be silently repointed: overwriting it would convert an inconsistent
 * bundle into a plausible one that claims approval it never received.
 */
export function classifyPrRowValue(raw: string, canonicalPrUrl: string | null): BindingValueVerdict {
  const { bare, unbalanced } = stripBalancedTicks(raw);
  if (bare === '') return { kind: 'empty', bare };
  if (unbalanced) return { kind: 'malformed', bare };
  if (PRE_MERGE_PLACEHOLDERS.has(bare.toLowerCase())) return { kind: 'placeholder', bare };
  if (!GITHUB_PR_URL.test(bare)) return { kind: 'malformed', bare };
  if (canonicalPrUrl !== null && bare !== canonicalPrUrl) return { kind: 'foreign', bare };
  return { kind: 'canonical', bare };
}

/**
 * The canonical binding-row labels. A writable row must be UNINDENTED.
 *
 * Any leading whitespace is ambiguous: four or more spaces is a markdown
 * indented code block, and one to three spaces is a list continuation — both
 * verbatim narrative that merely resembles a binding row. Rather than try to
 * tell them apart, only column zero counts, which is where every real bundle
 * writes its rows. An indented row therefore reads as ABSENT and the rebind
 * refuses, instead of rewriting narrative.
 *
 * Shared by the planner and the mask so the region the edit may touch and the
 * region the mask neutralises cannot drift apart.
 */
export const BINDING_ROW_LABELS = ['Merge SHA', 'PR', 'Approved PR head', 'Execution SHA'] as const;

/**
 * Ends the binding section. A markdown ATX heading may carry up to three
 * leading spaces, may be any level, is delimited from its text by a space OR A
 * TAB, and may be EMPTY — a bare `###` is a legal heading. Matching only an unindented `## ` missed both an indented heading
 * and a tab-delimited one, so the section appeared to run past its real end and
 * rows belonging to a later section became writable.
 *
 * Deliberately permissive: recognising MORE headings ends the section EARLIER,
 * which shrinks the writable region. Everything that would GROW the writable
 * region is strict instead — see isBindingSectionHeading and bindingRowPattern.
 */
export function isSectionHeading(line: string): boolean {
  return /^ {0,3}#{1,6}(?:[ \t]|$)/.test(line);
}

/**
 * True when `lines[index]` is the TEXT line of a setext heading — a non-blank
 * line immediately followed by a run of `=` or `-`. Setext is the other legal
 * way to write a heading in markdown, and recognising only ATX left a section
 * running past a `Appendix` / `--------` boundary, so the following rows became
 * writable. Ends the section AT the text line, which is where the heading
 * begins.
 */
export function isSetextHeadingText(lines: string[], index: number, verbatim: Set<number>): boolean {
  if (verbatim.has(index) || lines[index].trim() === '') return false;
  const underline = lines[index + 1];
  if (underline === undefined || verbatim.has(index + 1)) return false;
  return /^ {0,3}(?:=+|-+)[ \t]*$/.test(underline);
}

/**
 * The canonical binding-section anchor. Recognising it GROWS the writable
 * region, so it is strict: exact text, no indentation, nothing but trailing
 * whitespace. An indented or decorated variant is not the anchor, and the
 * rebind refuses for an absent section rather than writing into it.
 */
export function isBindingSectionHeading(line: string): boolean {
  return new RegExp(`^${MERGE_SHA_BINDING_HEADING}[ \\t]*$`).test(line);
}

export function bindingRowPattern(label?: string): RegExp {
  return new RegExp(`^(?:${label ?? BINDING_ROW_LABELS.join('|')}):`);
}

/** The single refusal message emitted when a non-binding byte would change. */
export function nonBindingRegionChangeMessage(relPath: string): string {
  return `${relPath}: refused — content outside the binding regions would change`;
}

/**
 * Applies the SAME masking the byte-for-byte guard uses, exported so the guard
 * can be driven against a genuinely mutated document.
 *
 * Like the changed-line guard, this comparison cannot be tripped from the
 * production path — the planner only ever edits regions the mask neutralises —
 * so a test that merely runs the planner and asserts no error proves nothing and
 * stays green with the comparison deleted. Exercising the masking directly with
 * a mutated pair is the only test that actually fails when it is weakened.
 */
export function nonBindingRegionChangeError(
  relPath: string,
  before: string,
  after: string,
): string | null {
  return maskWritableRegions(before) === maskWritableRegions(after)
    ? null
    : nonBindingRegionChangeMessage(relPath);
}

/**
 * Neutralises exactly the regions a rebind may write: the top-level MERGE_SHA
 * line and the canonical rows inside the binding section. Everything else —
 * narrative, blanks, indentation, and anything inside a code fence — is left
 * intact so it compares byte-for-byte.
 */
export function maskWritableRegions(text: string): string {
  // Line TERMINATORS are preserved, not normalised. Splitting on /\r?\n/ and
  // rejoining with '\n' made a CRLF->LF rewrite of non-binding bytes invisible
  // to this guard: both sides masked to the same string and it reported no
  // change. The separate CRLF check in the planner covered that inside the
  // planner, but the exported guard was wrong on its own.
  const parts = text.split(/(\r?\n)/);
  const out = parts.filter((_, i) => i % 2 === 0);
  const seps = parts.filter((_, i) => i % 2 === 1);
  const fencedHere = verbatimLineIndices(out);
  const mi = out.findIndex((l, i) => /^MERGE_SHA:\s*/.test(l) && !fencedHere.has(i));
  if (mi !== -1) out[mi] = '<<MERGE_SHA_LINE>>';
  const hi = out.findIndex((l, i) => isBindingSectionHeading(l) && !fencedHere.has(i));
  if (hi !== -1) {
    let end = out.length;
    for (let i = hi + 1; i < out.length; i += 1) {
      if (fencedHere.has(i)) continue;
      if (isSectionHeading(out[i]) || isSetextHeadingText(out, i, fencedHere)) { end = i; break; }
    }
    for (let i = hi + 1; i < end; i += 1) {
      if (!fencedHere.has(i) && bindingRowPattern().test(out[i])) {
        out[i] = `<<BINDING_ROW>>`;
      }
    }
  }
  return out.map((line, i) => `${line}${seps[i] ?? ''}`).join('');
}

/**
 * Line indices that sit INSIDE a VERBATIM region — a markdown code fence or an
 * HTML <pre> block. Both render their contents literally, so a line inside one
 * that looks like a binding row is illustrative narrative, not a binding.
 *
 * A ``` or ~~~ fence delimits verbatim content. A line inside one that looks
 * like a binding row — `Merge SHA: pending merge` shown as an example of what
 * closeout writes — is illustrative narrative, not a binding. Treating it as
 * the canonical writable row rewrote documentation inside a code fence, which
 * is precisely the "never destroy narrative" invariant this tool exists to
 * enforce, and the byte-for-byte mask could not catch it because the mask
 * neutralised the same line on both sides of the comparison.
 *
 * Fence state is computed from the start of the document so an earlier fence
 * can never be missed, and an UNTERMINATED fence marks everything after it as
 * fenced — the conservative direction, since a row that goes unrecognised
 * becomes a missing-required-row refusal rather than a silent rewrite.
 */
export function verbatimLineIndices(lines: string[]): Set<number> {
  const verbatim = new Set<number>();
  // CommonMark's literal-content HTML blocks. Only <pre> was recognised, so a
  // binding-looking line inside <script> — or <style>, or <textarea> — was
  // rewritten as though it were markdown.
  const HTML_OPEN = /<(?:pre|script|style|textarea)[\s>]/i;
  const HTML_CLOSE = /<\/(?:pre|script|style|textarea)\s*>/i;
  const FENCE = /^ {0,3}(`{3,}|~{3,})(.*)$/;
  // Inline code spans are stripped before scanning for HTML tags: a line that
  // merely MENTIONS `<pre>` inside backticks is prose about a tag, not a tag.
  const withoutInlineCode = (line: string): string => line.replace(/`+[^`]*`+/g, '');

  let state: 'none' | 'fence' | 'html' | 'comment' = 'none';
  let fence: { char: string; length: number } | null = null;
  let htmlDepth = 0;

  for (let i = 0; i < lines.length; i += 1) {
    const raw = lines[i];
    const bare = withoutInlineCode(raw);

    if (state === 'comment') {
      if (bare.includes('-->')) state = 'none';
      else verbatim.add(i);
      continue;
    }

    if (state === 'fence') {
      const match = raw.match(FENCE);
      // A closing fence must use the SAME character, be AT LEAST as long as the
      // opening run, and carry nothing but whitespace after it.
      const closes = match !== null
        && fence !== null
        && match[1][0] === fence.char
        && match[1].length >= fence.length
        && match[2].trim() === '';
      if (closes) { state = 'none'; fence = null; continue; }
      verbatim.add(i);
      continue;
    }

    if (state === 'html') {
      if (HTML_CLOSE.test(bare)) {
        htmlDepth -= 1;
        if (htmlDepth <= 0) { state = 'none'; htmlDepth = 0; }
        continue;
      }
      if (HTML_OPEN.test(bare)) { htmlDepth += 1; continue; }
      verbatim.add(i);
      continue;
    }

    // state === 'none'. A FENCE OPENER is checked FIRST and wins over any
    // tag-looking or comment-looking text on the same line: ```<pre> opens a
    // fence whose info string merely names a tag. Scanning for tags before the
    // opener consumed that line as a tag line, so the fence never opened and
    // every row inside it became writable.
    const opener = raw.match(FENCE);
    if (opener) { state = 'fence'; fence = { char: opener[1][0], length: opener[1].length }; continue; }

    const commentOpen = bare.lastIndexOf('<!--');
    if (commentOpen !== -1 && !bare.slice(commentOpen).includes('-->')) { state = 'comment'; continue; }

    if (HTML_OPEN.test(bare) && !HTML_CLOSE.test(bare)) { state = 'html'; htmlDepth = 1; continue; }
  }
  return verbatim;
}

/**
 * Refuses when the edited document differs from the original on more lines than
 * bindings were declared — a last-line defence against any future edit path that
 * rewrites content it never declared.
 *
 * Exported as a pure function ON PURPOSE. The surgical text edit replaces exact
 * value tokens and therefore cannot, by construction, trip this guard from the
 * production path; asserting "the production path does not trip its own guard"
 * is tautological and proves nothing. Exercising the guard directly against a
 * real mutated document — an undeclared line rewritten, or a line deleted — is
 * the only test that actually fails when the guard is weakened or removed.
 */
export function undeclaredLineChangeError(
  relPath: string,
  before: string,
  after: string,
  declaredChanges: number,
): string | null {
  const a = before.split('\n');
  const b = after.split('\n');
  const span = Math.max(a.length, b.length);
  let changedLines = 0;
  for (let i = 0; i < span; i += 1) {
    if (a[i] !== b[i]) changedLines += 1;
  }
  if (changedLines > declaredChanges) {
    return `${relPath}: refused — ${changedLines} lines would change but only ${declaredChanges} bindings were declared`;
  }
  return null;
}

/**
 * Evidence-bundle fields that may be rewritten, keyed by dotted path. Anything
 * absent from this map is never touched, so a future schema addition cannot be
 * silently rebound without an explicit code change and its own review.
 */
export const EVIDENCE_BINDING_FIELDS: Record<string, ShaClass> = {
  'sha_binding.merge_sha': 'merge_sha',
  'sha_binding.current_pr_head_sha': 'approved_head_sha',
  'sha_binding.verified_source_sha': 'execution_sha',
  'sha_binding.evidence_commit_sha': 'execution_sha',
};

/**
 * Fields that MUST be present in the document. An absent key is a malformed
 * bundle, not an optional binding: skipping it silently is how a bundle ends up
 * permanently missing its merge SHA. Distinguished from a key that is present
 * with an explicit null, which is the normal pre-merge state.
 */
export const REQUIRED_EVIDENCE_FIELDS = [
  'sha_binding.merge_sha',
  'sha_binding.current_pr_head_sha',
] as const;

/** `test_run_logs[].merge_sha` is bound per entry. */
export const EVIDENCE_ARRAY_BINDINGS = [
  { arrayPath: 'static_proof.test_run_logs', field: 'merge_sha', shaClass: 'merge_sha' as ShaClass },
];

export const MERGE_SHA_LINE = /^(MERGE_SHA:\s*)([0-9a-fA-F]{7,40}|pending merge.*)$/m;
export const MERGE_SHA_BINDING_HEADING = '## Merge SHA Binding';

/**
 * The proof artifacts a rebind must ALWAYS consider. Both are canonical: a
 * bundle missing either is malformed, and rebinding only the survivor is a
 * partial rebind reported as a complete one.
 */
export const CANONICAL_PROOF_ARTIFACTS = ['evidence.json', 'verification.md'] as const;

function getPath(obj: unknown, dotted: string): unknown {
  return dotted.split('.').reduce<unknown>((acc, key) => {
    if (acc && typeof acc === 'object' && key in (acc as Record<string, unknown>)) {
      return (acc as Record<string, unknown>)[key];
    }
    return undefined;
  }, obj);
}

function setPath(obj: Record<string, unknown>, dotted: string, value: unknown): void {
  const keys = dotted.split('.');
  const last = keys.pop() as string;
  let cursor: Record<string, unknown> = obj;
  for (const key of keys) {
    const next = cursor[key];
    if (!next || typeof next !== 'object') return;
    cursor = next as Record<string, unknown>;
  }
  cursor[last] = value;
}


/**
 * Highest number of times `key` appears within any single JSON object in the
 * raw text. A whole-document count is wrong: the same key name legitimately
 * appears in sibling objects. Only a repeat inside ONE object is ambiguous,
 * because JSON.parse keeps the last while a surgical text edit rewrites the
 * first. Minimal scanner: tracks string/escape state so a key-looking sequence
 * inside a narrative value is never counted.
 */
export function duplicateKeysInSameObject(text: string, key: string): number {
  const stack: Array<Map<string, number>> = [];
  const SIMPLE_ESCAPES: Record<string, string> = {
    '"': '"', '\\': '\\', '/': '/', b: '\b', f: '\f', n: '\n', r: '\r', t: '\t',
  };
  let max = 0;
  let inString = false;
  let escaped = false;
  let current = '';
  let stringStart = -1;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (inString) {
      if (escaped) {
        escaped = false;
        // DECODE the escape rather than appending it raw. JSON.parse sees the
        // DECODED name, so `"merge_sha"` is the same key as `"merge_sha"`
        // and a document can carry both. Comparing raw characters counted them
        // as different keys, so that duplicate went undetected here.
        if (ch === 'u' && /^[0-9a-fA-F]{4}$/.test(text.slice(i + 1, i + 5))) {
          current += String.fromCharCode(Number.parseInt(text.slice(i + 1, i + 5), 16));
          i += 4;
        } else {
          current += SIMPLE_ESCAPES[ch] ?? ch;
        }
        continue;
      }
      if (ch === '\\') { escaped = true; continue; }
      if (ch === '"') {
        inString = false;
        // A string is a KEY only when the next non-space character is a colon.
        let j = i + 1;
        while (j < text.length && /\s/.test(text[j])) j += 1;
        if (text[j] === ':' && stack.length > 0 && current === key) {
          const scope = stack[stack.length - 1];
          const next = (scope.get(current) ?? 0) + 1;
          scope.set(current, next);
          if (next > max) max = next;
        }
        current = '';
        continue;
      }
      current += ch;
      continue;
    }
    if (ch === '"') { inString = true; current = ''; stringStart = i; continue; }
    if (ch === '{') { stack.push(new Map()); continue; }
    if (ch === '}') { stack.pop(); continue; }
  }
  void stringStart;
  return max;
}

/**
 * Plans evidence.json changes. Returns the new content WITHOUT writing, plus
 * every field-level change. Formatting is preserved by re-serialising with the
 * same 2-space indent the bundles already use; the caller verifies that nothing
 * outside the binding fields moved.
 */
export function planEvidenceRebind(
  relPath: string,
  content: string,
  shas: ShaSet,
): { next: string; changes: BindingChange[]; errors: string[] } {
  const errors: string[] = [];
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(content) as Record<string, unknown>;
  } catch (error) {
    return { next: content, changes: [], errors: [`${relPath}: not valid JSON (${(error as Error).message})`] };
  }

  const changes: BindingChange[] = [];
  const before = JSON.parse(content) as Record<string, unknown>;

  for (const dotted of REQUIRED_EVIDENCE_FIELDS) {
    if (getPath(parsed, dotted) === undefined) {
      errors.push(`${relPath}: required binding field "${dotted}" is absent — refusing to rebind a malformed bundle`);
    }
  }

  // JSON.parse silently keeps the LAST of duplicated keys, so a document can
  // parse cleanly while carrying two conflicting bindings while the surgical
  // edit rewrites the FIRST occurrence and leaves the stale one behind. The scan
  // therefore runs over the RAW TEXT, and covers EVERY writable binding key —
  // required and optional alike. Restricting it to the required keys left the
  // optional execution/evidence SHA fields able to carry a surviving duplicate.
  // Counted per OBJECT SCOPE — the same key name legitimately appears in
  // different objects (e.g. test_run_logs entries also carry merge_sha).
  // EVERY segment of every binding path, not just the leaf. A duplicated
  // CONTAINER is exactly as ambiguous as a duplicated leaf — JSON.parse keeps
  // the last `sha_binding` object, so a document carrying a stale one first and
  // a bound one second reads as already bound, returns a clean no-op, and
  // leaves the contradictory stale object sitting in the file.
  const writableBindingKeys = new Set<string>([
    ...REQUIRED_EVIDENCE_FIELDS.flatMap((dotted) => dotted.split('.')),
    ...Object.keys(EVIDENCE_BINDING_FIELDS).flatMap((dotted) => dotted.split('.')),
    ...EVIDENCE_ARRAY_BINDINGS.flatMap((binding) => [...binding.arrayPath.split('.'), binding.field]),
  ]);
  for (const key of [...writableBindingKeys].sort()) {
    const duplicates = duplicateKeysInSameObject(content, key);
    if (duplicates > 1) {
      errors.push(
        `${relPath}: writable binding key "${key}" appears ${duplicates} times in the same object — ` +
          'ambiguous, refusing',
      );
    }
  }

  /**
   * A JSON binding field may only be overwritten when its CURRENT value is
   * accounted for: absent-as-null (the normal pre-merge state), a 40-character
   * SHA (stale or already bound), or a recognised pre-merge placeholder string.
   * Anything else — a truncated SHA, prose, a number, an object — is a
   * malformed bundle, and blindly overwriting it erases the inconsistency
   * instead of surfacing it. This is the same rule the verification.md rows
   * enforce; the JSON side was previously exempt.
   */
  const rejectMalformedJsonValue = (locator: string, current: unknown): boolean => {
    if (current === null) return false;
    if (typeof current !== 'string') {
      errors.push(
        `${relPath}: binding field "${locator}" holds a ${Array.isArray(current) ? 'array' : typeof current}, ` +
          'not a SHA string — malformed, refusing',
      );
      return true;
    }
    const verdict = classifyBindingValue(current);
    if (verdict.kind === 'sha' || verdict.kind === 'placeholder') return false;
    errors.push(
      `${relPath}: binding field "${locator}" value "${verdict.bare}" is neither a 40-character SHA ` +
        'nor a recognised pre-merge placeholder — malformed, refusing',
    );
    return true;
  };

  for (const [dotted, shaClass] of Object.entries(EVIDENCE_BINDING_FIELDS)) {
    const current = getPath(parsed, dotted);
    // Absent optional key: nothing to rebind. Absent REQUIRED keys already
    // refused above, so this can never silently skip a required binding.
    if (current === undefined) continue;
    if (rejectMalformedJsonValue(dotted, current)) continue;
    const target = shaClass === 'merge_sha'
      ? shas.merge_sha
      : shaClass === 'approved_head_sha'
        ? shas.approved_head_sha
        : shas.execution_sha;
    if (target === null) continue;
    if (current === target) continue;
    setPath(parsed, dotted, target);
    changes.push({
      file: relPath,
      locator: dotted,
      sha_class: shaClass,
      before: current === null ? null : String(current),
      after: target,
    });
  }

  for (const binding of EVIDENCE_ARRAY_BINDINGS) {
    const arr = getPath(parsed, binding.arrayPath);
    if (!Array.isArray(arr)) continue;
    arr.forEach((entry, index) => {
      if (!entry || typeof entry !== 'object') return;
      const row = entry as Record<string, unknown>;
      if (!(binding.field in row)) return;
      const current = row[binding.field];
      // Array bindings are validated exactly like the dotted fields. Applying
      // the rule only to the dotted fields left a malformed per-entry value —
      // prose, a truncated SHA — silently overwritten.
      if (rejectMalformedJsonValue(`${binding.arrayPath}[${index}].${binding.field}`, current)) return;
      if (current === shas.merge_sha) return;
      row[binding.field] = shas.merge_sha;
      changes.push({
        file: relPath,
        locator: `${binding.arrayPath}[${index}].${binding.field}`,
        sha_class: binding.shaClass,
        before: current === null || current === undefined ? null : String(current),
        after: shas.merge_sha,
      });
    });
  }

  // Apply the changes as SURGICAL TEXT EDITS to the original bytes rather than
  // re-serialising the parsed object. Re-serialisation is semantically faithful
  // but not byte-faithful: JSON.stringify normalises escapes, so a captured
  // narrative containing "\\u2014" comes back as a literal em-dash. That silently
  // rewrites evidence outside the binding fields, which this operation must
  // never do. Only the exact value tokens being rebound are touched.
  let next = content;
  let expectedByteDelta = 0;
  for (const change of changes) {
    const key = change.locator.split('.').pop()?.replace(/\[\d+\]$/, '') ?? '';
    const oldToken = `"${key}": ${change.before === null ? 'null' : JSON.stringify(change.before)}`;
    const newToken = `"${key}": ${JSON.stringify(change.after)}`;
    const index = next.indexOf(oldToken);
    if (index === -1) {
      errors.push(`${relPath}: could not locate the exact token for ${change.locator} — refusing`);
      continue;
    }
    // NOTE: taking the first match is NOT inherently unambiguous. An undeclared
    // field sharing the same key name and value can sit earlier in the byte
    // stream and be rewritten instead. What actually makes this safe is the
    // replay-equality check below, which refuses the whole write when the edited
    // document does not match the intended object. That guard is load-bearing,
    // not redundant — see the adversarial regression test.
    next = next.slice(0, index) + newToken + next.slice(index + oldToken.length);
    expectedByteDelta += newToken.length - oldToken.length;
  }

  // Prove the edit was surgical: the result must parse to exactly the object we
  // intended, AND every byte outside the rebound fields must be unchanged.
  const replay = before;
  for (const change of changes) {
    if (change.locator.includes('[')) {
      const match = change.locator.match(/^(.*)\[(\d+)\]\.(.+)$/);
      if (match) {
        const arr = getPath(replay, match[1]);
        if (Array.isArray(arr)) (arr[Number(match[2])] as Record<string, unknown>)[match[3]] = change.after;
      }
    } else {
      setPath(replay, change.locator, change.after);
    }
  }
  try {
    if (JSON.stringify(JSON.parse(next)) !== JSON.stringify(replay)) {
      errors.push(`${relPath}: refused — the edited document does not match the intended binding changes`);
    }
  } catch (error) {
    errors.push(`${relPath}: refused — edit produced invalid JSON (${(error as Error).message})`);
  }
  const lineGuardError = undeclaredLineChangeError(relPath, content, next, changes.length);
  if (lineGuardError !== null) errors.push(lineGuardError);
  // The changed-line guard is LINE-granular, so a byte added or removed on a
  // line that legitimately changed slips past it. The total byte delta must
  // therefore equal the sum of the declared token deltas exactly.
  const actualByteDelta = Buffer.byteLength(next, 'utf8') - Buffer.byteLength(content, 'utf8');
  if (actualByteDelta !== expectedByteDelta) {
    errors.push(
      `${relPath}: refused — the byte delta is ${actualByteDelta} but the declared bindings account ` +
        `for ${expectedByteDelta}`,
    );
  }

  return { next, changes, errors };
}

/**
 * Plans verification.md changes. Only two regions are writable: the top-level
 * `MERGE_SHA:` line and the body of a `## Merge SHA Binding` section. Every
 * other line must survive byte-for-byte — this is the region that the
 * destructive generate path used to overwrite with a template.
 */
export function planVerificationRebind(
  relPath: string,
  content: string,
  shas: ShaSet,
  prUrl: string | null,
): { next: string; changes: BindingChange[]; errors: string[] } {
  const errors: string[] = [];
  const changes: BindingChange[] = [];
  const hadTrailingNewline = content.endsWith('\n');
  // Preserve the file's line-ending convention. Splitting on /\r?\n/ and
  // rejoining with a bare \n silently strips CR from every rewritten line while
  // untouched lines keep theirs, producing a mixed-ending file. That is a real
  // byte-fidelity break, so the dominant convention is detected and restored.
  const crlfCount = (content.match(/\r\n/g) ?? []).length;
  const lfCount = (content.match(/\n/g) ?? []).length;
  const eol = crlfCount > 0 && crlfCount === lfCount ? '\r\n' : '\n';
  if (crlfCount > 0 && crlfCount !== lfCount) {
    errors.push(`${relPath}: mixed line endings (${crlfCount} CRLF of ${lfCount} LF) — refusing to rebind`);
  }
  const lines = content.split(/\r?\n/);
  // Lines inside a fenced code block are verbatim narrative and are never
  // writable, however much they resemble a binding row.
  const fenced = verbatimLineIndices(lines);

  // The ORIGINAL top-level value, captured and validated BEFORE any rewrite.
  // Reading it back out of `lines` after the rewrite (as this previously did)
  // compares the section row against the value just written, so a bundle whose
  // top-level line and section row carried the SAME stale SHA — the normal,
  // valid rebind input — was refused as contradictory, while a section row that
  // had already been bound past a stale top-level line passed silently.
  let originalTopMergeSha: BindingValueVerdict | null = null;

  const mergeLineIndices = lines
    .map((line, i) => (/^MERGE_SHA:\s*/.test(line) && !fenced.has(i) ? i : -1))
    .filter((i) => i !== -1);
  if (mergeLineIndices.length === 0) {
    errors.push(`${relPath}: no MERGE_SHA: line — refusing to invent one`);
  } else if (mergeLineIndices.length > 1) {
    errors.push(`${relPath}: ${mergeLineIndices.length} MERGE_SHA: lines — ambiguous, refusing`);
  } else {
    const index = mergeLineIndices[0];
    const current = lines[index].replace(/^MERGE_SHA:\s*/, '');
    const verdict = classifyBindingValue(current);
    originalTopMergeSha = verdict;
    if (verdict.kind === 'empty') {
      errors.push(`${relPath}: top-level MERGE_SHA: line has no value — malformed, refusing`);
    } else if (verdict.kind === 'malformed') {
      errors.push(
        `${relPath}: top-level MERGE_SHA: value "${verdict.bare}" is neither a 40-character SHA nor a ` +
          'recognised pre-merge placeholder — malformed, refusing',
      );
    } else if (verdict.bare !== shas.merge_sha) {
      lines[index] = `MERGE_SHA: ${shas.merge_sha}`;
      changes.push({
        file: relPath,
        locator: `line ${index + 1} (MERGE_SHA:)`,
        sha_class: 'merge_sha',
        before: verdict.bare,
        after: shas.merge_sha,
      });
    }
  }

  const headingIndices = lines
    .map((line, i) => (isBindingSectionHeading(line) && !fenced.has(i) ? i : -1))
    .filter((i) => i !== -1);
  if (headingIndices.length === 0) {
    // A partial binding must fail closed: previously the top-level line was
    // rebound while approved-head, execution SHA and PR identity were never
    // written, and the operation still reported success.
    errors.push(
      `${relPath}: required "${MERGE_SHA_BINDING_HEADING}" section is absent — ` +
        'refusing; a rebind must never invent the canonical binding section',
    );
  } else if (headingIndices.length > 1) {
    errors.push(
      `${relPath}: ${headingIndices.length} "${MERGE_SHA_BINDING_HEADING}" sections — ` +
        'ambiguous, refusing; a stale duplicate would survive the rebind',
    );
  } else {
    const headingIndex = headingIndices[0];
    let sectionEnd = lines.length;
    for (let i = headingIndex + 1; i < lines.length; i += 1) {
      if (fenced.has(i)) continue;
      if (isSectionHeading(lines[i]) || isSetextHeadingText(lines, i, fenced)) { sectionEnd = i; break; }
    }

    // Each canonical row is its own writable region. The section body is NEVER
    // replaced wholesale: any additional narrative a human put inside the
    // section is preserved byte-for-byte, along with line order, blank lines,
    // indentation and the file's EOL convention.
    const ROWS: Array<{ label: string; value: string | null; required: boolean }> = [
      { label: 'Merge SHA', value: shas.merge_sha, required: true },
      { label: 'PR', value: prUrl, required: true },
      { label: 'Approved PR head', value: shas.approved_head_sha, required: false },
      { label: 'Execution SHA', value: shas.execution_sha, required: false },
    ];

    for (const row of ROWS) {
      const matches: number[] = [];
      for (let i = headingIndex + 1; i < sectionEnd; i += 1) {
        if (fenced.has(i)) continue;
        if (bindingRowPattern(row.label).test(lines[i])) matches.push(i);
      }

      if (matches.length === 0) {
        if (row.required) {
          errors.push(`${relPath}: binding section is missing its required "${row.label}:" row — refusing`);
        }
        // Optional rows are NOT invented — inventing structure is exactly what
        // this operation must never do.
        continue;
      }
      if (matches.length > 1) {
        errors.push(
          `${relPath}: binding section has ${matches.length} "${row.label}:" rows — duplicate, refusing`,
        );
        continue;
      }

      const index = matches[0];
      const line = lines[index];
      const indent = (line.match(/^\s*/) ?? [''])[0];
      const existing = line.replace(new RegExp(`^${row.label}:\\s*`), '');

      // EVERY existing binding-row value is validated before it can be
      // replaced. A row is only overwritten when its current contents are
      // accounted for: a valid SHA (stale or already bound) or a recognised
      // pre-merge placeholder for a SHA row, and the canonical validated PR URL
      // or a placeholder for the PR row. A malformed nonempty value refuses —
      // blindly overwriting it would erase an inconsistency instead of
      // surfacing it.
      const verdict = row.label === 'PR'
        ? classifyPrRowValue(existing, prUrl)
        : classifyBindingValue(existing);
      if (verdict.kind === 'empty') {
        errors.push(`${relPath}: binding section row "${row.label}:" has no value — malformed, refusing`);
        continue;
      }
      if (verdict.kind === 'malformed') {
        errors.push(
          row.label === 'PR'
            ? `${relPath}: binding section row "PR:" value "${verdict.bare}" is neither a canonical ` +
              'GitHub pull-request URL nor a recognised pre-merge placeholder — malformed, refusing'
            : `${relPath}: binding section row "${row.label}:" value "${verdict.bare}" is neither a ` +
              '40-character SHA nor a recognised pre-merge placeholder — malformed, refusing',
        );
        continue;
      }
      if (verdict.kind === 'foreign') {
        errors.push(
          `${relPath}: binding section row "PR:" (${verdict.bare}) names a different pull request than ` +
            `the validated one (${prUrl}) — refusing`,
        );
        continue;
      }

      // Contradiction: a row already carrying a DIFFERENT concrete SHA than the
      // ORIGINAL top-level MERGE_SHA line is an inconsistent bundle, not a stale
      // one. Matching stale values are valid rebind input and must pass.
      if (
        row.label === 'Merge SHA' &&
        verdict.kind === 'sha' &&
        originalTopMergeSha !== null &&
        originalTopMergeSha.kind === 'sha' &&
        verdict.sha !== originalTopMergeSha.sha
      ) {
        errors.push(
          `${relPath}: binding section "Merge SHA:" (${verdict.sha}) contradicts the top-level ` +
            `MERGE_SHA: (${originalTopMergeSha.sha}) — refusing`,
        );
        continue;
      }

      if (row.value === null) continue;

      const replacement = `${indent}${row.label}: ${row.value}`;
      if (line !== replacement) {
        lines[index] = replacement;
        changes.push({
          file: relPath,
          locator: `${MERGE_SHA_BINDING_HEADING} > ${row.label} (line ${index + 1})`,
          sha_class: row.label === 'Approved PR head'
            ? 'approved_head_sha'
            : row.label === 'Execution SHA'
              ? 'execution_sha'
              : 'merge_sha',
          before: verdict.bare,
          after: row.value,
        });
      }
    }
  }

  let next = lines.join(eol);
  // Restore the original trailing-newline state exactly, including its absence.
  if (hadTrailingNewline && !next.endsWith(eol)) next = `${next}${eol}`;
  if (!hadTrailingNewline && next.endsWith(eol)) next = next.slice(0, -eol.length);

  // Non-binding regions must be byte-identical. ONE implementation of the
  // masking is used here and by the exported guard, so the tested behaviour and
  // the production behaviour cannot drift apart.
  const regionError = nonBindingRegionChangeError(relPath, content, next);
  if (regionError !== null) errors.push(regionError);
  // Line-ending fidelity is checked explicitly because mask() normalises them.
  // The COUNT legitimately changes (the rewritten section can add lines), so the
  // invariant is consistency: a CRLF document must not gain a bare LF.
  if (eol === '\r\n' && /(^|[^\r])\n/.test(next) && errors.length === 0) {
    errors.push(`${relPath}: refused — rewritten lines would lose their CR`);
  }

  return { next, changes, errors };
}

/**
 * The GitHub PR record a rebind validates identity against. Its authority core
 * is the SAME `MergedPrAttestation` shape the shipped UTV2-1722 evidence
 * contract (`scripts/ops/proof-schema.ts`) and `ops:truth-check` consume for
 * merged-PR attestation: rank-1 GitHub merge/head/PR-number truth, tagged with
 * its source. This tool must not grow a parallel notion of merge authority, so
 * it carries the shared type and only adds the record fields the contract does
 * not need (state, base ref, base reachability).
 */
export interface PullRequestIdentity {
  attestation: MergedPrAttestation;
  state: string;
  base_ref: string;
  merge_sha_on_base: boolean;
}

/**
 * Builds the shared `MergedPrAttestation` from a raw GitHub PR record,
 * fail-closed: an incomplete or malformed record yields named errors and no
 * attestation, exactly like the contract-side resolution refuses an incomplete
 * attestation rather than trusting whatever fields happen to be present.
 */
export function buildMergedPrAttestation(record: {
  number: unknown;
  headRefOid: unknown;
  mergeCommitOid: unknown;
}): { attestation: MergedPrAttestation | null; errors: string[] } {
  const errors: string[] = [];
  const prNumber = record.number;
  if (typeof prNumber !== 'number' || !Number.isSafeInteger(prNumber) || prNumber <= 0) {
    errors.push(`the PR record's number "${String(prNumber)}" is not a positive integer — refusing`);
  }
  const headSha = record.headRefOid;
  if (typeof headSha !== 'string' || !SHA_PATTERN.test(headSha)) {
    errors.push(`the PR record's head "${String(headSha)}" is not a 40-character SHA — refusing`);
  }
  const mergeSha = record.mergeCommitOid;
  if (mergeSha === null || mergeSha === undefined) {
    errors.push('the PR record has no merge commit recorded — refusing');
  } else if (typeof mergeSha !== 'string' || !SHA_PATTERN.test(mergeSha)) {
    errors.push(`the PR record's merge commit "${String(mergeSha)}" is not a 40-character SHA — refusing`);
  }
  if (errors.length > 0) return { attestation: null, errors };
  return {
    attestation: {
      merge_sha: mergeSha as string,
      head_sha: headSha as string,
      pr_number: prNumber as number,
      source: 'github-api',
    },
    errors: [],
  };
}

/**
 * Validates the SHA set against GitHub's record of the pull request BEFORE any
 * write. This is what stops a bundle being bound to a plausible-looking commit
 * that has nothing to do with the PR.
 *
 * Note on ancestry: a squash merge rewrites history, so the approved head is
 * NOT an ancestor of the merge commit. Asserting ancestry between them would be
 * wrong and would reject every correct squash rebind. What must hold instead is
 * that the merge commit is reachable from the base branch, and that both SHAs
 * match the PR record. The three SHA classes stay distinct throughout:
 * execution_sha is where the evidence ran, approved_head_sha is the reviewed PR
 * head, merge_sha is the base-branch commit — the same distinction the shipped
 * contract draws between an external receipt's head and
 * `sha_binding.verified_source_sha`.
 */
export function validatePrIdentity(
  shas: ShaSet,
  pr: PullRequestIdentity,
  opts: { executionShaOnBranch?: boolean } = {},
): string[] {
  const errors: string[] = [];
  const att = pr.attestation;
  if (att.source !== 'github-api') {
    errors.push(`PR #${att.pr_number}'s attestation source "${String(att.source)}" is not github-api — refusing`);
  }
  if (pr.state.toUpperCase() !== 'MERGED') {
    errors.push(`PR #${att.pr_number} is ${pr.state}, not MERGED — refusing to bind a merge SHA`);
  }
  if (att.merge_sha !== shas.merge_sha) {
    errors.push(
      `merge_sha "${shas.merge_sha}" is not PR #${att.pr_number}'s merge commit ` +
        `("${att.merge_sha}") — refusing`,
    );
  }
  if (att.head_sha !== shas.approved_head_sha) {
    errors.push(
      `approved_head_sha "${shas.approved_head_sha}" is not PR #${att.pr_number}'s head ` +
        `("${att.head_sha}") — refusing`,
    );
  }
  if (!pr.merge_sha_on_base) {
    errors.push(`merge_sha "${shas.merge_sha}" is not reachable from base branch "${pr.base_ref}" — refusing`);
  }
  // Evidence must have been produced on the PR branch at or before the approved
  // head. Nothing previously tied execution_sha to the PR at all, so a wholly
  // fabricated value passed identity validation cleanly.
  if (shas.execution_sha !== null && shas.execution_sha !== shas.approved_head_sha) {
    if (opts.executionShaOnBranch === false) {
      errors.push(
        `execution_sha "${shas.execution_sha}" is not an ancestor of the approved head ` +
          `"${shas.approved_head_sha}" — evidence cannot have been produced off the PR branch`,
      );
    } else if (opts.executionShaOnBranch === undefined) {
      errors.push(`execution_sha "${shas.execution_sha}" was not checked against the approved head — refusing`);
    }
  }
  return errors;
}


/**
 * The canonical PR URL, taken from the validated PR record and cross-checked to
 * identify that same PR. Returns null when the record yields nothing usable, so
 * the caller refuses rather than binding a URL that points elsewhere.
 */
export function deriveCanonicalPrUrl(recordUrl: string | null, prNumber: number): string | null {
  if (!recordUrl) return null;
  const match = recordUrl.match(
    new RegExp(`^https://github\\.com/${GITHUB_PR_OWNER}/${GITHUB_PR_REPO}/pull/([1-9]\\d*)$`),
  );
  if (!match) return null;
  if (Number.parseInt(match[1], 10) !== prNumber) return null;
  return recordUrl;
}

/**
 * The single proof profile a rebind may WRITE to. Everything else — app-runtime
 * (production/runtime decision truth), migration (receipts bound by the shipped
 * UTV2-1722 attestation contract), legacy or unclassifiable bundles — is
 * preview-only: those bundles carry evidence whose consumers reach beyond this
 * tool's byte-fidelity guarantees, so a rewrite of even their binding fields
 * must go through its own governed change, not a CLI flag.
 */
export const REBIND_APPLY_ALLOWED_PROFILE: EvidenceProofProfile = 'static';

export interface ApplyProfileVerdict {
  allowed: boolean;
  profile: EvidenceProofProfile | null;
  source: 'manifest-lane-type' | 'evidence' | null;
  errors: string[];
}

/**
 * HARD GUARD for --apply: classifies the bundle by the SAME precedence the
 * shipped evidence contract uses — the lane manifest's `lane_type` (via the
 * contract's own `declaredProfileForLaneType`) wins, the bundle's authored
 * `proof_profile` may not conflict with it — and permits a write ONLY for a
 * bundle affirmatively classified `static`. Fail closed: an unparseable
 * bundle, an unknown or missing profile, an unrecognised lane type (incident,
 * containment, or anything else the contract does not map), or a
 * manifest/evidence conflict all refuse. Preview never consults this guard and
 * never writes.
 */
export function resolveApplyProfileGuard(
  issueId: string,
  evidenceRaw: string,
  laneType: string | null,
): ApplyProfileVerdict {
  const refuse = (profile: EvidenceProofProfile | null, ...errors: string[]): ApplyProfileVerdict => ({
    allowed: false,
    profile,
    source: null,
    errors,
  });

  let bundle: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(evidenceRaw);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return refuse(null, `${issueId}: evidence.json is not a JSON object — cannot classify the bundle; --apply refused`);
    }
    bundle = parsed as Record<string, unknown>;
  } catch (error) {
    return refuse(
      null,
      `${issueId}: evidence.json is not valid JSON (${(error as Error).message}) — cannot classify the bundle; --apply refused`,
    );
  }

  const declared = declaredProfileForLaneType(laneType);
  const authored = bundle['proof_profile'];
  const AUTHORABLE = new Set<EvidenceProofProfile>(['app-runtime', 'migration', 'static']);

  if (authored !== undefined && (typeof authored !== 'string' || !AUTHORABLE.has(authored as EvidenceProofProfile))) {
    return refuse(
      null,
      `${issueId}: proof_profile "${String(authored)}" is not a recognised profile — cannot classify the bundle; --apply refused`,
    );
  }
  if (declared !== null && authored !== undefined && authored !== declared) {
    return refuse(
      declared,
      `${issueId}: proof_profile "${String(authored)}" conflicts with manifest lane_type "${String(laneType)}" ` +
        `(${declared}) — ambiguous classification; --apply refused`,
    );
  }
  // A lane type that IS declared but does not map to a contract profile —
  // incident, containment, or any future type — must not be overridden by the
  // bundle's self-authored profile. The manifest is the higher authority, and
  // an authority the guard cannot read fails closed.
  if (laneType !== null && laneType.trim() !== '' && declared === null) {
    return refuse(
      null,
      `${issueId}: lane_type "${laneType}" does not map to a recognised proof profile — ` +
        'unclassifiable; --apply refused (preview remains available)',
    );
  }

  const profile: EvidenceProofProfile | null = declared ?? (typeof authored === 'string' ? (authored as EvidenceProofProfile) : null);
  const source: ApplyProfileVerdict['source'] = declared !== null ? 'manifest-lane-type' : profile !== null ? 'evidence' : null;

  if (profile === null) {
    // Only reachable without a usable lane_type: the manifest-authority refusal
    // above already covered a declared-but-unmapped lane type.
    return refuse(
      null,
      `${issueId}: the bundle authors no proof_profile and no lane manifest lane_type is available — ` +
        'unclassifiable; --apply refused (preview remains available)',
    );
  }
  if (profile !== REBIND_APPLY_ALLOWED_PROFILE) {
    return refuse(
      profile,
      `${issueId}: --apply is refused for ${profile} proof bundles — ` +
        (profile === 'migration'
          ? 'migration receipts are bound by the merged-PR attestation contract and must be repaired under their own governed change'
          : 'production/runtime decision evidence must be repaired under its own governed change') +
        '; preview (without --apply) remains available and writes nothing',
    );
  }
  return { allowed: true, profile, source, errors: [] };
}

export interface RebindInput {
  issueId: string;
  shas: ShaSet;
  prUrl: string | null;
  files: string[];
  root?: string;
}

export interface StructuralRepair {
  file: string;
  locator: string;
  action: string;
}

/**
 * Repairs only the two omissions produced by the broken active schema-v2
 * generator. This is deliberately not part of the ordinary surgical planner:
 * callers may enable it only after validating a merged-PR attestation.
 * Legacy, schema-v1, migration and app-runtime evidence remain unrepairable.
 */
export function repairActiveSchemaV2Structure(
  relPath: string,
  content: string,
  shas: ShaSet,
): { next: string; repairs: StructuralRepair[]; errors: string[] } {
  if (relPath.endsWith('.json')) {
    let parsed: Record<string, unknown>;
    try {
      const candidate: unknown = JSON.parse(content);
      if (candidate === null || typeof candidate !== 'object' || Array.isArray(candidate)) {
        return { next: content, repairs: [], errors: [`${relPath}: active-schema repair requires a JSON object`] };
      }
      parsed = candidate as Record<string, unknown>;
    } catch (error) {
      return { next: content, repairs: [], errors: [`${relPath}: active-schema repair requires valid JSON (${(error as Error).message})`] };
    }
    if (parsed['schema_version'] !== 2 || parsed['proof_profile'] !== 'static') {
      return {
        next: content,
        repairs: [],
        errors: [`${relPath}: structural re-attestation is restricted to schema-v2 static proof bundles`],
      };
    }
    const binding = parsed['sha_binding'];
    if (binding === null || typeof binding !== 'object' || Array.isArray(binding)) {
      return { next: content, repairs: [], errors: [`${relPath}: sha_binding is absent or malformed`] };
    }
    if (Object.prototype.hasOwnProperty.call(binding, 'merge_sha')) {
      return { next: content, repairs: [], errors: [] };
    }
    (binding as Record<string, unknown>)['merge_sha'] = null;
    return {
      next: `${JSON.stringify(parsed, null, 2)}\n`,
      repairs: [{ file: relPath, locator: 'sha_binding.merge_sha', action: 'inserted reserved null merge slot' }],
      errors: [],
    };
  }

  if (relPath.endsWith('.md')) {
    const lines = content.split(/\r?\n/);
    if (lines.some((line) => isBindingSectionHeading(line))) {
      return { next: content, repairs: [], errors: [] };
    }
    if (!lines.some((line) => /^MERGE_SHA:\s*/.test(line))) {
      return { next: content, repairs: [], errors: [`${relPath}: no MERGE_SHA: line — refusing structural repair`] };
    }
    const eol = content.includes('\r\n') ? '\r\n' : '\n';
    const base = content.endsWith('\n') ? content : `${content}${eol}`;
    const section = [
      '',
      MERGE_SHA_BINDING_HEADING,
      '',
      'Merge SHA: pending merge',
      'PR: pending merge',
      'Approved PR head: pending merge',
      `Execution SHA: ${shas.execution_sha ?? 'pending merge'}`,
      '',
    ].join(eol);
    return {
      next: `${base}${section}`,
      repairs: [{ file: relPath, locator: MERGE_SHA_BINDING_HEADING, action: 'appended canonical binding section' }],
      errors: [],
    };
  }

  return { next: content, repairs: [], errors: [`${relPath}: unsupported artifact type for structural repair`] };
}

export interface RebindDeps {
  readFile: (absPath: string) => string;
  writeFile: (absPath: string, content: string) => void;
  exists: (absPath: string) => boolean;
}

/**
 * Write via temp file + fsync + atomic rename. A plain writeFileSync truncates
 * the target in place, so a failure mid-write (ENOSPC, crash, SIGKILL) leaves
 * the original destroyed and unrecoverable — the exact catastrophe this tool
 * exists to prevent. With rename(2) the original bytes are never touched until
 * a fully-written, fsynced replacement exists, and the swap is atomic within
 * the filesystem.
 */
export interface AtomicWriteOps {
  openSync: (target: string, flags: string) => number;
  writeFileSync: (fd: number, data: string, encoding: BufferEncoding) => void;
  fsyncSync: (fd: number) => void;
  closeSync: (fd: number) => void;
  renameSync: (from: string, to: string) => void;
  unlinkSync: (target: string) => void;
}

const nodeAtomicWriteOps: AtomicWriteOps = {
  openSync: (target, flags) => fs.openSync(target, flags),
  writeFileSync: (fd, data, encoding) => fs.writeFileSync(fd, data, encoding),
  fsyncSync: (fd) => fs.fsyncSync(fd),
  closeSync: (fd) => fs.closeSync(fd),
  renameSync: (from, to) => fs.renameSync(from, to),
  unlinkSync: (target) => fs.unlinkSync(target),
};

export function atomicWrite(target: string, content: string, ops: AtomicWriteOps = nodeAtomicWriteOps): void {
  const dir = path.dirname(target);
  const temp = path.join(dir, `.${path.basename(target)}.rebind-${process.pid}.tmp`);
  const handle = ops.openSync(temp, 'w');
  try {
    try {
      ops.writeFileSync(handle, content, 'utf8');
      ops.fsyncSync(handle);
    } finally {
      ops.closeSync(handle);
    }
  } catch (error) {
    // A failure BEFORE the rename previously left the temp file on disk,
    // unreported: the receipt named the artifact but a stray
    // `.evidence.json.rebind-<pid>.tmp` sat beside it, and a later reader could
    // mistake a half-written file for evidence. The temp is always removed.
    try { ops.unlinkSync(temp); } catch { /* best effort */ }
    throw error;
  }
  try {
    ops.renameSync(temp, target);
  } catch (error) {
    try { ops.unlinkSync(temp); } catch { /* best effort */ }
    throw error;
  }
  // Durability of the rename itself lives in the containing directory's own
  // metadata. Without this fsync the replacement can be complete on disk while
  // the directory entry still points at the old inode after a host crash.
  //
  // A failure to open or fsync the directory is PROPAGATED, never swallowed.
  // Swallowing it meant the run could report `proof_rebind_applied` — a receipt
  // asserting a durable rebind — over a rename whose durability was never
  // proven. Propagating drops the run into the rollback path instead, which
  // restores the original bytes and reports the failure. The rename has already
  // taken effect in the page cache, so restoring is still meaningful; what is
  // withheld is only the unearned success claim.
  const dirHandle = ops.openSync(dir, 'r');
  try {
    ops.fsyncSync(dirHandle);
  } finally {
    ops.closeSync(dirHandle);
  }
}

/**
 * Reads a file as UTF-8 and REFUSES if decoding was lossy.
 *
 * `readFileSync(p, 'utf8')` silently replaces invalid byte sequences with
 * U+FFFD. For a tool whose entire premise is byte fidelity that is fatal in two
 * ways at once: every checksum in the receipt would describe the DECODED text
 * rather than the bytes actually on disk — so `sha256_before` names a file that
 * never existed — and writing the decoded string back would rewrite the invalid
 * bytes, corrupting content far outside any binding region. Refusing to read is
 * the only safe outcome; repairing the encoding is a separate governed change.
 */
export function readUtf8Strict(absPath: string): string {
  const raw = fs.readFileSync(absPath);
  const text = raw.toString('utf8');
  if (!Buffer.from(text, 'utf8').equals(raw)) {
    throw new Error(
      'file is not valid UTF-8 — decoding it is lossy, so every recorded checksum would describe ' +
        'the decoded text rather than the bytes on disk, and writing it back would corrupt them',
    );
  }
  return text;
}

const defaultDeps: RebindDeps = {
  readFile: readUtf8Strict,
  writeFile: atomicWrite,
  exists: (p) => fs.existsSync(p),
};

export function validateShaSet(shas: ShaSet): string[] {
  const errors: string[] = [];
  if (!SHA_PATTERN.test(shas.merge_sha)) errors.push(`merge_sha is not a 40-character SHA: "${shas.merge_sha}"`);
  if (!SHA_PATTERN.test(shas.approved_head_sha)) errors.push(`approved_head_sha is not a 40-character SHA: "${shas.approved_head_sha}"`);
  if (shas.execution_sha !== null && !SHA_PATTERN.test(shas.execution_sha)) {
    errors.push(`execution_sha is not a 40-character SHA: "${shas.execution_sha}"`);
  }
  if (shas.merge_sha === shas.approved_head_sha) {
    errors.push('merge_sha equals approved_head_sha — a squash merge produces a distinct commit; refusing');
  }
  return errors;
}

/**
 * Plans, and optionally applies, the rebind. Atomic: every file is planned and
 * validated first; a single error means nothing is written. If a write throws
 * part-way, all previously written files are restored from their captured
 * originals and the restored checksums are re-verified.
 */
export function rebindProofBundle(
  input: RebindInput,
  options: {
    write: boolean;
    simulateWriteFailureFor?: string;
    simulatePartialWrite?: boolean;
    allowActiveSchemaStructuralRepair?: boolean;
  } = { write: false },
  deps: RebindDeps = defaultDeps,
): RebindResult {
  const root = input.root ?? ROOT;
  const errors: string[] = [...validateShaSet(input.shas)];
  const changes: BindingChange[] = [];
  const checksums: FileChecksum[] = [];
  const structuralRepairs: StructuralRepair[] = [];
  const planned: Array<{ abs: string; rel: string; before: string; next: string }> = [];

  for (const rel of input.files) {
    const abs = path.join(root, rel);
    if (!deps.exists(abs)) {
      errors.push(`${rel}: missing — refusing to create a proof artifact during a rebind`);
      continue;
    }
    let before: string;
    try {
      before = deps.readFile(abs);
    } catch (error) {
      // A read that cannot be performed faithfully is a refusal, not a crash,
      // and it must never be followed by a plan built on lossy content.
      errors.push(`${rel}: ${(error as Error).message}`);
      continue;
    }
    let planningContent = before;
    if (options.allowActiveSchemaStructuralRepair) {
      const repair = repairActiveSchemaV2Structure(rel, before, input.shas);
      errors.push(...repair.errors);
      structuralRepairs.push(...repair.repairs);
      planningContent = repair.next;
    }
    let plan: { next: string; changes: BindingChange[]; errors: string[] };
    if (rel.endsWith('.json')) {
      plan = planEvidenceRebind(rel, planningContent, input.shas);
    } else if (rel.endsWith('.md')) {
      plan = planVerificationRebind(rel, planningContent, input.shas, input.prUrl);
    } else {
      errors.push(`${rel}: unsupported artifact type for rebinding`);
      continue;
    }
    errors.push(...plan.errors);
    changes.push(...plan.changes);
    checksums.push({
      file: rel,
      sha256_before: sha256(before),
      sha256_after: sha256(plan.next),
      bytes_before: Buffer.byteLength(before, 'utf8'),
      bytes_after: Buffer.byteLength(plan.next, 'utf8'),
      changed: before !== plan.next,
    });
    planned.push({ abs, rel, before, next: plan.next });
  }

  const base: Omit<RebindResult, 'ok' | 'code'> = {
    issue_id: input.issueId,
    shas: input.shas,
    changes,
    checksums,
    errors,
    ...(structuralRepairs.length > 0 ? { structural_repairs: structuralRepairs } : {}),
  };

  if (errors.length > 0) {
    return { ...base, ok: false, code: 'proof_rebind_refused' };
  }
  if (changes.length === 0) {
    return { ...base, ok: true, code: 'proof_rebind_noop' };
  }
  if (!options.write) {
    return { ...base, ok: true, code: 'proof_rebind_preview' };
  }

  const written: Array<{ abs: string; rel: string; before: string }> = [];
  let failing: { abs: string; rel: string; before: string } | null = null;
  try {
    for (const entry of planned) {
      if (entry.before === entry.next) continue;
      // Recorded BEFORE the write so a failure part-way through this entry is
      // still restorable. Previously the entry was only tracked after a
      // successful write, so the one file actually being corrupted was the one
      // file never restored — while the receipt still claimed checksums matched.
      failing = { abs: entry.abs, rel: entry.rel, before: entry.before };
      if (options.simulateWriteFailureFor === entry.rel) {
        // Model a REAL partial write: damage the target, then throw.
        if (options.simulatePartialWrite) deps.writeFile(entry.abs, entry.next.slice(0, 10));
        throw new Error(`simulated write failure for ${entry.rel}`);
      }
      deps.writeFile(entry.abs, entry.next);
      written.push(failing);
      failing = null;
    }
  } catch (error) {
    const candidates = [...written, ...(failing ? [failing] : [])];
    for (const entry of candidates) {
      try {
        if (sha256(deps.readFile(entry.abs)) !== sha256(entry.before)) {
          deps.writeFile(entry.abs, entry.before);
        }
      } catch { /* the outcome is decided by the checksum pass below, not by whether restore threw */ }
    }
    // BOTH sets are derived from one FINAL checksum verification of every
    // touched file — never from whether a restore call threw. Deriving
    // restored_files from a non-throwing restore reported a file as restored
    // while the same file appeared in possibly_corrupted, so a single receipt
    // asserted both recovery and corruption. Partitioning one verification pass
    // makes the two sets mutually exclusive and exhaustive by construction.
    const restored: string[] = [];
    const unrecovered: string[] = [];
    for (const entry of candidates) {
      let matches = false;
      try { matches = sha256(deps.readFile(entry.abs)) === sha256(entry.before); } catch { matches = false; }
      (matches ? restored : unrecovered).push(entry.rel);
    }
    const checksumsMatch = unrecovered.length === 0;
    return {
      ...base,
      ok: false,
      code: 'proof_rebind_rolled_back',
      errors: [...errors, `write failed: ${(error as Error).message}`],
      rollback: {
        performed: true,
        restored_files: restored,
        checksums_match: checksumsMatch,
        ...(unrecovered.length > 0 ? { possibly_corrupted: unrecovered } : {}),
      },
    };
  }

  return { ...base, ok: true, code: 'proof_rebind_applied' };
}

async function main(): Promise<void> {
  const { flags, bools } = parseArgs(process.argv.slice(2));
  const issueId = (getFlag(flags, 'issue') ?? '').toUpperCase();
  const mergeSha = getFlag(flags, 'merge-sha') ?? '';
  const approvedHead = getFlag(flags, 'approved-head') ?? '';
  const executionSha = getFlag(flags, 'execution-sha') ?? null;
  const reattestActiveSchema = bools.has('reattest-active-schema') || flags.has('reattest-active-schema');
  // The PR URL is DERIVED from the validated gh record, never taken from the
  // caller. An independent --pr-url input could disagree with the PR whose
  // identity was just validated, writing a binding that points somewhere else.
  if (flags.has('pr-url') || bools.has('pr-url')) {
    emitJson({
      ok: false,
      code: 'proof_rebind_refused',
      errors: [
        '--pr-url is not accepted: the canonical PR URL is derived from the validated PR record. ' +
        'Pass --pr <number> instead.',
      ],
    });
    process.exitCode = 1;
    return;
  }
  let prUrl: string | null = null;
  // Preview is the default; writing requires an explicit --apply.
  const apply = bools.has('apply') || flags.has('apply');

  if (!issueId || !mergeSha || !approvedHead) {
    emitJson({
      ok: false,
      code: 'proof_rebind_invalid_input',
      message:
        'Missing required argument(s). Example: pnpm ops:proof-rebind --issue UTV2-1612 ' +
        '--merge-sha <40-hex> --approved-head <40-hex> [--execution-sha <40-hex>] ' +
        '[--apply]. Without --apply this previews and writes nothing.',
    });
    process.exitCode = 1;
    return;
  }

  // The issue ID becomes a PATH SEGMENT. Unvalidated, "../../.." walks the
  // rebind out of docs/06_status/proof entirely and points it at arbitrary repo
  // files — a tool that rewrites bytes must never accept an unconstrained path.
  if (!/^(UTV2|UNI)-\d+$/.test(issueId)) {
    emitJson({
      ok: false,
      code: 'proof_rebind_refused',
      issue_id: issueId,
      errors: [`--issue "${issueId}" is not a valid issue ID (UTV2-NNN or UNI-NNN) — refusing`],
    });
    process.exitCode = 1;
    return;
  }

  const proofRoot = path.posix.join('docs', '06_status', 'proof', issueId);
  // BOTH canonical artifacts are always requested. Filtering the list down to
  // the files that happen to exist meant a bundle missing evidence.json or
  // verification.md was rebound "successfully" on whatever survived — a partial
  // rebind reported as a complete one. `rebindProofBundle` refuses on a missing
  // artifact, and that refusal happens before any byte is written.
  const files = CANONICAL_PROOF_ARTIFACTS.map((name) => path.posix.join(proofRoot, name));

  const shas: ShaSet = { merge_sha: mergeSha, approved_head_sha: approvedHead, execution_sha: executionSha };

  // Identity/ancestry is validated against GitHub before any write.
  // --skip-pr-check is honoured for PREVIEW ONLY. Previously both branches of
  // this condition evaluated false when it was set, so `--apply --skip-pr-check`
  // fell straight through and wrote fabricated, unverified SHAs.
  const prNumber = getFlag(flags, 'pr');
  const skipPrCheck = bools.has('skip-pr-check') || flags.has('skip-pr-check');
  let identityValidated = false;

  if (apply && skipPrCheck) {
    emitJson({
      ok: false,
      code: 'proof_rebind_refused',
      issue_id: issueId,
      errors: ['--skip-pr-check is preview-only and can never be combined with --apply'],
    });
    process.exitCode = 1;
    return;
  }

  // HARD GUARD: --apply is allowlisted to bundles affirmatively classified
  // `static`. Runs BEFORE identity validation — a bundle this tool must never
  // write is refused without consulting the network, and no flag reaches past
  // it. Preview never enters this branch and never writes.
  if (apply) {
    const evidenceAbs = path.join(ROOT, proofRoot, 'evidence.json');
    let evidenceRaw: string | null = null;
    try {
      evidenceRaw = fs.readFileSync(evidenceAbs, 'utf8');
    } catch {
      evidenceRaw = null;
    }
    let laneType: string | null = null;
    const manifestAbs = path.join(ROOT, 'docs', '06_status', 'lanes', `${issueId}.json`);
    if (fs.existsSync(manifestAbs)) {
      try {
        const manifest = JSON.parse(fs.readFileSync(manifestAbs, 'utf8')) as Record<string, unknown>;
        laneType = typeof manifest['lane_type'] === 'string' ? manifest['lane_type'] : null;
      } catch {
        emitJson({
          ok: false,
          code: 'proof_rebind_apply_profile_refused',
          issue_id: issueId,
          errors: [`${issueId}: lane manifest exists but could not be parsed — cannot classify the bundle; --apply refused`],
        });
        process.exitCode = 1;
        return;
      }
    }
    const guard = evidenceRaw === null
      ? {
          allowed: false,
          profile: null,
          source: null,
          errors: [`${issueId}: evidence.json is unreadable — cannot classify the bundle; --apply refused`],
        }
      : resolveApplyProfileGuard(issueId, evidenceRaw, laneType);
    if (!guard.allowed) {
      emitJson({
        ok: false,
        code: 'proof_rebind_apply_profile_refused',
        issue_id: issueId,
        profile: guard.profile,
        errors: guard.errors,
      });
      process.exitCode = 1;
      return;
    }
  }

  if (prNumber && !skipPrCheck) {
    try {
      const raw = execFileSync(
        'gh',
        ['pr', 'view', prNumber, '--json', 'number,state,headRefOid,mergeCommit,baseRefName,url'],
        { encoding: 'utf8' },
      );
      const pr = JSON.parse(raw) as {
        number: number; state: string; headRefOid: string;
        mergeCommit: { oid: string } | null; baseRefName: string; url?: string;
      };
      // The identity core is the SHARED MergedPrAttestation shape the UTV2-1722
      // evidence contract consumes — built fail-closed from the GitHub record.
      const built = buildMergedPrAttestation({
        number: pr.number,
        headRefOid: pr.headRefOid,
        mergeCommitOid: pr.mergeCommit?.oid ?? null,
      });
      if (built.attestation === null) {
        emitJson({ ok: false, code: 'proof_rebind_refused', issue_id: issueId, shas, errors: built.errors });
        process.exitCode = 1;
        return;
      }
      const derivedUrl = deriveCanonicalPrUrl(pr.url ?? null, built.attestation.pr_number);
      if (derivedUrl === null) {
        emitJson({
          ok: false,
          code: 'proof_rebind_refused',
          issue_id: issueId,
          errors: [`the PR record did not yield a canonical URL identifying PR #${pr.number} — refusing`],
        });
        process.exitCode = 1;
        return;
      }
      prUrl = derivedUrl;
      const reachable = (sha: string, ref: string): boolean => {
        try { execFileSync('git', ['merge-base', '--is-ancestor', sha, ref], { stdio: 'ignore' }); return true; }
        catch { return false; }
      };
      const identityErrors = validatePrIdentity(
        shas,
        {
          attestation: built.attestation,
          state: pr.state,
          base_ref: pr.baseRefName,
          merge_sha_on_base: reachable(shas.merge_sha, `origin/${pr.baseRefName}`),
        },
        {
          executionShaOnBranch:
            shas.execution_sha === null ? true : reachable(shas.execution_sha, shas.approved_head_sha),
        },
      );
      if (identityErrors.length > 0) {
        emitJson({ ok: false, code: 'proof_rebind_refused', issue_id: issueId, shas, errors: identityErrors });
        process.exitCode = 1;
        return;
      }
      identityValidated = true;
    } catch (error) {
      emitJson({
        ok: false,
        code: 'proof_rebind_refused',
        issue_id: issueId,
        errors: [`could not validate PR identity: ${(error as Error).message}`],
      });
      process.exitCode = 1;
      return;
    }
  }

  // Belt and braces: a write is impossible without a completed validation.
  if (apply && !identityValidated) {
    emitJson({
      ok: false,
      code: 'proof_rebind_refused',
      issue_id: issueId,
      errors: ['--apply requires --pr <number> and a successful PR identity validation before writing'],
    });
    process.exitCode = 1;
    return;
  }

  if (reattestActiveSchema && !identityValidated) {
    emitJson({
      ok: false,
      code: 'proof_rebind_refused',
      issue_id: issueId,
      errors: ['--reattest-active-schema requires --pr <number> and successful merged-PR identity validation'],
    });
    process.exitCode = 1;
    return;
  }

  const result = rebindProofBundle(
    { issueId, shas, prUrl, files },
    { write: apply, allowActiveSchemaStructuralRepair: reattestActiveSchema },
  );
  emitJson(result);
  process.exitCode = result.ok ? 0 : 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  void main();
}
