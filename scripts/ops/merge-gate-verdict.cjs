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
 */
function parseVerdict(body) {
  if (!body) return null;
  const normalized = body.replace(/\\n/g, '\n');
  const lines = normalized.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length < 3) return null;

  const verdictMatch = lines[0].replace(/^\$/, '').match(/^PM_VERDICT:\s+(APPROVED|CHANGES_REQUIRED)$/i);
  if (!verdictMatch) return null;
  if (lines[1] !== 'schema: pm-verdict/v1') return null;
  const issueMatch = lines[2].match(/^Issue:\s+((?:UTV2|UNI)-\d+)$/i);
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

  return {
    verdict: verdictMatch[1].toUpperCase(),
    issueId: issueMatch[1],
    prNumber: Number.isFinite(prNumber) ? prNumber : null,
    headSha: headSha || null,
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

  const latest = verdicts[verdicts.length - 1];

  if (latest.userType === 'Bot') {
    errors.push(`PM verdict from bot account "${latest.user}" is not authorized. Must be a human CODEOWNERS member.`);
  } else if (!ctx.authorizedReviewers.has(latest.user)) {
    errors.push(
      `PM verdict author "${latest.user}" is not in CODEOWNERS. Authorized: ${[...ctx.authorizedReviewers].join(', ')}.`,
    );
  }

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

  // Bounce limit check -- unchanged from the pre-existing behavior.
  const changesRequested = verdicts.filter((v) => v.parsed.verdict === 'CHANGES_REQUIRED');
  if (changesRequested.length >= 3) {
    errors.push(
      `Bounce limit exceeded (${changesRequested.length} CHANGES_REQUIRED verdicts). Issue should be moved to Failed for PM triage.`,
    );
  }

  return errors;
}

module.exports = { parseVerdict, validateT1Verdicts };
