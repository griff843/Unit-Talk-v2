'use strict';
/* eslint-disable @typescript-eslint/no-require-imports -- Trusted GitHub evaluator runs plain Node CommonJS without a candidate build. */

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { parseVerdict, validateT1Verdicts } = require('../merge-gate-verdict.cjs');

const REGISTRY_PATH = 'docs/governance/tracker-independence/p0-classifications.json';
// Ratified initial batch, plus positive classifications committed before cutover.
// This floor cannot be removed by editing a candidate manifest or registry.
const HISTORICAL_P0 = Object.freeze([
  ...Array.from({ length: 10 }, (_, index) => `UTV2-${914 + index}`),
  'UTV2-948', 'UTV2-949', 'UTV2-953',
]);
const ID_PATTERN = /^(?:UTV2|UNI|WORK)-\d+$/;

function validateClassificationApproval({ issueId, prNumber, headSha, comments, authorizedReviewers }) {
  if (!Number.isInteger(prNumber) || !/^[a-f0-9]{40}$/i.test(headSha || '')) return false;
  const verdicts = comments.map((comment) => ({
    user: comment.user?.login ?? null,
    userType: comment.user?.type ?? null,
    parsed: parseVerdict(comment.body || ''),
    createdAt: comment.created_at || '',
  })).filter((record) => record.parsed?.issueId.toUpperCase() === issueId.toUpperCase())
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  return validateT1Verdicts(verdicts, {
    prNumber, headSha, authorizedReviewers: new Set(authorizedReviewers),
  }).length === 0;
}

function manifestFlag(manifest, issueId) {
  if (manifest === null) return undefined;
  if (!manifest || manifest.issue_id !== issueId) throw new Error('manifest identity mismatch');
  if (manifest.p0_protocol === undefined) return undefined;
  const flag = manifest.p0_protocol?.required;
  if (typeof flag !== 'boolean') throw new Error('p0_protocol.required must be boolean');
  return flag;
}

function registryFlag(registry, issueId) {
  if (registry === null) return undefined;
  if (registry.schema_version !== 1 || !Array.isArray(registry.classifications)) {
    throw new Error('invalid P0 registry schema');
  }
  const seen = new Set();
  for (const entry of registry.classifications) {
    if (!ID_PATTERN.test(entry.issue_id) || typeof entry.required !== 'boolean' ||
        typeof entry.evidence !== 'string' || !entry.evidence.trim() || seen.has(entry.issue_id)) {
      throw new Error('invalid or duplicate P0 registry classification');
    }
    seen.add(entry.issue_id);
  }
  return registry.classifications.find((entry) => entry.issue_id === issueId)?.required;
}

function classifyP0Evidence(input) {
  const issueId = typeof input.issueId === 'string' ? input.issueId.toUpperCase() : '';
  const result = (classification, source, reason) => ({
    schema_version: 1, issue_id: issueId, classification,
    is_p0: classification === 'unknown' ? null : classification === 'p0', source, reason,
  });
  if (!ID_PATTERN.test(issueId)) return result('unknown', 'error', 'Missing or malformed work identity');
  if (HISTORICAL_P0.includes(issueId)) return result('p0', 'historical', 'Ratified or historically committed positive P0 classification');
  try {
    if (input.baseError) throw new Error(input.baseError);
    const baseManifest = manifestFlag(input.baseManifest ?? null, issueId);
    const baseRegistry = registryFlag(input.baseRegistry ?? null, issueId);
    if (baseManifest === true || baseRegistry === true) {
      return result('p0', 'base', 'Trusted base positive P0 classification cannot be cleared by candidate');
    }
    if (input.candidateError) throw new Error(input.candidateError);
    const candidateManifest = manifestFlag(input.candidateManifest ?? null, issueId);
    const candidateRegistry = registryFlag(input.candidateRegistry ?? null, issueId);
    if (candidateManifest === true || candidateRegistry === true) return result('p0', 'candidate', 'Candidate explicitly requires P0 protocol');
    if (baseManifest === false || baseRegistry === false) return result('non_p0', 'base', 'Explicit reviewed classification committed on trusted base');
    if (candidateManifest === false || candidateRegistry === false) {
      const tier = input.candidateManifest?.tier;
      if (!['T1', 'T2', 'T3'].includes(tier)) {
        return result('unknown', 'missing', 'An explicit non-P0 declaration requires a repository manifest with a valid risk tier');
      }
      // Applicability is not merge authorization. This trusted classifier
      // preserves every positive obligation above and reads the existing lane
      // declaration. The required Merge Gate still applies T3/T2/T1 approval
      // policy; classification must not add a second, universal human gate.
      return result('non_p0', 'manifest', `Explicit repository non-P0 declaration; existing ${tier} merge and review requirements still apply`);
    }
    return result('unknown', 'missing', 'No explicit repository P0 classification; resolve applicability in the existing lane manifest');
  } catch (error) {
    return result('unknown', 'error', error instanceof Error ? error.message : String(error));
  }
}

function readAt(root, ref, relativePath) {
  if (!ref) {
    const file = path.join(root, relativePath);
    return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null;
  }
  // Resolve first: missing/unavailable base is never equivalent to a missing file.
  const sha = execFileSync('git', ['rev-parse', '--verify', `${ref}^{commit}`], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  const exists = execFileSync('git', ['ls-tree', '--name-only', sha, '--', relativePath], { cwd: root, encoding: 'utf8' }).trim();
  return exists ? JSON.parse(execFileSync('git', ['show', `${sha}:${relativePath}`], { cwd: root, encoding: 'utf8' })) : null;
}

function classifyRepositoryP0({ root, issueId, baseRef, headRef, approval = false }) {
  const input = { issueId, approval };
  if (!ID_PATTERN.test(String(issueId).toUpperCase())) return classifyP0Evidence(input);
  const manifestPath = `docs/06_status/lanes/${issueId.toUpperCase()}.json`;
  try {
    if (!baseRef) throw new Error('Trusted base reference is required');
    input.baseManifest = readAt(root, baseRef, manifestPath);
    input.baseRegistry = readAt(root, baseRef, REGISTRY_PATH);
  } catch (error) { input.baseError = `Unable to read trusted base: ${error.message}`; }
  try {
    input.candidateManifest = readAt(root, headRef, manifestPath);
    input.candidateRegistry = readAt(root, headRef, REGISTRY_PATH);
  } catch (error) { input.candidateError = `Unable to read candidate classification: ${error.message}`; }
  return classifyP0Evidence(input);
}

module.exports = { HISTORICAL_P0, REGISTRY_PATH, classifyP0Evidence, classifyRepositoryP0, validateClassificationApproval };
