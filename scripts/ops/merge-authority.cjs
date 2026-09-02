'use strict';

// Risk-Scoped Merge Authority (RMA/v1).
//
// Replaces lane-manifest tier as the input to merge authorization. The question
// is no longer "what tier was this lane admitted at?" but "what does this diff
// actually touch?".
//
// Rationale (docs/mission/intent.md): under the tier model every PR resolved to
// T1, so every PR — a typo fix and a production migration alike — required the
// same human relay. Making everything reserved is the same as reserving nothing:
// it prices the real risk decisions at zero attention. RMA reserves the six
// surfaces Griff actually owns and authorizes the rest on green CI.
//
// CommonJS so merge-gate.yml's actions/github-script step can `require()` it
// directly from the checked-out workspace with no build step — github-script
// runs plain Node, not tsx. Keeping the rules here rather than in workflow YAML
// means they are covered by scripts/ops/merge-authority.test.ts.
//
// FAIL-CLOSED. Every error path returns 'human'. A malformed policy, an
// unreadable diff, or an unknown condition reserves the merge; it never
// releases it.

const fs = require('node:fs');
const path = require('node:path');

const POLICY_PATH = 'docs/05_operations/RESERVED_RISK_SURFACES.json';

/**
 * Compiles one glob into a RegExp.
 *
 * Supported, deliberately minimal: `**` spans path separators, `*` does not,
 * `?` matches one non-separator character. Everything else is literal. We do
 * not pull in a glob dependency because this runs inside github-script with no
 * install step, and because a small explicit matcher is auditable — a merge
 * authority boundary should not depend on a transitive package's edge cases.
 */
function globToRegExp(glob) {
  let out = '';
  for (let i = 0; i < glob.length; i += 1) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') {
        // `**/` should also match zero directories, so `docs/**/*.sql` matches
        // `docs/a.sql`. Without this a reserved surface silently misses files
        // sitting directly in the reserved root.
        if (glob[i + 2] === '/') {
          out += '(?:.*/)?';
          i += 2;
        } else {
          out += '.*';
          i += 1;
        }
      } else {
        out += '[^/]*';
      }
    } else if (c === '?') {
      out += '[^/]';
    } else {
      out += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    }
  }
  return new RegExp(`^${out}$`);
}

function matchesAnyGlob(file, globs) {
  return globs.some((g) => globToRegExp(g).test(file));
}

/** Loads and structurally validates the policy. Throws — callers fail closed. */
function loadPolicy(repoRoot = process.cwd()) {
  const raw = fs.readFileSync(path.join(repoRoot, POLICY_PATH), 'utf8');
  const policy = JSON.parse(raw);
  if (policy.schema !== 'reserved-risk-surfaces/v1') {
    throw new Error(`Unsupported reserved-risk policy schema: ${policy.schema}`);
  }
  if (!Array.isArray(policy.surfaces) || policy.surfaces.length === 0) {
    throw new Error('Reserved-risk policy declares no surfaces.');
  }
  for (const s of policy.surfaces) {
    if (!s.id || !Array.isArray(s.paths) || s.paths.length === 0) {
      throw new Error(`Reserved-risk surface "${s.id || '(unnamed)'}" declares no paths.`);
    }
  }
  return policy;
}

/**
 * Classifies a diff.
 *
 * @param {object} input
 * @param {Array<{filename: string, patch?: string, status?: string}>} input.files
 *        Changed files, shaped like GitHub's pulls.listFiles response.
 * @param {object} input.policy Parsed reserved-risk policy.
 * @returns {{authority: 'auto'|'human', reasons: string[], surfaces: string[]}}
 */
function classifyDiff({ files, policy }) {
  const reasons = [];
  const surfaces = new Set();

  if (!Array.isArray(files)) {
    return {
      authority: 'human',
      reasons: ['Changed-file list unavailable — cannot classify risk, reserving merge.'],
      surfaces: ['unclassifiable'],
    };
  }
  if (files.length === 0) {
    return {
      authority: 'human',
      reasons: ['PR reports zero changed files — cannot classify risk, reserving merge.'],
      surfaces: ['unclassifiable'],
    };
  }

  for (const surface of policy.surfaces) {
    // `excludePaths` narrows a surface that would otherwise over-reserve. It is
    // applied AFTER the include match and only within that surface, so it can
    // never release a file another surface reserves.
    const excluded = surface.excludePaths || [];
    const hits = files
      .map((f) => f.filename)
      .filter(
        (name) =>
          typeof name === 'string' &&
          matchesAnyGlob(name, surface.paths) &&
          !matchesAnyGlob(name, excluded)
      );
    if (hits.length > 0) {
      surfaces.add(surface.id);
      const shown = hits.slice(0, 5).join(', ');
      const more = hits.length > 5 ? ` (+${hits.length - 5} more)` : '';
      reasons.push(`${surface.reserved} — touched by: ${shown}${more}`);
    }
  }

  for (const rule of policy.contentRules || []) {
    const pattern = new RegExp(rule.addedLinePattern, rule.patternFlags || '');
    for (const file of files) {
      if (typeof file.filename !== 'string') continue;
      if (rule.pathGlobs && !matchesAnyGlob(file.filename, rule.pathGlobs)) continue;
      // A file too large for GitHub to return a patch cannot be scanned. That is
      // an absence of evidence, not evidence of absence: reserve it.
      if (file.patch === undefined || file.patch === null) {
        if (file.status === 'removed' || file.status === 'renamed') continue;
        surfaces.add('unclassifiable');
        reasons.push(
          `No diff available for ${file.filename} — content rules cannot be evaluated, reserving merge.`
        );
        continue;
      }
      const addedLines = String(file.patch)
        .split('\n')
        .filter((l) => l.startsWith('+') && !l.startsWith('+++'))
        .map((l) => l.slice(1));
      const offending = addedLines.find((l) => pattern.test(l));
      if (offending) {
        surfaces.add(rule.id);
        reasons.push(`${rule.reserved} — ${file.filename}: ${offending.trim().slice(0, 120)}`);
      }
    }
  }

  return {
    authority: reasons.length > 0 ? 'human' : 'auto',
    reasons,
    surfaces: [...surfaces],
  };
}

/**
 * Full authority decision for a PR.
 *
 * `auto`  → CI is the authority. verify / P0 Protocol / Executor Result
 *           Validation remain independently required branch-protection checks;
 *           this gate simply stops demanding a human.
 * `human` → a CODEOWNERS approval label AND an approved pm-verdict/v1 are both
 *           required.
 *
 * `verdictApproved` / `verdictErrors` are supplied by the caller from
 * scripts/ops/merge-gate-verdict.cjs. That module already implements
 * latest-verdict-wins, CODEOWNERS authorization, and exact-head binding, and is
 * covered by its own suite. Re-deriving those rules here would fork a subtle
 * security decision across two files -- notably, a naive "collect the APPROVED
 * ones" reimplementation silently ignores a later CHANGES_REQUIRED.
 *
 * @returns {{authorized: boolean, authority: 'auto'|'human', errors: string[], notes: string[], surfaces: string[]}}
 */
function evaluateMergeAuthority({ files, policy, labels = [], verdictApproved = false, verdictErrors = [] }) {
  const errors = [];
  const notes = [];

  let classification;
  try {
    classification = classifyDiff({ files, policy });
  } catch (e) {
    return {
      authorized: false,
      authority: 'human',
      surfaces: ['unclassifiable'],
      notes,
      errors: [`Risk classification failed (${e.message}). Reserving merge.`],
    };
  }

  if (labels.includes('governance:pause')) {
    errors.push('governance:pause label is active. All merges blocked until removed by Griff.');
  }

  if (classification.authority === 'auto') {
    notes.push('RMA/v1: diff touches no reserved surface. Authorized on green CI.');
    return {
      authorized: errors.length === 0,
      authority: 'auto',
      surfaces: [],
      notes,
      errors,
    };
  }

  notes.push(
    `RMA/v1: reserved surface(s) ${classification.surfaces.join(', ')}. Human approval required.`
  );
  for (const r of classification.reasons) notes.push(r);

  const approvalLabels = [
    policy.approval?.label,
    ...(policy.approval?.legacyLabels || []),
  ].filter(Boolean);
  const hasLabel = approvalLabels.some((l) => labels.includes(l));
  if (!hasLabel) {
    errors.push(
      `Reserved surface touched. Requires the "${policy.approval?.label}" label from a CODEOWNERS member.`
    );
  }

  if (!verdictApproved) {
    errors.push(
      ...(verdictErrors.length > 0
        ? verdictErrors
        : [
            'Reserved surface touched. Requires a pm-verdict/v1 APPROVED comment from a ' +
              'CODEOWNERS member bound to the current head SHA.',
          ])
    );
  }

  return {
    authorized: errors.length === 0,
    authority: 'human',
    surfaces: classification.surfaces,
    notes,
    errors,
  };
}

module.exports = {
  POLICY_PATH,
  globToRegExp,
  matchesAnyGlob,
  loadPolicy,
  classifyDiff,
  evaluateMergeAuthority,
};
