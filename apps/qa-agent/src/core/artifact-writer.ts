import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { QAResult } from './types.js';

const STATUS_ICON: Record<string, string> = {
  PASS: '[PASS]',
  FAIL: '[FAIL]',
  NEEDS_REVIEW: '[REVIEW]',
  SKIP: '[SKIP]',
  ERROR: '[ERROR]',
};

export async function writeArtifact(result: QAResult, runDir: string): Promise<{ json: string; md: string }> {
  await mkdir(runDir, { recursive: true });

  const jsonPath = join(runDir, 'qa_result.json');
  const mdPath = join(runDir, 'qa_result.md');

  await writeFile(jsonPath, JSON.stringify(result, null, 2), 'utf-8');
  await writeFile(mdPath, renderMarkdown(result), 'utf-8');

  return { json: jsonPath, md: mdPath };
}

function renderMarkdown(r: QAResult): string {
  const icon = STATUS_ICON[r.status] ?? r.status;

  const stepsBlock = r.steps
    .map((s, i) => {
      const bullet = s.status === 'pass' ? '✓' : s.status === 'fail' ? '✗' : '–';
      const detail = s.detail ? `\n   > ${s.detail}` : '';
      return `${i + 1}. ${bullet} ${s.step}${detail}`;
    })
    .join('\n');

  const sections: string[] = [
    `# QA Result`,
    '',
    '```',
    `schema:      experience-qa/v1`,
    `Product:     ${r.product}`,
    `Surface:     ${r.surface}`,
    `Persona:     ${r.persona}`,
    `Flow:        ${r.flow}`,
    `Environment: ${r.environment}`,
    `Head SHA:    ${r.headSha}`,
    `Timestamp:   ${r.timestamp}`,
    `Mode:        ${r.mode}`,
    `Status:      ${icon}${r.severity ? ` (${r.severity})` : ''}`,
    `Verdict:     ${r.verdictReason}`,
    `Duration:    ${r.durationMs}ms`,
    '```',
    '',
    '## Preflight Results',
    '',
    r.preflightResults.length === 0
      ? '- None'
      : r.preflightResults.map((p) => `- ${p.status.toUpperCase()} ${p.id}: ${p.message}`).join('\n'),
    '',
    '## Step Results',
    '',
    stepsBlock,
    '',
    '## Observations',
    '',
    r.observations.length === 0 ? '- None' : r.observations.map((item) => `- ${item}`).join('\n'),
    '',
    '## Expectation Results',
    '',
    r.expectationResults.length === 0
      ? '- None'
      : r.expectationResults.map((item) => (
        `- ${item.status.toUpperCase()} ${item.id} (${item.severity}): ${item.message}`
      )).join('\n'),
    '',
    '## Final Verdict',
    '',
    `${r.status}: ${r.verdictReason}`,
  ];

  if (r.consoleErrors.length > 0) {
    sections.push('', '## Console Errors', '');
    sections.push(...r.consoleErrors.map((e) => `- \`${e}\``));
  }

  if (r.networkErrors.length > 0) {
    sections.push('', '## Network Errors', '');
    sections.push(...r.networkErrors.map((e) => `- \`${e}\``));
  }

  if (r.uxFriction.length > 0) {
    sections.push('', '## UX Friction', '');
    sections.push(...r.uxFriction.map((e) => `- ${e}`));
  }

  if (r.regressionRecommendations && r.regressionRecommendations.length > 0) {
    sections.push('', '## Regression Recommendations', '');
    sections.push(...r.regressionRecommendations.map((e) => `- ${e}`));
  }

  if (r.screenshots.length > 0) {
    sections.push('', '## Screenshots', '');
    sections.push(...r.screenshots.map((s) => `- \`${s}\``));
  }

  if (r.videoPath) sections.push('', '## Video', '', `\`${r.videoPath}\``);
  if (r.tracePath) sections.push('', '## Trace', '', `\`${r.tracePath}\``);

  return sections.join('\n') + '\n';
}
