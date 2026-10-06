import assert from 'node:assert/strict';
import test from 'node:test';
import {
  readFileSync,
  mkdtempSync,
  mkdirSync,
  readdirSync,
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
const preflight = workflow.jobs['verify']!.steps.find(
  (step) => step.name === 'Validate production Discord guild identity',
)!;
const remoteBody = registration.run!.match(
  /<<'DISCORD_COMMANDS_REMOTE'\n([\s\S]*?)\nDISCORD_COMMANDS_REMOTE/,
)?.[1];

function createRemoteHarness() {
  assert.ok(remoteBody);
  const dir = mkdtempSync(join(tmpdir(), 'ut-discord-registration-'));
  mkdirSync(join(dir, 'bin'));
  const log = join(dir, 'docker.log');
  const overrideCapture = join(dir, 'registration-override.yml');
  const docker = join(dir, 'bin', 'docker');
  writeFileSync(
    docker,
    `#!/bin/bash
printf '%s\n' "$*" >> "$DOCKER_LOG"
if [ "$1" = inspect ]; then
  echo "$DOCKER_IMAGE"
  exit 0
fi
if [[ " $* " = *" ps -q discord-bot "* ]]; then
  echo bot-container
  exit 0
fi
if [[ " $* " = *" run --rm --no-deps -T discord-bot "* ]]; then
  args=("$@")
  for ((i=0; i < \${#args[@]}; i++)); do
    if [ "\${args[$i]}" = -f ] && [[ "\${args[$((i + 1))]}" = *'.discord-registration.'* ]]; then
      cp "\${args[$((i + 1))]}" "$DOCKER_OVERRIDE_CAPTURE"
    fi
  done
  printf '%s\n' "$UNIT_TALK_IMAGE_TAG" > "$DOCKER_TAG_LOG"
  exit "$DOCKER_STATUS"
fi
exit 99
`,
  );
  chmodSync(docker, 0o755);
  writeFileSync(join(dir, '.unit-talk-release'), 'reviewed-sha\n');

  return {
    dir,
    log,
    overrideCapture,
    run: (
      tag: string,
      status: string,
      image = 'test/discord-bot:reviewed-sha',
    ) =>
      spawnSync('bash', ['-s', '--', dir, tag, 'test'], {
        input: remoteBody,
        encoding: 'utf8',
        env: {
          ...process.env,
          PATH: `${join(dir, 'bin')}:${process.env.PATH}`,
          DOCKER_LOG: log,
          DOCKER_OVERRIDE_CAPTURE: overrideCapture,
          DOCKER_STATUS: status,
          DOCKER_IMAGE: image,
          DOCKER_TAG_LOG: join(dir, 'image-tag.log'),
        },
      }),
    registrationTemps: () =>
      readdirSync(dir).filter((file) =>
        file.startsWith('.discord-registration.'),
      ),
  };
}

function runPreflight(guildId: string | undefined) {
  const env = { ...process.env };
  if (guildId === undefined) delete env.DISCORD_GUILD_ID;
  else env.DISCORD_GUILD_ID = guildId;
  return spawnSync('bash', ['-e', '-o', 'pipefail', '-c', preflight.run!], {
    encoding: 'utf8',
    env,
  });
}

test('early preflight accepts a valid production guild snowflake', () => {
  assert.ok(preflight);
  assert.equal(runPreflight('1284478946171293736').status, 0);
  assert.equal(runPreflight('18446744073709551615').status, 0);
});

test('early preflight refuses missing and malformed guild IDs before deployment mutation', () => {
  const missing = runPreflight(undefined);
  assert.notEqual(missing.status, 0);
  assert.match(missing.stdout, /DISCORD_GUILD_ID/);

  for (const guildId of [
    '0',
    '00000000000000000',
    '99999999999999999999',
    '18446744073709551616',
    'not-a-snowflake',
    ' 1284478946171293736 ',
  ]) {
    const invalid = runPreflight(guildId);
    assert.notEqual(invalid.status, 0);
    assert.match(
      invalid.stdout,
      /valid nonzero unsigned 64-bit Discord snowflake/,
    );
    if (guildId !== '0')
      assert.equal(
        `${invalid.stdout}${invalid.stderr}`.includes(guildId),
        false,
      );
  }

  assert.doesNotMatch(preflight.run!, /ssh|docker|scp|rsync|deploy-commands/);
  assert.deepEqual(workflow.jobs['canary']!.needs, [
    'build',
    'build-nextjs',
    'verify',
  ]);
  assert.equal(workflow.jobs['promote']!.needs, 'canary');
});

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

test('remote step isolates registration in a bounded disposable production-config container', () => {
  const harness = createRemoteHarness();
  try {
    assert.equal(harness.run('reviewed-sha', '0').status, 0);
    const dockerLog = readFileSync(harness.log, 'utf8');
    assert.match(
      dockerLog,
      /compose -f docker-compose\.yml -f .*\.discord-registration\..*\.yml run --rm --no-deps -T discord-bot/,
    );
    assert.doesNotMatch(
      dockerLog,
      /compose exec|compose up|compose restart|--service-ports|--publish/,
    );
    assert.equal(
      readFileSync(join(harness.dir, 'image-tag.log'), 'utf8').trim(),
      'reviewed-sha',
    );
    const override = parse(readFileSync(harness.overrideCapture, 'utf8')) as {
      services: {
        'discord-bot': {
          mem_limit: string;
          deploy: { resources: { limits: { memory: string } } };
          entrypoint: string[];
          command: string[];
        };
      };
    };
    assert.equal(override.services['discord-bot'].mem_limit, '256m');
    assert.equal(
      override.services['discord-bot'].deploy.resources.limits.memory,
      '256m',
    );
    assert.deepEqual(override.services['discord-bot'].entrypoint, [
      '/repo/node_modules/.bin/tsx',
      '/repo/apps/discord-bot/scripts/deploy-commands.ts',
    ]);
    assert.deepEqual(override.services['discord-bot'].command, []);
    assert.deepEqual(harness.registrationTemps(), []);
  } finally {
    rmSync(harness.dir, { recursive: true, force: true });
  }
});

test('registration failures propagate exactly and clean up the temporary override', () => {
  const harness = createRemoteHarness();
  try {
    assert.equal(harness.run('reviewed-sha', '17').status, 17);
    assert.deepEqual(harness.registrationTemps(), []);
  } finally {
    rmSync(harness.dir, { recursive: true, force: true });
  }
});

test('stale release or live bot image refuses registration before a one-off container starts', () => {
  const harness = createRemoteHarness();
  try {
    assert.notEqual(harness.run('other-sha', '0').status, 0);
    assert.throws(
      () => readFileSync(harness.overrideCapture),
      'mismatched release must not execute registration',
    );
    assert.notEqual(
      harness.run('reviewed-sha', '0', 'test/discord-bot:old-sha').status,
      0,
    );
    assert.throws(
      () => readFileSync(harness.overrideCapture),
      'stale bot image must not register commands',
    );
    assert.doesNotMatch(
      remoteBody!,
      /kill.switch|receipt|submit|restart|up -d|applicationCommands/,
    );
    assert.deepEqual(harness.registrationTemps(), []);
  } finally {
    rmSync(harness.dir, { recursive: true, force: true });
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
