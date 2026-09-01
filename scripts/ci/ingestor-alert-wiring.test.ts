import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';

const WORKFLOW_PATH = path.join(
  process.cwd(),
  '.github',
  'workflows',
  'ingestor-staleness-alert.yml',
);

interface WorkflowStep {
  name?: string;
  env?: Record<string, string>;
}

interface WorkflowJob {
  steps?: WorkflowStep[];
}

interface Workflow {
  jobs?: Record<string, WorkflowJob>;
}

function loadWorkflow(): Workflow {
  const workflow = YAML.parse(readFileSync(WORKFLOW_PATH, 'utf8')) as Workflow;
  assert.ok(workflow && typeof workflow === 'object', 'workflow must parse as a YAML object');
  return workflow;
}

function runtimeEnv(workflow: Workflow, jobName: string, stepName: string): Record<string, string> {
  const job = workflow.jobs?.[jobName];
  assert.ok(job, `workflow job ${jobName} must exist`);

  const step = (job.steps ?? []).find((candidate) => candidate.name === stepName);
  assert.ok(step, `${jobName} must contain the ${stepName} step`);
  assert.ok(step.env, `${jobName}/${stepName} must declare an env mapping`);
  return step.env;
}

test('scheduled alert workflow gives each runtime step its required configuration', () => {
  const workflow = loadWorkflow();
  const requiredByJob = [
    {
      jobName: 'alerting-pass',
      stepName: 'Run one alerting pass',
    },
    {
      jobName: 'monitor',
      stepName: 'Check ingestion and alert-system freshness',
    },
  ];

  const requiredBindings = {
    SUPABASE_URL: '${{ secrets.SUPABASE_URL }}',
    SUPABASE_ANON_KEY: '${{ secrets.SUPABASE_ANON_KEY }}',
    SUPABASE_SERVICE_ROLE_KEY: '${{ secrets.SUPABASE_SERVICE_ROLE_KEY }}',
    UNIT_TALK_OPS_ALERT_WEBHOOK_URL: '${{ secrets.UNIT_TALK_OPS_ALERT_WEBHOOK_URL }}',
  };

  for (const { jobName, stepName } of requiredByJob) {
    const env = runtimeEnv(workflow, jobName, stepName);
    for (const [variable, expression] of Object.entries(requiredBindings)) {
      assert.strictEqual(
        env[variable],
        expression,
        `${jobName}/${stepName} must bind ${variable} to ${expression}`,
      );
    }
  }
});

test('scheduled alert workflow remains parked and canary-only', () => {
  const workflow = loadWorkflow();
  const alertingEnv = runtimeEnv(workflow, 'alerting-pass', 'Run one alerting pass');

  assert.strictEqual(alertingEnv.ALERT_MEMBER_CHANNELS_ENABLED, 'false');
  assert.strictEqual(alertingEnv.SYSTEM_PICKS_ENABLED, 'false');
});
