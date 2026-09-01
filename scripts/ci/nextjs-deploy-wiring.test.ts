/**
 * UTV2-1795 — the shared Next.js production deployment is wired, fails closed,
 * and never leaks a server-only credential.
 *
 * These assertions read the actual deployment artifacts. Each one names a
 * condition that would ship a real defect if it stopped holding:
 *
 *   - an image the deploy never builds (a promote that pulls nothing),
 *   - a hostname baked into the repository instead of a secret,
 *   - a Google/Auth.js credential handed to a container that does not need it
 *     (the public website, or the public TLS edge),
 *   - a deploy that proceeds with an empty capper allow-list, which admits
 *     nobody while every health check still passes,
 *   - the QA authentication bypass reaching production.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test } from 'node:test';
import { parse as parseYaml } from 'yaml';

const ROOT = process.cwd();
const DEPLOY_WORKFLOW_PATH = resolve(ROOT, '.github/workflows/deploy.yml');
const COMPOSE_PATH = resolve(ROOT, 'deploy/production/docker-compose.yml');
const CADDYFILE_PATH = resolve(ROOT, 'deploy/production/Caddyfile');
const DOCKERFILE_PATH = resolve(ROOT, 'deploy/production/Dockerfile.nextjs');

const workflowSource = readFileSync(DEPLOY_WORKFLOW_PATH, 'utf8');
/** Parsed YAML is untyped by nature; read it through narrowing helpers rather than `any`. */
const asRecord = (value: unknown): Record<string, unknown> => {
  assert.ok(value && typeof value === 'object' && !Array.isArray(value), 'expected an object');
  return value as Record<string, unknown>;
};
const field = (value: unknown, ...path: string[]): unknown =>
  path.reduce<unknown>((node, key) => (node == null ? undefined : asRecord(node)[key]), value);

const workflow = asRecord(parseYaml(workflowSource));
const compose = asRecord(parseYaml(readFileSync(COMPOSE_PATH, 'utf8')));
const caddyfile = readFileSync(CADDYFILE_PATH, 'utf8');
const dockerfile = readFileSync(DOCKERFILE_PATH, 'utf8');

const NEXTJS_SERVICES = ['web', 'smart-form'] as const;

/** Server-only values that must never reach a browser bundle or an extra container. */
const SERVER_ONLY_SECRETS = [
  'GOOGLE_CLIENT_SECRET',
  'NEXTAUTH_SECRET',
  'ALLOWED_CAPPER_EMAILS',
] as const;

function job(jobId: string): Record<string, unknown> {
  const found = field(workflow, 'jobs', jobId);
  assert.ok(found, `job ${jobId} must exist`);
  return asRecord(found);
}

function service(name: string): Record<string, unknown> {
  const found = field(compose, 'services', name);
  assert.ok(found, `compose must define ${name}`);
  return asRecord(found);
}

function step(jobId: string, name: string): Record<string, unknown> {
  const steps = job(jobId)['steps'];
  assert.ok(Array.isArray(steps), `job ${jobId} must have steps`);
  const found = steps.find((entry) => asRecord(entry)['name'] === name);
  assert.ok(found, `step "${name}" must exist in job ${jobId}`);
  return asRecord(found);
}

test('both Next.js apps are built and pushed by the deploy workflow', () => {
  const buildJob = job('build-nextjs');
  const included = field(buildJob, 'strategy', 'matrix', 'include') as Record<string, string>[];
  assert.ok(Array.isArray(included), 'build-nextjs must build from a matrix include list');
  assert.deepEqual(
    included.map((entry) => entry.service).sort(),
    [...NEXTJS_SERVICES].sort(),
    'build-nextjs must cover exactly the two Next.js services',
  );

  for (const entry of included) {
    assert.match(entry.app_dir, /^apps\/(web|smart-form)$/, 'app_dir must name a Next.js app');
    assert.match(entry.app_package, /^@unit-talk\//, 'app_package must be a workspace package');
    assert.match(entry.app_port, /^\d+$/, 'app_port must be a port number');
  }

  // Ports must be distinct, or the two containers collide behind one Caddy route.
  const ports = included.map((entry) => entry.app_port);
  assert.equal(new Set(ports).size, ports.length, 'each Next.js app must listen on its own port');

  const build = step('build-nextjs', 'Build and push image');
  assert.equal(
    field(build, 'with', 'file'),
    'deploy/production/Dockerfile.nextjs',
    'the Next.js build must use the shared deployment Dockerfile',
  );
  assert.equal(field(build, 'with', 'push'), true, 'the Next.js images must be pushed to the registry');

  // A promote that pulls an image nothing built fails on the server, not in CI.
  // `needs` is a string or a list, and promote depends on build-nextjs through
  // canary, so walk the graph rather than checking one hop.
  const dependsOn = (jobId: string): string[] => {
    const raw = field(workflow, 'jobs', jobId, 'needs');
    return raw === undefined ? [] : Array.isArray(raw) ? raw : [String(raw)];
  };
  const reaches = (from: string, target: string, seen = new Set<string>()): boolean => {
    if (seen.has(from)) return false;
    seen.add(from);
    return dependsOn(from).some((dep) => dep === target || reaches(dep, target, seen));
  };
  for (const jobId of ['canary', 'promote']) {
    assert.ok(reaches(jobId, 'build-nextjs'), `${jobId} must wait for build-nextjs`);
  }
});

test('deployment fails closed when required Next.js configuration is absent', () => {
  const required = [
    'CADDY_DOMAIN',
    'UNIT_TALK_WEB_DOMAIN',
    'UNIT_TALK_SMART_FORM_DOMAIN',
    'GOOGLE_CLIENT_ID',
    'GOOGLE_CLIENT_SECRET',
    'NEXTAUTH_SECRET',
    'ALLOWED_CAPPER_EMAILS',
  ];

  const inventory = step('verify', 'Validate production secret inventory');
  const inventoryScript = String(inventory['run']);
  for (const name of required) {
    assert.ok(
      inventoryScript.includes(`missing+=(${name})`),
      `the secret inventory must refuse a deploy that is missing ${name}`,
    );
    assert.ok(
      String(field(inventory, 'env', `SECRET_${name}`) ?? '').includes(`secrets.${name}`),
      `the secret inventory must read ${name} from repository secrets`,
    );
  }

  // The inventory runs before the whole build; re-check at the point of use.
  for (const jobId of ['canary', 'promote']) {
    const write = step(jobId, 'Write Next.js service env files to server');
    const script = String(write['run']);
    assert.match(
      script,
      /Refusing to write a partial Next\.js configuration/,
      `${jobId} must refuse to write a partial Next.js env file`,
    );
    assert.ok(
      script.includes('ALLOWED_CAPPER_EMAILS'),
      `${jobId} must treat an empty capper allow-list as a deploy failure`,
    );
  }
});

test('the QA authentication bypass never reaches production', () => {
  for (const jobId of ['canary', 'promote']) {
    const script = String(step(jobId, 'Write Next.js service env files to server')['run']);
    assert.doesNotMatch(
      script.replace(/^\s*#.*$/gm, '').replace(/SMART_FORM_QA_AUTH_BYPASS='?\)?/g, (m) => m),
      /^[^#\n]*(NEXT_PUBLIC_)?SMART_FORM_QA_AUTH_BYPASS=\$/m,
      `${jobId} must never write a QA bypass value into a production env file`,
    );
    assert.match(
      script,
      /A QA auth bypass variable reached the production Smart Form env file/,
      `${jobId} must assert the bypass is absent rather than assume it`,
    );
  }
});

test('server-only credentials reach only the container that needs them', () => {
  const smartForm = service('smart-form');
  const web = service('web');
  const caddy = service('caddy');

  assert.deepEqual(smartForm['env_file'], ['.env.smart-form'], 'smart-form reads its own env file');
  assert.deepEqual(web['env_file'], ['.env.web'], 'the public website reads its own env file');
  assert.deepEqual(caddy['env_file'], ['.env.edge'], 'the public edge reads hostnames only');

  // .env.production carries the Supabase service-role key, the Discord bot token
  // and the SGO keys. Nothing browser-facing may read it.
  for (const [name, svc] of Object.entries({ web, 'smart-form': smartForm, caddy })) {
    assert.ok(
      !((svc['env_file'] as string[] | undefined) ?? []).includes('.env.production'),
      `${name} must not read .env.production`,
    );
  }

  for (const jobId of ['canary', 'promote']) {
    const script = String(step(jobId, 'Write Next.js service env files to server')['run']);
    const webBlock = script.slice(script.indexOf('.env.web') - 600, script.indexOf('.env.web'));
    for (const secret of SERVER_ONLY_SECRETS) {
      assert.ok(
        !webBlock.includes(`${secret}=$`),
        `${jobId} must not write ${secret} into the public website env file`,
      );
    }
    // Anything inlined into a browser bundle must be non-secret by construction.
    const publicNames = [...script.matchAll(/"(NEXT_PUBLIC_[A-Z0-9_]+)=/g)].map((m) => m[1]);
    for (const name of publicNames) {
      assert.ok(
        !SERVER_ONLY_SECRETS.some((secret) => name.includes(secret)),
        `${name} would inline a server-only value into a browser bundle`,
      );
    }
  }

  // The image itself must carry no credential: build args land in image history.
  const build = step('build-nextjs', 'Build and push image');
  const buildArgs = String(field(build, 'with', 'build-args') ?? '');
  for (const secret of SERVER_ONLY_SECRETS) {
    assert.ok(!buildArgs.includes(secret), `${secret} must not be a build arg`);
  }
  assert.doesNotMatch(dockerfile, /secrets\./, 'the Dockerfile must not reference repository secrets');
});

test('Caddy routes every approved hostname from configuration, not from source', () => {
  const expected: Record<string, string> = {
    '{$CADDY_DOMAIN}': 'api:4000',
    '{$UNIT_TALK_WEB_DOMAIN}': 'web:4200',
    '{$UNIT_TALK_SMART_FORM_DOMAIN}': 'smart-form:4400',
  };
  for (const [site, upstream] of Object.entries(expected)) {
    const block = caddyfile.slice(caddyfile.indexOf(`${site} {`));
    assert.ok(caddyfile.includes(`${site} {`), `Caddyfile must serve ${site}`);
    assert.ok(
      block.slice(0, block.indexOf('\n}')).includes(`reverse_proxy ${upstream}`),
      `${site} must proxy to ${upstream}`,
    );
  }

  // A hostname committed to the repository is one that cannot be changed without
  // a code change, and one that leaks the production domain into every fork.
  const uncommented = caddyfile
    .split('\n')
    .filter((line) => !line.trim().startsWith('#'))
    .join('\n');
  assert.doesNotMatch(uncommented, /\b[a-z0-9-]+\.(com|net|io|app|dev)\b/, 'no literal hostname in the Caddyfile');
});

test('each Next.js surface is independently deployable and rollable', () => {
  for (const name of NEXTJS_SERVICES) {
    const svc = service(name);

    // Its own image, so a rollback replaces exactly one container.
    assert.match(
      String(svc['image']),
      new RegExp(`/${name}:\\$\\{UNIT_TALK_IMAGE_TAG`),
      `${name} must be pinned to its own tagged image`,
    );
    assert.ok(field(svc, 'healthcheck', 'test'), `${name} must have a health check`);
    assert.ok(
      field(svc, 'deploy', 'resources', 'limits', 'memory'),
      `${name} must declare a memory limit`,
    );
    assert.equal(svc['restart'], 'unless-stopped', `${name} must restart unless stopped`);

    // Neither Next.js app may depend on the other, or one rollback drags the other.
    const dependsOn = Object.keys((svc['depends_on'] as Record<string, unknown>) ?? {});
    for (const other of NEXTJS_SERVICES) {
      if (other !== name) {
        assert.ok(!dependsOn.includes(other), `${name} must not depend on ${other}`);
      }
    }

    // Internal only: the public edge is the sole ingress.
    assert.ok(!svc['ports'], `${name} must not publish a host port`);
  }

  const verify = step('promote', 'Verify Next.js surfaces are healthy');
  const script = String(verify['run']);
  for (const name of NEXTJS_SERVICES) {
    assert.ok(script.includes(name), `the promote health gate must cover ${name}`);
  }
  assert.match(script, /did not report healthy after promotion/, 'promote must fail on an unhealthy surface');
});

test('the shared image builds either app without an app-owned config change', () => {
  for (const arg of ['APP_DIR', 'APP_PACKAGE', 'APP_PORT']) {
    assert.ok(dockerfile.includes(`ARG ${arg}`), `the Dockerfile must accept ${arg}`);
  }
  // `next start` serves a normal build from either app. Requiring the standalone
  // server would force `output: 'standalone'` into apps/smart-form/next.config.js,
  // which this lane deliberately does not touch.
  assert.match(dockerfile, /next start/, 'the runtime stage must start the app with next start');
  assert.ok(
    dockerfile.includes('pnpm --filter "${APP_PACKAGE}..." build'),
    'the builder stage must build the selected package and its dependencies',
  );
});

const ENTRYPOINT_PATH = resolve(ROOT, 'deploy/production/nextjs-entrypoint.sh');
const entrypoint = readFileSync(ENTRYPOINT_PATH, 'utf8');
const BUILD_PLACEHOLDER = 'nextauth-build-only-placeholder-not-a-secret';

test('the build-time auth placeholder can never become the runtime secret', () => {
  // `next build` evaluates apps/smart-form's Auth.js route, and
  // apps/smart-form/lib/auth-config.ts throws in production without a secret, so
  // the builder stage must supply one. That value is published in this
  // repository; signing real sessions with it would be a silent auth defect.
  const [builderStage, runtimeStage] = dockerfile.split(/^FROM node:\$\{NODE_VERSION\}\s*$/m);
  assert.ok(runtimeStage, 'the Dockerfile must have a separate runtime stage');
  assert.ok(
    builderStage.includes(BUILD_PLACEHOLDER),
    'the builder stage must supply the build-time placeholder',
  );
  assert.ok(
    !runtimeStage.includes('ENV NEXTAUTH_SECRET'),
    'the runtime stage must not bake a NEXTAUTH_SECRET into the image',
  );
  assert.ok(
    entrypoint.includes(BUILD_PLACEHOLDER),
    'the entrypoint must know the placeholder in order to reject it',
  );
  assert.match(
    entrypoint,
    /NEXTAUTH_SECRET.*=.*BUILD_PLACEHOLDER[\s\S]{0,200}?exit 1/,
    'the entrypoint must refuse to start on the build-time placeholder',
  );
});

test('the intake container refuses to start on a configuration that admits nobody', () => {
  // Each of these would otherwise produce a container that passes its health
  // check while being unusable or unsafe.
  const refusals: Array<[string, RegExp]> = [
    ['NEXTAUTH_SECRET', /NEXTAUTH_SECRET is not set/],
    ['ALLOWED_CAPPER_EMAILS', /ALLOWED_CAPPER_EMAILS is empty/],
    ['GOOGLE_CLIENT_SECRET', /Google OAuth credentials are not configured/],
    ['NEXTAUTH_URL', /NEXTAUTH_URL is not set/],
  ];
  for (const [name, message] of refusals) {
    assert.match(entrypoint, message, `the entrypoint must refuse to start without ${name}`);
  }
  assert.match(entrypoint, /^set -eu$/m, 'the entrypoint must abort on an unset variable or a failed check');
  assert.ok(
    entrypoint.indexOf('exec pnpm exec next start') > entrypoint.lastIndexOf('exit 1'),
    'every refusal must be evaluated before the server starts',
  );

  // The public website has no auth configuration and must not be gated on it.
  assert.match(
    entrypoint,
    /if \[ "\$APP_DIR" = 'apps\/smart-form' \]/,
    'the auth refusals must be scoped to the intake surface',
  );
});

test('the public API origin is compiled into the browser bundle, not supplied at runtime', () => {
  // Next.js substitutes NEXT_PUBLIC_* during `next build`. apps/smart-form/lib/
  // api-client.ts and participant-search.ts both fall back to
  // http://127.0.0.1:4000, so an origin supplied only through the container
  // environment leaves production browsers calling the capper's own machine.
  const build = step('build-nextjs', 'Build and push image');
  const buildArgs = String(field(build, 'with', 'build-args') ?? '');
  assert.match(
    buildArgs,
    /NEXT_PUBLIC_API_BASE_URL=https:\/\/\$\{\{\s*secrets\.CADDY_DOMAIN\s*\}\}/,
    'the build must receive the public API origin derived from the configured API hostname',
  );
  assert.doesNotMatch(
    buildArgs,
    /127\.0\.0\.1|localhost/,
    'no local address may be compiled into a production bundle',
  );

  // The value must exist as a build stage variable before the app is compiled,
  // and an empty one must stop the build rather than silently ship the fallback.
  const argIndex = dockerfile.indexOf('ARG NEXT_PUBLIC_API_BASE_URL');
  const envIndex = dockerfile.indexOf('ENV NEXT_PUBLIC_API_BASE_URL=');
  const buildIndex = dockerfile.indexOf('pnpm --filter');
  assert.ok(argIndex >= 0 && envIndex > argIndex, 'the builder stage must declare and export the origin');
  assert.ok(envIndex < buildIndex, 'the origin must be exported before `next build` runs');
  assert.match(
    dockerfile,
    /test -n "\$\{NEXT_PUBLIC_API_BASE_URL\}"/,
    'an empty origin must fail the build',
  );

  // The workflow must refuse before it reaches the builder at all.
  const guard = String(step('build-nextjs', 'Require a public API origin at build time')['run']);
  assert.match(guard, /CADDY_DOMAIN/);
  assert.match(guard, /exit 1/, 'a missing API hostname must fail the build job');
});

test('the API verifies exactly the capper token Smart Form signs', async () => {
  // apps/smart-form/auth.ts signs the session bearer with NEXTAUTH_SECRET;
  // apps/api/src/auth.ts verifies capper JWTs with UNIT_TALK_JWT_SECRET. If the
  // deploy provisions the first without the second, every authenticated
  // submission is a 401 while every health check still passes.
  for (const jobId of ['canary', 'promote']) {
    const script = String(step(jobId, 'Write .env.production to server')['run']);
    assert.match(
      script,
      /"UNIT_TALK_JWT_SECRET=\$NEXTAUTH_SECRET"/,
      `${jobId} must give the API the same key Smart Form signs with`,
    );
    assert.match(
      script,
      /if \[ -z "\$\{NEXTAUTH_SECRET:-\}" \]/,
      `${jobId} must refuse to write a half-configured environment`,
    );
    const env = asRecord(field(job(jobId), 'steps') ? step(jobId, 'Write .env.production to server')['env'] : {});
    assert.ok('NEXTAUTH_SECRET' in env, `${jobId} must bind NEXTAUTH_SECRET for the API env file`);
  }

  // Executed control: a token this signer produces validates through the API's
  // verifier under the same key, and is refused under any other key.
  const { createCapperSessionToken } = await import('../../apps/smart-form/lib/auth-session-token.ts');
  const { validateCapperToken } = await import('../../apps/api/src/auth.ts');

  const sharedKey = 'utv2-1795-shared-capper-signing-key-not-a-real-secret';
  const otherKey = 'utv2-1795-a-different-key-entirely';
  const token = createCapperSessionToken(
    { sub: 'capper-1795', capperId: 'capper-1795', displayName: 'Pilot Capper', email: 'pilot@example.com' },
    sharedKey,
  );

  const accepted = await validateCapperToken(token, sharedKey);
  assert.ok(accepted, 'the API must accept a token signed with the shared key');
  assert.equal(accepted?.role, 'capper');

  const refused = await validateCapperToken(token, otherKey);
  assert.equal(refused, null, 'the API must refuse a token signed with any other key');
});
