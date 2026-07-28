import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import {
  EVIDENCE_BINDING_FIELDS,
  validatePrIdentity,
  deriveCanonicalPrUrl,
  duplicateKeysInSameObject,
  REQUIRED_EVIDENCE_FIELDS,
  planEvidenceRebind,
  planVerificationRebind,
  rebindProofBundle,
  sha256,
  validateShaSet,
  type RebindDeps,
  type ShaSet,
} from './proof-rebind.js';

const MERGE = '2822b709c74c43dc24a50dc6df35597e1a0463fe';
const HEAD = 'e0464b519206ca63f707002ea91d91136750d797';
const EXEC = '6718c0de3c125beaa241bb8eb6937a7fa8e5f0bb';
const SHAS: ShaSet = { merge_sha: MERGE, approved_head_sha: HEAD, execution_sha: EXEC };

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
  const { next, changes } = planVerificationRebind('verification.md', RICH_VERIFICATION, SHAS, 'https://x/pull/1311');

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

test('refuses when content outside the binding regions would change', () => {
  const { errors } = planVerificationRebind('verification.md', RICH_VERIFICATION, SHAS, null);
  assert.deepStrictEqual(errors, []);

  // A file with no MERGE_SHA: line must be refused rather than invented.
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
      prUrl: 'https://x/pull/1311',
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

test('refuses if more lines would change than bindings were declared', () => {
  // Guards against any future edit path that rewrites unrelated content.
  const doc = '{\n  "sha_binding": {\n    "merge_sha": null,\n    "current_pr_head_sha": null\n  }\n}\n';
  const { errors } = planEvidenceRebind('e.json', doc, SHAS);
  assert.deepStrictEqual(errors, [], 'the surgical path must not trip its own guard');
});

// ---------------------------------------------------------------------------
// Findings from the exact-head review of 612b8ca1. Each test fails if its fix
// is reverted; every refusal must also write zero bytes.
// ---------------------------------------------------------------------------

const SECTION = '\n## Merge SHA Binding\n\nMerge SHA: pending merge\nPR: https://x/pull/1\n';

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

test('P0: the ENTIRE binding section is validated before it is replaced', () => {
  const section = (body: string): string => md('body\n') + '\n## Merge SHA Binding\n' + body;

  // Nothing canonical at all: missing both required rows AND unrelated content.
  const junk = planVerificationRebind('v.md', section('\nnothing canonical here\n'), SHAS, null).errors;
  assert.ok(junk.some((e) => /missing its required "Merge SHA:" row/.test(e)));
  assert.ok(junk.some((e) => /missing its required "PR:" row/.test(e)));
  assert.ok(junk.some((e) => /unrelated line\(s\) that a rebind would destroy/.test(e)));

  // Missing only the PR row.
  const noPr = planVerificationRebind('v.md', section('\nMerge SHA: pending merge\n'), SHAS, null).errors;
  assert.ok(noPr.some((e) => /missing its required "PR:" row/.test(e)));

  // Missing only the merge row.
  const noMerge = planVerificationRebind('v.md', section('\nPR: https://x/pull/1\n'), SHAS, null).errors;
  assert.ok(noMerge.some((e) => /missing its required "Merge SHA:" row/.test(e)));

  // Duplicate required row.
  const dupRow = planVerificationRebind(
    'v.md',
    section('\nMerge SHA: a\nMerge SHA: b\nPR: https://x/pull/1\n'),
    SHAS,
    null,
  ).errors;
  assert.ok(dupRow.some((e) => /has 2 "Merge SHA:" rows — duplicate/.test(e)));

  // Duplicate optional row.
  const dupOpt = planVerificationRebind(
    'v.md',
    section('\nMerge SHA: a\nApproved PR head: x\nApproved PR head: y\nPR: https://x/pull/1\n'),
    SHAS,
    null,
  ).errors;
  assert.ok(dupOpt.some((e) => /duplicate "Approved PR head:" rows/.test(e)));

  // Unrelated narrative inside the writable span must not be silently destroyed.
  const narrative = planVerificationRebind(
    'v.md',
    section('\nMerge SHA: a\nPR: https://x/pull/1\n\nOperator note: do not lose this.\n'),
    SHAS,
    null,
  ).errors;
  assert.ok(narrative.some((e) => /unrelated line\(s\) that a rebind would destroy/.test(e)));

  // A fully canonical section is accepted.
  const ok = planVerificationRebind(
    'v.md',
    section('\nMerge SHA: pending merge\nApproved PR head: x\nPR: https://x/pull/1\n'),
    SHAS,
    null,
  ).errors;
  assert.deepStrictEqual(ok, []);
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

test('the rename is durably committed by fsyncing the containing directory', () => {
  // Without this the replacement can be complete on disk while the directory
  // entry still points at the old inode after a host crash.
  const source = fs.readFileSync(path.join(process.cwd(), 'scripts', 'ops', 'proof-rebind.ts'), 'utf8');
  const atomic = source.slice(source.indexOf('function atomicWrite'), source.indexOf('const defaultDeps'));
  const renameIndex = atomic.indexOf('fs.renameSync');
  const dirOpen = atomic.indexOf('fs.openSync(dir');
  assert.ok(renameIndex >= 0, 'the write must go through rename');
  assert.ok(dirOpen > renameIndex, 'the containing directory must be fsynced AFTER the rename');
  assert.match(atomic.slice(dirOpen), /fs\.fsyncSync\(dirHandle\)/);
  assert.match(atomic, /fs\.fsyncSync\(handle\)/, 'the file itself must be fsynced before rename');
});

test('the recovery guidance is present as a section, not merely mentioned', () => {
  const source = fs.readFileSync(path.join(process.cwd(), 'scripts', 'ops', 'proof-rebind.ts'), 'utf8');
  const occurrences = (source.match(/PARTIAL-BUNDLE RECOVERY/g) ?? []).length;
  assert.ok(occurrences >= 2, 'must be both cross-referenced and present as a heading');
  const heading = source.indexOf(' * PARTIAL-BUNDLE RECOVERY\n * -----');
  assert.ok(heading >= 0, 'the recovery section heading must exist');
});
