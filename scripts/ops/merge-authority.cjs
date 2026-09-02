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
// it prices the real risk decisions at zero attention. RMA reserves the
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
 * Every path a changed-file entry occupies, before and after.
 *
 * GitHub reports a rename as `filename` (destination) plus `previous_filename`
 * (source). Classifying only the destination would let a reserved path escape
 * by rename: moving `.github/CODEOWNERS` or `merge-gate.yml` to an unreserved
 * name would be classified as `auto` and delete the boundary in a diff that
 * never "touches" a reserved path. A rename is a change to BOTH paths, so both
 * are classified and either one reserves.
 */
function filePaths(file) {
  return [file.filename, file.previous_filename].filter((n) => typeof n === 'string' && n !== '');
}

/**
 * Classifies a diff.
 *
 * @param {object} input
 * @param {Array<{filename: string, previous_filename?: string, patch?: string, status?: string, additions?: number, deletions?: number}>} input.files
 *        Changed files, shaped like GitHub's pulls.listFiles response.
 * @param {object} input.policy Parsed reserved-risk policy.
 * @param {number|null|undefined} [input.declaredFileCount] The PR's own
 *        `changed_files` total. GitHub's List-pull-request-files endpoint stops
 *        at 3,000 files no matter how far you paginate, so on a larger PR the
 *        returned list is a SUBSET and a reserved file can simply be absent
 *        from it. Comparing the count is the only way to detect that from the
 *        API response, and a short list is treated as unclassifiable rather
 *        than as a clean diff. Omit it only where no total is available.
 * @returns {{authority: 'auto'|'human', reasons: string[], surfaces: string[]}}
 */
function classifyDiff({ files, policy, declaredFileCount }) {
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

  if (typeof declaredFileCount === 'number' && files.length < declaredFileCount) {
    // Fail closed: an incomplete file list cannot be shown to be free of
    // reserved paths, and GitHub gives no way to fetch the remainder.
    surfaces.add('unclassifiable');
    reasons.push(
      `Changed-file list is truncated (${files.length} of ${declaredFileCount} files returned) — ` +
        'the diff cannot be shown to be free of reserved surfaces, reserving merge.'
    );
  }

  for (const surface of policy.surfaces) {
    // `excludePaths` narrows a surface that would otherwise over-reserve. It is
    // applied AFTER the include match and only within that surface, so it can
    // never release a file another surface reserves.
    const excluded = surface.excludePaths || [];
    const hits = files
      .flatMap((f) => {
        const names = filePaths(f);
        const matched = names.filter(
          (name) => matchesAnyGlob(name, surface.paths) && !matchesAnyGlob(name, excluded)
        );
        if (matched.length === 0) return [];
        // Report a rename as "old -> new" so the reason names the path that was
        // reserved, not only the one it landed on.
        return names.length > 1 && names[0] !== names[1]
          ? [`${names[1]} -> ${names[0]}`]
          : [matched[0]];
      });
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
      const names = filePaths(file);
      if (names.length === 0) continue;
      if (rule.pathGlobs && !names.some((n) => matchesAnyGlob(n, rule.pathGlobs))) continue;
      // A file too large for GitHub to return a patch cannot be scanned. That is
      // an absence of evidence, not evidence of absence: reserve it.
      if (file.patch === undefined || file.patch === null) {
        // A removed file contributes no added lines, so there is nothing a
        // content rule could match. A rename is only equally safe when it is a
        // PURE rename: GitHub omits the patch both for a 100%-similarity rename
        // (genuinely no content change) and for a rename whose accompanying
        // edit is too large to return. Only the counts tell those apart, so a
        // rename is skipped solely when it reports zero additions and zero
        // deletions; anything else -- including missing counts -- is
        // unclassifiable.
        if (file.status === 'removed') continue;
        if (file.status === 'renamed' && file.additions === 0 && file.deletions === 0) continue;
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
function evaluateMergeAuthority({ files, policy, labels = [], verdictApproved = false, verdictErrors = [], declaredFileCount }) {
  const errors = [];
  const notes = [];

  let classification;
  try {
    classification = classifyDiff({ files, policy, declaredFileCount });
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
  filePaths,
  loadPolicy,
  classifyDiff,
  evaluateMergeAuthority,
};
