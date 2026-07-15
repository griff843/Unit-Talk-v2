#!/usr/bin/env tsx
/**
 * Direct-main-push detection guard (UTV2-1537).
 *
 * Built in response to a real incident
 * (docs/06_status/INCIDENTS/INC-2026-07-14-utv2-1533-direct-main-push.md): a commit
 * landed directly on `main` with no associated PR and no documented emergency
 * exception, and no mechanical detector existed to notice. This script closes that
 * specific gap.
 *
 * What this detector CAN reliably tell, from repo/GitHub-API-visible signals only:
 *
 *   1. Whether a commit on `main` has an associated merged PR
 *      (`gh api repos/{owner}/{repo}/commits/{sha}/pulls`).
 *   2. Whether the commit's author is a known, allow-listed automation identity
 *      making a change that BOTH matches an allow-listed commit-message pattern AND
 *      only touches the exact file-path globs that identity's known operation is
 *      documented to touch (currently: the `SYNC_BOT_TOKEN` lane-closeout
 *      bookkeeping commits `post-merge-lane-close.yml` pushes as
 *      `github-actions[bot]`, scoped to `docs/06_status/lanes/*.json`,
 *      `docs/06_status/proof/**`, and `.ops/sync/*.yml`). A message-pattern match
 *      alone is never sufficient -- a commit whose changed files are not confirmed
 *      to stay within that scope is not classified as authorized.
 *   3. Whether the commit message carries an `Emergency-Bypass-Record: <path>`
 *      trailer pointing at an existing `docs/06_status/INCIDENTS/*.md` file that
 *      itself references the commit SHA -- the mechanical convention this script
 *      introduces for a `DIRECT_MAIN_BYPASS_POLICY.md` emergency-exception record to
 *      be machine-checkable. No commit in this repo's history uses this trailer yet
 *      (it did not exist before this lane), so this classification band is currently
 *      always empty in practice -- that is an honest, expected fact about a brand-new
 *      convention, not a detector bug.
 *
 * What this detector CANNOT tell, and does not claim to:
 *
 *   - Whether a push literally invoked a GitHub "administrator bypass" affordance vs.
 *     simply succeeded because branch protection's `enforce_admins` is disabled for
 *     that identity (both look identical from `git log` + the commits API -- GitHub's
 *     private audit log is the only place that distinction could ever be confirmed,
 *     and this script has no access to it).
 *   - Whether a "documented emergency exception" mention in an incident doc actually
 *     satisfies every field `DIRECT_MAIN_BYPASS_POLICY.md` requires (incident ID,
 *     exact files/commands, why the PR path was too slow, rollback plan, authorizer)
 *     -- it only checks that the trailer-referenced doc exists and mentions the SHA.
 *     A human should still read the linked doc to confirm it is a genuine
 *     pre-authorization, not (as with this incident's own record) a post-hoc writeup
 *     of a violation.
 *   - Any commit that predates this script's introduction and used a different,
 *     undocumented bypass convention -- it can only classify what it can see today.
 *
 * Usage:
 *   tsx scripts/ci/direct-main-push-guard.ts --sha <sha> [--sha <sha> ...] [--json]
 *   tsx scripts/ci/direct-main-push-guard.ts --since <sha> --until <sha> [--json]
 *
 * Exit codes:
 *   0 — every inspected commit classifies as pr_merge, authorized_automation, or
 *       documented_emergency_exception
 *   1 — at least one commit classifies as unauthorized_direct_push
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import micromatch from 'micromatch';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');
const EMERGENCY_TRAILER = /^Emergency-Bypass-Record:\s*(\S+)\s*$/m;

/**
 * Identities allowed to author unreviewed commits directly on `main`, the
 * commit-message pattern each identity's known operation is allow-listed for, AND
 * the exact file-path globs that operation is known to touch. All three must match
 * -- a commit matching the identity+message pattern but touching a file outside
 * `changedPathGlobs` is NOT authorized_automation (Codex review finding, this
 * lane's own PR: message-pattern matching alone would let a compromised or buggy
 * automation stage arbitrary files under an allow-listed subject line). Extending
 * this list is itself a governance change and should land through a normal PR
 * against this file, not be silently widened.
 */
const KNOWN_AUTOMATION_IDENTITIES: Record<
  string,
  Array<{ messagePattern: RegExp; changedPathGlobs: string[] }>
> = {
  'github-actions[bot]': [
    {
      // post-merge-lane-close.yml's closeout commit: git add "$MANIFEST_PATH" +
      // git add docs/06_status/proof/"$ISSUE_ID"/ + git rm .ops/sync/"$ISSUE_ID".yml.
      messagePattern: /^chore\(lanes\): close .+ — lane closed/,
      changedPathGlobs: ['docs/06_status/lanes/*.json', 'docs/06_status/proof/**', '.ops/sync/*.yml'],
    },
  ],
};

export interface CommitClassificationInput {
  sha: string;
  authorLogin: string | null;
  message: string;
  associatedPrNumbers: number[];
  /**
   * Files this commit touched. Optional for backward compatibility with older
   * callers, but required in practice to reach `authorized_automation` -- a commit
   * with unknown changed files can never be verified as narrowly-scoped, so it
   * falls through to the emergency-record / unauthorized checks instead.
   */
  changedFiles?: string[];
}

export type DirectMainPushClassificationCode =
  | 'pr_merge'
  | 'authorized_automation'
  | 'documented_emergency_exception'
  | 'unauthorized_direct_push';

export interface DirectMainPushClassification {
  sha: string;
  code: DirectMainPushClassificationCode;
  reason: string;
}

function findEmergencyBypassRecord(message: string): string | null {
  const match = EMERGENCY_TRAILER.exec(message);
  return match?.[1] ?? null;
}

/**
 * Confirms an `Emergency-Bypass-Record:` trailer path exists under
 * docs/06_status/INCIDENTS/ and its content actually mentions the commit SHA. This is
 * a structural check only (see module header for what it cannot confirm).
 */
export function emergencyRecordReferencesSha(recordPath: string, sha: string, root: string = ROOT): boolean {
  const resolved = path.resolve(root, recordPath);
  const incidentsDir = path.resolve(root, 'docs', '06_status', 'INCIDENTS');
  if (!resolved.startsWith(incidentsDir + path.sep)) {
    return false; // refuse to follow a trailer path outside the incidents directory
  }
  if (!fs.existsSync(resolved)) {
    return false;
  }
  const content = fs.readFileSync(resolved, 'utf8');
  return content.includes(sha);
}

/**
 * Pure classification function -- no fs/network access -- so it is fully unit
 * testable without a live git checkout or GitHub token. The CLI wrapper below
 * gathers the real inputs via `git`/`gh` and this repo's INCIDENTS directory.
 */
export function classifyMainCommit(
  input: CommitClassificationInput,
  options: { checkEmergencyRecord?: (recordPath: string, sha: string) => boolean } = {},
): DirectMainPushClassification {
  const { sha, authorLogin, message, associatedPrNumbers, changedFiles } = input;
  const checkEmergencyRecord = options.checkEmergencyRecord ?? emergencyRecordReferencesSha;

  if (associatedPrNumbers.length > 0) {
    return {
      sha,
      code: 'pr_merge',
      reason: `associated with merged PR #${associatedPrNumbers[0]} (gh api commits/${sha}/pulls)`,
    };
  }

  if (authorLogin && authorLogin in KNOWN_AUTOMATION_IDENTITIES) {
    const operations = KNOWN_AUTOMATION_IDENTITIES[authorLogin] ?? [];
    for (const operation of operations) {
      if (!operation.messagePattern.test(message)) {
        continue;
      }
      if (changedFiles === undefined) {
        // Message pattern matched but we have no changed-files evidence to confirm
        // the operation stayed within its known scope -- do not authorize on
        // message text alone.
        continue;
      }
      const allInScope = changedFiles.every((file) => micromatch.isMatch(file, operation.changedPathGlobs, { dot: true }));
      if (allInScope) {
        return {
          sha,
          code: 'authorized_automation',
          reason: `known automation identity "${authorLogin}" with an allow-listed commit-message pattern, and every changed file (${changedFiles.join(', ') || 'none'}) matches its known scope (${operation.changedPathGlobs.join(', ')})`,
        };
      }
      // Message matched but files did not -- fall through (do not authorize),
      // rather than breaking out of the identity check entirely, in case a later
      // operation entry for this identity also matches.
    }
  }

  const recordPath = findEmergencyBypassRecord(message);
  if (recordPath && checkEmergencyRecord(recordPath, sha)) {
    return {
      sha,
      code: 'documented_emergency_exception',
      reason: `Emergency-Bypass-Record trailer points to ${recordPath}, which references this SHA -- a human should still confirm it is a genuine pre-authorization, not a post-hoc writeup`,
    };
  }

  return {
    sha,
    code: 'unauthorized_direct_push',
    reason: 'no associated PR, not a recognized automation identity/pattern, and no Emergency-Bypass-Record trailer resolving to a matching incident doc',
  };
}

// ── CLI wrapper: gathers real inputs and calls the pure classifier above ────────

function git(args: string[]): string {
  return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim();
}

function ghApiJson<T>(pathSuffix: string): T {
  const raw = execFileSync('gh', ['api', pathSuffix], { encoding: 'utf8' });
  return JSON.parse(raw) as T;
}

function gatherCommitInput(sha: string): CommitClassificationInput {
  const message = git(['log', '-1', '--format=%B', sha]);
  let authorLogin: string | null = null;
  let associatedPrNumbers: number[] = [];
  try {
    const commit = ghApiJson<{ author?: { login?: string } | null }>(
      `repos/{owner}/{repo}/commits/${sha}`,
    );
    authorLogin = commit.author?.login ?? null;
  } catch {
    authorLogin = null;
  }
  try {
    const pulls = ghApiJson<Array<{ number: number }>>(`repos/{owner}/{repo}/commits/${sha}/pulls`);
    associatedPrNumbers = pulls.map((pr) => pr.number);
  } catch {
    associatedPrNumbers = [];
  }
  const changedFiles = git(['show', '--format=', '--name-only', sha])
    .split('\n')
    .filter(Boolean);
  return { sha, authorLogin, message, associatedPrNumbers, changedFiles };
}

function parseArgs(argv: string[]): { shas: string[]; json: boolean } {
  const shas: string[] = [];
  let since: string | null = null;
  let until: string | null = null;
  let json = false;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--sha') {
      const value = argv[++i];
      if (value) shas.push(value);
    } else if (arg === '--since') {
      since = argv[++i] ?? null;
    } else if (arg === '--until') {
      until = argv[++i] ?? null;
    } else if (arg === '--json') {
      json = true;
    }
  }

  if (since && until) {
    const range = git(['log', '--format=%H', `${since}..${until}`]);
    shas.push(...range.split('\n').filter(Boolean));
  }

  return { shas, json };
}

function main(argv = process.argv.slice(2)): number {
  const { shas, json } = parseArgs(argv);
  if (shas.length === 0) {
    process.stderr.write(
      'Usage: tsx scripts/ci/direct-main-push-guard.ts --sha <sha> [--sha <sha> ...] | --since <sha> --until <sha> [--json]\n',
    );
    return 1;
  }

  const results = shas.map((sha) => classifyMainCommit(gatherCommitInput(sha)));
  const unauthorized = results.filter((result) => result.code === 'unauthorized_direct_push');

  if (json) {
    process.stdout.write(`${JSON.stringify({ results, unauthorized_count: unauthorized.length }, null, 2)}\n`);
  } else {
    for (const result of results) {
      process.stdout.write(`${result.sha}\t${result.code}\t${result.reason}\n`);
    }
    if (unauthorized.length > 0) {
      process.stderr.write(
        `\n${unauthorized.length} unauthorized direct push(es) to main detected. See docs/05_operations/DIRECT_MAIN_BYPASS_POLICY.md.\n`,
      );
    }
  }

  return unauthorized.length > 0 ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main();
}
