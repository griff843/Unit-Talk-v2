import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import test from 'node:test';

const ROOT = process.cwd();
const TSX = path.join(
  ROOT,
  'node_modules',
  '.bin',
  process.platform === 'win32' ? 'tsx.cmd' : 'tsx',
);

test('ops:brief --agent is a local-only compact snapshot', () => {
  const result = spawnSync(
    TSX,
    [path.join(ROOT, 'scripts', 'ops-brief.ts'), '--agent', '--json'],
    {
      cwd: ROOT,
      encoding: 'utf8',
      env: {
        ...process.env,
        LINEAR_API_TOKEN: '',
        SUPABASE_URL: '',
        SUPABASE_SERVICE_ROLE_KEY: '',
      },
    },
  );

  assert.strictEqual(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout) as {
    recommendation: string[];
    sections: Array<{ name: string; lines: string[] }>;
  };
  assert.deepStrictEqual(
    payload.sections.map((section) => section.name),
    ['Overview', 'Codex Lanes', 'Agent Mode'],
  );
  assert.match(payload.recommendation.join('\n'), /local agent snapshot only/);
  assert.match(
    payload.sections[2]!.lines.join('\n'),
    /external checks skipped/,
  );
});
