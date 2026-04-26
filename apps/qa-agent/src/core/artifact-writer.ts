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
    `Duration:    ${r.durationMs}ms`,
    '```',
    '',
    '## Steps',
    '',
    stepsBlock,
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

  if (r.screenshots.length > 0) {
    sections.push('', '## Screenshots', '');
    sections.push(...r.screenshots.map((s) => `- \`${s}\``));
  }

  if (r.videoPath) sections.push('', '## Video', '', `\`${r.videoPath}\``);
  if (r.tracePath) sections.push('', '## Trace', '', `\`${r.tracePath}\``);

  return sections.join('\n') + '\n';
}
