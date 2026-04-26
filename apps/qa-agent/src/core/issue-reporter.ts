import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { QAResult, IssueRecommendation } from './types.js';

/**
 * Writes an issue-ready markdown report when a QA run fails or needs review.
 * Returns the path written, or undefined if the result was a clean PASS.
 */
export async function writeIssueReport(result: QAResult, runDir: string): Promise<string | undefined> {
  if (result.status === 'PASS' && !result.issueRecommendation) return undefined;

  const recommendation = result.issueRecommendation ?? deriveIssue(result);

  // Merge runner-captured screenshots into recommendation if skill left them empty
  if (recommendation.screenshotPaths.length === 0 && result.screenshots.length > 0) {
    recommendation.screenshotPaths = result.screenshots;
  }

  const issuePath = join(runDir, 'issue_report.md');
  await writeFile(issuePath, renderIssue(result, recommendation), 'utf-8');
  return issuePath;
}

function deriveIssue(result: QAResult): IssueRecommendation {
  const failedSteps = result.steps.filter((s) => s.status === 'fail');
  const isNeedsReview = result.status === 'NEEDS_REVIEW';

  const actualBehaviorParts: string[] = [];
  if (failedSteps.length > 0) {
    actualBehaviorParts.push(failedSteps.map((s) => s.detail ?? s.step).join('; '));
  }
  if (result.uxFriction.length > 0) {
    actualBehaviorParts.push(...result.uxFriction);
  }
  if (result.consoleErrors.length > 0) {
    actualBehaviorParts.push(`Console errors: ${result.consoleErrors.slice(0, 3).map(e => e.split('\n')[0]).join('; ')}`);
  }

  const titleSuffix = isNeedsReview ? 'needs review' : 'fails';
  const severityLabel = result.severity ?? (isNeedsReview ? 'low' : 'medium');

  return {
    title: `[QA] ${result.surface}: ${result.flow} ${titleSuffix} for persona '${result.persona}'`,
    severity: severityLabel,
    product: result.product,
    surface: result.surface,
    description: [
      `Automated QA detected a **${result.status}** in the **${result.flow}** flow`,
      `on **${result.surface}** for persona **${result.persona}**.`,
      result.uxFriction.length > 0
        ? `\n\nUX issues found:\n${result.uxFriction.map((f) => `- ${f}`).join('\n')}`
        : '',
      failedSteps.length > 0
        ? `\n\nFailed at step: "${failedSteps[0]?.step ?? 'unknown'}".`
        : '',
    ]
      .filter(Boolean)
      .join(' '),
    stepsToReproduce: [
      `Environment: ${result.environment} (${result.headSha})`,
      `Persona: ${result.persona}`,
      ...(failedSteps.length > 0
        ? failedSteps.map((s) => s.step)
        : [`Run: pnpm qa:experience --surface ${result.surface} --persona ${result.persona} --flow ${result.flow}`]),
    ],
    expectedBehavior: `${result.flow} flow completes without UX friction or errors for persona ${result.persona}`,
    actualBehavior: actualBehaviorParts.join('\n') || `Status: ${result.status}`,
    screenshotPaths: result.screenshots,
    labels: [
      'qa-agent',
      result.product,
      result.surface,
      `severity-${severityLabel}`,
      ...(isNeedsReview ? ['needs-review'] : []),
    ],
  };
}

function renderIssue(result: QAResult, issue: IssueRecommendation): string {
  const failedExpectations = result.expectationResults.filter((item) => item.status === 'failed');
  const lines: string[] = [
    `# ${issue.title}`,
    '',
    '## Summary',
    '',
    `${result.surface}/${result.flow} as ${result.persona} finished with ${result.status}.`,
    '',
    '## Final Verdict',
    '',
    `${result.status}: ${result.verdictReason}`,
    '',
    `**Severity:** ${issue.severity}`,
    `**Product:** ${issue.product}`,
    `**Surface:** ${issue.surface}`,
    `**Labels:** ${issue.labels.join(', ')}`,
    '',
    '---',
    '',
    '## Description',
    '',
    issue.description,
    '',
    '## Steps to Reproduce',
    '',
    ...issue.stepsToReproduce.map((s, i) => `${i + 1}. ${s}`),
    '',
    '## Expected Behavior',
    '',
    issue.expectedBehavior,
    '',
    '## Actual Behavior',
    '',
    issue.actualBehavior,
    '',
    '## Preflight Results',
    '',
    ...(result.preflightResults.length > 0
      ? result.preflightResults.map((p) => `- ${p.status.toUpperCase()} ${p.id}: ${p.message}`)
      : ['- None']),
    '',
    '## Failed Expectations',
    '',
    ...(failedExpectations.length > 0
      ? failedExpectations.map((item) => `- ${item.id} (${item.severity}): ${item.message}`)
      : ['- None']),
    '',
    '## QA Run Context',
    '',
    `- Run ID: \`${result.runId}\``,
    `- SHA: \`${result.headSha}\``,
    `- Timestamp: ${result.timestamp}`,
    `- Persona: ${result.persona}`,
    `- Environment: ${result.environment}`,
    `- Mode: ${result.mode}`,
  ];

  if (result.consoleErrors.length > 0) {
    lines.push('', '## Console Errors', '');
    const deduped = [...new Set(result.consoleErrors.map((e) => e.split('\n')[0]))].slice(0, 8);
    lines.push(...deduped.map((e) => `- \`${e}\``));
    if (result.consoleErrors.length > deduped.length) {
      lines.push(`- _...and ${result.consoleErrors.length - deduped.length} more (see qa_result.json)_`);
    }
  }

  if (result.networkErrors.length > 0) {
    lines.push('', '## Network Errors', '');
    lines.push(...result.networkErrors.slice(0, 5).map((e) => `- \`${e}\``));
    if (result.networkErrors.length > 5) {
      lines.push(`- _...and ${result.networkErrors.length - 5} more (see qa_result.json)_`);
    }
  }

  lines.push('', '## Trace', '');
  lines.push(result.tracePath ? `- \`${result.tracePath}\`` : '- None captured');

  lines.push('', '## Video', '');
  lines.push(result.videoPath ? `- \`${result.videoPath}\`` : '- None captured');

  lines.push('', '## Recommended Fix', '');
  lines.push(recommendedFix(result));

  lines.push('', '## Reproduction Command', '');
  lines.push(`\`pnpm qa:experience --surface ${result.surface} --persona ${result.persona} --flow ${result.flow} --env ${result.environment}\``);

  lines.push('', '## Screenshots', '');
  if (issue.screenshotPaths.length > 0) {
    lines.push(...issue.screenshotPaths.map((p) => `- \`${p}\``));
  } else {
    lines.push('_No screenshots captured_');
  }

  lines.push('', '---', '', `_Generated by Experience QA Agent · ${result.timestamp}_`);

  return lines.join('\n') + '\n';
}

function recommendedFix(result: QAResult): string {
  const failedIds = new Set(result.expectationResults.filter((item) => item.status === 'failed').map((item) => item.id));
  const hasSessionFailure = failedIds.has('smart_form_session_no_500') ||
    result.networkErrors.some((item) => item.includes('/api/auth/session'));
  const hasLoginRedirect = failedIds.has('smart_form_no_login_redirect_before_form');
  if (result.surface === 'smart_form' && (hasSessionFailure || hasLoginRedirect)) {
    return 'Check AUTH_SECRET / NEXTAUTH_SECRET in local.env and NextAuth config. The form controls did not render because auth redirected before the form mounted.';
  }

  const hasBrokenLifecycle = failedIds.has('command_center_no_broken_lifecycle_signals');
  const hasOperatorPreflightFailure = result.preflightResults.some((item) => (
    item.status === 'failed' && item.id.startsWith('operator_')
  ));
  if (result.surface === 'command_center' && (hasBrokenLifecycle || hasOperatorPreflightFailure)) {
    return 'UI shell rendered, but backend lifecycle/API signals were unavailable. Classify as dependency/backend failure rather than frontend render failure.';
  }

  return result.regressionRecommendations?.[0] ?? result.regressionRecommendation ?? 'Inspect failed preflights, expectations, network errors, and screenshots.';
}
