import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';

const workflowPath = path.join(process.cwd(), '.github', 'workflows', 'track-a-monitor.yml');

interface Workflow {
  on?: { schedule?: Array<{ cron?: string }>; workflow_dispatch?: unknown };
  permissions?: Record<string, string>;
  jobs?: { monitor?: { steps?: Array<Record<string, unknown>> } };
}

function load(): { text: string; wf: Workflow } {
  const text = fs.readFileSync(workflowPath, 'utf8');
  return { text, wf: YAML.parse(text) as Workflow };
}

test('runs on a 6-hour schedule and supports manual dispatch', () => {
  const { wf } = load();
  const crons = (wf.on?.schedule ?? []).map((s) => s.cron);
  assert.ok(crons.includes('23 */6 * * *'), `expected every-6h cron, got ${JSON.stringify(crons)}`);
  // workflow_dispatch present (YAML parses bare `workflow_dispatch:` to null).
  assert.ok(wf.on !== undefined && 'workflow_dispatch' in (wf.on as object));
});

test('runs the read-only monitor script and writes the snapshot artifact', () => {
  const { wf } = load();
  const steps = wf.jobs?.monitor?.steps ?? [];
  const runStep = steps.find((s) => String(s.name).includes('Run Track A monitor'));
  assert.ok(runStep, 'monitor run step must exist');
  assert.match(String(runStep?.run ?? ''), /scripts\/ops\/track-a-monitor\.ts/);
  assert.match(String(runStep?.run ?? ''), /--output-json artifacts\/track-a-monitor\.json/);

  const upload = steps.find((s) => String(s.name).includes('Upload monitor snapshot'));
  assert.ok(upload, 'artifact upload step must exist');
  assert.match(
    String((upload?.with as Record<string, unknown> | undefined)?.path ?? ''),
    /artifacts\/track-a-monitor\.json/,
  );
});

test('secrets are passed as env, never echoed', () => {
  const { text, wf } = load();
  const steps = wf.jobs?.monitor?.steps ?? [];
  const runStep = steps.find((s) => String(s.name).includes('Run Track A monitor'));
  const env = (runStep?.env as Record<string, string> | undefined) ?? {};
  assert.match(env.SUPABASE_URL ?? '', /secrets\.SUPABASE_URL/);
  assert.match(env.SUPABASE_SERVICE_ROLE_KEY ?? '', /secrets\.SUPABASE_SERVICE_ROLE_KEY/);
  assert.match(env.LINEAR_API_TOKEN ?? '', /secrets\.LINEAR_API_TOKEN/);

  // No step echoes/prints a secret value.
  assert.doesNotMatch(text, /echo[^\n]*secrets\./i);
  assert.doesNotMatch(text, /echo[^\n]*\$\{?\s*(SUPABASE_SERVICE_ROLE_KEY|LINEAR_API_TOKEN)/);
});

test('workflow holds least-privilege read-only permissions', () => {
  const { wf } = load();
  assert.equal(wf.permissions?.contents, 'read');
});
