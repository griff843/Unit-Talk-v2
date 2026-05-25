import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildPmVerdictBody,
  buildPmVerdictPayload,
  parsePmVerdictArgs,
  runPmVerdict,
} from './pm-verdict.js';

test('parsePmVerdictArgs defaults to dry-run and requires explicit post for posting', () => {
  const options = parsePmVerdictArgs([
    '--',
    'utv2-1200',
    '--pr',
    '44',
    '--approve',
    '--actor',
    'griff843',
  ]);

  assert.equal(options.issueId, 'UTV2-1200');
  assert.equal(options.prNumber, 44);
  assert.equal(options.approve, true);
  assert.equal(options.post, false);
  assert.equal(options.dryRun, true);
  assert.equal(options.actor, 'griff843');
});

test('parsePmVerdictArgs enables non-dry-run only with --post and no --dry-run', () => {
  const options = parsePmVerdictArgs(['UTV2-1200', '--pr=44', '--approve', '--post']);

  assert.equal(options.post, true);
  assert.equal(options.dryRun, false);
});

test('buildPmVerdictBody emits canonical PM_VERDICT: APPROVED schema', () => {
  const payload = buildPmVerdictPayload({
    issueId: 'utv2-1200',
    prNumber: 44,
    actor: 'griff843',
    approvedAt: '2026-05-25T12:00:00.000Z',
    note: 'ready to merge',
  });
  const body = buildPmVerdictBody(payload);
  const lines = body.split('\n').filter((line) => line.trim().length > 0);

  assert.equal(lines[0], 'PM_VERDICT: APPROVED');
  assert.equal(lines[1], 'schema: pm-verdict/v1');
  assert.equal(lines[2], 'Issue: UTV2-1200');
  assert.match(body, /"schema": "pm-verdict\/v1"/);
  assert.match(body, /"verdict": "APPROVED"/);
  assert.match(body, /"issue_id": "UTV2-1200"/);
  assert.match(body, /does not bypass branch protection/);
});

test('runPmVerdict refuses to emit approval payload without --approve', () => {
  const result = runPmVerdict({
    issueId: 'UTV2-1200',
    prNumber: 44,
    actor: 'griff843',
    approve: false,
    post: false,
    json: false,
    dryRun: true,
    note: null,
  });

  assert.equal(result.ok, false);
  assert.equal(result.payload, null);
  assert.ok(result.failures.some((failure) => failure.includes('--approve')));
});

test('runPmVerdict posts only when --approve and --post are explicit', () => {
  const calls: Array<{ command: string; args: string[] }> = [];
  const result = runPmVerdict(
    {
      issueId: 'UTV2-1200',
      prNumber: 44,
      actor: 'griff843',
      approve: true,
      post: true,
      json: false,
      dryRun: false,
      note: null,
    },
    (command, args) => {
      calls.push({ command, args });
      return { status: 0, stdout: '', stderr: '' };
    },
  );

  assert.equal(result.ok, true);
  assert.equal(result.posted, true);
  assert.deepStrictEqual(calls.map((call) => call.command), ['gh']);
  assert.deepStrictEqual(calls[0]?.args.slice(0, 3), ['pr', 'comment', '44']);
  assert.ok(calls[0]?.args.includes('--body'));
});
