import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import {
  atomicWrite,
  CANONICAL_PROOF_ARTIFACTS,
  BINDING_ROW_LABELS,
  bindingRowPattern,
  classifyBindingValue,
  classifyPrRowValue,
  EVIDENCE_BINDING_FIELDS,
  maskWritableRegions,
  PRE_MERGE_PLACEHOLDERS,
  nonBindingRegionChangeError,
  readUtf8Strict,
  verbatimLineIndices,
  isBindingSectionHeading,
  isSetextHeadingText,
  isSectionHeading,
  validatePrIdentity,
  deriveCanonicalPrUrl,
  duplicateKeysInSameObject,
  REQUIRED_EVIDENCE_FIELDS,
  planEvidenceRebind,
  planVerificationRebind,
  rebindProofBundle,
  sha256,
  undeclaredLineChangeError,
  validateShaSet,
  type AtomicWriteOps,
  type RebindDeps,
  type ShaSet,
} from './proof-rebind.js';

const MERGE = '2822b709c74c43dc24a50dc6df35597e1a0463fe';
const HEAD = 'e0464b519206ca63f707002ea91d91136750d797';
const EXEC = '6718c0de3c125beaa241bb8eb6937a7fa8e5f0bb';
const SHAS: ShaSet = { merge_sha: MERGE, approved_head_sha: HEAD, execution_sha: EXEC };

// The PR row is only ever bound to the canonical URL derived from the validated
// PR record, so the fixtures use canonical URLs — an abbreviated stand-in is now
// itself a refusal case (see the malformed/foreign PR-row tests below).
const PR_URL = 'https://github.com/griff843/Unit-Talk-v2/pull/1';
const PR_URL_1311 = 'https://github.com/griff843/Unit-Talk-v2/pull/1311';

/**
 * A verification.md carrying real captured evidence — TAP output, a live-DB
 * receipt and reviewer findings. This is precisely the content the destructive
 * generate path replaced with a template.
 */
const RICH_VERIFICATION = `# PROOF: UTV2-1592
MERGE_SHA: 0000000000000000000000000000000000000000

## Summary

Adds a mandatory pre-merge authorization gate.

## ASSERTIONS:

- [x] The merge command never runs without authorization.

## EVIDENCE:

Reviewer finding: the merge-train path bypassed the gate entirely.

## Verification

\`\`\`
$ pnpm test:db
1..7
# tests 7
# pass 7
# fail 0
\`\`\`

Live Supabase project zfzdnfwdarxucxtaojxm.

## Merge SHA Binding

Merge SHA: pending merge
PR: https://github.com/griff843/Unit-Talk-v2/pull/1311
`;

const EVIDENCE = JSON.stringify(
  {
    schema_version: 1,
    issue_id: 'UTV2-1592',
    sha_binding: {
      verified_source_sha: '1111111111111111111111111111111111111111',
      merge_sha: null,
      evidence_commit_sha: '1111111111111111111111111111111111111111',
      current_pr_head_sha: '1111111111111111111111111111111111111111',
    },
    static_proof: {
      test: { status: 'PASS', note: 'captured narrative that must survive' },
      test_run_logs: [{ path: 'scripts/ops/merge-wrapper.test.ts', merge_sha: null }],
    },
    runtime_proof: { command: 'pnpm test:db', status: 'PASS', tests: 7, pass: 7, fail: 0 },
  },
  null,
  2,
) + '\n';

function memoryDeps(files: Record<string, string>): { deps: RebindDeps; store: Record<string, string> } {
  const store = { ...files };
  return {
    store,
    deps: {
      exists: (p) => p in store,
      readFile: (p) => store[p],
      writeFile: (p, c) => { store[p] = c; },
    },
  };
}

test('validateShaSet rejects malformed SHAs and a merge SHA equal to the approved head', () => {
  assert.deepStrictEqual(validateShaSet(SHAS), []);
  assert.ok(validateShaSet({ ...SHAS, merge_sha: 'abc' }).some((e) => /merge_sha is not a 40-character SHA/.test(e)));
  assert.ok(validateShaSet({ ...SHAS, execution_sha: 'nope' }).some((e) => /execution_sha/.test(e)));
  // A squash merge always produces a distinct commit; equality means a caller
  // conflated the approved head with the merge commit.
  assert.ok(
    validateShaSet({ ...SHAS, merge_sha: HEAD }).some((e) => /equals approved_head_sha/.test(e)),
    'must refuse when merge_sha equals approved_head_sha',
  );
});

test('the three SHA classes are bound to distinct fields', () => {
  const { next, changes } = planEvidenceRebind('evidence.json', EVIDENCE, SHAS);
  const parsed = JSON.parse(next);
  assert.strictEqual(parsed.sha_binding.merge_sha, MERGE);
  assert.strictEqual(parsed.sha_binding.current_pr_head_sha, HEAD);
  assert.strictEqual(parsed.sha_binding.verified_source_sha, EXEC);
  assert.strictEqual(parsed.sha_binding.evidence_commit_sha, EXEC);
  assert.strictEqual(parsed.static_proof.test_run_logs[0].merge_sha, MERGE);

  const classes = new Set(changes.map((c) => c.sha_class));
  assert.ok(classes.has('merge_sha') && classes.has('approved_head_sha') && classes.has('execution_sha'));
});

test('captured evidence outside the binding fields survives byte-for-byte', () => {
  const { next } = planEvidenceRebind('evidence.json', EVIDENCE, SHAS);
  const before = JSON.parse(EVIDENCE);
  const after = JSON.parse(next);
  assert.deepStrictEqual(after.runtime_proof, before.runtime_proof);
  assert.strictEqual(after.static_proof.test.note, 'captured narrative that must survive');
  assert.strictEqual(after.static_proof.test.status, 'PASS');
});

test('UTV2-1592 REGRESSION: rebinding never templates over captured evidence', () => {
  // The destructive path replaced verification.md with buildRuntimeVerification()
  // output, destroying the TAP block, the live-DB receipt and reviewer findings.
  // Rebinding must touch only the two binding regions.
  const { next, changes } = planVerificationRebind('verification.md', RICH_VERIFICATION, SHAS, PR_URL_1311);

  for (const preserved of [
    '# PROOF: UTV2-1592',
    '## ASSERTIONS:',
    '- [x] The merge command never runs without authorization.',
    'Reviewer finding: the merge-train path bypassed the gate entirely.',
    '$ pnpm test:db',
    '1..7',
    '# pass 7',
    '# fail 0',
    'Live Supabase project zfzdnfwdarxucxtaojxm.',
  ]) {
    assert.ok(next.includes(preserved), `destroyed captured evidence: ${preserved}`);
  }

  assert.match(next, /^MERGE_SHA: 2822b709c74c43dc24a50dc6df35597e1a0463fe$/m);
  assert.ok(changes.some((c) => c.locator.includes('MERGE_SHA')));
  // The bundle must not shrink — the destructive symptom was 304 lines -> stub.
  assert.ok(next.split('\n').length >= RICH_VERIFICATION.split('\n').length);
});

test('a file with no MERGE_SHA: line is refused rather than invented', () => {
  const { errors } = planVerificationRebind('verification.md', RICH_VERIFICATION, SHAS, null);
  assert.deepStrictEqual(errors, []);

  const noAnchor = '# PROOF: X\n\n## Summary\n\nno binding line here\n';
  const result = planVerificationRebind('verification.md', noAnchor, SHAS, null);
  assert.ok(result.errors.some((e) => /no MERGE_SHA: line/.test(e)));
});

test('preview writes nothing and enumerates every field and file that would change', () => {
  const { deps, store } = memoryDeps({
    '/r/docs/06_status/proof/UTV2-1592/evidence.json': EVIDENCE,
    '/r/docs/06_status/proof/UTV2-1592/verification.md': RICH_VERIFICATION,
  });
  const before = { ...store };

  const result = rebindProofBundle(
    {
      issueId: 'UTV2-1592',
      shas: SHAS,
      prUrl: PR_URL_1311,
      root: '/r',
      files: ['docs/06_status/proof/UTV2-1592/evidence.json', 'docs/06_status/proof/UTV2-1592/verification.md'],
    },
    { write: false },
    deps,
  );

  assert.strictEqual(result.code, 'proof_rebind_preview');
  assert.ok(result.ok);
  assert.deepStrictEqual(store, before, 'preview must not write');
  assert.ok(result.changes.length > 0);
  assert.strictEqual(result.checksums.length, 2);
  for (const c of result.checksums) {
    assert.match(c.sha256_before, /^[0-9a-f]{64}$/);
    assert.match(c.sha256_after, /^[0-9a-f]{64}$/);
  }
});

test('apply is atomic and records before/after checksums', () => {
  const { deps, store } = memoryDeps({
    '/r/docs/06_status/proof/UTV2-1592/evidence.json': EVIDENCE,
    '/r/docs/06_status/proof/UTV2-1592/verification.md': RICH_VERIFICATION,
  });
  const result = rebindProofBundle(
    {
      issueId: 'UTV2-1592',
      shas: SHAS,
      prUrl: null,
      root: '/r',
      files: ['docs/06_status/proof/UTV2-1592/evidence.json', 'docs/06_status/proof/UTV2-1592/verification.md'],
    },
    { write: true },
    deps,
  );
  assert.strictEqual(result.code, 'proof_rebind_applied');
  for (const c of result.checksums) {
    const actual = sha256(store[`/r/${c.file}`]);
    assert.strictEqual(actual, c.sha256_after, `${c.file}: post-write checksum must match the receipt`);
  }
});

test('SIMULATED FAILURE: rollback restores the exact original checksums', () => {
  const files = {
    '/r/docs/06_status/proof/UTV2-1592/evidence.json': EVIDENCE,
    '/r/docs/06_status/proof/UTV2-1592/verification.md': RICH_VERIFICATION,
  };
  const originalChecksums = Object.fromEntries(Object.entries(files).map(([k, v]) => [k, sha256(v)]));
  const { deps, store } = memoryDeps(files);

  const result = rebindProofBundle(
    {
      issueId: 'UTV2-1592',
      shas: SHAS,
      prUrl: null,
      root: '/r',
      files: ['docs/06_status/proof/UTV2-1592/evidence.json', 'docs/06_status/proof/UTV2-1592/verification.md'],
    },
    // evidence.json writes first, then verification.md fails — proving the
    // already-written file is rolled back, not left half-applied.
    { write: true, simulateWriteFailureFor: 'docs/06_status/proof/UTV2-1592/verification.md' },
    deps,
  );

  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.code, 'proof_rebind_rolled_back');
  assert.strictEqual(result.rollback?.performed, true);
  assert.strictEqual(result.rollback?.checksums_match, true);
  for (const [file, checksum] of Object.entries(originalChecksums)) {
    assert.strictEqual(sha256(store[file]), checksum, `${file}: must be restored byte-for-byte`);
  }
});

test('a missing artifact is refused rather than created', () => {
  const { deps } = memoryDeps({ '/r/docs/06_status/proof/X/evidence.json': EVIDENCE });
  const result = rebindProofBundle(
    { issueId: 'X', shas: SHAS, prUrl: null, root: '/r', files: ['docs/06_status/proof/X/verification.md'] },
    { write: true },
    deps,
  );
  assert.strictEqual(result.code, 'proof_rebind_refused');
  assert.ok(result.errors.some((e) => /refusing to create a proof artifact/.test(e)));
});

test('an already-bound bundle is a no-op, not a rewrite', () => {
  const bound = JSON.stringify(
    {
      sha_binding: {
        merge_sha: MERGE,
        current_pr_head_sha: HEAD,
        verified_source_sha: EXEC,
        evidence_commit_sha: EXEC,
      },
    },
    null,
    2,
  ) + '\n';
  const { deps, store } = memoryDeps({ '/r/e.json': bound });
  const result = rebindProofBundle(
    { issueId: 'X', shas: SHAS, prUrl: null, root: '/r', files: ['e.json'] },
    { write: true },
    deps,
  );
  assert.strictEqual(result.code, 'proof_rebind_noop');
  assert.strictEqual(store['/r/e.json'], bound);
});

test('the binding allowlist is closed — an undeclared field is never written', () => {
  const withExtra = JSON.stringify(
    {
      sha_binding: { merge_sha: null, some_other_sha: '9999999999999999999999999999999999999999' },
    },
    null,
    2,
  ) + '\n';
  const { next, changes } = planEvidenceRebind('e.json', withExtra, SHAS);
  assert.strictEqual(JSON.parse(next).sha_binding.some_other_sha, '9999999999999999999999999999999999999999');
  assert.ok(!changes.some((c) => c.locator.includes('some_other_sha')));
  assert.ok(!Object.keys(EVIDENCE_BINDING_FIELDS).includes('sha_binding.some_other_sha'));
});

test('CLI previews by default and writes only with --apply', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'proof-rebind-cli-'));
  // shared.ts resolves ROOT via git at import time, so the fixture must be a repo.
  execFileSync('git', ['init', '-q'], { cwd: dir });
  const proofDir = path.join(dir, 'docs', '06_status', 'proof', 'UTV2-1592');
  fs.mkdirSync(proofDir, { recursive: true });
  fs.writeFileSync(path.join(proofDir, 'evidence.json'), EVIDENCE);
  fs.writeFileSync(path.join(proofDir, 'verification.md'), RICH_VERIFICATION);
  const digestBefore = sha256(fs.readFileSync(path.join(proofDir, 'verification.md'), 'utf8'));

  const script = path.join(process.cwd(), 'scripts', 'ops', 'proof-rebind.ts');
  const out = execFileSync(
    'npx',
    ['tsx', script, '--issue', 'UTV2-1592', '--merge-sha', MERGE, '--approved-head', HEAD],
    { cwd: dir, encoding: 'utf8', env: { ...process.env, PATH: process.env.PATH ?? '' } },
  );
  const parsed = JSON.parse(out);
  assert.strictEqual(parsed.code, 'proof_rebind_preview');
  assert.strictEqual(
    sha256(fs.readFileSync(path.join(proofDir, 'verification.md'), 'utf8')),
    digestBefore,
    'preview must leave the file untouched on disk',
  );
  fs.rmSync(dir, { recursive: true, force: true });
});

test('PR identity is validated before any write', () => {
  const good = {
    number: 1313, state: 'MERGED', head_sha: HEAD,
    merge_commit_sha: MERGE, base_ref: 'main', merge_sha_on_base: true,
  };
  assert.deepStrictEqual(validatePrIdentity(SHAS, good, { executionShaOnBranch: true }), []);

  assert.ok(validatePrIdentity(SHAS, { ...good, state: 'OPEN' })
    .some((e) => /not MERGED/.test(e)), 'an unmerged PR must be refused');

  assert.ok(validatePrIdentity(SHAS, { ...good, merge_commit_sha: 'f'.repeat(40) })
    .some((e) => /is not PR #1313's merge commit/.test(e)), 'a foreign merge SHA must be refused');

  assert.ok(validatePrIdentity(SHAS, { ...good, head_sha: 'a'.repeat(40) })
    .some((e) => /is not PR #1313's head/.test(e)), 'a mismatched approved head must be refused');

  assert.ok(validatePrIdentity(SHAS, { ...good, merge_sha_on_base: false })
    .some((e) => /not reachable from base branch/.test(e)), 'an unreachable merge SHA must be refused');

  assert.ok(validatePrIdentity(SHAS, { ...good, merge_commit_sha: null })
    .some((e) => /no merge commit recorded/.test(e)));
});

test('squash semantics: the approved head is NOT required to be an ancestor of the merge SHA', () => {
  // A squash merge produces a new commit with no parent link to the PR head.
  // Requiring ancestry between them would reject every correct squash rebind,
  // so identity is asserted via the PR record instead.
  const errors = validatePrIdentity(SHAS, {
    number: 1313, state: 'MERGED', head_sha: HEAD,
    merge_commit_sha: MERGE, base_ref: 'main', merge_sha_on_base: true,
  }, { executionShaOnBranch: true });
  assert.deepStrictEqual(errors, []);
  assert.notStrictEqual(SHAS.merge_sha, SHAS.approved_head_sha);
});

test('BYTE-FIDELITY: escape sequences outside the binding fields are preserved exactly', () => {
  // JSON.stringify normalises "—" to a literal em-dash. Re-serialising the
  // document would therefore silently rewrite captured narrative bytes outside
  // the binding fields. The edit must be surgical, not a re-serialisation.
  const withEscapes =
    '{\n' +
    '  "sha_binding": {\n' +
    '    "merge_sha": null,\n' +
    '    "current_pr_head_sha": null\n' +
    '  },\n' +
    '  "note": "none \\u2014 no R-level artifacts required",\n' +
    '  "unicode_tail": "caf\\u00e9"\n' +
    '}\n';

  const { next, changes, errors } = planEvidenceRebind('e.json', withEscapes, SHAS);
  assert.deepStrictEqual(errors, []);
  assert.strictEqual(changes.length, 2);

  assert.ok(next.includes('\\u2014'), 'escaped em-dash must survive byte-for-byte');
  assert.ok(next.includes('\\u00e9'), 'escaped accent must survive byte-for-byte');
  assert.ok(!next.includes('—'), 'must not normalise the escape to a literal character');

  // Exactly one line differs, and it is the bound field.
  const a = withEscapes.split('\n');
  const b = next.split('\n');
  const changed = a.map((line, i) => (line !== b[i] ? i + 1 : 0)).filter(Boolean);
  assert.strictEqual(changed.length, 2);
  assert.match(b[changed[0] - 1], /"merge_sha": "2822b709c74c43dc24a50dc6df35597e1a0463fe"/);

  // Byte length changes only by the difference between null and the SHA literal.
  const expectedDelta = ('"2822b709c74c43dc24a50dc6df35597e1a0463fe"'.length - 'null'.length)
    + ('"e0464b519206ca63f707002ea91d91136750d797"'.length - 'null'.length);
  assert.strictEqual(Buffer.byteLength(next) - Buffer.byteLength(withEscapes), expectedDelta);
});

test('the changed-line guard refuses a real mutation that touches an undeclared line', () => {
  // This replaces a tautological predecessor which only asserted that the
  // production path does not trip its own guard — true by construction, and
  // equally true with the guard deleted. The guard is a pure function precisely
  // so it can be driven with a genuinely mutated document.
  const before = '{\n  "sha_binding": {\n    "merge_sha": null\n  },\n  "note": "captured narrative"\n}\n';
  const declaredOnly = before.replace('"merge_sha": null', `"merge_sha": "${MERGE}"`);

  // The surgical, correct edit: one declared binding, one changed line.
  assert.strictEqual(undeclaredLineChangeError('e.json', before, declaredOnly, 1), null);

  // MUTATION 1 — the declared binding is rewritten AND an undeclared narrative
  // line is rewritten alongside it. Two lines change; one binding was declared.
  const alsoRewritesNarrative = declaredOnly.replace('"captured narrative"', '"silently replaced"');
  assert.match(
    undeclaredLineChangeError('e.json', before, alsoRewritesNarrative, 1) ?? '',
    /2 lines would change but only 1 bindings were declared/,
    'a rewritten undeclared line must be refused',
  );

  // MUTATION 2 — a line is DELETED. Every subsequent line shifts up, so the
  // guard must compare across the longer of the two documents; comparing only
  // over the original's indices let a tail deletion go uncounted.
  const deletesNarrative = declaredOnly.replace('  "note": "captured narrative"\n', '');
  const deletionError = undeclaredLineChangeError('e.json', before, deletesNarrative, 1);
  assert.ok(deletionError !== null, 'a deleted line must be refused');
  assert.match(deletionError, /lines would change but only 1 bindings were declared/);

  // MUTATION 3 — a line is APPENDED past the end of the original document.
  const appends = `${declaredOnly}injected trailing line\n`;
  assert.ok(
    undeclaredLineChangeError('e.json', before, appends, 1) !== null,
    'an appended line must be refused',
  );

  // WIRING, asserted in THIS test rather than only in the mask test: the review
  // measured that deleting the planner's call left this individual test green,
  // so each guard now carries its own wiring assertion. The call cannot be
  // exercised behaviourally — a token replacement never changes more lines than
  // it declares — so it is asserted against the planner's source.
  const planner = fs.readFileSync(path.join(process.cwd(), 'scripts', 'ops', 'proof-rebind.ts'), 'utf8');
  const planEvidenceBody = planner.slice(
    planner.indexOf('export function planEvidenceRebind('),
    planner.indexOf('export function planVerificationRebind('),
  );
  assert.match(
    planEvidenceBody,
    /undeclaredLineChangeError\(relPath, content, next, changes\.length\)/,
    'planEvidenceRebind must call the changed-line guard',
  );
  assert.deepStrictEqual(
    planEvidenceRebind('e.json', '{\n  "sha_binding": {\n    "merge_sha": null,\n    "current_pr_head_sha": null\n  }\n}\n', SHAS).errors,
    [],
  );
});

// ---------------------------------------------------------------------------
// Findings from the exact-head review of 612b8ca1. Each test fails if its fix
// is reverted; every refusal must also write zero bytes.
// ---------------------------------------------------------------------------

const SECTION = '\n## Merge SHA Binding\n\nMerge SHA: pending merge\nPR: https://github.com/griff843/Unit-Talk-v2/pull/1\n';

function md(body: string): string {
  return `# PROOF: X\nMERGE_SHA: 0000000000000000000000000000000000000000\n\n## Summary\n\n${body}`;
}

test('P0: a missing "## Merge SHA Binding" section is refused, not silently partial', () => {
  const doc = md('no binding section here\n');
  const { errors, changes } = planVerificationRebind('v.md', doc, SHAS, null);
  assert.ok(errors.some((e) => /section is absent/.test(e)), `expected refusal, got: ${errors.join('|')}`);
  assert.ok(!(errors.length === 0 && changes.length > 0), 'must not report success with only a partial binding');
});

test('P0: a duplicate binding section is refused so no stale section survives', () => {
  const doc = md('body\n') + SECTION + SECTION;
  const { errors } = planVerificationRebind('v.md', doc, SHAS, null);
  assert.ok(errors.some((e) => /sections — ambiguous/.test(e)));
});

test('each canonical row is its own writable region; every other byte survives', () => {
  const section = (body) => md('body\n') + '\n## Merge SHA Binding\n' + body;

  // Required rows missing -> refuse. Optional rows are never invented.
  const noMerge = planVerificationRebind('v.md', section('\nPR: https://github.com/griff843/Unit-Talk-v2/pull/1\n'), SHAS, PR_URL).errors;
  assert.ok(noMerge.some((e) => /missing its required "Merge SHA:" row/.test(e)));
  const noPr = planVerificationRebind('v.md', section('\nMerge SHA: pending merge\n'), SHAS, PR_URL).errors;
  assert.ok(noPr.some((e) => /missing its required "PR:" row/.test(e)));

  // Duplicate row -> refuse.
  const dup = planVerificationRebind(
    'v.md', section('\nMerge SHA: a\nMerge SHA: b\nPR: https://github.com/griff843/Unit-Talk-v2/pull/1\n'), SHAS, PR_URL).errors;
  assert.ok(dup.some((e) => /has 2 "Merge SHA:" rows — duplicate/.test(e)));

  // Malformed (valueless) row -> refuse.
  const empty = planVerificationRebind(
    'v.md', section('\nMerge SHA:\nPR: https://github.com/griff843/Unit-Talk-v2/pull/1\n'), SHAS, PR_URL).errors;
  assert.ok(empty.some((e) => /has no value — malformed/.test(e)));

  // Contradictory concrete SHAs between the row and the top-level line -> refuse.
  const contradictory =
    '# P\nMERGE_SHA: ' + 'a'.repeat(40) + '\n\n## Merge SHA Binding\n\nMerge SHA: ' + 'b'.repeat(40) +
    '\nPR: https://github.com/griff843/Unit-Talk-v2/pull/1\n';
  const contra = planVerificationRebind('v.md', contradictory, SHAS, PR_URL).errors;
  assert.ok(contra.some((e) => /contradicts the top-level MERGE_SHA:/.test(e)));
});

test('NARRATIVE PRESERVATION: additional lines in the section survive byte-for-byte', () => {
  const doc =
    md('body\n') +
    '\n## Merge SHA Binding\n' +
    '\nMerge SHA: pending merge\n' +
    'PR: https://github.com/griff843/Unit-Talk-v2/pull/1\n' +
    '\n' +
    'This section is the machine-rebindable anchor `ops:proof-generate` rewrites\n' +
    '   at closeout. Indented continuation line with  double  spaces.\n' +
    '\n' +
    'Operator note: do not lose this.\n';

  const { next, changes, errors } = planVerificationRebind('v.md', doc, SHAS, PR_URL);
  assert.deepStrictEqual(errors, [], 'narrative must be preserved, not refused');

  // Exactly two writable regions changed: the top-level line and the section's
  // Merge SHA row. The PR row already carried the correct value.
  assert.deepStrictEqual(changes.map((c) => c.locator), [
    'line 2 (MERGE_SHA:)',
    '## Merge SHA Binding > Merge SHA (line 10)',
  ]);

  for (const preserved of [
    'This section is the machine-rebindable anchor `ops:proof-generate` rewrites',
    '   at closeout. Indented continuation line with  double  spaces.',
    'Operator note: do not lose this.',
  ]) {
    assert.ok(next.includes(preserved), `narrative line destroyed: ${preserved}`);
  }

  // Line order, count and blank lines are identical; exactly one line differs.
  const a = doc.split('\n');
  const b = next.split('\n');
  assert.strictEqual(a.length, b.length, 'line count must not change');
  const differing = a.map((l, i) => (l !== b[i] ? i : -1)).filter((i) => i !== -1);
  assert.strictEqual(differing.length, 2, 'only the two binding rows may differ');
  assert.match(b[differing[0]], /^MERGE_SHA: 2822b709c74c43dc24a50dc6df35597e1a0463fe$/);
  assert.match(b[differing[1]], /^Merge SHA: 2822b709c74c43dc24a50dc6df35597e1a0463fe$/);
  assert.ok(next.endsWith('\n'), 'trailing-newline state preserved');
});

test('NARRATIVE PRESERVATION holds under CRLF and without a trailing newline', () => {
  const base =
    md('body\n') + '\n## Merge SHA Binding\n\nMerge SHA: pending merge\nPR: https://github.com/griff843/Unit-Talk-v2/pull/1\n' +
    '\nKeep this narrative.\n';
  const crlf = base.replace(/\n/g, '\r\n').replace(/\r\n$/, '');
  assert.ok(!crlf.endsWith('\n'));

  const { next, errors } = planVerificationRebind('v.md', crlf, SHAS, PR_URL);
  assert.deepStrictEqual(errors, []);
  assert.ok(next.includes('Keep this narrative.'), 'narrative must survive');
  assert.ok(!/(^|[^\r])\n/.test(next), 'CRLF convention preserved');
  assert.ok(!next.endsWith('\n'), 'absent trailing newline preserved');
});

test('P0: duplicate MERGE_SHA: lines are refused as ambiguous', () => {
  const doc = '# P\nMERGE_SHA: 1111111111111111111111111111111111111111\nMERGE_SHA: 2222222222222222222222222222222222222222\n' + SECTION;
  const { errors } = planVerificationRebind('v.md', doc, SHAS, null);
  assert.ok(errors.some((e) => /MERGE_SHA: lines — ambiguous/.test(e)));
});

test('P0: an ABSENT required JSON field is refused, not silently skipped', () => {
  // The key never existed — distinct from present-with-null, which is normal pre-merge.
  const doc = JSON.stringify({ sha_binding: { current_pr_head_sha: null } }, null, 2) + '\n';
  const { errors } = planEvidenceRebind('e.json', doc, SHAS);
  assert.ok(errors.some((e) => /required binding field "sha_binding.merge_sha" is absent/.test(e)));
  assert.ok(REQUIRED_EVIDENCE_FIELDS.includes('sha_binding.merge_sha'));
});

test('P0: every refusal writes zero bytes', () => {
  const cases: Record<string, string> = {
    '/r/a.md': md('no section\n'),
    '/r/b.md': md('x\n') + SECTION + SECTION,
    '/r/c.json': JSON.stringify({ sha_binding: { current_pr_head_sha: null } }, null, 2) + '\n',
  };
  for (const [file, content] of Object.entries(cases)) {
    const { deps, store } = memoryDeps({ [file]: content });
    const snapshot = { ...store };
    const result = rebindProofBundle(
      { issueId: 'X', shas: SHAS, prUrl: null, root: '/r', files: [file.replace('/r/', '')] },
      { write: true },
      deps,
    );
    assert.strictEqual(result.code, 'proof_rebind_refused', `${file} must refuse`);
    assert.deepStrictEqual(store, snapshot, `${file}: a refusal wrote bytes`);
  }
});

test('P1: CRLF line endings survive the rebind byte-for-byte', () => {
  const doc = (md('body\n') + SECTION).replace(/\n/g, '\r\n');
  const { next, errors } = planVerificationRebind('v.md', doc, SHAS, null);
  assert.deepStrictEqual(errors, []);
  // The rewritten section legitimately adds lines, so the CR COUNT changes.
  // The invariant is consistency: every LF must still be preceded by a CR.
  assert.ok(!/(^|[^\r])\n/.test(next), 'a CRLF document must not gain a bare LF');
  assert.strictEqual(
    (next.match(/\r\n/g) ?? []).length,
    next.split(/\r?\n/).length - 1,
    'every line break must be CRLF',
  );
  // Untouched narrative lines keep their exact bytes.
  assert.ok(next.includes('## Summary\r\n'), 'untouched lines must retain CRLF');
});

test('P1: absence of a trailing newline is preserved', () => {
  const doc = (md('body\n') + SECTION).replace(/\n$/, '');
  assert.ok(!doc.endsWith('\n'));
  const { next, errors } = planVerificationRebind('v.md', doc, SHAS, null);
  assert.deepStrictEqual(errors, []);
  assert.ok(!next.endsWith('\n'), 'must not invent a trailing newline');
});

test('P1 ADVERSARIAL: the replay guard is load-bearing — an undeclared same-key field cannot be rewritten', () => {
  // An undeclared field sharing the key name and value sits EARLIER in the byte
  // stream, so a naive first-match walk rewrites the wrong one. Removing the
  // replay-equality guard previously left all tests green while corrupting data.
  const doc = JSON.stringify(
    { metadata: { merge_sha: null }, sha_binding: { merge_sha: null, current_pr_head_sha: null } },
    null,
    2,
  ) + '\n';
  const { next, errors } = planEvidenceRebind('e.json', doc, SHAS);
  if (errors.length === 0) {
    const parsed = JSON.parse(next);
    assert.strictEqual(parsed.metadata.merge_sha, null, 'an undeclared field must never be rewritten');
    assert.strictEqual(parsed.sha_binding.merge_sha, MERGE, 'the declared field must be the one rebound');
  } else {
    assert.ok(errors.some((e) => /does not match the intended binding changes/.test(e)));
  }
});

test('P1: execution_sha is validated against the approved head', () => {
  const pr = {
    number: 1, state: 'MERGED', head_sha: HEAD,
    merge_commit_sha: MERGE, base_ref: 'main', merge_sha_on_base: true,
  };
  assert.deepStrictEqual(validatePrIdentity(SHAS, pr, { executionShaOnBranch: true }), []);
  assert.ok(
    validatePrIdentity(SHAS, pr, { executionShaOnBranch: false }).some((e) => /not an ancestor of the approved head/.test(e)),
    'a fabricated execution_sha must be refused',
  );
  assert.ok(
    validatePrIdentity(SHAS, pr).some((e) => /was not checked against the approved head/.test(e)),
    'an unchecked execution_sha must refuse rather than pass silently',
  );
});

test('P0: a PARTIAL write on the failing file is detected and restored', () => {
  const files = {
    '/r/e.json': EVIDENCE,
    '/r/v.md': RICH_VERIFICATION,
  };
  const originals = Object.fromEntries(Object.entries(files).map(([k, v]) => [k, sha256(v)]));
  const { deps, store } = memoryDeps(files);

  const result = rebindProofBundle(
    { issueId: 'X', shas: SHAS, prUrl: null, root: '/r', files: ['e.json', 'v.md'] },
    { write: true, simulateWriteFailureFor: 'v.md', simulatePartialWrite: true },
    deps,
  );

  assert.strictEqual(result.code, 'proof_rebind_rolled_back');
  assert.strictEqual(result.rollback?.checksums_match, true);
  assert.strictEqual(result.rollback?.possibly_corrupted, undefined);
  // The file that was actively being written must be restored too — previously
  // it was excluded from both restore and the checksum claim.
  for (const [file, digest] of Object.entries(originals)) {
    assert.strictEqual(sha256(store[file]), digest, `${file} must be restored byte-for-byte`);
  }
});

test('the canonical PR URL is derived from the validated record, never from a caller input', () => {
  const canonical = 'https://github.com/griff843/Unit-Talk-v2/pull/1315';
  assert.strictEqual(deriveCanonicalPrUrl(canonical, 1315), canonical);

  // Missing.
  assert.strictEqual(deriveCanonicalPrUrl(null, 1315), null);
  assert.strictEqual(deriveCanonicalPrUrl('', 1315), null);
  // Malformed.
  assert.strictEqual(deriveCanonicalPrUrl('not-a-url', 1315), null);
  assert.strictEqual(deriveCanonicalPrUrl('https://github.com/o/r/issues/1315', 1315), null);
  assert.strictEqual(deriveCanonicalPrUrl('http://github.com/o/r/pull/1315', 1315), null);
  assert.strictEqual(deriveCanonicalPrUrl('https://evil.example/o/r/pull/1315', 1315), null);
  // Identifies a DIFFERENT PR than the one validated.
  assert.strictEqual(deriveCanonicalPrUrl('https://github.com/o/r/pull/9999', 1315), null);
  // Trailing junk must not be accepted.
  assert.strictEqual(deriveCanonicalPrUrl(`${canonical}/files`, 1315), null);
});

test('duplicate binding keys are detected per object scope, not per document', () => {
  // Same key in SIBLING objects is legitimate and must not refuse.
  const siblings = JSON.stringify(
    { sha_binding: { merge_sha: null, current_pr_head_sha: null },
      static_proof: { test_run_logs: [{ merge_sha: null }, { merge_sha: null }] } },
    null, 2) + '\n';
  assert.strictEqual(duplicateKeysInSameObject(siblings, 'merge_sha'), 1);
  assert.deepStrictEqual(planEvidenceRebind('e.json', siblings, SHAS).errors, []);

  // The SAME key twice in ONE object is ambiguous: JSON.parse keeps the last,
  // the surgical edit rewrites the first, so the stale one would survive.
  const dup = '{\n  "sha_binding": {\n    "merge_sha": null,\n    "merge_sha": null,\n    "current_pr_head_sha": null\n  }\n}\n';
  assert.strictEqual(duplicateKeysInSameObject(dup, 'merge_sha'), 2);
  assert.ok(
    planEvidenceRebind('e.json', dup, SHAS).errors.some((e) => /appears 2 times in the same object/.test(e)),
  );

  // A key-looking sequence inside a narrative VALUE must never be counted.
  const narrative = '{\n  "sha_binding": {\n    "merge_sha": null,\n    "current_pr_head_sha": null,\n    "note": "the field \\"merge_sha\\": was stale"\n  }\n}\n';
  assert.strictEqual(duplicateKeysInSameObject(narrative, 'merge_sha'), 1);
  assert.deepStrictEqual(planEvidenceRebind('e.json', narrative, SHAS).errors, []);
});

test('the partial-bundle limitation names the signals and gives exact recovery guidance', () => {
  const source = fs.readFileSync(path.join(process.cwd(), 'scripts', 'ops', 'proof-rebind.ts'), 'utf8');
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGKILL']) {
    assert.ok(source.includes(signal), `the limitation must name ${signal}`);
  }
  assert.match(source, /PARTIAL-BUNDLE RECOVERY/);
  assert.match(source, /pnpm ops:proof-rebind --issue <ID> --pr <N>/);
  assert.match(source, /idempotent/);
});

test('possibly_corrupted is derived from final checksums, not from whether restore threw', () => {
  // A restore that returns WITHOUT error but leaves different bytes must still
  // be reported. Deriving the field from the restore call's success would report
  // a clean rollback over a corrupted file.
  const files = { '/r/e.json': EVIDENCE, '/r/v.md': RICH_VERIFICATION };
  const store: Record<string, string> = { ...files };
  const deps: RebindDeps = {
    exists: (p) => p in store,
    readFile: (p) => store[p],
    writeFile: (p, c) => {
      // Silently refuse to restore v.md: no throw, but the bytes stay wrong.
      if (p === '/r/v.md' && c === RICH_VERIFICATION) { store[p] = 'STILL CORRUPT'; return; }
      store[p] = c;
    },
  };

  const result = rebindProofBundle(
    { issueId: 'X', shas: SHAS, prUrl: null, root: '/r', files: ['e.json', 'v.md'] },
    { write: true, simulateWriteFailureFor: 'v.md', simulatePartialWrite: true },
    deps,
  );

  assert.strictEqual(result.code, 'proof_rebind_rolled_back');
  assert.strictEqual(result.rollback?.checksums_match, false, 'a silently-failed restore must not report a match');
  assert.deepStrictEqual(result.rollback?.possibly_corrupted, ['v.md']);
  // The file that DID restore cleanly must not be listed.
  assert.strictEqual(sha256(store['/r/e.json']), sha256(EVIDENCE));
});

/**
 * A real-filesystem `AtomicWriteOps` with a single injected fault. Everything
 * else goes through node's fs, so the ordering under test is the production
 * ordering, not a re-implementation of it.
 */
function faultyOps(fault: { on: 'dir-open' | 'dir-fsync' }): { ops: AtomicWriteOps; calls: string[] } {
  const calls: string[] = [];
  const dirHandles = new Set<number>();
  return {
    calls,
    ops: {
      openSync: (target, flags) => {
        // The temp file does not exist yet when it is opened with 'w'.
        const isDir = fs.existsSync(target) && fs.statSync(target).isDirectory();
        if (isDir) {
          calls.push('dir-open');
          if (fault.on === 'dir-open') throw new Error('simulated directory open failure');
        }
        const fd = fs.openSync(target, flags);
        if (isDir) dirHandles.add(fd);
        return fd;
      },
      writeFileSync: (fd, data, encoding) => { calls.push('write'); fs.writeFileSync(fd, data, encoding); },
      fsyncSync: (fd) => {
        const isDir = dirHandles.has(fd);
        calls.push(isDir ? 'dir-fsync' : 'file-fsync');
        if (isDir && fault.on === 'dir-fsync') throw new Error('simulated directory fsync failure');
        fs.fsyncSync(fd);
      },
      closeSync: (fd) => { calls.push(dirHandles.has(fd) ? 'dir-close' : 'file-close'); fs.closeSync(fd); },
      renameSync: (from, to) => { calls.push('rename'); fs.renameSync(from, to); },
      unlinkSync: (target) => { calls.push('unlink'); fs.unlinkSync(target); },
    },
  };
}

test('a parent-directory open or fsync failure is PROPAGATED, never swallowed', () => {
  // Without the directory fsync the replacement can be complete on disk while
  // the directory entry still points at the old inode after a host crash.
  // Swallowing its failure produced a durability claim that was never earned.
  for (const on of ['dir-open', 'dir-fsync'] as const) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), `proof-rebind-fsync-${on}-`));
    const target = path.join(dir, 'evidence.json');
    fs.writeFileSync(target, EVIDENCE);
    const { ops, calls } = faultyOps({ on });

    assert.throws(
      () => atomicWrite(target, 'rebound', ops),
      new RegExp(`simulated directory ${on === 'dir-open' ? 'open' : 'fsync'} failure`),
      `${on}: the failure must propagate out of atomicWrite`,
    );

    // Ordering is the production ordering: the file is fsynced, then renamed,
    // and only then is the containing directory fsynced.
    assert.ok(calls.indexOf('file-fsync') < calls.indexOf('rename'), `${on}: file fsync must precede the rename`);
    assert.ok(calls.indexOf('rename') < calls.indexOf('dir-open'), `${on}: the directory is fsynced AFTER the rename`);
    // No temp file is left behind for a caller to mistake for the artifact.
    assert.deepStrictEqual(
      fs.readdirSync(dir).filter((n) => n.includes('.rebind-')),
      [],
      `${on}: no temp file may survive`,
    );
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a durability failure can never be reported as proof_rebind_applied', () => {
  // Mirrors what atomicWrite now does when the directory fsync fails: the bytes
  // land (rename already took effect) and the call then throws. The run must
  // roll back and report the failure, never emit an applied receipt.
  const files = { '/r/e.json': EVIDENCE, '/r/v.md': RICH_VERIFICATION };
  const originals = Object.fromEntries(Object.entries(files).map(([k, v]) => [k, sha256(v)]));
  const store: Record<string, string> = { ...files };
  let durabilityFailed = false;
  const deps: RebindDeps = {
    exists: (p) => p in store,
    readFile: (p) => store[p],
    writeFile: (p, c) => {
      store[p] = c;
      if (!durabilityFailed && p === '/r/e.json' && c !== EVIDENCE) {
        durabilityFailed = true;
        throw new Error('simulated directory fsync failure');
      }
    },
  };

  const result = rebindProofBundle(
    { issueId: 'X', shas: SHAS, prUrl: null, root: '/r', files: ['e.json', 'v.md'] },
    { write: true },
    deps,
  );

  assert.notStrictEqual(result.code, 'proof_rebind_applied', 'durability was not proven — applied is a false receipt');
  assert.strictEqual(result.code, 'proof_rebind_rolled_back');
  assert.ok(result.errors.some((e) => /simulated directory fsync failure/.test(e)));
  assert.strictEqual(result.rollback?.checksums_match, true);
  for (const [file, digest] of Object.entries(originals)) {
    assert.strictEqual(sha256(store[file]), digest, `${file} must be restored byte-for-byte`);
  }
});

test('restored_files and possibly_corrupted are disjoint and both come from the final checksum pass', () => {
  const files = { '/r/e.json': EVIDENCE, '/r/v.md': RICH_VERIFICATION };
  const store: Record<string, string> = { ...files };
  const deps: RebindDeps = {
    exists: (p) => p in store,
    readFile: (p) => store[p],
    // v.md's restore returns cleanly but leaves the wrong bytes.
    writeFile: (p, c) => { store[p] = p === '/r/v.md' && c === RICH_VERIFICATION ? 'STILL CORRUPT' : c; },
  };

  const result = rebindProofBundle(
    { issueId: 'X', shas: SHAS, prUrl: null, root: '/r', files: ['e.json', 'v.md'] },
    { write: true, simulateWriteFailureFor: 'v.md', simulatePartialWrite: true },
    deps,
  );

  const restored = result.rollback?.restored_files ?? [];
  const corrupted = result.rollback?.possibly_corrupted ?? [];
  assert.deepStrictEqual(restored, ['e.json'], 'only the file that verified clean may be reported restored');
  assert.deepStrictEqual(corrupted, ['v.md']);
  assert.deepStrictEqual(
    restored.filter((f) => corrupted.includes(f)),
    [],
    'a file must never be reported both restored and possibly corrupted',
  );
  // Exhaustive: every touched file lands in exactly one of the two sets.
  assert.deepStrictEqual([...restored, ...corrupted].sort(), ['e.json', 'v.md']);
});

test('the recovery guidance is present as a section, not merely mentioned', () => {
  const source = fs.readFileSync(path.join(process.cwd(), 'scripts', 'ops', 'proof-rebind.ts'), 'utf8');
  const occurrences = (source.match(/PARTIAL-BUNDLE RECOVERY/g) ?? []).length;
  assert.ok(occurrences >= 2, 'must be both cross-referenced and present as a heading');
  const heading = source.indexOf(' * PARTIAL-BUNDLE RECOVERY\n * -----');
  assert.ok(heading >= 0, 'the recovery section heading must exist');
});

// ---------------------------------------------------------------------------
// Findings from the exact-head review of da298435.
// ---------------------------------------------------------------------------

test('P1: the ORIGINAL top-level MERGE_SHA is captured before any rewrite', () => {
  // The section row was previously compared against the top-level line AFTER
  // that line had already been rewritten, so the comparison was against the
  // value being written rather than the value the bundle carried.

  // (a) MATCHING STALE values are valid rebind input. Both carry the same stale
  //     SHA; both must rebind. Reading the top-level line back after its rewrite
  //     made this look contradictory and refused a correct bundle.
  const stale = 'a'.repeat(40);
  const matching =
    `# P\nMERGE_SHA: ${stale}\n\n## Merge SHA Binding\n\nMerge SHA: ${stale}\nPR: ${PR_URL}\n`;
  const okResult = planVerificationRebind('v.md', matching, SHAS, PR_URL);
  assert.deepStrictEqual(okResult.errors, [], 'matching stale values are valid rebind input');
  assert.deepStrictEqual(okResult.changes.map((c) => c.before), [stale, stale]);
  assert.deepStrictEqual(okResult.changes.map((c) => c.after), [MERGE, MERGE]);
  assert.match(okResult.next, new RegExp(`^MERGE_SHA: ${MERGE}$`, 'm'));
  assert.match(okResult.next, new RegExp(`^Merge SHA: ${MERGE}$`, 'm'));

  // (b) CONTRADICTORY concrete values refuse.
  const contradictory =
    `# P\nMERGE_SHA: ${'a'.repeat(40)}\n\n## Merge SHA Binding\n\nMerge SHA: ${'b'.repeat(40)}\nPR: ${PR_URL}\n`;
  const contra = planVerificationRebind('v.md', contradictory, SHAS, PR_URL);
  assert.ok(
    contra.errors.some((e) => new RegExp(`\\(${'b'.repeat(40)}\\) contradicts the top-level MERGE_SHA: \\(${'a'.repeat(40)}\\)`).test(e)),
    `expected a contradiction naming BOTH original values, got: ${contra.errors.join('|')}`,
  );

  // (c) A section row ALREADY bound past a stale top-level line is still a
  //     contradiction — it must not be masked by rewriting the top line first.
  const preBound =
    `# P\nMERGE_SHA: ${'a'.repeat(40)}\n\n## Merge SHA Binding\n\nMerge SHA: ${MERGE}\nPR: ${PR_URL}\n`;
  assert.ok(
    planVerificationRebind('v.md', preBound, SHAS, PR_URL).errors.some((e) => /contradicts the top-level/.test(e)),
    'a section row bound ahead of the top-level line must refuse',
  );
});

test('P1: a valueless or malformed top-level MERGE_SHA refuses', () => {
  const section = `\n## Merge SHA Binding\n\nMerge SHA: pending merge\nPR: ${PR_URL}\n`;

  const empty = planVerificationRebind('v.md', `# P\nMERGE_SHA:\n${section}`, SHAS, PR_URL);
  assert.ok(empty.errors.some((e) => /top-level MERGE_SHA: line has no value/.test(e)));
  assert.deepStrictEqual(empty.changes.filter((c) => c.locator.includes('MERGE_SHA:')), [], 'nothing may be planned');

  const whitespace = planVerificationRebind('v.md', `# P\nMERGE_SHA:    \n${section}`, SHAS, PR_URL);
  assert.ok(whitespace.errors.some((e) => /top-level MERGE_SHA: line has no value/.test(e)));

  for (const bad of ['not-a-sha', '6718c0de', 'TBD tomorrow', 'see PR #1313']) {
    const result = planVerificationRebind('v.md', `# P\nMERGE_SHA: ${bad}\n${section}`, SHAS, PR_URL);
    assert.ok(
      result.errors.some((e) => /top-level MERGE_SHA: value .* is neither a 40-character SHA nor a recognised pre-merge placeholder/.test(e)),
      `"${bad}" must be refused as malformed, got: ${result.errors.join('|')}`,
    );
  }

  // A recognised pre-merge placeholder is the normal state and must NOT refuse.
  for (const placeholder of ['pending merge', 'pending', 'TBD']) {
    const result = planVerificationRebind('v.md', `# P\nMERGE_SHA: ${placeholder}\n${section}`, SHAS, PR_URL);
    assert.deepStrictEqual(result.errors, [], `"${placeholder}" is a valid pre-merge value`);
  }
});

test('P1: every existing binding-row value is validated before it can be replaced', () => {
  const doc = (rows: string) => `# P\nMERGE_SHA: ${'a'.repeat(40)}\n\n## Merge SHA Binding\n\n${rows}`;

  // SHA rows: a malformed nonempty value refuses rather than being overwritten.
  for (const label of ['Merge SHA', 'Approved PR head', 'Execution SHA']) {
    const rows = ['Merge SHA: pending merge', `PR: ${PR_URL}`]
      .filter((r) => !r.startsWith(`${label}:`))
      .concat(`${label}: 6718c0de`)
      .join('\n') + '\n';
    const result = planVerificationRebind('v.md', doc(rows), SHAS, PR_URL);
    assert.ok(
      result.errors.some((e) => new RegExp(`row "${label}:" value "6718c0de" is neither a 40-character SHA`).test(e)),
      `${label}: an abbreviated SHA must be refused, got: ${result.errors.join('|')}`,
    );
  }

  // A well-formed SHA and a recognised placeholder are both accepted.
  const accepted = planVerificationRebind(
    'v.md',
    doc(`Merge SHA: ${'a'.repeat(40)}\nPR: ${PR_URL}\nApproved PR head: pending\nExecution SHA: ${EXEC}\n`),
    SHAS,
    PR_URL,
  );
  assert.deepStrictEqual(accepted.errors, []);

  // PR row: a value that is not a canonical GitHub pull-request URL refuses.
  for (const bad of ['https://x/pull/1', 'github.com/o/r/pull/1', `${PR_URL}/files`, 'see the PR']) {
    const result = planVerificationRebind('v.md', doc(`Merge SHA: pending merge\nPR: ${bad}\n`), SHAS, PR_URL);
    assert.ok(
      result.errors.some((e) => /row "PR:" value .* is neither a canonical GitHub pull-request URL/.test(e)),
      `"${bad}" must be refused as malformed, got: ${result.errors.join('|')}`,
    );
  }

  // PR row: a canonical URL naming a DIFFERENT pull request refuses rather than
  // being silently repointed at the validated one.
  const foreign = planVerificationRebind(
    'v.md',
    doc(`Merge SHA: pending merge\nPR: https://github.com/griff843/Unit-Talk-v2/pull/9999\n`),
    SHAS,
    PR_URL,
  );
  assert.ok(
    foreign.errors.some((e) => /names a different pull request than the validated one/.test(e)),
    `expected a foreign-PR refusal, got: ${foreign.errors.join('|')}`,
  );

  // Every one of these refusals plans zero changes.
  for (const bad of [
    doc(`Merge SHA: 6718c0de\nPR: ${PR_URL}\n`),
    doc(`Merge SHA: pending merge\nPR: https://github.com/griff843/Unit-Talk-v2/pull/9999\n`),
  ]) {
    const { deps, store } = memoryDeps({ '/r/v.md': bad });
    const snapshot = { ...store };
    const result = rebindProofBundle(
      { issueId: 'X', shas: SHAS, prUrl: PR_URL, root: '/r', files: ['v.md'] },
      { write: true },
      deps,
    );
    assert.strictEqual(result.code, 'proof_rebind_refused');
    assert.deepStrictEqual(store, snapshot, 'a refusal wrote bytes');
  }
});

test('P1: duplicate raw keys are detected for EVERY writable JSON binding, optional included', () => {
  // Restricted to the required fields, the scan left the optional execution and
  // evidence SHA keys able to carry a duplicate that JSON.parse hides: the
  // surgical edit rewrites the first occurrence, the stale second one survives,
  // and the receipt claims a clean rebind.
  const optionalKeys = ['verified_source_sha', 'evidence_commit_sha'];
  for (const key of optionalKeys) {
    assert.ok(
      Object.keys(EVIDENCE_BINDING_FIELDS).includes(`sha_binding.${key}`),
      `${key} must be a declared writable binding`,
    );
    assert.ok(
      !REQUIRED_EVIDENCE_FIELDS.includes(`sha_binding.${key}` as (typeof REQUIRED_EVIDENCE_FIELDS)[number]),
      `${key} must be OPTIONAL — that is what made the gap reachable`,
    );
    const doc =
      '{\n  "sha_binding": {\n    "merge_sha": null,\n    "current_pr_head_sha": null,\n' +
      `    "${key}": "${'1'.repeat(40)}",\n    "${key}": "${'2'.repeat(40)}"\n  }\n}\n`;
    assert.strictEqual(duplicateKeysInSameObject(doc, key), 2);
    const { errors } = planEvidenceRebind('e.json', doc, SHAS);
    assert.ok(
      errors.some((e) => new RegExp(`writable binding key "${key}" appears 2 times in the same object`).test(e)),
      `${key}: a duplicate must refuse, got: ${errors.join('|')}`,
    );
  }

  // The array binding's key is covered too, still scoped per object so sibling
  // test_run_logs entries remain legitimate.
  const arrayDup =
    '{\n  "sha_binding": {\n    "merge_sha": null,\n    "current_pr_head_sha": null\n  },\n' +
    '  "static_proof": {\n    "test_run_logs": [\n      { "merge_sha": null, "merge_sha": null }\n    ]\n  }\n}\n';
  assert.ok(
    planEvidenceRebind('e.json', arrayDup, SHAS).errors.some((e) => /"merge_sha" appears 2 times in the same object/.test(e)),
  );
});

test('P1: the CLI always requests BOTH canonical artifacts, so a missing one refuses', () => {
  assert.deepStrictEqual([...CANONICAL_PROOF_ARTIFACTS], ['evidence.json', 'verification.md']);

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'proof-rebind-partial-'));
  execFileSync('git', ['init', '-q'], { cwd: dir });
  const proofDir = path.join(dir, 'docs', '06_status', 'proof', 'UTV2-1592');
  fs.mkdirSync(proofDir, { recursive: true });
  // verification.md is ABSENT. Filtering the request down to the files that
  // exist rebound evidence.json alone and reported success — a partial rebind
  // presented as a complete one.
  fs.writeFileSync(path.join(proofDir, 'evidence.json'), EVIDENCE);
  const digestBefore = sha256(fs.readFileSync(path.join(proofDir, 'evidence.json'), 'utf8'));

  const script = path.join(process.cwd(), 'scripts', 'ops', 'proof-rebind.ts');
  let out = '';
  try {
    out = execFileSync(
      'npx',
      ['tsx', script, '--issue', 'UTV2-1592', '--merge-sha', MERGE, '--approved-head', HEAD],
      { cwd: dir, encoding: 'utf8', env: { ...process.env, PATH: process.env.PATH ?? '' } },
    );
  } catch (error) {
    out = (error as { stdout?: string }).stdout ?? '';
  }
  const parsed = JSON.parse(out);
  assert.strictEqual(parsed.code, 'proof_rebind_refused');
  assert.ok(
    parsed.errors.some((e: string) => /verification\.md: missing — refusing to create a proof artifact/.test(e)),
    `expected a refusal naming verification.md, got: ${JSON.stringify(parsed.errors)}`,
  );
  assert.strictEqual(
    sha256(fs.readFileSync(path.join(proofDir, 'evidence.json'), 'utf8')),
    digestBefore,
    'the surviving artifact must not be partially rebound',
  );
  fs.rmSync(dir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Real-bundle contracts. These read the two bundles from the WORKING TREE, not
// from a pinned commit: CI checks out at fetch-depth 1, so `git show <sha>:path`
// against a commit that is only a shallow boundary is not reliably resolvable
// there (it passes locally on a full clone and fails on the runner).
//
// Reading the working tree raises the opposite hazard — a test that quietly
// changes meaning once a bundle is legitimately rebound. That is handled by
// making each contract STATE-AWARE rather than by pinning: the pre-rebind state
// and the post-rebind state are both asserted, and whichever the bundle is in,
// the other branch is the one that would have to be wrong. Neither branch can
// pass vacuously, because the state is derived from the bundle itself.
// ---------------------------------------------------------------------------

function readRealBundle(relPath: string): string {
  const abs = path.join(process.cwd(), relPath);
  assert.ok(fs.existsSync(abs), `real bundle artifact is missing from the repo: ${relPath}`);
  return fs.readFileSync(abs, 'utf8');
}

test('REAL BUNDLE: UTV2-1592 remains refused', () => {
  const rel = 'docs/06_status/proof/UTV2-1592/verification.md';
  const md = readRealBundle(rel);
  const { errors, changes } = planVerificationRebind(
    rel,
    md,
    { merge_sha: '5f4abb09113f33ec9ca5ba88ab639041c521c00e', approved_head_sha: HEAD, execution_sha: null },
    PR_URL_1311,
  );
  // Its binding block is headed "## SHA Binding", not the canonical
  // "## Merge SHA Binding". A rebind must refuse rather than invent the section.
  assert.ok(
    !md.includes('\n## Merge SHA Binding'),
    'precondition: this bundle lacks the canonical binding section — if that changes, this contract must be re-derived',
  );
  assert.ok(
    errors.some((e) => /required "## Merge SHA Binding" section is absent/.test(e)),
    `expected the canonical-section refusal, got: ${errors.join('|')}`,
  );
  assert.ok(!(errors.length === 0 && changes.length > 0), 'must never report a partial success');
});

test('REAL BUNDLE: UTV2-1612 rebinds exactly five fields and moves no other byte', () => {
  const evidenceRel = 'docs/06_status/proof/UTV2-1612/evidence.json';
  const verificationRel = 'docs/06_status/proof/UTV2-1612/verification.md';
  const evidence = readRealBundle(evidenceRel);
  const verification = readRealBundle(verificationRel);

  const MERGE_1313 = '2822b709c74c43dc24a50dc6df35597e1a0463fe';
  const shas: ShaSet = {
    merge_sha: MERGE_1313,
    approved_head_sha: 'e0464b519206ca63f707002ea91d91136750d797',
    execution_sha: '6718c0de3c125beaa241bb8eb6937a7fa8e5f0bb',
  };
  const prUrl = 'https://github.com/griff843/Unit-Talk-v2/pull/1313';

  const json = planEvidenceRebind(evidenceRel, evidence, shas);
  const md = planVerificationRebind(verificationRel, verification, shas, prUrl);
  assert.deepStrictEqual([...json.errors, ...md.errors], [], 'the bundle must plan cleanly in either state');

  const changes = [...json.changes, ...md.changes];
  const alreadyBound = (JSON.parse(evidence) as { sha_binding: { merge_sha: string | null } })
    .sha_binding.merge_sha !== null;

  if (alreadyBound) {
    // POST-REBIND CONTRACT: rebinding an already-bound bundle to the same SHAs
    // is a clean no-op. A rebind is idempotent; a second run must never rewrite.
    assert.deepStrictEqual(changes, [], 'an already-bound bundle must be a no-op, not a rewrite');
    assert.strictEqual(json.next, evidence);
    assert.strictEqual(md.next, verification);
  } else {
    // PRE-REBIND CONTRACT: exactly five binding fields change, and nothing else.
    assert.strictEqual(
      changes.length,
      5,
      `expected five binding changes, got:\n${changes.map((c) => `${c.file} ${c.locator}`).join('\n')}`,
    );
    assert.deepStrictEqual(
      changes.map((c) => c.locator.replace(/ \(line \d+\)$/, '').replace(/^line \d+ /, '')),
      [
        'sha_binding.merge_sha',
        'sha_binding.current_pr_head_sha',
        'static_proof.test_run_logs[0].merge_sha',
        '(MERGE_SHA:)',
        '## Merge SHA Binding > Merge SHA',
      ],
    );
    assert.deepStrictEqual(
      changes.map((c) => c.after),
      [MERGE_1313, shas.approved_head_sha, MERGE_1313, MERGE_1313, MERGE_1313],
    );
    // The out-of-section narrative row that RESEMBLES a binding row must not be
    // among the changes: it sits outside "## Merge SHA Binding" and is narrative.
    assert.ok(
      verification.includes('Merge SHA: pending merge. This bundle is bound to'),
      'precondition: the bundle carries a narrative line resembling a binding row',
    );
    assert.ok(
      md.next.includes('Merge SHA: pending merge. This bundle is bound to'),
      'a narrative line resembling a binding row but outside the section must survive',
    );
  }

  // Holds in BOTH states: every non-binding byte survives. Exactly the declared
  // lines differ, and the line count never changes.
  for (const [before, after, declared] of [
    [evidence, json.next, json.changes.length],
    [verification, md.next, md.changes.length],
  ] as const) {
    const a = before.split('\n');
    const b = after.split('\n');
    assert.strictEqual(a.length, b.length, 'line count must not change');
    const differing = a.map((line, i) => (line !== b[i] ? i : -1)).filter((i) => i !== -1);
    assert.strictEqual(differing.length, declared, 'only the declared binding lines may differ');
  }

  // The long explanatory field shares no key with any binding and must come
  // through byte-identical.
  assert.strictEqual(
    (JSON.parse(json.next) as { sha_binding: { verified_source_note: string } }).sha_binding.verified_source_note,
    (JSON.parse(evidence) as { sha_binding: { verified_source_note: string } }).sha_binding.verified_source_note,
  );
  assert.ok(
    md.next.includes('The remote script is delivered to the host on ssh **stdin** via `bash -s`'),
    'captured narrative must survive',
  );

  // IDEMPOTENCY, exercised on every run regardless of which state the bundle is
  // in: feeding the planned output back in must produce a clean no-op. This is
  // what makes interrupted-run recovery safe (re-running --apply completes the
  // transaction without double-applying), and it keeps the post-rebind branch
  // above from ever being dead code.
  const jsonAgain = planEvidenceRebind(evidenceRel, json.next, shas);
  const mdAgain = planVerificationRebind(verificationRel, md.next, shas, prUrl);
  assert.deepStrictEqual([...jsonAgain.errors, ...mdAgain.errors], [], 'a rebound bundle must still plan cleanly');
  assert.deepStrictEqual([...jsonAgain.changes, ...mdAgain.changes], [], 'a second rebind must change nothing');
  assert.strictEqual(jsonAgain.next, json.next);
  assert.strictEqual(mdAgain.next, md.next);
});

// ---------------------------------------------------------------------------
// Findings from the adversarial exact-head review of e550a7cd.
// ---------------------------------------------------------------------------

test('P1: a binding row inside a fenced code block is narrative and is NEVER rewritten', () => {
  // A proof bundle may legitimately SHOW what closeout writes, inside a fence.
  // Those lines matched the row regex and were treated as the canonical writable
  // row, so the rebind rewrote documentation inside a code fence — and the
  // byte-for-byte mask could not catch it, because it neutralised the very same
  // line on both sides of the comparison.
  const fencedOnly = [
    '# P', `MERGE_SHA: ${'a'.repeat(40)}`, '', '## Merge SHA Binding', '',
    'Example of what closeout writes:', '', '```', 'Merge SHA: pending merge', '```', '',
    `PR: ${PR_URL}`, '',
  ].join('\n');

  const only = planVerificationRebind('v.md', fencedOnly, SHAS, PR_URL);
  // The fenced line is not a row, so the required row is ABSENT — refuse.
  assert.ok(
    only.errors.some((e) => /missing its required "Merge SHA:" row/.test(e)),
    `a fence-only row must refuse as missing, got: ${only.errors.join('|')}`,
  );
  assert.strictEqual(
    only.next.split('\n')[8],
    'Merge SHA: pending merge',
    'the fenced line must survive byte-for-byte',
  );
  assert.ok(
    !only.changes.some((c) => c.locator.includes('Merge SHA Binding')),
    'no change may be planned against a fenced line',
  );

  // With a REAL row present alongside the fenced example, the real row is the
  // only match: the example must neither be rewritten nor counted as a duplicate.
  const withRealRow = fencedOnly.replace(`PR: ${PR_URL}`, `Merge SHA: pending merge\nPR: ${PR_URL}`);
  const both = planVerificationRebind('v.md', withRealRow, SHAS, PR_URL);
  assert.deepStrictEqual(both.errors, [], 'a fenced example must not read as a duplicate row');
  const after = both.next.split('\n');
  assert.strictEqual(after[8], 'Merge SHA: pending merge', 'the fenced example must not be rewritten');
  assert.strictEqual(after[11], `Merge SHA: ${MERGE}`, 'the real row must be the one rebound');

  // The same protection applies to the top-level MERGE_SHA: line and to the
  // section heading itself.
  const fencedTop = ['# P', '```', `MERGE_SHA: ${'a'.repeat(40)}`, '```', '', '## Merge SHA Binding', '',
    'Merge SHA: pending merge', `PR: ${PR_URL}`, ''].join('\n');
  assert.ok(
    planVerificationRebind('v.md', fencedTop, SHAS, PR_URL).errors.some((e) => /no MERGE_SHA: line/.test(e)),
    'a fenced top-level line must not be treated as the anchor',
  );
  const fencedHeading = ['# P', `MERGE_SHA: ${'a'.repeat(40)}`, '', '```', '## Merge SHA Binding', '',
    'Merge SHA: pending merge', `PR: ${PR_URL}`, '```', ''].join('\n');
  assert.ok(
    planVerificationRebind('v.md', fencedHeading, SHAS, PR_URL).errors.some((e) => /section is absent/.test(e)),
    'a fenced heading must not be treated as the canonical section',
  );

  // An UNTERMINATED fence marks everything after it as fenced — the
  // conservative direction, producing a refusal rather than a silent rewrite.
  const unterminated = ['# P', `MERGE_SHA: ${'a'.repeat(40)}`, '', '## Merge SHA Binding', '', '```',
    'Merge SHA: pending merge', `PR: ${PR_URL}`, ''].join('\n');
  assert.ok(
    planVerificationRebind('v.md', unterminated, SHAS, PR_URL).errors.length > 0,
    'an unterminated fence must fail closed',
  );

  // Direct coverage of the helper: deleting it makes this import unresolvable.
  assert.deepStrictEqual(
    [...verbatimLineIndices(['a', '```', 'inside', '```', 'b'])],
    [2],
    'only lines strictly inside the fence are protected',
  );
  assert.deepStrictEqual([...verbatimLineIndices(['a', '~~~', 'x', '~~~'])], [2], '~~~ fences count too');
});

test('P2: a duplicate key spelled with a JSON escape is still detected', () => {
  // JSON.parse decodes "merge_sha" to the SAME key as "merge_sha", so a
  // document can carry both and parse cleanly while the surgical edit rewrites
  // only one. Comparing raw characters counted them as different keys.
  const escaped = '{\n  "sha_binding": {\n    "merge\\u005fsha": null,\n    "merge_sha": null,\n' +
    '    "current_pr_head_sha": null\n  }\n}\n';
  assert.strictEqual(JSON.parse(escaped).sha_binding.merge_sha, null, 'both spellings are one key to JSON.parse');
  assert.strictEqual(duplicateKeysInSameObject(escaped, 'merge_sha'), 2);
  assert.ok(
    planEvidenceRebind('e.json', escaped, SHAS).errors.some((e) => /"merge_sha" appears 2 times in the same object/.test(e)),
    'an escaped duplicate must refuse',
  );

  // Order-independent: the escaped spelling second is equally ambiguous.
  const escapedLast = '{\n  "sha_binding": {\n    "merge_sha": null,\n    "merge\\u005fsha": null,\n' +
    '    "current_pr_head_sha": null\n  }\n}\n';
  assert.strictEqual(duplicateKeysInSameObject(escapedLast, 'merge_sha'), 2);

  // Decoding must not create FALSE positives: an escape inside a narrative VALUE
  // is still not a key, and a genuinely different key stays different.
  const narrative = '{\n  "sha_binding": {\n    "merge_sha": null,\n    "current_pr_head_sha": null,\n' +
    '    "note": "the field \\"merge\\u005fsha\\" was stale"\n  }\n}\n';
  assert.strictEqual(duplicateKeysInSameObject(narrative, 'merge_sha'), 1);
  assert.deepStrictEqual(planEvidenceRebind('e.json', narrative, SHAS).errors, []);
  const other = '{\n  "sha_binding": {\n    "merge_sha": null, "merge\\u005fshb": null,\n' +
    '    "current_pr_head_sha": null\n  }\n}\n';
  assert.strictEqual(duplicateKeysInSameObject(other, 'merge_sha'), 1);
});

test('P1: the byte-for-byte guard is exercised against a real mutation, not asserted from source', () => {
  // This replaces two tests the review measured as tautological: one ran the
  // planner and asserted no error (green with the comparison deleted), the other
  // asserted the mask's SHAPE by reading the module's own source text. The mask
  // and its comparison are now exported, so both are driven with mutated pairs.
  const doc = [
    '# P', `MERGE_SHA: ${'a'.repeat(40)}`, '', '## Summary', '', 'Captured narrative.', '',
    '## Merge SHA Binding', '', 'Merge SHA: pending merge', `PR: ${PR_URL}`, '',
    'Operator note inside the section.', '',
  ].join('\n');

  // Rewriting ONLY the writable regions is invisible to the guard, by design.
  const bindingsOnly = doc
    .replace(`MERGE_SHA: ${'a'.repeat(40)}`, `MERGE_SHA: ${MERGE}`)
    .replace('Merge SHA: pending merge', `Merge SHA: ${MERGE}`);
  assert.strictEqual(nonBindingRegionChangeError('v.md', doc, bindingsOnly), null);

  // MUTATION: a narrative line OUTSIDE the section is rewritten.
  assert.match(
    nonBindingRegionChangeError('v.md', doc, doc.replace('Captured narrative.', 'Silently replaced.')) ?? '',
    /content outside the binding regions would change/,
  );

  // MUTATION: narrative INSIDE the section is rewritten. This is the case the
  // deleted source-text test was standing in for — a mask that neutralised the
  // whole section body instead of the individual rows would miss it.
  assert.ok(
    nonBindingRegionChangeError('v.md', doc, doc.replace('Operator note inside the section.', 'gone')) !== null,
    'narrative inside the section must still be compared',
  );
  // Proven directly on the mask: the section body is NOT wholesale-neutralised.
  assert.ok(
    maskWritableRegions(doc).includes('Operator note inside the section.'),
    'the mask must leave section narrative intact',
  );
  assert.ok(!maskWritableRegions(doc).includes('Merge SHA: pending merge'), 'canonical rows must be neutralised');
  assert.ok(!maskWritableRegions(doc).includes(`MERGE_SHA: ${'a'.repeat(40)}`), 'the top-level line must be neutralised');

  // MUTATION: a blank line is removed, and indentation is changed.
  assert.ok(nonBindingRegionChangeError('v.md', doc, doc.replace('\n\n## Summary', '\n## Summary')) !== null);
  assert.ok(nonBindingRegionChangeError('v.md', doc, doc.replace('Captured narrative.', '   Captured narrative.')) !== null);

  // WIRING. Neither this guard nor the changed-line guard can be tripped from
  // the production path — the planner only edits regions the mask neutralises,
  // and a token replacement never changes more lines than it declares. So the
  // guards' BEHAVIOUR is proven above, and their being CALLED is proven here by
  // reading the planner bodies. Deleting either call fails this assertion, which
  // is exactly the coverage the review found missing.
  const source = fs.readFileSync(path.join(process.cwd(), 'scripts', 'ops', 'proof-rebind.ts'), 'utf8');
  const bodyOf = (name: string): string => {
    const from = source.indexOf(`export function ${name}(`);
    assert.ok(from >= 0, `${name} must exist`);
    const to = source.indexOf('\nexport ', from + 1);
    return source.slice(from, to === -1 ? source.length : to);
  };
  assert.match(bodyOf('planVerificationRebind'), /nonBindingRegionChangeError\(relPath, content, next\)/);
  assert.match(bodyOf('planEvidenceRebind'), /undeclaredLineChangeError\(relPath, content, next, changes\.length\)/);
});

test('P1: a file that is not valid UTF-8 is refused, and no checksum is claimed for it', () => {
  // readFileSync(p, 'utf8') replaces invalid bytes with U+FFFD. The receipt's
  // sha256_before would then describe text that was never on disk, and writing
  // the decoded string back would rewrite bytes far outside any binding region.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'proof-rebind-utf8-'));
  const target = path.join(dir, 'verification.md');
  const invalid = Buffer.concat([
    Buffer.from(`# P\nMERGE_SHA: ${'a'.repeat(40)}\n\nnarrative `, 'utf8'),
    Buffer.from([0xff, 0xfe]),
    Buffer.from(`\n\n## Merge SHA Binding\n\nMerge SHA: pending merge\nPR: ${PR_URL}\n`, 'utf8'),
  ]);
  fs.writeFileSync(target, invalid);

  assert.throws(() => readUtf8Strict(target), /not valid UTF-8/);

  // Through the bundle entry point it is a refusal, not a crash, and the file is
  // left untouched with no checksum recorded.
  const result = rebindProofBundle(
    { issueId: 'X', shas: SHAS, prUrl: PR_URL, root: dir, files: ['verification.md'] },
    { write: true },
  );
  assert.strictEqual(result.code, 'proof_rebind_refused');
  assert.ok(result.errors.some((e) => /not valid UTF-8/.test(e)), `got: ${result.errors.join('|')}`);
  assert.deepStrictEqual(result.checksums, [], 'no checksum may be claimed for a file that could not be read faithfully');
  assert.deepStrictEqual(result.changes, []);
  assert.ok(fs.readFileSync(target).equals(invalid), 'the bytes on disk must be untouched');

  // A valid UTF-8 file with multi-byte characters must NOT be refused.
  const validPath = path.join(dir, 'valid.md');
  fs.writeFileSync(validPath, `# P — café 🎯\nMERGE_SHA: ${'a'.repeat(40)}\n`, 'utf8');
  assert.ok(readUtf8Strict(validPath).includes('café 🎯'));
  fs.rmSync(dir, { recursive: true, force: true });
});

test('P1: a malformed JSON binding value is refused, never overwritten', () => {
  // The verification.md rows validated their existing value; the JSON fields did
  // not, so prose or a truncated SHA sitting in sha_binding was silently
  // replaced — erasing the inconsistency instead of surfacing it.
  for (const bad of ['not-a-sha', '6718c0de', 'see PR #1313', '']) {
    const doc = JSON.stringify(
      { sha_binding: { merge_sha: bad, current_pr_head_sha: null } }, null, 2) + '\n';
    const { errors, changes } = planEvidenceRebind('e.json', doc, SHAS);
    assert.ok(
      errors.some((e) => /binding field "sha_binding.merge_sha" value .* is neither a 40-character SHA/.test(e)),
      `"${bad}" must be refused, got: ${errors.join('|')}`,
    );
    assert.ok(!changes.some((c) => c.locator === 'sha_binding.merge_sha'), 'no change may be planned');
  }

  // Non-string values are refused with their actual type named.
  for (const [bad, type] of [[123, 'number'], [true, 'boolean'], [{}, 'object'], [[], 'array']] as const) {
    const doc = JSON.stringify(
      { sha_binding: { merge_sha: bad, current_pr_head_sha: null } }, null, 2) + '\n';
    assert.ok(
      planEvidenceRebind('e.json', doc, SHAS).errors.some((e) =>
        new RegExp(`holds a ${type}, not a SHA string`).test(e)),
      `${type} must be refused`,
    );
  }

  // null and a recognised placeholder remain valid pre-merge states.
  for (const ok of [null, 'pending merge']) {
    const doc = JSON.stringify(
      { sha_binding: { merge_sha: ok, current_pr_head_sha: null } }, null, 2) + '\n';
    assert.deepStrictEqual(planEvidenceRebind('e.json', doc, SHAS).errors, [], `${String(ok)} must be accepted`);
  }

  // The ARRAY bindings follow the same rule. Applying it only to the dotted
  // fields left a malformed per-entry value silently overwritten.
  for (const bad of ['not-a-sha', '6718c0de', 42, true, {}] as const) {
    const withArray = JSON.stringify({
      sha_binding: { merge_sha: null, current_pr_head_sha: null },
      static_proof: { test_run_logs: [{ path: 'x.test.ts', merge_sha: bad }] },
    }, null, 2) + '\n';
    const result = planEvidenceRebind('e.json', withArray, SHAS);
    assert.ok(
      result.errors.some((e) => /binding field "static_proof\.test_run_logs\[0\]\.merge_sha"/.test(e)),
      `array entry "${String(bad)}" must be refused, got: ${result.errors.join('|')}`,
    );
    assert.ok(
      !result.changes.some((c) => c.locator === 'static_proof.test_run_logs[0].merge_sha'),
      'no change may be planned against a malformed array entry',
    );
  }
  // null and an already-bound SHA remain valid in an array entry.
  const validArray = JSON.stringify({
    sha_binding: { merge_sha: null, current_pr_head_sha: null },
    static_proof: { test_run_logs: [{ path: 'x.test.ts', merge_sha: null }, { path: 'y.test.ts', merge_sha: MERGE }] },
  }, null, 2) + '\n';
  assert.deepStrictEqual(planEvidenceRebind('e.json', validArray, SHAS).errors, []);

  // A refusal writes zero bytes.
  const doc = JSON.stringify({ sha_binding: { merge_sha: 'garbage', current_pr_head_sha: null } }, null, 2) + '\n';
  const { deps, store } = memoryDeps({ '/r/e.json': doc });
  const snapshot = { ...store };
  assert.strictEqual(
    rebindProofBundle({ issueId: 'X', shas: SHAS, prUrl: null, root: '/r', files: ['e.json'] }, { write: true }, deps).code,
    'proof_rebind_refused',
  );
  assert.deepStrictEqual(store, snapshot);
});

test('P1: unbalanced markdown ticks are malformed, not silently stripped and erased', () => {
  const doc = (rows: string) => `# P\nMERGE_SHA: ${'a'.repeat(40)}\n\n## Merge SHA Binding\n\n${rows}`;

  // A stray leading tick previously made the value parse as a clean SHA, and the
  // rewrite then ERASED the tick — a byte change to an unaccounted-for value.
  const unbalanced = planVerificationRebind(
    'v.md', doc(`Merge SHA: \`${'b'.repeat(40)}\nPR: ${PR_URL}\n`), SHAS, PR_URL);
  assert.ok(
    unbalanced.errors.some((e) => /row "Merge SHA:" value .* is neither a 40-character SHA/.test(e)),
    `got: ${unbalanced.errors.join('|')}`,
  );
  assert.strictEqual(classifyBindingValue(`\`${'b'.repeat(40)}`).kind, 'malformed');
  assert.strictEqual(classifyBindingValue(`${'b'.repeat(40)}\``).kind, 'malformed');
  assert.strictEqual(classifyBindingValue('`').kind, 'malformed');

  // The same applies to the top-level line and to the PR row.
  assert.ok(
    planVerificationRebind('v.md', `# P\nMERGE_SHA: \`${'a'.repeat(40)}\n\n## Merge SHA Binding\n\nMerge SHA: pending merge\nPR: ${PR_URL}\n`, SHAS, PR_URL)
      .errors.some((e) => /top-level MERGE_SHA: value .* is neither a 40-character SHA/.test(e)),
  );
  assert.strictEqual(classifyPrRowValue(`\`${PR_URL}`, PR_URL).kind, 'malformed');

  // BALANCED ticks remain a legitimate way to write the value.
  assert.strictEqual(classifyBindingValue(`\`${'b'.repeat(40)}\``).kind, 'sha');
  assert.strictEqual(classifyPrRowValue(`\`${PR_URL}\``, PR_URL).kind, 'canonical');
});

test('P1: an issue ID that could escape the proof directory is refused by the CLI', () => {
  // The issue ID becomes a path segment; unvalidated it walks the rebind out of
  // docs/06_status/proof and points it at arbitrary repo files.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'proof-rebind-traversal-'));
  execFileSync('git', ['init', '-q'], { cwd: dir });
  const outside = path.join(dir, 'package.json');
  fs.writeFileSync(outside, '{"name":"victim"}\n');
  const digestBefore = sha256(fs.readFileSync(outside, 'utf8'));
  const script = path.join(process.cwd(), 'scripts', 'ops', 'proof-rebind.ts');

  for (const evil of ['../../../..', 'UTV2-1/../../..', './..']) {
    let out = '';
    try {
      out = execFileSync('npx', ['tsx', script, '--issue', evil, '--merge-sha', MERGE, '--approved-head', HEAD],
        { cwd: dir, encoding: 'utf8', env: { ...process.env, PATH: process.env.PATH ?? '' } });
    } catch (error) {
      out = (error as { stdout?: string }).stdout ?? '';
    }
    const parsed = JSON.parse(out);
    assert.strictEqual(parsed.code, 'proof_rebind_refused', `"${evil}" must refuse`);
    assert.ok(
      parsed.errors.some((e: string) => /is not a valid issue ID/.test(e)),
      `"${evil}": expected an issue-ID refusal, got ${JSON.stringify(parsed.errors)}`,
    );
  }
  assert.strictEqual(sha256(fs.readFileSync(outside, 'utf8')), digestBefore, 'nothing outside the proof dir may be touched');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('P2: the canonical PR URL shape rejects noncanonical repository components', () => {
  // `[^/]+` accepted query and fragment junk inside the owner/repo segments, so
  // a URL that is not a real GitHub PR URL could pass as canonical.
  for (const junk of [
    'https://github.com/o/r?junk/pull/1',
    'https://github.com/o/r#f/pull/1',
    'https://github.com/o/r%2e%2e/pull/1',
    'https://github.com/o/r/pull/01',
    'https://github.com/o/r/pull/0',
    'https://github.com//r/pull/1',
    'https://github.com/a_b/repo/pull/1',
    'https://github.com/a-/repo/pull/1',
    'https://github.com/-a/repo/pull/1',
  ]) {
    assert.strictEqual(deriveCanonicalPrUrl(junk, 1), null, `${junk} must not be canonical`);
    assert.strictEqual(classifyPrRowValue(junk, null).kind, 'malformed', `${junk} must classify malformed`);
  }
  // Legitimate owner/repo characters still pass.
  const dotted = 'https://github.com/griff-843/Unit.Talk_v2/pull/1315';
  assert.strictEqual(deriveCanonicalPrUrl(dotted, 1315), dotted);
});

test('P1: fence recognition and row indentation cannot be used to smuggle a rewrite', () => {
  // A closing fence must use the SAME character, be AT LEAST as long as the
  // opening run, and carry nothing but whitespace. Accepting a shorter run
  // closed a longer fence early, so content genuinely still inside the fence
  // read as writable.
  assert.deepStrictEqual(
    [...verbatimLineIndices(['a', '````', 'x', '```', 'Merge SHA: pending merge', '````', 'b'])],
    [2, 3, 4],
    'a 3-backtick line must not close a 4-backtick fence',
  );
  assert.deepStrictEqual(
    [...verbatimLineIndices(['a', '```', 'x', '``` not-a-close', 'y', '```', 'b'])],
    [2, 3, 4],
    'a closing fence may not carry trailing text',
  );
  // An opening fence MAY carry an info string.
  assert.deepStrictEqual([...verbatimLineIndices(['a', '```json', 'x', '```', 'b'])], [2]);
  // Mixed delimiters do not close each other.
  assert.deepStrictEqual([...verbatimLineIndices(['a', '```', 'x', '~~~', 'y', '```', 'b'])], [2, 3, 4]);
  // Four or more leading spaces is an indented code block, not a fence.
  assert.deepStrictEqual([...verbatimLineIndices(['a', '    ```', 'x', '    ```', 'b'])], []);

  // A row inside a 4-space indented code block is verbatim narrative, so the
  // required row reads as ABSENT and the rebind refuses instead of rewriting it.
  const indented = [
    '# P', `MERGE_SHA: ${'a'.repeat(40)}`, '', '## Merge SHA Binding', '', 'Example:', '',
    '    Merge SHA: pending merge', '', `PR: ${PR_URL}`, '',
  ].join('\n');
  const result = planVerificationRebind('v.md', indented, SHAS, PR_URL);
  assert.ok(
    result.errors.some((e) => /missing its required "Merge SHA:" row/.test(e)),
    `got: ${result.errors.join('|')}`,
  );
  assert.strictEqual(
    result.next.split('\n')[7],
    '    Merge SHA: pending merge',
    'an indented-code-block line must survive byte-for-byte',
  );

  // ANY indent now reads as narrative. One to three spaces is a list
  // continuation and four or more is an indented code block; rather than try to
  // tell them apart, only column zero is writable, so an indented row refuses.
  const listContinuation = indented.replace('    Merge SHA: pending merge', '   Merge SHA: pending merge');
  const cont = planVerificationRebind('v.md', listContinuation, SHAS, PR_URL);
  assert.ok(
    cont.errors.some((e) => /missing its required "Merge SHA:" row/.test(e)),
    'a three-space list continuation must not be writable',
  );
  assert.strictEqual(cont.next.split('\n')[7], '   Merge SHA: pending merge', 'it must survive byte-for-byte');

  // The planner and the mask share ONE row pattern, so the region the edit may
  // touch and the region the mask neutralises cannot drift apart.
  assert.deepStrictEqual([...BINDING_ROW_LABELS], ['Merge SHA', 'PR', 'Approved PR head', 'Execution SHA']);
  assert.ok(bindingRowPattern().test('Merge SHA: x'));
  assert.ok(!bindingRowPattern().test('  Merge SHA: x'), 'a list continuation is never writable');
  assert.ok(!bindingRowPattern().test('    Merge SHA: x'), 'an indented-code-block row is never writable');
  assert.ok(bindingRowPattern('PR').test('PR: x'));
  assert.ok(!bindingRowPattern('PR').test('Merge SHA: x'));
  assert.ok(
    maskWritableRegions(indented).includes('    Merge SHA: pending merge'),
    'the mask must leave an indented-code-block row intact so a rewrite of it is detectable',
  );
});

test('P1: an INDENTED next-section heading still ends the binding section', () => {
  // A markdown ATX heading may carry up to three leading spaces. Matching only
  // an unindented "## " made the binding section appear to run past its real
  // end, so a row belonging to a LATER section became writable.
  const doc = [
    '# P', `MERGE_SHA: ${'a'.repeat(40)}`, '', '## Merge SHA Binding', '',
    'Merge SHA: pending merge', `PR: ${PR_URL}`, '',
    '  ## Appendix', '',
    'Merge SHA: this row belongs to the appendix and is narrative', '',
  ].join('\n');

  const result = planVerificationRebind('v.md', doc, SHAS, PR_URL);
  assert.deepStrictEqual(result.errors, []);
  const after = result.next.split('\n');
  assert.strictEqual(after[5], `Merge SHA: ${MERGE}`, 'the real row is rebound');
  assert.strictEqual(
    after[10],
    'Merge SHA: this row belongs to the appendix and is narrative',
    'a row after the indented next-section heading must not be touched',
  );
  assert.ok(isSectionHeading('  ## Appendix'));
  assert.ok(isSectionHeading('## Appendix'));
  assert.ok(isSectionHeading('##\tAppendix'), 'a heading may be tab-delimited');
  assert.ok(isSectionHeading('# Top'), 'any ATX level ends the section — ending earlier is fail-closed');
  assert.ok(isSectionHeading('### Sub'));
  assert.ok(!isSectionHeading('    ## Indented code block'), 'four spaces is a code block, not a heading');
  assert.ok(!isSectionHeading('##NoSpace'), 'a heading needs a space or tab after the run');
  // Recognising the ANCHOR grows the writable region, so it is strict.
  assert.ok(isBindingSectionHeading('## Merge SHA Binding'));
  assert.ok(!isBindingSectionHeading('  ## Merge SHA Binding'), 'an indented anchor is not the anchor');
  assert.ok(!isBindingSectionHeading('## Merge SHA Binding extra'), 'a heading with trailing text is not the anchor');

  // The mask uses the same rule, so a rewrite past the section end is detectable.
  assert.ok(
    maskWritableRegions(doc).includes('Merge SHA: this row belongs to the appendix and is narrative'),
  );
});

test('P2: the exported byte guard is not blind to a line-ending rewrite', () => {
  // maskWritableRegions split on /\r?\n/ and rejoined with '\n', so a CRLF->LF
  // rewrite of NON-binding bytes masked to the same string on both sides and the
  // exported guard reported no change.
  const lf = [
    '# P', `MERGE_SHA: ${'a'.repeat(40)}`, '', '## Summary', '', 'Captured narrative.', '',
    '## Merge SHA Binding', '', 'Merge SHA: pending merge', `PR: ${PR_URL}`, '',
  ].join('\n');
  const crlf = lf.replace(/\n/g, '\r\n');

  assert.notStrictEqual(maskWritableRegions(crlf), maskWritableRegions(lf), 'the mask must preserve terminators');
  assert.ok(
    nonBindingRegionChangeError('v.md', crlf, lf) !== null,
    'a CRLF -> LF rewrite of non-binding bytes must be detected',
  );
  // Terminators are preserved exactly, not merely counted.
  assert.ok(maskWritableRegions(crlf).includes('Captured narrative.\r\n'));
  // A pure binding-region rewrite within one convention is still invisible.
  assert.strictEqual(
    nonBindingRegionChangeError('v.md', crlf, crlf.replace('Merge SHA: pending merge', `Merge SHA: ${MERGE}`)),
    null,
  );
});

// ---------------------------------------------------------------------------
// Findings from the third adversarial exact-head review, of f965aa36.
// ---------------------------------------------------------------------------

test('P1: a TAB-delimited or any-level next-section heading ends the binding section', () => {
  // A markdown ATX heading is delimited from its text by a space OR A TAB.
  // Matching only "## " left a `##\tAppendix` heading unrecognised, so the
  // section ran past its real end and the appendix's rows became writable.
  const doc = (heading: string) => [
    '# P', `MERGE_SHA: ${'a'.repeat(40)}`, '', '## Merge SHA Binding', '',
    'Merge SHA: pending merge', `PR: ${PR_URL}`, '',
    heading, '',
    `Execution SHA: ${'c'.repeat(40)}`, '',
  ].join('\n');

  for (const heading of ['##\tAppendix', '  ## Appendix', '# Top', '### Sub', '   #\tTabbed']) {
    const result = planVerificationRebind('v.md', doc(heading), SHAS, PR_URL);
    assert.deepStrictEqual(result.errors, [], `heading ${JSON.stringify(heading)}: ${result.errors.join('|')}`);
    assert.strictEqual(
      result.next.split('\n')[10],
      `Execution SHA: ${'c'.repeat(40)}`,
      `heading ${JSON.stringify(heading)}: the row after it must not be rewritten`,
    );
    assert.ok(
      maskWritableRegions(doc(heading)).includes(`Execution SHA: ${'c'.repeat(40)}`),
      'the mask must use the same heading rule, or the rewrite would be concealed',
    );
  }
});

test('P1: binding-looking narrative inside an HTML <pre> block is never rewritten', () => {
  // A <pre> block renders verbatim, exactly like a code fence.
  const doc = [
    '# P', `MERGE_SHA: ${'a'.repeat(40)}`, '', '## Merge SHA Binding', '',
    'What closeout writes:', '<pre>', 'Merge SHA: pending merge', '</pre>', '',
    `PR: ${PR_URL}`, '',
  ].join('\n');

  const result = planVerificationRebind('v.md', doc, SHAS, PR_URL);
  assert.ok(
    result.errors.some((e) => /missing its required "Merge SHA:" row/.test(e)),
    `a <pre> row must not satisfy the required row, got: ${result.errors.join('|')}`,
  );
  assert.strictEqual(result.next.split('\n')[7], 'Merge SHA: pending merge', 'it must survive byte-for-byte');
  assert.ok(maskWritableRegions(doc).includes('Merge SHA: pending merge'), 'the mask must not conceal it');

  assert.deepStrictEqual([...verbatimLineIndices(['a', '<pre>', 'x', '</pre>', 'b'])], [2]);
  assert.deepStrictEqual([...verbatimLineIndices(['a', '<pre class="x">', 'y', '</pre >', 'b'])], [2]);
  // A real row alongside a <pre> example is still the one rebound.
  const withReal = doc.replace(`PR: ${PR_URL}`, `Merge SHA: pending merge\nPR: ${PR_URL}`);
  const both = planVerificationRebind('v.md', withReal, SHAS, PR_URL);
  assert.deepStrictEqual(both.errors, []);
  assert.strictEqual(both.next.split('\n')[7], 'Merge SHA: pending merge', 'the <pre> example is untouched');
  assert.strictEqual(both.next.split('\n')[10], `Merge SHA: ${MERGE}`, 'the real row is rebound');
});

test('P1: a duplicated CONTAINER object is as ambiguous as a duplicated leaf key', () => {
  // JSON.parse keeps the LAST `sha_binding`, so a document carrying a stale one
  // first and a bound one second read as already-bound, returned a clean no-op,
  // and left the contradictory stale object sitting in the file.
  const stale = 'a'.repeat(40);
  const doc = '{\n' +
    `  "sha_binding": { "merge_sha": "${stale}", "current_pr_head_sha": "${stale}" },\n` +
    `  "sha_binding": { "merge_sha": "${MERGE}", "current_pr_head_sha": "${HEAD}" }\n` +
    '}\n';
  assert.strictEqual(
    (JSON.parse(doc) as { sha_binding: { merge_sha: string } }).sha_binding.merge_sha,
    MERGE,
    'JSON.parse keeps the last container, which is what hid the stale one',
  );
  assert.strictEqual(duplicateKeysInSameObject(doc, 'sha_binding'), 2);

  const { errors, changes } = planEvidenceRebind('e.json', doc, SHAS);
  assert.ok(
    errors.some((e) => /writable binding key "sha_binding" appears 2 times in the same object/.test(e)),
    `a duplicated container must refuse, got: ${errors.join('|')}`,
  );
  assert.deepStrictEqual(changes, []);

  // Through the bundle entry point it is a refusal, not a no-op, and nothing is written.
  const { deps, store } = memoryDeps({ '/r/e.json': doc });
  const snapshot = { ...store };
  const result = rebindProofBundle(
    { issueId: 'X', shas: SHAS, prUrl: null, root: '/r', files: ['e.json'] }, { write: true }, deps);
  assert.strictEqual(result.code, 'proof_rebind_refused', 'must not report proof_rebind_noop');
  assert.deepStrictEqual(store, snapshot);

  // Duplicated array containers are covered too, and legitimate siblings are not.
  const dupArray = '{\n  "sha_binding": { "merge_sha": null, "current_pr_head_sha": null },\n' +
    '  "static_proof": { "test_run_logs": [] },\n  "static_proof": { "test_run_logs": [] }\n}\n';
  assert.ok(
    planEvidenceRebind('e.json', dupArray, SHAS).errors.some((e) => /"static_proof" appears 2 times/.test(e)),
  );
  assert.deepStrictEqual(
    planEvidenceRebind('e.json', JSON.stringify({
      sha_binding: { merge_sha: null, current_pr_head_sha: null },
      static_proof: { test_run_logs: [{ merge_sha: null }, { merge_sha: null }] },
    }, null, 2) + '\n', SHAS).errors,
    [],
    'sibling containers and sibling entries remain legitimate',
  );
});

test('P2: a non-binding byte change on a legitimately-changed LINE is refused', () => {
  // undeclaredLineChangeError is line-granular, so a byte added or removed on a
  // line that legitimately changed slips past it. The total byte delta must
  // equal the sum of the declared token deltas exactly.
  const before = '{\n  "sha_binding": {\n    "merge_sha": null,\n    "current_pr_head_sha": null\n  }\n}\n';
  const { next, changes, errors } = planEvidenceRebind('e.json', before, SHAS);
  assert.deepStrictEqual(errors, []);
  const declaredDelta = changes.reduce(
    (sum, c) => sum + (JSON.stringify(c.after).length - (c.before === null ? 4 : JSON.stringify(c.before).length)),
    0,
  );
  assert.strictEqual(
    Buffer.byteLength(next) - Buffer.byteLength(before),
    declaredDelta,
    'the surgical path accounts for every byte it changes',
  );
  // The guard is wired: deleting it leaves this assertion unenforced.
  const planner = fs.readFileSync(path.join(process.cwd(), 'scripts', 'ops', 'proof-rebind.ts'), 'utf8');
  const body = planner.slice(
    planner.indexOf('export function planEvidenceRebind('),
    planner.indexOf('export function planVerificationRebind('),
  );
  assert.match(body, /actualByteDelta !== expectedByteDelta/, 'planEvidenceRebind must enforce the byte delta');
  assert.match(body, /expectedByteDelta \+= newToken\.length - oldToken\.length/);
});

test('P2: the canonical PR owner rejects consecutive hyphens and over-length owners', () => {
  for (const bad of [
    'https://github.com/a--b/repo/pull/1',
    `https://github.com/${'a'.repeat(40)}/repo/pull/1`,
    'https://github.com/a-b-/repo/pull/1',
  ]) {
    assert.strictEqual(deriveCanonicalPrUrl(bad, 1), null, `${bad} must not be canonical`);
    assert.strictEqual(classifyPrRowValue(bad, null).kind, 'malformed');
  }
  // Legitimate owners still pass, including the maximum length and single hyphens.
  for (const good of [
    'https://github.com/griff843/Unit-Talk-v2/pull/1315',
    'https://github.com/a-b-c/repo/pull/1',
    `https://github.com/${'a'.repeat(39)}/repo/pull/1`,
  ]) {
    assert.strictEqual(deriveCanonicalPrUrl(good, good.endsWith('1315') ? 1315 : 1), good, `${good} must be canonical`);
  }
});

test('P1: --apply without a completed PR identity validation is refused BY THE CLI', () => {
  // The previous suite only exercised validatePrIdentity, a pure function, so
  // disabling the CLI's own `apply && !identityValidated` gate left the test
  // that claimed to cover it green. This drives the CLI itself.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'proof-rebind-applygate-'));
  execFileSync('git', ['init', '-q'], { cwd: dir });
  const proofDir = path.join(dir, 'docs', '06_status', 'proof', 'UTV2-1592');
  fs.mkdirSync(proofDir, { recursive: true });
  fs.writeFileSync(path.join(proofDir, 'evidence.json'), EVIDENCE);
  fs.writeFileSync(path.join(proofDir, 'verification.md'), RICH_VERIFICATION);
  const digests = {
    evidence: sha256(fs.readFileSync(path.join(proofDir, 'evidence.json'), 'utf8')),
    verification: sha256(fs.readFileSync(path.join(proofDir, 'verification.md'), 'utf8')),
  };
  const script = path.join(process.cwd(), 'scripts', 'ops', 'proof-rebind.ts');
  const run = (args: string[]): { code: string; errors: string[] } => {
    let out = '';
    try {
      out = execFileSync('npx', ['tsx', script, ...args],
        { cwd: dir, encoding: 'utf8', env: { ...process.env, PATH: process.env.PATH ?? '' } });
    } catch (error) {
      out = (error as { stdout?: string }).stdout ?? '';
    }
    return JSON.parse(out);
  };
  const base = ['--issue', 'UTV2-1592', '--merge-sha', MERGE, '--approved-head', HEAD];

  // --apply with NO --pr: no identity validation ever ran.
  const noPr = run([...base, '--apply']);
  assert.strictEqual(noPr.code, 'proof_rebind_refused');
  assert.ok(noPr.errors.some((e) => /--apply requires --pr <number> and a successful PR identity validation/.test(e)),
    `got: ${JSON.stringify(noPr.errors)}`);

  // --apply --skip-pr-check can never be combined.
  const skipped = run([...base, '--apply', '--skip-pr-check', '--pr', '1311']);
  assert.strictEqual(skipped.code, 'proof_rebind_refused');
  assert.ok(skipped.errors.some((e) => /--skip-pr-check is preview-only/.test(e)));

  // --pr-url is never accepted from the caller.
  const prUrlFlag = run([...base, '--pr-url', PR_URL_1311]);
  assert.strictEqual(prUrlFlag.code, 'proof_rebind_refused');
  assert.ok(prUrlFlag.errors.some((e) => /--pr-url is not accepted/.test(e)));

  // Every one of those refusals wrote zero bytes.
  assert.strictEqual(sha256(fs.readFileSync(path.join(proofDir, 'evidence.json'), 'utf8')), digests.evidence);
  assert.strictEqual(sha256(fs.readFileSync(path.join(proofDir, 'verification.md'), 'utf8')), digests.verification);
  fs.rmSync(dir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Findings from the fourth adversarial exact-head review, of 8277bb64.
// ---------------------------------------------------------------------------

test('P1: a SETEXT heading ends the binding section', () => {
  // Setext is the other legal way to write a markdown heading: a text line
  // underlined with = or -. Recognising only ATX left the section running past
  // an "Appendix / --------" boundary, so the rows after it became writable and
  // the shared mask concealed the rewrite.
  const doc = (underline: string) => [
    '# P', `MERGE_SHA: ${'a'.repeat(40)}`, '', '## Merge SHA Binding', '',
    'Merge SHA: pending merge', `PR: ${PR_URL}`, '',
    'Appendix', underline, '',
    `Execution SHA: ${'c'.repeat(40)}`, '',
  ].join('\n');

  for (const underline of ['--------', '========', '  ---', '-']) {
    const result = planVerificationRebind('v.md', doc(underline), SHAS, PR_URL);
    assert.deepStrictEqual(result.errors, [], `underline ${JSON.stringify(underline)}: ${result.errors.join('|')}`);
    assert.strictEqual(
      result.next.split('\n')[11],
      `Execution SHA: ${'c'.repeat(40)}`,
      `underline ${JSON.stringify(underline)}: the row after the setext heading must not be rewritten`,
    );
    assert.ok(
      maskWritableRegions(doc(underline)).includes(`Execution SHA: ${'c'.repeat(40)}`),
      'the mask must use the same rule, or the rewrite would be concealed',
    );
  }

  const lines = doc('--------').split('\n');
  const verbatim = verbatimLineIndices(lines);
  assert.ok(isSetextHeadingText(lines, 8, verbatim), '"Appendix" is the setext heading text line');
  assert.ok(!isSetextHeadingText(lines, 7, verbatim), 'a blank line is not a setext heading');
  // A setext underline inside a code fence is not a heading.
  const fencedUnderline = ['a', '```', 'Appendix', '-----', '```', 'b'];
  assert.ok(!isSetextHeadingText(fencedUnderline, 2, verbatimLineIndices(fencedUnderline)));
});

test('P1: an HTML comment is a verbatim region', () => {
  // Nothing inside <!-- --> renders, so a binding-looking line in a comment is
  // narrative. It was being rewritten with zero errors, and masked.
  const doc = [
    '# P', `MERGE_SHA: ${'a'.repeat(40)}`, '',
    '<!--', `MERGE_SHA: ${'b'.repeat(40)}`, 'Merge SHA: pending merge', '-->', '',
    '## Merge SHA Binding', '', 'Merge SHA: pending merge', `PR: ${PR_URL}`, '',
  ].join('\n');

  const result = planVerificationRebind('v.md', doc, SHAS, PR_URL);
  assert.deepStrictEqual(result.errors, [], `got: ${result.errors.join('|')}`);
  const after = result.next.split('\n');
  assert.strictEqual(after[1], `MERGE_SHA: ${MERGE}`, 'the real top-level line is rebound');
  assert.strictEqual(after[4], `MERGE_SHA: ${'b'.repeat(40)}`, 'the commented line must survive byte-for-byte');
  assert.strictEqual(after[5], 'Merge SHA: pending merge', 'the commented row must survive byte-for-byte');
  assert.ok(maskWritableRegions(doc).includes(`MERGE_SHA: ${'b'.repeat(40)}`), 'the mask must not conceal it');

  assert.deepStrictEqual([...verbatimLineIndices(['a', '<!--', 'x', 'y', '-->', 'b'])], [2, 3]);
  // A single-line comment encloses nothing.
  assert.deepStrictEqual([...verbatimLineIndices(['a', '<!-- x -->', 'b'])], []);
});

test('P1: an inline-code MENTION of <pre> is prose, not an unterminated block', () => {
  // Treating a backticked `<pre>` mention as an opening tag left the rest of the
  // document permanently "inside" a block — which newly refused this lane's own
  // proof bundle, because that bundle documents this very rule.
  const doc = [
    '# P', `MERGE_SHA: ${'a'.repeat(40)}`, '',
    'Narrative that mentions `<pre>` and `</pre>` as inline code.', '',
    '## Merge SHA Binding', '', 'Merge SHA: pending merge', `PR: ${PR_URL}`, '',
  ].join('\n');
  const result = planVerificationRebind('v.md', doc, SHAS, PR_URL);
  assert.deepStrictEqual(result.errors, [], `an inline mention must not hide the section: ${result.errors.join('|')}`);
  assert.strictEqual(result.next.split('\n')[7], `Merge SHA: ${MERGE}`);

  assert.deepStrictEqual([...verbatimLineIndices(['a', 'see `<pre>` here', 'b'])], [], 'a mention opens nothing');
  assert.deepStrictEqual([...verbatimLineIndices(['a', '<pre>', 'x', '</pre>', 'b'])], [2], 'real tags still work');

  // THIS LANE'S OWN BUNDLE is the regression case: it must plan cleanly.
  const own = fs.readFileSync(
    path.join(process.cwd(), 'docs', '06_status', 'proof', 'UTV2-1614', 'verification.md'), 'utf8');
  assert.ok(own.includes('`<pre>`'), 'precondition: this bundle mentions <pre> as inline code');
  const ownPlan = planVerificationRebind('v.md', own, SHAS, 'https://github.com/griff843/Unit-Talk-v2/pull/1315');
  assert.ok(
    !ownPlan.errors.some((e) => /section is absent/.test(e)),
    `this lane's own bundle must not be refused: ${ownPlan.errors.join('|')}`,
  );
});

test('P2: the pre-merge placeholder set matches the repository sentinel contract', () => {
  // These are not invented here. Rejecting them refused 25 real bundles that
  // legitimately store a CI-resolved sentinel. The alignment is asserted
  // mechanically, against the two canonical sources, so it cannot drift.
  const readSet = (file: string, marker: string): string[] => {
    const src = fs.readFileSync(path.join(process.cwd(), file), 'utf8');
    const from = src.indexOf(marker);
    assert.ok(from >= 0, `${file} must still declare ${marker}`);
    const block = src.slice(from, src.indexOf(']', from));
    return [...block.matchAll(/'([^']+)'/g)].map((m) => m[1]).filter((v) => v !== '');
  };
  for (const [file, marker] of [
    ['packages/invariants/src/merge-sha-binding.ts', 'const SENTINEL_VALUES = new Set(['],
    ['scripts/ci/proof-binding-validator.ts', "const SENTINELS = new Set(["],
  ] as const) {
    for (const sentinel of readSet(file, marker)) {
      assert.ok(
        PRE_MERGE_PLACEHOLDERS.has(sentinel),
        `${file} allows "${sentinel}" but PRE_MERGE_PLACEHOLDERS rejects it — 25 real bundles carry such values`,
      );
    }
  }
  // Behaviourally: a real bundle's sentinel is a valid pre-merge value, not malformed.
  for (const sentinel of ['set-by-ci', 'validated-by-ci-at-runtime']) {
    assert.strictEqual(classifyBindingValue(sentinel).kind, 'placeholder', sentinel);
    const doc = JSON.stringify({
      sha_binding: { merge_sha: null, current_pr_head_sha: sentinel, evidence_commit_sha: sentinel },
    }, null, 2) + '\n';
    assert.deepStrictEqual(planEvidenceRebind('e.json', doc, SHAS).errors, [], sentinel);
  }
  // Genuinely malformed values are still refused.
  assert.strictEqual(classifyBindingValue('set-by-someone').kind, 'malformed');
});

test('P2: the canonical PR owner is capped at 39 TOTAL characters', () => {
  // Bounding the component repetitions counted alphanumeric runs, not
  // characters, so a 41-character hyphenated owner passed as canonical.
  const hyphenated = (n: number) => Array.from({ length: n }, () => 'a').join('-');
  const over = `https://github.com/${hyphenated(21)}/repo/pull/1`;
  assert.ok(hyphenated(21).length > 39, 'precondition: this owner exceeds 39 characters');
  assert.strictEqual(deriveCanonicalPrUrl(over, 1), null, 'an over-length hyphenated owner must be rejected');
  assert.strictEqual(classifyPrRowValue(over, null).kind, 'malformed');

  const ok = `https://github.com/${hyphenated(20)}/repo/pull/1`;
  assert.strictEqual(hyphenated(20).length, 39);
  assert.strictEqual(deriveCanonicalPrUrl(ok, 1), ok, 'exactly 39 characters is legal');
});
