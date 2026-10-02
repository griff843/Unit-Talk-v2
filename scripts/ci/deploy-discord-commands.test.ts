import assert from 'node:assert/strict';
import test from 'node:test';
import {
  readFileSync,
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  chmodSync,
  rmSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { parse } from 'yaml';

type Step = {
  name?: string;
  run?: string;
  shell?: string;
  env?: Record<string, string>;
  if?: string;
  'continue-on-error'?: boolean;
};
const workflow = parse(
  readFileSync('.github/workflows/deploy.yml', 'utf8'),
) as {
  jobs: Record<string, { steps: Step[]; needs?: string | string[] }>;
};
const name = 'Register and verify production Discord guild commands';
const steps = workflow.jobs['promote']!.steps;
const registration = steps.find((step) => step.name === name)!;

test('only promoted production runs registration; failure blocks smoke and deployment success', () => {
  assert.ok(registration);
  assert.equal(registration.shell, 'bash');
  assert.equal(registration.if, undefined);
  assert.notEqual(registration['continue-on-error'], true);
  assert.equal(workflow.jobs['smoke']!.needs, 'promote');
  assert.ok(
    steps.indexOf(registration) >
      steps.findIndex((step) =>
        step.run?.includes('syndicate_machine_mode.confirmed'),
      ),
  );
  assert.ok(
    steps.indexOf(registration) <
      steps.findIndex(
        (step) => step.name === 'Reclaim superseded release images',
      ),
  );
  for (const [job, value] of Object.entries(workflow.jobs)) {
    if (job !== 'promote')
      assert.ok(!value.steps.some((step) => step.name === name));
  }
  assert.equal(
    registration.env?.['IMAGE_TAG'],
    '${{ inputs.image_tag || github.sha }}',
  );
  assert.match(registration.run!, /set -euo pipefail/);
  assert.doesNotMatch(
    registration.run!,
    /continue-on-error|\|\| true|printenv|set -x/,
  );
});

test('remote step uses promoted release script, refuses a mismatched release and propagates registration failures', () => {
  const body = registration.run!.match(
    /<<'DISCORD_COMMANDS_REMOTE'\n([\s\S]*?)\nDISCORD_COMMANDS_REMOTE/,
  )?.[1];
  assert.ok(body);
  const dir = mkdtempSync(join(tmpdir(), 'ut-discord-registration-'));
  try {
    mkdirSync(join(dir, 'bin'));
    const log = join(dir, 'docker.log');
    const docker = join(dir, 'bin', 'docker');
    writeFileSync(
      docker,
      '#!/bin/bash\nif [ "$1" = inspect ]; then echo "$DOCKER_IMAGE"; exit 0; fi\n' +
        'if [ "$2" = ps ]; then echo bot-container; exit 0; fi\n' +
        'printf "%s\\n" "$*" > "$DOCKER_LOG"\nexit "$DOCKER_STATUS"\n',
    );
    chmodSync(docker, 0o755);
    writeFileSync(join(dir, '.unit-talk-release'), 'reviewed-sha\n');
    const run = (
      tag: string,
      status: string,
      image = 'test/discord-bot:reviewed-sha',
    ) =>
      spawnSync('bash', ['-s', '--', dir, tag, 'test'], {
        input: body,
        encoding: 'utf8',
        env: {
          ...process.env,
          PATH: `${join(dir, 'bin')}:${process.env.PATH}`,
          DOCKER_LOG: log,
          DOCKER_STATUS: status,
          DOCKER_IMAGE: image,
        },
      });
    assert.equal(run('reviewed-sha', '0').status, 0);
    assert.equal(
      readFileSync(log, 'utf8').trim(),
      'compose exec -T discord-bot /repo/node_modules/.bin/tsx /repo/apps/discord-bot/scripts/deploy-commands.ts',
    );
    assert.equal(run('reviewed-sha', '17').status, 17);
    rmSync(log);
    assert.notEqual(run('other-sha', '0').status, 0);
    assert.throws(
      () => readFileSync(log),
      'mismatched release must not execute registration',
    );
    assert.notEqual(
      run('reviewed-sha', '0', 'test/discord-bot:old-sha').status,
      0,
    );
    assert.throws(
      () => readFileSync(log),
      'stale bot image must not register commands',
    );
    assert.doesNotMatch(
      body,
      /kill.switch|receipt|submit|restart|up -d|applicationCommands/,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('both focused regression files run in required package test gates', () => {
  const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as {
    scripts: Record<string, string>;
  };
  assert.ok(
    pkg.scripts['test:apps-rest']!.includes(
      'apps/discord-bot/scripts/deploy-commands.test.ts',
    ),
  );
  assert.ok(
    pkg.scripts['test:ops']!.includes(
      'scripts/ci/deploy-discord-commands.test.ts',
    ),
  );
});
