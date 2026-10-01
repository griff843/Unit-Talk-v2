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

test('ops:brief --static is a local-only compact snapshot with no external/live sections', () => {
  const result = spawnSync(
    TSX,
    [path.join(ROOT, 'scripts', 'ops-brief.ts'), '--static', '--json'],
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
    ['Overview', 'Codex Lanes', 'Static Mode'],
  );
  assert.match(payload.recommendation.join('\n'), /local static snapshot only/);
  const staticMode = payload.sections[2]!.lines.join('\n');
  for (const skipped of ['Linear', 'GitHub', 'runtime', 'pipeline', 'product truth', 'DB/live']) {
    assert.match(staticMode, new RegExp(skipped, 'iu'));
  }
  for (const forbiddenSection of ['Linear', 'GitHub', 'Pipeline', 'Product Truth', 'Proof', 'Closeout']) {
    assert.ok(
      !payload.sections.some((section) => section.name === forbiddenSection),
      `--static must not build ${forbiddenSection}`,
    );
  }
});

test('ops:brief --agent remains a compatibility alias for static mode', () => {
  const result = spawnSync(
    TSX,
    [path.join(ROOT, 'scripts', 'ops-brief.ts'), '--agent', '--json'],
    { cwd: ROOT, encoding: 'utf8' },
  );

  assert.strictEqual(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout) as { sections: Array<{ name: string }> };
  assert.deepStrictEqual(
    payload.sections.map((section) => section.name),
    ['Overview', 'Codex Lanes', 'Static Mode'],
  );
});
