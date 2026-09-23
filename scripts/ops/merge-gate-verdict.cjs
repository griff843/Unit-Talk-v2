'use strict';

// UTV2-1543: pure T1 pm-verdict/v1 parsing and validation logic.
//
// CommonJS (not TypeScript) so merge-gate.yml's actions/github-script step
// can `require()` this file directly from the checked-out workspace without
// a build step -- github-script runs plain Node, not tsx. Keeping this out
// of the workflow YAML means the parsing/validation rules are covered by
// scripts/ops/merge-gate-verdict.test.ts instead of only exercised live.

/**
 * Parses a pm-verdict/v1 comment body. Returns null if the first three
 * required lines (PM_VERDICT, schema, Issue) don't match -- matching the
 * existing "silently ignored" behavior documented in
 * docs/05_operations/schemas/pm-verdict-v1.md for schema mismatches.
 *
 * PR: and Head SHA: are looked up anywhere in the remaining lines (not a
 * fixed position), since real verdict comments include free-form scope-of-
 * approval text between the header fields.
 *
 * UTV2-1926: `bounce` carries the canonical `Bounce:` field, which
 * docs/05_operations/schemas/pm-verdict-v1.md validation rule 6 REQUIRES on a
 * CHANGES_REQUIRED verdict and requires to be numeric. It is `null` when the
 * field is absent, non-numeric, negative, or otherwise malformed -- i.e. when
 * the comment is not a valid bounce declaration under the schema. Parsing
 * still succeeds in that case, because an invalid CHANGES_REQUIRED must keep
 * BLOCKING via the latest-verdict rule; what it must not do is contribute to
 * the bounce limit. Refusing to parse it here would turn a PM refusal into a
 * silent pass, which is the opposite failure.
 */
function parseVerdict(body) {
  if (!body) return null;
  const normalized = body.replace(/\\n/g, '\n');
  const lines = normalized.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length < 3) return null;

  const verdictMatch = lines[0].replace(/^\$/, '').match(/^PM_VERDICT:\s+(APPROVED|CHANGES_REQUIRED)$/i);
  if (!verdictMatch) return null;
  if (lines[1] !== 'schema: pm-verdict/v1') return null;
  const issueMatch = lines[2].match(/^Issue:\s+((?:UTV2|UNI|WORK)-\d+)$/i);
  if (!issueMatch) return null;

  const field = (name) => {
    const re = new RegExp('^' + name + ':\\s+(.+)$', 'i');
    const hit = lines.find((l) => re.test(l));
    return hit ? hit.replace(re, '$1').trim() : null;
  };

  const prField = field('PR');
  const prMatch = prField ? prField.match(/#?(\d+)/) : null;
  const prNumber = prMatch ? Number(prMatch[1]) : null;
  const headSha = field('Head SHA');

  // UTV2-1926: the whole field must be a non-negative integer. `Bounce: 2 of
  // 3`, `Bounce: two`, `Bounce: -1` and `Bounce:` are all malformed, and a
  // malformed declaration is not a bounce.
  const bounceField = field('Bounce');
  const bounceIsNumeric = typeof bounceField === 'string' && /^\d+$/.test(bounceField);
  const bounce = bounceIsNumeric ? Number(bounceField) : null;

  return {
    verdict: verdictMatch[1].toUpperCase(),
    issueId: issueMatch[1],
    prNumber: Number.isFinite(prNumber) ? prNumber : null,
    headSha: headSha || null,
    bounce: Number.isInteger(bounce) ? bounce : null,
  };
}

/**
 * Validates the T1 pm-verdict/v1 gate against live PR context. Returns an
 * array of error strings; empty means the gate passes.
 *
 * @param {Array<{user: string|null, userType: string|null, parsed: object, createdAt: string}>} verdicts
 *   Already-parsed verdict records (parseVerdict result attached), in
 *   ascending creation-time order -- the caller filters out non-matching
 *   comments (parsed === null) before calling this.
 * @param {{prNumber: number, headSha: string, authorizedReviewers: Set<string>}} ctx
 */
function validateT1Verdicts(verdicts, ctx) {
  const errors = [];

  if (verdicts.length === 0) {
    errors.push('T1 requires a valid pm-verdict/v1 comment. PM must post a structured verdict.');
    return errors;
  }

  // UTV2-1554: authorization filtering happens BEFORE latest-verdict
  // selection, not after. Any GitHub user can post a comment that
  // structurally parses as a pm-verdict/v1 verdict -- CODEOWNERS membership
  // is what makes it count, not comment recency. An unauthorized or
  // bot-authored comment must never be treated as "the latest verdict" in
  // either direction: it must not block a valid owner APPROVED, and it must
  // not supersede a valid owner CHANGES_REQUIRED.
  const isAuthorized = (v) => v.userType !== 'Bot' && ctx.authorizedReviewers.has(v.user);
  const authorized = verdicts.filter(isAuthorized);

  if (authorized.length === 0) {
    // No authorized verdict exists. Report why the most recent raw comment
    // doesn't count (preserves prior single-comment diagnostics), then fail
    // closed exactly as the no-comments-at-all case above.
    const rawLatest = verdicts[verdicts.length - 1];
    if (rawLatest.userType === 'Bot') {
      errors.push(
        `PM verdict from bot account "${rawLatest.user}" is not authorized. Must be a human CODEOWNERS member.`,
      );
    } else {
      errors.push(
        `PM verdict author "${rawLatest.user}" is not in CODEOWNERS. Authorized: ${[...ctx.authorizedReviewers].join(', ')}.`,
      );
    }
    errors.push('T1 requires a valid pm-verdict/v1 comment. PM must post a structured verdict.');
    return errors;
  }

  const latest = authorized[authorized.length - 1];

  if (latest.parsed.verdict !== 'APPROVED') {
    errors.push(`Most recent PM verdict is "${latest.parsed.verdict}", not "APPROVED".`);
  } else {
    // PR/head-SHA freshness only gates verdicts intended to approve the
    // merge -- a CHANGES_REQUIRED verdict already blocks above regardless.
    if (!latest.parsed.prNumber) {
      errors.push('T1 pm-verdict/v1 comment is missing a "PR:" field. PM must bind the verdict to this exact PR.');
    } else if (latest.parsed.prNumber !== ctx.prNumber) {
      errors.push(`PM verdict PR mismatch: comment declares PR #${latest.parsed.prNumber}, actual is #${ctx.prNumber}.`);
    }

    if (!latest.parsed.headSha) {
      errors.push(
        'T1 pm-verdict/v1 comment is missing a "Head SHA:" field. PM must bind approval to the exact reviewed head.',
      );
    } else if (latest.parsed.headSha.toLowerCase() !== ctx.headSha.toLowerCase()) {
      errors.push(
        `PM verdict is stale: comment approved head SHA "${latest.parsed.headSha}", current PR head is "${ctx.headSha}". A fresh verdict bound to the new head is required.`,
      );
    }
  }

  // Bounce limit check.
  //
  // Two independent rules, and conflating them was UTV2-1926:
  //
  //   1. TRUST. Only authorized verdicts are considered at all. Otherwise an
  //      unauthorized commenter could spam CHANGES_REQUIRED-shaped comments to
  //      force a false bounce-limit trip -- the same trust boundary as above.
  //   2. SCHEMA. Bounce state is whatever the PM DECLARED in the canonical
  //      `Bounce:` field, never the lifetime count of CHANGES_REQUIRED-shaped
  //      comments. docs/05_operations/schemas/pm-verdict-v1.md makes that field
  //      required and numeric on a CHANGES_REQUIRED verdict (validation rule 6)
  //      and makes bounce 3 the trigger for Failed / PM triage. A comment with
  //      no `Bounce:` field, or a malformed one, is not a valid bounce
  //      declaration and contributes nothing here.
  //
  // The counting implementation this replaces made a PR unmergeable on ANY
  // verdict once three CHANGES_REQUIRED-shaped comments existed, because the
  // check runs unconditionally -- a later APPROVED clears the latest-verdict
  // error and leaves this one standing. On #1592 three such comments existed
  // and none carried a Bounce field at all.
  //
  // MAX, not latest: a PM who later posts `Bounce: 1` on a PR already at
  // bounce 3 must not thereby reset the freeze. The freeze is a ratchet.
  //
  // An invalid CHANGES_REQUIRED still BLOCKS -- via the latest-verdict rule
  // above, which this does not touch. Excluding it here narrows the freeze,
  // never the refusal.
  const changesRequested = authorized.filter((v) => v.parsed.verdict === 'CHANGES_REQUIRED');
  const declaredBounces = changesRequested
    .map((v) => v.parsed.bounce)
    .filter((n) => Number.isInteger(n) && n >= 1);
  const bounceState = declaredBounces.length > 0 ? Math.max(...declaredBounces) : 0;
  if (bounceState >= 3) {
    errors.push(
      `Bounce limit exceeded (PM declared Bounce: ${bounceState}). Issue should be moved to Failed for PM triage.`,
    );
  }

  return errors;
}

module.exports = { parseVerdict, validateT1Verdicts };
