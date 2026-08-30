/**
 * Tests for ops:proof-check (Proof Freshness Validator — WFR-v2 Phase A)
 *
 * These tests exercise the run() logic via fixture files written to a
 * temp dir. They use node:test so they run under `pnpm test`.
 */

import { describe, it, before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync, type SpawnSyncReturns } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateProofSchema, isProofStale, PROOF_SCHEMA_VERSION } from './proof-schema.js';
import type { ProofSchemaV2 } from './proof-schema.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const VALID_SHA = 'a'.repeat(40);
const OTHER_SHA = 'b'.repeat(40);
const THIRD_SHA = 'c'.repeat(40);
const PRE_PROOF_HOOK = fileURLToPath(
  new URL('../../.claude/hooks/pre-proof-validator.sh', import.meta.url),
);

function makeProof(overrides: Partial<ProofSchemaV2> = {}): ProofSchemaV2 {
  return {
    schema_version: PROOF_SCHEMA_VERSION,
    issue_id: 'UTV2-1156',
    pr_number: 900,
    source_sha: VALID_SHA,
    reviewed_head_sha: VALID_SHA,
    evidence_commit_sha: null,
    current_head_sha: null,
    merge_sha: null,
    gate_results: [{ gate: 'ci', verdict: 'PASS', detail: 'All green' }],
    reviewer_verdict: null,
    pm_verdict: null,
    generated_at: new Date().toISOString(),
    ...overrides,
  };
}

function runGit(repo: string, args: string[], allowFailure = false): SpawnSyncReturns<string> {
  const result = spawnSync('git', args, { cwd: repo, encoding: 'utf8' });
  if (!allowFailure) {
    assert.equal(
      result.status,
      0,
      `git ${args.join(' ')} failed\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
    );
  }
  return result;
}

function writeFixture(repo: string, relativePath: string, content: string): void {
  const target = path.join(repo, relativePath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
}

function commitFixture(repo: string, message: string): void {
  runGit(repo, ['add', '--all']);
  runGit(repo, ['commit', '-m', message]);
}

function initGitFixture(): string {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'pre-proof-hook-test-'));
  runGit(repo, ['init', '--initial-branch=main']);
  runGit(repo, ['config', 'user.name', 'Unit Talk Test']);
  runGit(repo, ['config', 'user.email', 'unit-talk-test@example.invalid']);
  writeFixture(repo, 'package.json', '{"scripts":{"test:ops":"base"}}\n');
  commitFixture(repo, 'base');
  runGit(repo, ['branch', 'topic']);
  return repo;
}

function validEvidence(sha = VALID_SHA): string {
  return `${JSON.stringify({
    schema_version: '1',
    sha_binding: { verified_source_sha: sha, ci_sentinels: ['unit-test'] },
    static_proof: {},
    status: 'complete',
  })}\n`;
}

function invalidEvidence(marker = 'historical-proof'): string {
  return `${JSON.stringify({
    schema_version: '1',
    sha_binding: { verified_source_sha: VALID_SHA },
    static_proof: { marker },
    status: 'complete',
  })}\n`;
}

function runPreProofHook(
  repo: string,
  hookPath = PRE_PROOF_HOOK,
  command = 'git commit -m "merge"',
): SpawnSyncReturns<string> {
  return spawnSync('bash', [hookPath], {
    cwd: repo,
    encoding: 'utf8',
    input: JSON.stringify({ tool_input: { command } }),
  });
}

interface InheritedMergeFixture {
  repo: string;
  oldProofPath: string;
}

function setupInheritedMerge(options: {
  packageConflict?: boolean;
  inheritedEvidence?: string;
} = {}): InheritedMergeFixture {
  const repo = initGitFixture();
  const oldProofPath = 'docs/06_status/proof/OLD/evidence.json';

  writeFixture(repo, oldProofPath, options.inheritedEvidence ?? invalidEvidence());
  if (options.packageConflict) {
    writeFixture(repo, 'package.json', '{"scripts":{"test:ops":"main-suite"}}\n');
  }
  commitFixture(repo, 'main adds historical proof');

  runGit(repo, ['checkout', 'topic']);
  writeFixture(repo, 'lane-owned.txt', 'topic change\n');
  writeFixture(repo, 'docs/06_status/proof/TOPIC/evidence.json', validEvidence(OTHER_SHA));
  if (options.packageConflict) {
    writeFixture(repo, 'package.json', '{"scripts":{"test:ops":"topic-suite"}}\n');
  }
  commitFixture(repo, 'topic work');

  const merge = runGit(repo, ['merge', 'main', '--no-commit', '--no-ff'], options.packageConflict);
  if (options.packageConflict) {
    assert.notEqual(merge.status, 0, 'fixture must retain the unrelated package.json conflict');
    writeFixture(
      repo,
      'package.json',
      '{"scripts":{"test:ops":"main-suite topic-suite"}}\n',
    );
    runGit(repo, ['add', 'package.json']);
  }
  assert.ok(fs.existsSync(path.join(repo, '.git', 'MERGE_HEAD')), 'fixture must be mid-merge');
  return { repo, oldProofPath };
}

function writeLegacySelectionMutation(repo: string): string {
  const mutatedHook = path.join(repo, 'legacy-pre-proof-validator.sh');
  const current = fs.readFileSync(PRE_PROOF_HOOK, 'utf8');
  const selection = /# BEGIN MERGE-AWARE SELECTION[\s\S]*?# END MERGE-AWARE SELECTION/;
  assert.match(current, selection);
  const legacy = current.replace(
    selection,
    `# BEGIN MERGE-AWARE SELECTION
repo_root=$(git rev-parse --show-toplevel 2>/dev/null) || exit 2
mapfile -t staged_files < <(git diff --cached --no-renames --name-only 2>/dev/null)
[ "\${#staged_files[@]}" -eq 0 ] && exit 0
has_proof=false
for f in "\${staged_files[@]}"; do
  if [[ "$f" == docs/06_status/proof/* ]]; then
    has_proof=true
    break
  fi
done
[ "$has_proof" = false ] && exit 0
# END MERGE-AWARE SELECTION`,
  );
  fs.writeFileSync(mutatedHook, legacy);
  return mutatedHook;
}

// ---------------------------------------------------------------------------
// Schema validation unit tests (no filesystem)
// ---------------------------------------------------------------------------

describe('proof-schema validation fixtures', () => {
  it('valid proof passes', () => {
    const r = validateProofSchema(makeProof());
    assert.ok(r.valid, JSON.stringify(r.failures));
  });

  it('NEGATIVE: wrong schema_version → invalid', () => {
    const r = validateProofSchema({ ...makeProof(), schema_version: 1 });
    assert.ok(!r.valid);
    assert.ok(r.failures.some(f => f.field === 'schema_version'));
  });

  it('NEGATIVE: missing issue_id → invalid', () => {
    const r = validateProofSchema({ ...makeProof(), issue_id: '' });
    assert.ok(!r.valid);
  });

  it('NEGATIVE: pr_number = 0 → invalid', () => {
    const r = validateProofSchema({ ...makeProof(), pr_number: 0 });
    assert.ok(!r.valid);
    assert.ok(r.failures.some(f => f.field === 'pr_number'));
  });

  it('NEGATIVE: bad source_sha → invalid', () => {
    const r = validateProofSchema({ ...makeProof(), source_sha: 'deadbeef' });
    assert.ok(!r.valid);
    assert.ok(r.failures.some(f => f.field === 'source_sha'));
  });

  it('NEGATIVE: bad gate verdict → invalid', () => {
    const r = validateProofSchema({
      ...makeProof(),
      gate_results: [{ gate: 'ci', verdict: 'YES', detail: 'hmm' }],
    });
    assert.ok(!r.valid);
  });

  it('NEGATIVE: empty gate_results is valid (no gates required yet)', () => {
    const r = validateProofSchema({ ...makeProof(), gate_results: [] });
    assert.ok(r.valid, JSON.stringify(r.failures));
  });

  it('NEGATIVE: non-array gate_results → invalid', () => {
    const r = validateProofSchema({ ...makeProof(), gate_results: 'bad' as unknown as [] });
    assert.ok(!r.valid);
  });
});

// ---------------------------------------------------------------------------
// Staleness logic unit tests
// ---------------------------------------------------------------------------

describe('isProofStale', () => {
  it('fresh: source_sha == current head → not stale', () => {
    assert.equal(isProofStale(makeProof({ source_sha: VALID_SHA }), VALID_SHA), false);
  });

  it('NEGATIVE stale: source_sha != current head → stale', () => {
    assert.equal(isProofStale(makeProof({ source_sha: VALID_SHA }), OTHER_SHA), true);
  });

  it('NEGATIVE stale: proof written at HEAD-1, new commit pushed → stale', () => {
    const proof = makeProof({ source_sha: VALID_SHA });
    const newHead = THIRD_SHA;
    assert.equal(isProofStale(proof, newHead), true);
  });

  it('malformed currentHeadSha → treats as not-stale (unknown)', () => {
    assert.equal(isProofStale(makeProof({ source_sha: VALID_SHA }), 'short'), false);
  });

  it('malformed source_sha → treats as stale (invalid proof)', () => {
    assert.equal(isProofStale(makeProof({ source_sha: 'bad' }), VALID_SHA), true);
  });
});

// ---------------------------------------------------------------------------
// Filesystem fixture tests
// ---------------------------------------------------------------------------

describe('proof-check file resolution', () => {
  let tmpDir: string;

  before(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'proof-check-test-'));
  });

  after(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('finds valid JSON proof file', () => {
    const proofPath = path.join(tmpDir, 'UTV2-TEST.json');
    fs.writeFileSync(proofPath, JSON.stringify(makeProof({ issue_id: 'UTV2-TEST' })));
    assert.ok(fs.existsSync(proofPath));
    const content = JSON.parse(fs.readFileSync(proofPath, 'utf8')) as unknown;
    const r = validateProofSchema(content);
    assert.ok(r.valid, JSON.stringify(r.failures));
  });

  it('NEGATIVE: missing proof file → no content', () => {
    const proofPath = path.join(tmpDir, 'UTV2-MISSING.json');
    assert.ok(!fs.existsSync(proofPath));
  });

  it('NEGATIVE: corrupt JSON → parse error', () => {
    const proofPath = path.join(tmpDir, 'UTV2-CORRUPT.json');
    fs.writeFileSync(proofPath, '{bad json}');
    assert.throws(() => JSON.parse(fs.readFileSync(proofPath, 'utf8')));
  });

  it('NEGATIVE: proof with wrong schema_version in file → invalid', () => {
    const proofPath = path.join(tmpDir, 'UTV2-V1.json');
    fs.writeFileSync(proofPath, JSON.stringify({ ...makeProof(), schema_version: 1 }));
    const content = JSON.parse(fs.readFileSync(proofPath, 'utf8')) as unknown;
    const r = validateProofSchema(content);
    assert.ok(!r.valid);
  });

  it('NEGATIVE: stale proof written to file', () => {
    const proofPath = path.join(tmpDir, 'UTV2-STALE.json');
    const proof = makeProof({ source_sha: VALID_SHA });
    fs.writeFileSync(proofPath, JSON.stringify(proof));
    const content = JSON.parse(fs.readFileSync(proofPath, 'utf8')) as ProofSchemaV2;
    // Simulate that the head has moved
    const newHead = OTHER_SHA;
    assert.equal(isProofStale(content, newHead), true);
  });

  it('NEGATIVE: pr_number mismatch', () => {
    const proof = makeProof({ pr_number: 900 });
    const claimedPr = 901;
    assert.notEqual(proof.pr_number, claimedPr);
  });
});

// ---------------------------------------------------------------------------
// Pre-proof hook merge selection (real git repositories; no git mocks)
// ---------------------------------------------------------------------------

test('pre-proof hook ignores invalid evidence inherited unchanged from the incoming parent', () => {
  const { repo, oldProofPath } = setupInheritedMerge();
  try {
    assert.ok(fs.existsSync(path.join(repo, oldProofPath)));
    const result = runPreProofHook(repo);
    assert.equal(result.status, 0, result.stderr);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('pre-proof hook blocks an inherited proof deliberately edited and staged after merge', () => {
  const { repo, oldProofPath } = setupInheritedMerge();
  try {
    writeFixture(repo, oldProofPath, invalidEvidence('edited-after-merge'));
    runGit(repo, ['add', oldProofPath]);

    const result = runPreProofHook(repo);
    assert.equal(result.status, 2);
    assert.match(result.stderr, /ci_sentinels missing or empty/);
    assert.match(result.stderr, /docs\/06_status\/proof\/OLD\/evidence\.json/);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('pre-proof hook validates a conflict resolved to exactly the incoming parent bytes', () => {
  const repo = initGitFixture();
  const proofPath = 'docs/06_status/proof/CONFLICT/evidence.json';
  try {
    writeFixture(repo, proofPath, validEvidence());
    commitFixture(repo, 'main proof baseline');
    runGit(repo, ['branch', '-f', 'topic', 'HEAD']);

    writeFixture(repo, proofPath, invalidEvidence('incoming-conflict-version'));
    commitFixture(repo, 'main changes proof');
    const incomingBytes = runGit(repo, ['show', `main:${proofPath}`]).stdout;

    runGit(repo, ['checkout', 'topic']);
    writeFixture(repo, proofPath, validEvidence(THIRD_SHA));
    commitFixture(repo, 'topic changes proof');

    const merge = runGit(repo, ['merge', 'main', '--no-commit', '--no-ff'], true);
    assert.notEqual(merge.status, 0, 'proof path must conflict');
    runGit(repo, ['checkout', '--theirs', '--', proofPath]);
    runGit(repo, ['add', proofPath]);
    assert.equal(fs.readFileSync(path.join(repo, proofPath), 'utf8'), incomingBytes);
    assert.match(fs.readFileSync(path.join(repo, '.git', 'MERGE_MSG'), 'utf8'), /# Conflicts:/);

    const result = runPreProofHook(repo);
    assert.equal(result.status, 2);
    assert.match(result.stderr, /ci_sentinels missing or empty/);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('pre-proof hook retains fail-closed validation for a normal non-merge commit', () => {
  const repo = initGitFixture();
  const proofPath = 'docs/06_status/proof/TOPIC/evidence.json';
  try {
    writeFixture(repo, proofPath, invalidEvidence('ordinary-topic-proof'));
    runGit(repo, ['add', proofPath]);

    const result = runPreProofHook(repo);
    assert.equal(result.status, 2);
    assert.match(result.stderr, /ci_sentinels missing or empty/);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('pre-proof hook blocks malformed JSON rather than treating parse failure as valid', () => {
  const repo = initGitFixture();
  const proofPath = 'docs/06_status/proof/TOPIC/evidence.json';
  try {
    writeFixture(repo, proofPath, '{not-json}\n');
    runGit(repo, ['add', proofPath]);

    const result = runPreProofHook(repo);
    assert.equal(result.status, 2);
    assert.match(result.stderr, /cannot parse evidence/);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('pre-proof hook validates the staged blob instead of an unstaged worktree replacement', () => {
  const repo = initGitFixture();
  const proofPath = 'docs/06_status/proof/TOPIC/evidence.json';
  try {
    writeFixture(repo, proofPath, invalidEvidence('invalid-index-blob'));
    runGit(repo, ['add', proofPath]);
    writeFixture(repo, proofPath, validEvidence());
    assert.doesNotMatch(runGit(repo, ['show', `:${proofPath}`]).stdout, /ci_sentinels/);
    assert.match(fs.readFileSync(path.join(repo, proofPath), 'utf8'), /ci_sentinels/);

    const result = runPreProofHook(repo);
    assert.equal(result.status, 2);
    assert.match(result.stderr, /ci_sentinels missing or empty/);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('pre-proof hook recognizes equivalent git commit command spellings', async t => {
  const commands = [
    'git -C . commit -m alternate',
    "git 'commit' -m quoted",
    'git\tcommit -m tabbed',
    '/usr/bin/git --no-pager commit -m absolute',
  ];
  for (const command of commands) {
    await t.test(command.replace(/\s+/g, ' '), () => {
      const repo = initGitFixture();
      const proofPath = 'docs/06_status/proof/TOPIC/evidence.json';
      try {
        writeFixture(repo, proofPath, invalidEvidence(command));
        runGit(repo, ['add', proofPath]);
        const result = runPreProofHook(repo, PRE_PROOF_HOOK, command);
        assert.equal(result.status, 2, `${command}\n${result.stderr}`);
      } finally {
        fs.rmSync(repo, { recursive: true, force: true });
      }
    });
  }
});

test('PR #1453 regression allows inherited history while the legacy staged-file mutation blocks it', () => {
  const { repo } = setupInheritedMerge({ packageConflict: true });
  try {
    const fixed = runPreProofHook(repo);
    assert.equal(fixed.status, 0, fixed.stderr);

    const legacyHook = writeLegacySelectionMutation(repo);
    const mutated = runPreProofHook(repo, legacyHook);
    assert.equal(mutated.status, 2, 'legacy staged-file selection must reproduce the incident');
    assert.match(mutated.stderr, /docs\/06_status\/proof\/OLD\/evidence\.json/);
    assert.match(mutated.stderr, /ci_sentinels missing or empty/);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('pre-proof hook blocks delete and rename status tricks after a clean merge', async t => {
  await t.test('delete inherited evidence', () => {
    const { repo, oldProofPath } = setupInheritedMerge({ inheritedEvidence: validEvidence() });
    try {
      fs.rmSync(path.join(repo, oldProofPath));
      runGit(repo, ['add', '--all']);

      const result = runPreProofHook(repo);
      assert.equal(result.status, 2);
      assert.match(result.stderr, /proof file is staged as deleted or unavailable/);
    } finally {
      fs.rmSync(repo, { recursive: true, force: true });
    }
  });

  await t.test('rename inherited evidence', () => {
    const { repo, oldProofPath } = setupInheritedMerge({ inheritedEvidence: validEvidence() });
    const renamedPath = 'docs/06_status/proof/RENAMED/evidence.json';
    try {
      fs.mkdirSync(path.dirname(path.join(repo, renamedPath)), { recursive: true });
      runGit(repo, ['mv', oldProofPath, renamedPath]);

      const result = runPreProofHook(repo);
      assert.equal(result.status, 2);
      assert.match(result.stderr, /proof file is staged as deleted or unavailable/);
    } finally {
      fs.rmSync(repo, { recursive: true, force: true });
    }
  });
});

test('pre-proof hook conservatively blocks proof edits hidden in an octopus merge', () => {
  const repo = initGitFixture();
  const proofPath = 'docs/06_status/proof/OCTOPUS/evidence.json';
  try {
    runGit(repo, ['branch', 'incoming-one']);
    runGit(repo, ['branch', 'incoming-two']);

    runGit(repo, ['checkout', 'incoming-one']);
    writeFixture(repo, proofPath, validEvidence());
    commitFixture(repo, 'incoming one adds proof');

    runGit(repo, ['checkout', 'incoming-two']);
    writeFixture(repo, 'incoming-two.txt', 'second parent\n');
    commitFixture(repo, 'incoming two adds unrelated content');

    runGit(repo, ['checkout', 'topic']);
    writeFixture(repo, 'topic.txt', 'topic parent\n');
    commitFixture(repo, 'topic content');
    runGit(repo, ['merge', 'incoming-one', 'incoming-two', '--no-commit', '--no-ff']);

    writeFixture(repo, proofPath, invalidEvidence('octopus-edit'));
    runGit(repo, ['add', proofPath]);
    const mergeHeads = fs
      .readFileSync(path.join(repo, '.git', 'MERGE_HEAD'), 'utf8')
      .trim()
      .split(/\r?\n/);
    assert.equal(mergeHeads.length, 2);

    const result = runPreProofHook(repo);
    assert.equal(result.status, 2);
    assert.match(result.stderr, /ci_sentinels missing or empty/);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('merge selection resolves MERGE_HEAD through a linked worktree git directory', () => {
  const owner = initGitFixture();
  const linked = `${owner}-linked`;
  const proofPath = 'docs/06_status/proof/OLD/evidence.json';
  try {
    writeFixture(owner, proofPath, invalidEvidence('linked-worktree-history'));
    commitFixture(owner, 'main adds historical proof');
    runGit(owner, ['worktree', 'add', linked, 'topic']);

    writeFixture(linked, 'topic.txt', 'topic worktree change\n');
    commitFixture(linked, 'topic work');
    runGit(linked, ['merge', 'main', '--no-commit', '--no-ff']);
    assert.ok(fs.statSync(path.join(linked, '.git')).isFile());
    assert.match(runGit(linked, ['rev-parse', '--git-dir']).stdout, /worktrees/);

    const result = runPreProofHook(linked);
    assert.equal(result.status, 0, result.stderr);
  } finally {
    runGit(owner, ['worktree', 'remove', '--force', linked], true);
    fs.rmSync(linked, { recursive: true, force: true });
    fs.rmSync(owner, { recursive: true, force: true });
  }
});

test('the configured hook is the tracked repo-owned implementation', () => {
  const repoRoot = path.resolve(path.dirname(PRE_PROOF_HOOK), '../..');
  const tracked = runGit(repoRoot, [
    'ls-files',
    '--error-unmatch',
    '.claude/hooks/pre-proof-validator.sh',
  ]);
  assert.equal(tracked.stdout.trim(), '.claude/hooks/pre-proof-validator.sh');

  const settings = JSON.parse(
    fs.readFileSync(path.join(repoRoot, '.claude', 'settings.json'), 'utf8'),
  ) as { hooks?: { PreToolUse?: Array<{ hooks?: Array<{ command?: string }> }> } };
  const configuredCommands = (settings.hooks?.PreToolUse ?? []).flatMap(entry =>
    (entry.hooks ?? []).map(hook => hook.command),
  );
  assert.deepEqual(
    configuredCommands.filter(command => command === 'bash .claude/hooks/pre-proof-validator.sh'),
    ['bash .claude/hooks/pre-proof-validator.sh'],
  );
});

test('pre-proof hook engages on commits invoked indirectly through a shell wrapper', async t => {
  // The pre-rewrite hook matched the raw command substring, so `bash -c "git
  // commit ..."` was covered. Argv tokenization alone cannot see inside the
  // quoted string, so the fallback below must keep these forms covered.
  const wrapped = [
    'bash -c "git commit -m indirect"',
    "sh -c 'git commit -m indirect'",
    'eval "git commit -m indirect"',
  ];
  for (const command of wrapped) {
    await t.test(command, () => {
      const repo = initGitFixture();
      const proofPath = 'docs/06_status/proof/TOPIC/evidence.json';
      try {
        writeFixture(repo, proofPath, invalidEvidence(command));
        runGit(repo, ['add', proofPath]);
        const result = runPreProofHook(repo, PRE_PROOF_HOOK, command);
        assert.equal(result.status, 2, `${command}\n${result.stderr}`);
        assert.match(result.stderr, /ci_sentinels missing or empty/);
      } finally {
        fs.rmSync(repo, { recursive: true, force: true });
      }
    });
  }
});

test('the indirect-invocation fallback is load-bearing, not decorative', () => {
  const repo = initGitFixture();
  const proofPath = 'docs/06_status/proof/TOPIC/evidence.json';
  try {
    writeFixture(repo, proofPath, invalidEvidence('mutation-control'));
    runGit(repo, ['add', proofPath]);

    const current = fs.readFileSync(PRE_PROOF_HOOK, 'utf8');
    const fallback = /if \[ "\$is_git_commit" != yes \]; then[\s\S]*?\nfi\n/;
    assert.match(current, fallback, 'fallback block must exist to be mutated');
    const mutatedHook = path.join(repo, 'no-fallback-pre-proof-validator.sh');
    fs.writeFileSync(mutatedHook, current.replace(fallback, ''));

    const command = 'bash -c "git commit -m indirect"';
    assert.equal(runPreProofHook(repo, mutatedHook, command).status, 0);
    assert.equal(runPreProofHook(repo, PRE_PROOF_HOOK, command).status, 2);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});
