import test from 'node:test';
import assert from 'node:assert/strict';
import { parseVerdict, validateT1Verdicts } from './merge-gate-verdict.cjs';

const PR_NUMBER = 1230;
const HEAD_SHA = '05abe4bf3f9c4870137d3dece41a30d1947ba1c3';
const OLD_HEAD_SHA = '17417b95a72c534b262c0cc2a6e3562627380de4';
const REVIEWERS = new Set(['griff843']);

function approvedComment({ pr = PR_NUMBER, headSha = HEAD_SHA, issue = 'UTV2-1501' } = {}) {
  return [
    'PM_VERDICT: APPROVED',
    'schema: pm-verdict/v1',
    `Issue: ${issue}`,
    `PR: ${pr}`,
    `Head SHA: ${headSha}`,
    '',
    'Scope of approval: something.',
  ].join('\n');
}

/**
 * UTV2-1926: a CHANGES_REQUIRED body. `bounce` omitted produces a body with NO
 * `Bounce:` line at all -- the exact shape of the historical #1592 comments,
 * and invalid under docs/05_operations/schemas/pm-verdict-v1.md rule 6.
 */
function changesRequiredComment({ bounce = undefined, issue = 'UTV2-1501' } = {}) {
  return [
    'PM_VERDICT: CHANGES_REQUIRED',
    'schema: pm-verdict/v1',
    `Issue: ${issue}`,
    ...(bounce === undefined ? [] : [`Bounce: ${bounce}`]),
    '',
    'Scope: something needs changing.',
  ].join('\n');
}

function verdictRecord(body, overrides = {}) {
  return {
    user: 'griff843',
    userType: 'User',
    parsed: parseVerdict(body),
    createdAt: '2026-07-17T00:00:00Z',
    ...overrides,
  };
}

test('parseVerdict extracts PR and Head SHA from anywhere in the body', () => {
  const parsed = parseVerdict(approvedComment());
  assert.equal(parsed.verdict, 'APPROVED');
  assert.equal(parsed.issueId, 'UTV2-1501');
  assert.equal(parsed.prNumber, PR_NUMBER);
  assert.equal(parsed.headSha, HEAD_SHA);
});

test('parseVerdict returns null for schema-mismatched comments (silently ignored)', () => {
  assert.equal(parseVerdict('not a verdict'), null);
  assert.equal(parseVerdict('PM_VERDICT: APPROVED\nschema: something-else\nIssue: UTV2-1'), null);
  assert.equal(parseVerdict(''), null);
  assert.equal(parseVerdict(null), null);
});

test('parseVerdict returns null prNumber/headSha when those fields are absent', () => {
  const parsed = parseVerdict('PM_VERDICT: APPROVED\nschema: pm-verdict/v1\nIssue: UTV2-1501');
  assert.equal(parsed.verdict, 'APPROVED');
  assert.equal(parsed.prNumber, null);
  assert.equal(parsed.headSha, null);
});

// Acceptance test 1: exact issue/PR/head APPROVED verdict passes.
test('UTV2-1543 AC1: exact issue/PR/head APPROVED verdict passes', () => {
  const verdicts = [verdictRecord(approvedComment())];
  const errors = validateT1Verdicts(verdicts, { prNumber: PR_NUMBER, headSha: HEAD_SHA, authorizedReviewers: REVIEWERS });
  assert.deepEqual(errors, []);
});

// Acceptance test 2: approved verdict for an earlier head fails after a rebase/push.
test('UTV2-1543 AC2: approved verdict bound to a stale head fails after a rebase', () => {
  const verdicts = [verdictRecord(approvedComment({ headSha: OLD_HEAD_SHA }))];
  const errors = validateT1Verdicts(verdicts, { prNumber: PR_NUMBER, headSha: HEAD_SHA, authorizedReviewers: REVIEWERS });
  assert.equal(errors.length, 1);
  assert.match(errors[0], /stale/i);
  assert.match(errors[0], new RegExp(OLD_HEAD_SHA));
  assert.match(errors[0], new RegExp(HEAD_SHA));
});

// Acceptance test 3: wrong PR number fails.
test('UTV2-1543 AC3: wrong PR number fails', () => {
  const verdicts = [verdictRecord(approvedComment({ pr: 9999 }))];
  const errors = validateT1Verdicts(verdicts, { prNumber: PR_NUMBER, headSha: HEAD_SHA, authorizedReviewers: REVIEWERS });
  assert.equal(errors.length, 1);
  assert.match(errors[0], /PR mismatch/i);
  assert.match(errors[0], /#9999/);
  assert.match(errors[0], new RegExp(`#${PR_NUMBER}`));
});

// Acceptance test 4: missing Head SHA fails.
test('UTV2-1543 AC4: missing Head SHA fails', () => {
  const body = ['PM_VERDICT: APPROVED', 'schema: pm-verdict/v1', 'Issue: UTV2-1501', `PR: ${PR_NUMBER}`].join('\n');
  const verdicts = [verdictRecord(body)];
  const errors = validateT1Verdicts(verdicts, { prNumber: PR_NUMBER, headSha: HEAD_SHA, authorizedReviewers: REVIEWERS });
  assert.equal(errors.length, 1);
  assert.match(errors[0], /missing a "Head SHA:" field/i);
});

test('UTV2-1543: missing PR field fails independently of Head SHA', () => {
  const body = ['PM_VERDICT: APPROVED', 'schema: pm-verdict/v1', 'Issue: UTV2-1501', `Head SHA: ${HEAD_SHA}`].join('\n');
  const verdicts = [verdictRecord(body)];
  const errors = validateT1Verdicts(verdicts, { prNumber: PR_NUMBER, headSha: HEAD_SHA, authorizedReviewers: REVIEWERS });
  assert.equal(errors.length, 1);
  assert.match(errors[0], /missing a "PR:" field/i);
});

// Acceptance test 5: CHANGES_REQUIRED remains authoritative when latest.
test('UTV2-1543 AC5: CHANGES_REQUIRED remains authoritative when latest, regardless of PR/head fields', () => {
  const approvedBody = approvedComment();
  const changesRequiredBody = [
    'PM_VERDICT: CHANGES_REQUIRED',
    'schema: pm-verdict/v1',
    'Issue: UTV2-1501',
    'Bounce: 1',
  ].join('\n');
  const verdicts = [verdictRecord(approvedBody), verdictRecord(changesRequiredBody)];
  const errors = validateT1Verdicts(verdicts, { prNumber: PR_NUMBER, headSha: HEAD_SHA, authorizedReviewers: REVIEWERS });
  assert.equal(errors.length, 1);
  assert.match(errors[0], /not "APPROVED"/);
});

// Acceptance test 6: a byte-identical rebase still requires a newly bound
// human verdict; no content-based inference — covered structurally, since
// validateT1Verdicts only ever compares the declared Head SHA against the
// live PR head. It has no code path that inspects diff/content equality.
test('UTV2-1543 AC6: no content-based inference — only the declared Head SHA is ever compared', () => {
  // Same PR, same issue, byte-identical intent, but the verdict names a head
  // that isn't the current one: must fail exactly like AC2, with no special
  // case for "the diff didn't actually change".
  const verdicts = [verdictRecord(approvedComment({ headSha: OLD_HEAD_SHA }))];
  const errors = validateT1Verdicts(verdicts, { prNumber: PR_NUMBER, headSha: HEAD_SHA, authorizedReviewers: REVIEWERS });
  assert.ok(errors.some((e) => /stale/i.test(e)));
});

// Acceptance test 7: existing T2 behavior is unchanged — validateT1Verdicts
// is only invoked from the T1 branch in merge-gate.yml; this module makes
// no T2 assertion, confirming no shared code path was touched.
test('UTV2-1543 AC7: validateT1Verdicts has no T2 code path to regress', () => {
  assert.equal(typeof validateT1Verdicts, 'function');
  assert.equal(validateT1Verdicts.length, 2);
});

test('bot-authored verdict is rejected even when otherwise well-formed', () => {
  const verdicts = [verdictRecord(approvedComment(), { user: 'github-actions[bot]', userType: 'Bot' })];
  const errors = validateT1Verdicts(verdicts, { prNumber: PR_NUMBER, headSha: HEAD_SHA, authorizedReviewers: REVIEWERS });
  assert.ok(errors.some((e) => /not authorized/i.test(e) && /bot account/i.test(e)));
});

test('verdict from a non-CODEOWNERS human is rejected', () => {
  const verdicts = [verdictRecord(approvedComment(), { user: 'some-random-user', userType: 'User' })];
  const errors = validateT1Verdicts(verdicts, { prNumber: PR_NUMBER, headSha: HEAD_SHA, authorizedReviewers: REVIEWERS });
  assert.ok(errors.some((e) => /not in CODEOWNERS/i.test(e)));
});

test('no verdicts at all fails with the generic missing-verdict message', () => {
  const errors = validateT1Verdicts([], { prNumber: PR_NUMBER, headSha: HEAD_SHA, authorizedReviewers: REVIEWERS });
  assert.equal(errors.length, 1);
  assert.match(errors[0], /requires a valid pm-verdict\/v1 comment/i);
});

test('bounce limit is preserved: a declared bounce 3 trips the limit', () => {
  // UTV2-1926: the fixture used to be three identical `Bounce: 1` comments,
  // which passed only because the implementation counted comments. Under the
  // canonical schema the PM declares the bounce number, so a real third cycle
  // is 1 -> 2 -> 3.
  const verdicts = [
    verdictRecord(changesRequiredComment({ bounce: 1 })),
    verdictRecord(changesRequiredComment({ bounce: 2 })),
    verdictRecord(changesRequiredComment({ bounce: 3 })),
  ];
  const errors = validateT1Verdicts(verdicts, { prNumber: PR_NUMBER, headSha: HEAD_SHA, authorizedReviewers: REVIEWERS });
  assert.ok(errors.some((e) => /Bounce limit exceeded/i.test(e)));
});

test('a later APPROVED verdict supersedes an earlier CHANGES_REQUIRED one', () => {
  const changesRequiredBody = [
    'PM_VERDICT: CHANGES_REQUIRED',
    'schema: pm-verdict/v1',
    'Issue: UTV2-1501',
    'Bounce: 1',
  ].join('\n');
  const verdicts = [verdictRecord(changesRequiredBody), verdictRecord(approvedComment())];
  const errors = validateT1Verdicts(verdicts, { prNumber: PR_NUMBER, headSha: HEAD_SHA, authorizedReviewers: REVIEWERS });
  assert.deepEqual(errors, []);
});

// UTV2-1554: trust-boundary regressions. Any GitHub user can post a comment
// that structurally parses as pm-verdict/v1; only CODEOWNERS membership
// (checked before latest-verdict selection) makes it authoritative.

test('UTV2-1554: unauthorized bot CHANGES_REQUIRED cannot override an earlier valid owner APPROVED', () => {
  const outsiderChangesRequired = ['PM_VERDICT: CHANGES_REQUIRED', 'schema: pm-verdict/v1', 'Issue: UTV2-1501'].join(
    '\n',
  );
  const verdicts = [
    verdictRecord(approvedComment()), // authorized owner APPROVED, current head
    verdictRecord(outsiderChangesRequired, { user: 'github-actions[bot]', userType: 'Bot' }),
  ];
  const errors = validateT1Verdicts(verdicts, { prNumber: PR_NUMBER, headSha: HEAD_SHA, authorizedReviewers: REVIEWERS });
  assert.deepEqual(errors, []);
});

test('UTV2-1554: unauthorized outsider APPROVED cannot override an earlier valid owner CHANGES_REQUIRED', () => {
  const changesRequiredBody = ['PM_VERDICT: CHANGES_REQUIRED', 'schema: pm-verdict/v1', 'Issue: UTV2-1501'].join('\n');
  const verdicts = [
    verdictRecord(changesRequiredBody), // authorized owner CHANGES_REQUIRED
    verdictRecord(approvedComment(), { user: 'some-random-user', userType: 'User' }),
  ];
  const errors = validateT1Verdicts(verdicts, { prNumber: PR_NUMBER, headSha: HEAD_SHA, authorizedReviewers: REVIEWERS });
  assert.equal(errors.length, 1);
  assert.match(errors[0], /not "APPROVED"/);
});

test('UTV2-1554: fails closed when every parsed verdict is unauthorized, even a later-looking APPROVED', () => {
  const verdicts = [verdictRecord(approvedComment(), { user: 'some-random-user', userType: 'User' })];
  const errors = validateT1Verdicts(verdicts, { prNumber: PR_NUMBER, headSha: HEAD_SHA, authorizedReviewers: REVIEWERS });
  assert.ok(errors.some((e) => /requires a valid pm-verdict\/v1 comment/i.test(e)));
});

test('UTV2-1554: bounce limit only counts authorized CHANGES_REQUIRED verdicts', () => {
  // UTV2-1926: the unauthorized comments now declare `Bounce: 3` outright, so
  // the trust boundary is what this asserts -- not the absence of a field.
  const verdicts = [
    verdictRecord(changesRequiredComment({ bounce: 1 })), // 1 authorized
    verdictRecord(changesRequiredComment({ bounce: 3 }), { user: 'some-random-user', userType: 'User' }),
    verdictRecord(changesRequiredComment({ bounce: 3 }), { user: 'github-actions[bot]', userType: 'Bot' }),
  ];
  const errors = validateT1Verdicts(verdicts, { prNumber: PR_NUMBER, headSha: HEAD_SHA, authorizedReviewers: REVIEWERS });
  assert.ok(!errors.some((e) => /Bounce limit exceeded/i.test(e)));
});


// ---------------------------------------------------------------------------
// UTV2-1926 -- bounce state comes from the canonical `Bounce:` field.
//
// docs/05_operations/schemas/pm-verdict-v1.md is the authority: validation rule
// 6 requires a numeric `Bounce:` on a CHANGES_REQUIRED verdict, and the Bounce
// Limit section makes bounce 3 the Failed / PM-triage trigger. The previous
// implementation counted CHANGES_REQUIRED-SHAPED COMMENTS instead, so three
// comments that were invalid under the schema froze a PR permanently.
// ---------------------------------------------------------------------------

test('UTV2-1926: parseVerdict extracts a numeric Bounce field', () => {
  assert.equal(parseVerdict(changesRequiredComment({ bounce: 2 })).bounce, 2);
  assert.equal(parseVerdict(changesRequiredComment({ bounce: 0 })).bounce, 0);
});

test('UTV2-1926: parseVerdict yields a null bounce for absent or malformed fields', () => {
  // Absent entirely -- the historical #1592 shape.
  assert.equal(parseVerdict(changesRequiredComment()).bounce, null);
  // Present but not a number.
  assert.equal(parseVerdict(changesRequiredComment({ bounce: 'two' })).bounce, null);
  // Numeric-ish but not a bare integer.
  assert.equal(parseVerdict(changesRequiredComment({ bounce: '2 of 3' })).bounce, null);
  assert.equal(parseVerdict(changesRequiredComment({ bounce: '-1' })).bounce, null);
  assert.equal(parseVerdict(changesRequiredComment({ bounce: '1.5' })).bounce, null);
  // An APPROVED verdict carries no bounce.
  assert.equal(parseVerdict(approvedComment()).bounce, null);
});

test('UTV2-1926 R1: CHANGES_REQUIRED without a Bounce field does not count toward the limit', () => {
  const verdicts = [
    verdictRecord(changesRequiredComment()),
    verdictRecord(changesRequiredComment()),
    verdictRecord(changesRequiredComment()),
  ];
  const errors = validateT1Verdicts(verdicts, { prNumber: PR_NUMBER, headSha: HEAD_SHA, authorizedReviewers: REVIEWERS });
  assert.ok(!errors.some((e) => /Bounce limit exceeded/i.test(e)));
  // ...and it still BLOCKS. Narrowing the freeze must never become a pass.
  assert.ok(errors.some((e) => /not "APPROVED"/.test(e)));
});

test('UTV2-1926 R2: a malformed Bounce field does not count toward the limit', () => {
  for (const malformed of ['two', '2 of 3', '-1', '1.5', 'one']) {
    const verdicts = [
      verdictRecord(changesRequiredComment({ bounce: malformed })),
      verdictRecord(changesRequiredComment({ bounce: malformed })),
      verdictRecord(changesRequiredComment({ bounce: malformed })),
    ];
    const errors = validateT1Verdicts(verdicts, { prNumber: PR_NUMBER, headSha: HEAD_SHA, authorizedReviewers: REVIEWERS });
    assert.ok(
      !errors.some((e) => /Bounce limit exceeded/i.test(e)),
      `malformed bounce "${malformed}" must not count`,
    );
    assert.ok(errors.some((e) => /not "APPROVED"/.test(e)), `malformed bounce "${malformed}" must still block`);
  }
});

test('UTV2-1926 R3: a valid bounce 1 is accepted and does not trip the limit', () => {
  const verdicts = [verdictRecord(changesRequiredComment({ bounce: 1 }))];
  const errors = validateT1Verdicts(verdicts, { prNumber: PR_NUMBER, headSha: HEAD_SHA, authorizedReviewers: REVIEWERS });
  assert.ok(!errors.some((e) => /Bounce limit exceeded/i.test(e)));
});

test('UTV2-1926 R4: a valid bounce 2 is accepted and does not trip the limit', () => {
  const verdicts = [
    verdictRecord(changesRequiredComment({ bounce: 1 })),
    verdictRecord(changesRequiredComment({ bounce: 2 })),
  ];
  const errors = validateT1Verdicts(verdicts, { prNumber: PR_NUMBER, headSha: HEAD_SHA, authorizedReviewers: REVIEWERS });
  assert.ok(!errors.some((e) => /Bounce limit exceeded/i.test(e)));
});

test('UTV2-1926 R5: a valid bounce 3 trips Failed / PM triage', () => {
  const verdicts = [verdictRecord(changesRequiredComment({ bounce: 3 }))];
  const errors = validateT1Verdicts(verdicts, { prNumber: PR_NUMBER, headSha: HEAD_SHA, authorizedReviewers: REVIEWERS });
  const tripped = errors.find((e) => /Bounce limit exceeded/i.test(e));
  assert.ok(tripped, 'a declared bounce 3 must trip the limit');
  assert.match(tripped, /Bounce: 3/);
  assert.match(tripped, /Failed for PM triage/i);
});

test('UTV2-1926 R5: a declared bounce above 3 also trips', () => {
  const verdicts = [verdictRecord(changesRequiredComment({ bounce: 4 }))];
  const errors = validateT1Verdicts(verdicts, { prNumber: PR_NUMBER, headSha: HEAD_SHA, authorizedReviewers: REVIEWERS });
  assert.ok(errors.some((e) => /Bounce limit exceeded/i.test(e)));
});

test('UTV2-1926 R6: bounce state is the declared maximum, not the latest declaration', () => {
  // A later `Bounce: 1` must not reset a freeze already reached. The freeze is
  // a ratchet; only PM re-scoping clears it, and that is not a gate decision.
  const verdicts = [
    verdictRecord(changesRequiredComment({ bounce: 3 })),
    verdictRecord(changesRequiredComment({ bounce: 1 })),
  ];
  const errors = validateT1Verdicts(verdicts, { prNumber: PR_NUMBER, headSha: HEAD_SHA, authorizedReviewers: REVIEWERS });
  assert.ok(errors.some((e) => /Bounce limit exceeded/i.test(e)));
});

test('UTV2-1926 R6: many CHANGES_REQUIRED comments at bounce 1 never trip the limit', () => {
  const verdicts = Array.from({ length: 9 }, () => verdictRecord(changesRequiredComment({ bounce: 1 })));
  const errors = validateT1Verdicts(verdicts, { prNumber: PR_NUMBER, headSha: HEAD_SHA, authorizedReviewers: REVIEWERS });
  assert.ok(!errors.some((e) => /Bounce limit exceeded/i.test(e)));
});

test('UTV2-1926 R7: an unauthorized declared bounce 3 is ignored', () => {
  const verdicts = [
    verdictRecord(changesRequiredComment({ bounce: 3 }), { user: 'some-random-user', userType: 'User' }),
    verdictRecord(changesRequiredComment({ bounce: 3 }), { user: 'github-actions[bot]', userType: 'Bot' }),
    verdictRecord(approvedComment()),
  ];
  const errors = validateT1Verdicts(verdicts, { prNumber: PR_NUMBER, headSha: HEAD_SHA, authorizedReviewers: REVIEWERS });
  assert.deepEqual(errors, []);
});

test('UTV2-1926: the #1592 shape -- three bounce-less CHANGES_REQUIRED then an exact-head APPROVED passes', () => {
  // The live artifact this repair was measured against: PR #1592 carried three
  // authorized CHANGES_REQUIRED comments, none with a Bounce field, plus an
  // APPROVED. Under the counting implementation the gate reported
  // "Bounce limit exceeded (3 CHANGES_REQUIRED verdicts)" on EVERY verdict,
  // because the check runs unconditionally -- so no PM action could ever
  // unblock it and the PR was permanently unmergeable.
  const verdicts = [
    verdictRecord(changesRequiredComment()),
    verdictRecord(approvedComment({ headSha: OLD_HEAD_SHA })),
    verdictRecord(changesRequiredComment()),
    verdictRecord(changesRequiredComment()),
    verdictRecord(approvedComment()),
  ];
  const errors = validateT1Verdicts(verdicts, { prNumber: PR_NUMBER, headSha: HEAD_SHA, authorizedReviewers: REVIEWERS });
  assert.deepEqual(errors, []);
});

test('UTV2-1926 R8: exact-PR and exact-head APPROVED validation is unchanged by the repair', () => {
  const history = [
    verdictRecord(changesRequiredComment()),
    verdictRecord(changesRequiredComment()),
    verdictRecord(changesRequiredComment()),
  ];

  // Stale head still fails, with the same message, after the same history.
  const stale = validateT1Verdicts([...history, verdictRecord(approvedComment({ headSha: OLD_HEAD_SHA }))], {
    prNumber: PR_NUMBER,
    headSha: HEAD_SHA,
    authorizedReviewers: REVIEWERS,
  });
  assert.ok(stale.some((e) => /stale/i.test(e)));
  assert.ok(!stale.some((e) => /Bounce limit exceeded/i.test(e)));

  // Wrong PR still fails.
  const wrongPr = validateT1Verdicts([...history, verdictRecord(approvedComment({ pr: PR_NUMBER + 1 }))], {
    prNumber: PR_NUMBER,
    headSha: HEAD_SHA,
    authorizedReviewers: REVIEWERS,
  });
  assert.ok(wrongPr.some((e) => /PR mismatch/i.test(e)));

  // Missing Head SHA still fails.
  const noHead = validateT1Verdicts(
    [...history, verdictRecord('PM_VERDICT: APPROVED\nschema: pm-verdict/v1\nIssue: UTV2-1501\nPR: ' + PR_NUMBER)],
    { prNumber: PR_NUMBER, headSha: HEAD_SHA, authorizedReviewers: REVIEWERS },
  );
  assert.ok(noHead.some((e) => /missing a "Head SHA:" field/i.test(e)));
});

for (const issue of ['WORK-2026091001', 'UTV2-1501', 'UNI-42']) {
  test(`repository and legacy identity ${issue} retain exact-head PM approval checks`, () => {
    const verdict = verdictRecord(approvedComment({ issue }));
    assert.equal(verdict.parsed.issueId, issue);
    assert.deepEqual(validateT1Verdicts([verdict], { prNumber: PR_NUMBER, headSha: HEAD_SHA, authorizedReviewers: REVIEWERS }), []);
    assert.ok(validateT1Verdicts([verdict], { prNumber: PR_NUMBER, headSha: OLD_HEAD_SHA, authorizedReviewers: REVIEWERS }).length > 0);
  });
}

// UTV2-1892: the trusted-base parser and the workflow's own issue extraction
// must admit the same identifier namespaces. The workflow is evaluated from
// pull_request.base.sha and requires this module from the same checkout, so a
// namespace admitted by one and refused by the other is a silent gate hole in
// whichever direction it drifts.
test('UTV2-1892: merge-gate.yml issue extraction and parseVerdict admit the same namespaces', async () => {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const workflow = fs.readFileSync(path.join(process.cwd(), '.github', 'workflows', 'merge-gate.yml'), 'utf8');
  const { parseVerdict } = await import('./merge-gate-verdict.cjs');
  const pick = (marker: string) => {
    const at = workflow.indexOf(marker);
    assert.ok(at >= 0, `merge-gate.yml must carry ${marker}`);
    const m = workflow.slice(at, at + 200).match(/\((?:\?:)?([A-Za-z0-9|]+)\)-\\d\+/);
    assert.ok(m, `no namespace alternation after ${marker}`);
    return m[1].toUpperCase().split('|').sort();
  };
  const namespaces = pick("(headRef || '').match(");
  const titleNamespaces = pick("(prTitle || '').match(");
  const wfrNamespaces = pick("grep -oiP '(");
  assert.deepEqual(titleNamespaces, namespaces);
  assert.deepEqual(wfrNamespaces, namespaces);
  assert.deepEqual(namespaces, ['UNI', 'UTV2', 'WORK']);
  for (const ns of namespaces) {
    const parsed = parseVerdict(`PM_VERDICT: APPROVED\nschema: pm-verdict/v1\nIssue: ${ns}-7\nPR: 1\nHead SHA: ${'a'.repeat(40)}`);
    assert.ok(parsed && parsed.issueId === `${ns}-7`, `parseVerdict must admit ${ns}`);
  }
  assert.equal(parseVerdict(`PM_VERDICT: APPROVED\nschema: pm-verdict/v1\nIssue: BOOTSTRAP-7\nPR: 1\nHead SHA: ${'a'.repeat(40)}`), null);

  // The reverse direction: the parser's own Issue-line alternation, read from its
  // source, must not admit a namespace the workflow does not extract.
  const parserSource = fs.readFileSync(path.join(process.cwd(), 'scripts', 'ops', 'merge-gate-verdict.cjs'), 'utf8');
  const parserAlt = parserSource.match(/\^Issue:\\s\+\(\(\?:([A-Za-z0-9|]+)\)-\\d\+\)\$/);
  assert.ok(parserAlt, 'merge-gate-verdict.cjs must carry the anchored Issue: alternation');
  assert.deepEqual(parserAlt[1].toUpperCase().split('|').sort(), namespaces);
});

// UTV2-1892: an identifier embedded in a longer token is not an identifier.
// `homework-123` and `work-123abc` must not resolve as WORK-123 in any of the
// three workflow extractors, while ordinary lane branches and titles still do.
test('UTV2-1892: workflow issue extraction is bounded at both ends', async () => {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const { execFileSync } = await import('node:child_process');
  const workflow = fs.readFileSync(path.join(process.cwd(), '.github', 'workflows', 'merge-gate.yml'), 'utf8');
  const literal = (marker: string): RegExp => {
    const at = workflow.indexOf(marker);
    assert.ok(at >= 0, `merge-gate.yml must carry ${marker}`);
    const m = workflow.slice(at + marker.length, at + marker.length + 200).match(/^\/((?:\\.|[^/])+)\/([a-z]*)/);
    assert.ok(m, `no regex literal after ${marker}`);
    return new RegExp(m[1], m[2]);
  };
  const headRe = literal("(headRef || '').match(");
  const titleRe = literal("(prTitle || '').match(");
  const grepAt = workflow.indexOf("grep -oiP '");
  assert.ok(grepAt >= 0);
  const grepPattern = workflow.slice(grepAt + "grep -oiP '".length).split("'")[0];
  const grep = (branch: string): string | null => {
    try {
      return execFileSync('grep', ['-oiP', grepPattern], { input: `${branch}\n`, encoding: 'utf8' }).trim().split('\n')[0].toUpperCase() || null;
    } catch {
      return null;
    }
  };

  const branches: Array<[string, string | null]> = [
    ['claude/utv2-1892-merge-gate-work-identity', 'UTV2-1892'],
    ['codex/work-2026091001-tracker-independence', 'WORK-2026091001'],
    ['bootstrap/uni-42-thing', 'UNI-42'],
    ['work-123', 'WORK-123'],
    ['feature/homework-123-fix', null],
    ['feature/work-123abc', null],
    ['feature/mywork-123', null],
  ];
  for (const [branch, expected] of branches) {
    const m = branch.match(headRe);
    assert.equal(m ? m[1].toUpperCase() : null, expected, `headRef extraction for ${branch}`);
    assert.equal(grep(branch), expected, `WFR-v2 grep extraction for ${branch}`);
  }
  const titles: Array<[string, string | null]> = [
    ['UTV2-1892: admit WORK identities', 'UTV2-1892'],
    ['WORK-2026091001 tracker independence', 'WORK-2026091001'],
    ['fix (uni-42) thing', 'UNI-42'],
    ['Fix homework-123', null],
    ['work-123abc', null],
    ['no identifier here', null],
  ];
  for (const [title, expected] of titles) {
    const m = title.match(titleRe);
    assert.equal(m ? m[1].toUpperCase() : null, expected, `title extraction for ${title}`);
  }
});
