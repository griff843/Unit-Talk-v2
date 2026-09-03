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
 * Decodes the escape sequences a JSON encoder may use inside a string, so a
 * content rule compares against the value a JSON parser would produce.
 *
 * Only string-level escapes are decoded; the line is not parsed as JSON,
 * because a patch line is a fragment and usually will not parse.
 */
function decodeJsonEscapes(line) {
  return line
    .replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/\\\//g, '/');
}

// ── Structural analysis of package manifests ───────────────────────────────
//
// Three independent evasions of a line regex over `package.json` were found in
// review before this became structural: a JSON escape (`"ops:merge-wrapper"`),
// a key and its colon split across two added lines, and a runner name sitting in
// a comment (`true # tsx --test`). Each parses to exactly the value pnpm runs, and
// each matched nothing. A regex over patch text is the wrong instrument for a
// structured file: these rules compare the PARSED manifest at base against the
// PARSED manifest at head, so any encoding, reformatting or commentary that
// produces the same parsed value produces the same verdict.

/**
 * Shell syntax this validator does not model. Its presence in a script value
 * makes the value UNPROVEN, which reserves.
 *
 * This list is deliberately the wrong shape for an arms race. Four rounds of
 * review defeated four successive attempts to enumerate the ways a script can
 * look like work without doing it -- `true || tsx`, `exit 0 && tsx`,
 * `pnpm --filter X exec true`, then `false && tsx; true`, `tsx ... & true`, and
 * `tsx() { true; }; tsx ...`. Each fix was correct and each was followed by
 * another construct. The generator of those evasions is that the shell has more
 * ways to discard a command's execution or its status than a validator can
 * enumerate, so enumerating them is a losing position by construction.
 *
 * So the default is inverted here. Rather than proving a command is a no-op,
 * a command must prove it is work, in a grammar small enough to reason about:
 * a `&&`-joined list of plain words. Everything else -- backgrounding, pipes,
 * subshells, function definitions, redirection, command substitution, quoting,
 * `;`, `||` -- is refused without being interpreted. That is a strictly larger
 * refusal set than any list of known tricks, and it does not grow when someone
 * invents a new one.
 */
const UNMODELLED_SHELL_SYNTAX = /[&;|()<>`$\\{}'"\n\r]/;

/**
 * Does this script value PROVABLY run work?
 *
 * Returns true only for a `&&`-joined chain in which every element resolves to
 * a configured runner. Every element must resolve, not merely one: in `a && b`
 * the shell runs `b` only if `a` succeeded, so a chain whose first element is
 * `false` (or any command that can fail) reaches nothing after it. Requiring
 * all of them removes the need to reason about which ones are reachable.
 *
 * Anything unproven reserves. Unproven is not an accusation that the script is
 * neutered; it means this validator cannot show that it is not, and a
 * merge-authority control resolves that direction.
 */
function commandInvokesRunner(command, scripts, config, seen) {
  if (typeof command !== 'string') return false;
  const visited = seen || new Set();
  const trimmed = command.trim();
  if (!trimmed) return false;
  const elements = trimmed.split('&&');
  for (const raw of elements) {
    const element = raw.trim();
    // An empty element means the split produced something the grammar does not
    // describe -- a bare `&` (backgrounding), a trailing `&&`, or `&&&`.
    if (!element) return false;
    if (UNMODELLED_SHELL_SYNTAX.test(element)) return false;
    if (!elementRunsRunner(element, scripts, config, visited)) return false;
  }
  return true;
}

/** One element of a `&&` chain: plain words, already known free of shell syntax. */
function elementRunsRunner(element, scripts, config, visited) {
  const runners = new Set(config.runnerCommands || []);
  const wrappers = new Set(config.commandWrappers || []);
  let words = element.split(/\s+/).filter(Boolean);
  // A leading `VAR=value` prefix is REFUSED, not skipped over.
  //
  // Skipping it was the reasoning error: `PATH=./fake-bin tsx --test x` was
  // read as "assignment, then the bare runner `tsx`", and a bare runner was
  // trusted on the grounds that it resolves through the workspace's own
  // `node_modules/.bin`. That grounds is exactly what the assignment removes.
  // A PR that adds an executable `fake-bin/tsx` exiting 0 then supplies both
  // the runner and its behaviour -- the same escape the bare-word rule was
  // written to close, reached one word earlier.
  //
  // Refusing outright rather than allowlisting "harmless" variables: whether a
  // variable affects resolution is a property of the environment, not of this
  // file, and enumerating the ones that do is the arms race this grammar
  // exists to stop. The cost was measured before choosing: across the root and
  // every workspace manifest exactly ONE script uses a leading assignment
  // (`apps/smart-form` `test:e2e:fixture`), and it is not in the required
  // chain. Inside the protected closure this costs nothing.
  if (words.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(words[0])) return false;
  while (words.length) {
    const word = words[0];
    const base = word.replace(/^.*\//, '');
    // A runner must be a BARE word. `./tsx --test a.test.ts` looks like the
    // toolchain and is not: it executes a file the PR itself can add, so the
    // diff supplies both the "runner" and its behaviour. A bare word resolves
    // through the workspace's own `node_modules/.bin`, which a diff cannot
    // repoint without changing a manifest this validator already reserves.
    if (word !== base) return false;
    if (runners.has(base)) return true;
    if (wrappers.has(base)) {
      // `pnpm --filter <pkg> <thing>` selects another workspace project; it is
      // not itself proof of work, and the manifest that would prove it is not
      // in this diff. Drop the selector and keep resolving what follows; if
      // what remains is a script this manifest does not define, it stays
      // unproven and reserves.
      const next = [];
      let filtered = false;
      for (let i = 1; i < words.length; i += 1) {
        const w = words[i];
        if (w === '--filter' || w === '-F') { filtered = true; i += 1; continue; }
        if (w.startsWith('--filter=')) { filtered = true; continue; }
        if (w.startsWith('-')) continue;
        next.push(w);
      }
      // `pnpm --filter <pkg> verify` runs the script named `verify` in ANOTHER
      // manifest. Resolving the remaining word here would look it up in THIS
      // manifest and follow a same-named root script instead -- reporting on a
      // command that never runs. There is no manifest here that can prove it,
      // so it stays unproven.
      if (filtered) return false;
      words = next;
      continue;
    }
    // `pnpm test:apps` resolves inside the same manifest. The visited set stops
    // a cycle from recursing forever; a cycle runs nothing, so it stays false.
    if (Object.prototype.hasOwnProperty.call(scripts, base) && !visited.has(base)) {
      visited.add(base);
      return commandInvokesRunner(scripts[base], scripts, config, visited);
    }
    return false;
  }
  return false;
}

/**
 * Every root script reachable from a set of entrypoints, in either manifest.
 *
 * The closure is computed over base AND head so that neither adding nor
 * removing a link can hide a change: a script newly pulled into the required
 * chain is protected from that moment, and one dropped out of it is still
 * protected for the change that dropped it.
 */
/**
 * Is a script's new value a WIDENING of its old one?
 *
 * A required-chain script may gain work and may not lose it. Adding a test file
 * is ordinary; swapping the whole value for `node scripts/validate-env.mjs`
 * runs a real runner and none of the suite, and naming a runner cannot tell
 * those apart. Comparing the operand SETS can: every word the old value ran
 * must still be there, and every flag must be one the required chain uses.
 */
function isWidening(baseValue, headValue, allowedFlags) {
  if (typeof headValue !== 'string') return false;
  const parts = (value) => {
    const words = String(value).split(/\s+/).filter(Boolean);
    return {
      flags: words.filter((w) => w.startsWith('-')).map((w) => w.split('=')[0]),
      operands: new Set(words.filter((w) => !w.startsWith('-'))),
    };
  };
  const head = parts(headValue);
  for (const flag of head.flags) if (!allowedFlags.has(flag)) return false;
  if (typeof baseValue !== 'string') return true;
  for (const operand of parts(baseValue).operands) {
    if (!head.operands.has(operand)) return false;
  }
  return true;
}

function reachableScripts(entrypoints, headScripts, baseScripts) {
  const reachable = new Set();
  const queue = [...entrypoints];
  while (queue.length) {
    const key = queue.shift();
    if (reachable.has(key)) continue;
    reachable.add(key);
    for (const scripts of [headScripts, baseScripts]) {
      const value = scripts[key];
      if (typeof value !== 'string') continue;
      for (const word of value.split(/[\s&;|]+/)) {
        if (word && Object.prototype.hasOwnProperty.call(headScripts, word)) queue.push(word);
        else if (word && Object.prototype.hasOwnProperty.call(baseScripts, word)) queue.push(word);
      }
    }
  }
  return reachable;
}

function scriptsOf(manifest) {
  return manifest && typeof manifest.scripts === 'object' && manifest.scripts ? manifest.scripts : {};
}

function dependencyVersion(manifest, name) {
  if (!manifest) return undefined;
  for (const field of ['dependencies', 'devDependencies', 'optionalDependencies', 'pnpm']) {
    const bag = manifest[field];
    if (bag && typeof bag === 'object' && name in bag) return bag[name];
  }
  return undefined;
}

const MANIFEST_NAME = /(^|\/)package\.json$/;

/**
 * Compares every changed package.json structurally.
 *
 * @param {object} input
 * @param {Array} input.files Changed files, as given to classifyDiff.
 * @param {object|undefined} input.manifests
 *        `{ '<path>': { base: <raw json or null>, head: <raw json or null> } }`.
 *        `null` means the file does not exist at that ref. A changed manifest
 *        with no entry here is unclassifiable, not clean.
 * @param {object} input.config The policy's `manifestPolicy` block.
 */
function analyzeManifests({ files, manifests, config }) {
  const surfaces = new Set();
  const reasons = [];
  if (!config) return { surfaces: [], reasons: [] };

  const changedManifests = [];
  for (const f of files) {
    for (const name of filePaths(f)) {
      if (MANIFEST_NAME.test(name) && !changedManifests.includes(name)) changedManifests.push(name);
    }
  }
  if (changedManifests.length === 0) return { surfaces: [], reasons: [] };

  const reserve = (surface, reason) => {
    surfaces.add(surface);
    reasons.push(reason);
  };

  for (const name of changedManifests) {
    const entry = manifests && typeof manifests === 'object' ? manifests[name] : undefined;
    if (!entry) {
      reserve(
        'unclassifiable',
        `${name} changed but its contents were not supplied — the parsed scripts cannot be compared, reserving merge.`
      );
      continue;
    }
    const parse = (raw, ref) => {
      if (raw === null || raw === undefined) return null;
      try {
        return JSON.parse(String(raw));
      } catch (e) {
        reserve('unclassifiable', `${name} at ${ref} is not parseable JSON (${e.message}) — reserving merge.`);
        return undefined;
      }
    };
    const base = parse(entry.base, 'base');
    const head = parse(entry.head, 'head');
    if (base === undefined || head === undefined) continue;
    if (head === null) {
      reserve(
        'neutered-workspace-script',
        `${name} was deleted — every script it contributed to the required chain is gone, reserving merge.`
      );
      continue;
    }

    const baseScripts = scriptsOf(base);
    const headScripts = scriptsOf(head);
    const isRoot = name === 'package.json';

    if (isRoot) {
      // The protected set is the TRANSITIVE CLOSURE, not the named entrypoints.
      // `verify` and `test` are what CI invokes, but they invoke `test:ops`,
      // which invokes nothing CI names -- so weakening `test:ops` left every
      // required check green while a whole suite stopped running. Reachability
      // is the property that matters: if a required check's outcome depends on
      // a script, that script decides what the check proves.
      const named = new Set(config.protectedRootScripts || []);
      const allowedFlags = new Set(config.requiredChainAllowedFlags || []);
      const protectedClosure = reachableScripts([...named], headScripts, baseScripts);
      for (const key of protectedClosure) {
        if (headScripts[key] === baseScripts[key]) continue;
        if (named.has(key)) {
          reserve(
            'ci-required-check-entrypoints',
            `Root script "${key}" changed — the required \`verify\` job invokes it, so repointing it changes what that check proves.`
          );
          continue;
        }
        // Below the named entrypoints the rule is narrower on purpose. Adding a
        // test file to a group is the most ordinary change there is and must
        // stay automatic; running LESS than before is not, because it leaves
        // every required check green while the suite shrinks. So a change here
        // must be a widening: no operand may be dropped, and every flag must be
        // one the required chain actually uses.
        if (!isWidening(baseScripts[key], headScripts[key], allowedFlags)) {
          reserve(
            'ci-required-check-entrypoints',
            `Root script "${key}" is reachable from a required-check entrypoint and its change is not a widening — it drops something it used to run, or passes a flag the required chain does not use: ${String(headScripts[key]).slice(0, 120)}`
          );
        }
      }
      for (const dep of config.controlToolchainDependencies || []) {
        if (dependencyVersion(head, dep) !== dependencyVersion(base, dep)) {
          reserve(
            'control-toolchain',
            `Root dependency "${dep}" changed — the merge-authority chain executes through it, so a replacement binary can satisfy the gate without evaluating it.`
          );
        }
      }
    }

    // A manifest OTHER than the root can still carry a script the required
    // chain runs, reached through `pnpm --filter <pkg> <script>`. The root
    // graph traversal cannot see it -- it is in a different file -- so it was
    // unprotected, and changing apps/smart-form's `verify` to run nothing left
    // every required check green.
    if (!isRoot) {
      // Keyed by MANIFEST PATH, not by package name.
      //
      // Keying by `head.name` meant a workspace could leave the protected set
      // by renaming itself: the lookup found no entry and the change went
      // `auto`. That is not merely a missed reservation -- it silently removes
      // the checks. `pnpm --filter <name>` that matches nothing prints
      // "No projects matched" and exits 0 unless `--fail-if-no-match` is
      // passed, and the root chain does not pass it. So renaming
      // `@unit-talk/smart-form` makes `pnpm --filter @unit-talk/smart-form
      // verify` a successful no-op and `verify:static` stays green while an
      // entire app stops being verified. A path cannot be changed without
      // moving the file, which appears in the diff as its own reserved event.
      const entrypoints = (config.requiredChainWorkspaceScripts || {})[name] || [];
      const allowed = new Set(config.requiredChainAllowedFlags || []);

      // Renaming a protected workspace IS the attack above, so it reserves on
      // its own -- before any script comparison, because after the rename the
      // filter selects nothing and the scripts no longer matter.
      if (entrypoints.length > 0 && base && head && base.name !== head.name) {
        reserve(
          'ci-required-check-entrypoints',
          `${name} is selected by the root required chain through \`pnpm --filter ${String(base.name)}\`, and its package name changed to "${String(head.name)}". An unmatched filter is a successful no-op, so this silently removes the checks it names.`
        );
      }

      // The closure, not the named entrypoints. The policy names smart-form's
      // `verify`, but that is `pnpm type-check && pnpm test` -- so `test`,
      // which runs six test files, was reachable from the required chain and
      // unprotected. Replacing it with a single file returned `auto` while
      // five required test files stopped running and `verify:static` stayed
      // green. Same reasoning as the root closure, applied one file over.
      const protectedClosure = reachableScripts([...entrypoints], headScripts, baseScripts);
      for (const key of protectedClosure) {
        if (headScripts[key] === baseScripts[key]) continue;
        if (!isWidening(baseScripts[key], headScripts[key], allowed)) {
          reserve(
            'ci-required-check-entrypoints',
            `Script "${key}" in ${name} is reachable from the root required chain through \`pnpm --filter\`, and its change is not a widening: ${String(headScripts[key]).slice(0, 120)}`
          );
        }
      }
    }

    const mergeCommandPattern = config.mergeCommandValuePattern
      ? new RegExp(config.mergeCommandValuePattern, 'i')
      : null;

    for (const [key, value] of Object.entries(headScripts)) {
      if (value === baseScripts[key]) continue;
      if ((config.mergeCommandScripts || []).includes(key)) {
        reserve('merge-wrapper-entrypoint', `Script "${key}" in ${name} was repointed — this is the sanctioned merge command.`);
      }
      // A TEST FILE named after the merge chain is not the merge chain.
      // `test:ops` lists `pre-merge-authorization.test.ts`, so adding any test
      // file to that group matched this pattern and reserved as if the script
      // had been repointed at the merge wrapper. Running a test named after a
      // control is the opposite of repointing at it.
      const executable = String(value)
        .split(/\s+/)
        .filter((word) => !/\.test\.[cm]?[jt]s$/.test(word))
        .join(' ');
      if (mergeCommandPattern && mergeCommandPattern.test(executable)) {
        reserve('merge-wrapper-entrypoint', `Script "${key}" in ${name} now invokes the merge-authorization chain.`);
      }
      if (!commandInvokesRunner(String(value), headScripts, config)) {
        reserve(
          'neutered-workspace-script',
          `Script "${key}" in ${name} was changed to a command this validator cannot prove runs work — it is not a && chain of recognised runners: ${String(value).slice(0, 120)}`
        );
      }
    }
    for (const key of Object.keys(baseScripts)) {
      if (key in headScripts) continue;
      reserve('neutered-workspace-script', `Script "${key}" was removed from ${name} — whatever it contributed no longer runs.`);
    }
  }

  return { surfaces: [...surfaces], reasons };
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
function classifyDiff({ files, policy, declaredFileCount, manifests }) {
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
      // A rule over a JSON manifest must see the string the PARSER sees. JSON
      // permits `"ops\\u003amerge-wrapper"`, which decodes back to
      // `ops:merge-wrapper` and is what pnpm then runs -- while a regex over the
      // raw patch text matches nothing. Each added line is therefore tested in
      // both its literal and its escape-decoded form.
      const candidates = rule.decodeJsonEscapes
        ? addedLines.flatMap((l) => {
            const decoded = decodeJsonEscapes(l);
            return decoded === l ? [l] : [l, decoded];
          })
        : addedLines;
      const offending = candidates.find((l) => pattern.test(l));
      if (offending) {
        surfaces.add(rule.id);
        reasons.push(`${rule.reserved} — ${file.filename}: ${offending.trim().slice(0, 120)}`);
      }
    }
  }

  const manifestResult = analyzeManifests({ files, manifests, config: policy.manifestPolicy });
  for (const id of manifestResult.surfaces) surfaces.add(id);
  reasons.push(...manifestResult.reasons);

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
function evaluateMergeAuthority({ files, policy, labels = [], verdictApproved = false, verdictErrors = [], declaredFileCount, manifests }) {
  const errors = [];
  const notes = [];

  let classification;
  try {
    classification = classifyDiff({ files, policy, declaredFileCount, manifests });
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
  decodeJsonEscapes,
  commandInvokesRunner,
  analyzeManifests,
  POLICY_PATH,
  globToRegExp,
  matchesAnyGlob,
  filePaths,
  loadPolicy,
  classifyDiff,
  evaluateMergeAuthority,
};
