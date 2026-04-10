import fs from 'node:fs';
import path from 'node:path';

import type { CliConfig, IssueMetadata, SqlReviewState, VerifyState } from '../types.js';

const BODY_TEMPLATE = `## Summary
${'${TITLE}'}

${'${NOTES_SECTION}'}## Scope
Allowed files:
${'${ALLOWED_FILES}'}

Forbidden files:
${'${FORBIDDEN_FILES}'}

## Verification results
${'${VERIFY_RESULTS}'}

${'${PRE_EXISTING_FAILURES_SECTION}'}${'${MIGRATION_SECTION}'}## Rollback plan
${'${ROLLBACK_PLAN}'}

## Dependencies
Upstream:
${'${UPSTREAMS}'}

Downstream unlocks:
${'${DOWNSTREAMS}'}

## Tier
${'${TIER_LINE}'}

Closes ${'${ISSUE_ID}'}
`;

function renderList(items: string[]): string {
  return items.length === 0 ? '- (none)' : items.map((item) => `- ${item}`).join('\n');
}

export function buildPrBody(
  repoRoot: string,
  metadata: IssueMetadata,
  verify: VerifyState,
  sqlReview: SqlReviewState | null,
  config: CliConfig,
): string {
  const verifyLines = verify.gateResults.map((gate) => `- ${gate.name}: ${gate.pass ? 'PASS' : 'BLOCK'}`);
  if (verify.skippedGates.length > 0) {
    verifyLines.push(...verify.skippedGates.map((gate) => `- ${gate.name}: SKIPPED (${gate.reason})`));
  }

  const migrationSection =
    verify.migrations.paths.length === 0
      ? ''
      : `## Migration info
${verify.migrations.paths.map((migration) => `- ${migration.path} (${migration.sha256})`).join('\n')}
${sqlReview ? `- SQL review marker: ${sqlReview.reviewer} at ${sqlReview.timestamp}` : '- SQL review marker: missing'}

`;

  const preExistingFailuresSection =
    metadata.tier === 'T1' && metadata.pre_existing_failures
      ? `## Pre-existing failures (documented)
${metadata.pre_existing_failures}

`
      : '';

  const notesSection = metadata.notes ? `${metadata.notes}\n\n` : '';
  const tierLine = `${metadata.tier}${metadata.pm_review_required ? ' - PM review required' : ''}`;

  let body = BODY_TEMPLATE
    .replace('${TITLE}', metadata.title)
    .replace('${NOTES_SECTION}', notesSection)
    .replace('${ALLOWED_FILES}', renderList(metadata.allowed_files))
    .replace('${FORBIDDEN_FILES}', renderList(metadata.forbidden_files))
    .replace('${VERIFY_RESULTS}', verifyLines.join('\n'))
    .replace('${PRE_EXISTING_FAILURES_SECTION}', preExistingFailuresSection)
    .replace('${MIGRATION_SECTION}', migrationSection)
    .replace('${ROLLBACK_PLAN}', metadata.rollback_plan ?? '- none')
    .replace('${UPSTREAMS}', renderList(metadata.upstream_dependencies))
    .replace('${DOWNSTREAMS}', renderList(metadata.downstream_unlocks))
    .replace('${TIER_LINE}', tierLine)
    .replace('${ISSUE_ID}', metadata.id);

  if (metadata.pr_template) {
    const templatePath = path.join(repoRoot, metadata.pr_template);
    const template = fs.readFileSync(templatePath, 'utf8');
    body = template
      .replace(/\$\{ISSUE_ID\}/g, metadata.id)
      .replace(/\$\{TITLE\}/g, metadata.title)
      .replace(/\$\{TIER\}/g, metadata.tier)
      .replace(/\$\{VERIFY_RESULT\}/g, verifyLines.join('\n'))
      .replace(/\$\{ROLLBACK_PLAN\}/g, metadata.rollback_plan ?? '- none')
      .replace(/\$\{PROGRAM_STATUS_PATH\}/g, config.programStatusPath)
      .replace(/\$\{PRE_EXISTING_FAILURES\}/g, metadata.pre_existing_failures ?? '');
  }

  return body.trim();
}
