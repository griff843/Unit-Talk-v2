'use strict';
/* eslint-disable @typescript-eslint/no-require-imports -- Trusted GitHub evaluator runs plain Node CommonJS without a candidate build. */
const { classifyP0Evidence, validateClassificationApproval, REGISTRY_PATH } = require('./p0-classifier.cjs');

async function evaluatePullRequest({ github, repo, number, headSha }) {
  const { data: pr } = await github.rest.pulls.get({ ...repo, pull_number: number });
  if (pr.base.ref !== 'main' || pr.base.repo?.full_name?.toLowerCase() !== `${repo.owner}/${repo.repo}`.toLowerCase()) throw new Error('P0 evaluator requires this repository protected main base');
  if (pr.head.sha !== headSha) throw new Error('PR head changed during P0 evaluation; rerun at current head');
  const resolveId = (value) => [...String(value || '').matchAll(/\b(?:UTV2|UNI|WORK)-\d+\b/gi)].map((match) => match[0].toUpperCase());
  const branchIdentity = String(pr.head.ref || '').match(/^[^/]+\/((?:UTV2|UNI|WORK)-\d+)(?:-|$)/i)?.[1]?.toUpperCase();
  const ids = branchIdentity ? [branchIdentity] : [...new Set(resolveId(pr.title))];
  if (ids.length !== 1) throw new Error('P0 classification requires one unambiguous work identity in title or branch');
  const issueId = ids[0];
  const read = async (file, ref) => {
    try {
      const { data } = await github.rest.repos.getContent({ ...repo, path: file, ref });
      if (Array.isArray(data) || data.type !== 'file' || data.encoding !== 'base64') throw new Error(`Expected file: ${file}`);
      return Buffer.from(data.content, 'base64').toString('utf8');
    } catch (error) { if (error.status === 404) return null; throw error; }
  };
  const json = async (file, ref) => { const text = await read(file, ref); return text === null ? null : JSON.parse(text); };
  const manifestPath = `docs/06_status/lanes/${issueId}.json`;
  const comments = await github.paginate(github.rest.issues.listComments, { ...repo, issue_number: number, per_page: 100 });
  // Authorized human matches existing Merge Gate; candidate CODEOWNERS is never read.
  const approval = validateClassificationApproval({ issueId, prNumber: number, headSha, comments, authorizedReviewers: ['griff843'] });
  const evidence = {
    issueId, approval,
    baseManifest: await json(manifestPath, pr.base.sha),
    baseRegistry: await json(REGISTRY_PATH, pr.base.sha),
    candidateManifest: await json(manifestPath, headSha),
    candidateRegistry: await json(REGISTRY_PATH, headSha),
  };
  const classification = classifyP0Evidence(evidence);
  const summary = `${issueId}: ${classification.classification} — ${classification.reason}`;
  if (classification.classification === 'unknown') throw new Error(summary);
  if (classification.is_p0) {
    if (evidence.candidateManifest?.p0_protocol?.required !== true) throw new Error('Known P0 candidate must retain p0_protocol.required=true');
    if (evidence.candidateManifest.p0_protocol.merge_type !== 'manual') throw new Error('P0 requires manifest merge_type=manual');
    if (pr.auto_merge || pr.labels.some((label) => /^(automerge|auto-merge|auto_merge)$/i.test(label.name))) throw new Error('P0 forbids auto-merge');
    if (!approval) throw new Error('P0 requires authorized exact-head human PM approval');
    const proof = `docs/06_status/proof/${issueId}`;
    const protocol = evidence.candidateManifest.p0_protocol;
    if (protocol.claude_critique?.recorded !== true || protocol.claude_critique.artifact_path !== `${proof}/claude-critique.md`) throw new Error('P0 manifest must record its canonical critique artifact');
    if (protocol.runtime_verification?.recorded !== true || protocol.runtime_verification.artifact_path !== `${proof}/runtime-verification.md` || protocol.runtime_verification.result !== 'pass') throw new Error('P0 manifest must record its canonical passing runtime verification artifact');
    // Read exact candidate bytes. The contract requires the critique to reference
    // the merge SHA AFTER merge (truth-check H2), not a self-referential premerge SHA.
    const critique = await read(`${proof}/claude-critique.md`, headSha);
    const verification = await read(`${proof}/runtime-verification.md`, headSha);
    if (!critique?.trim()) throw new Error('Missing or empty P0 claude-critique.md');
    if (!verification?.trim() || !/^result:\s*pass\s*$/im.test(verification)) throw new Error('P0 runtime-verification.md requires result: pass');
    if (/^\s*-\s*\[[ xX]\]\s+.*:\s*(FAIL|SKIP|SKIPPED)\s*$/im.test(verification)) throw new Error('P0 runtime verification contains FAIL/SKIP');
  }
  const { data: current } = await github.rest.pulls.get({ ...repo, pull_number: number });
  if (current.head.sha !== headSha || current.base.sha !== pr.base.sha || current.base.ref !== 'main' || current.base.repo?.full_name !== pr.base.repo.full_name) throw new Error('PR head/base changed during P0 evaluation; rerun');
  return summary;
}

module.exports = { evaluatePullRequest };
