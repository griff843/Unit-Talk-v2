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

/**
 * Always-on, publicly-routed Next.js surfaces. Every assertion keyed on this
 * list is about a service the edge serves to the internet on every deploy.
 */
const NEXTJS_SERVICES = ['web', 'smart-form'] as const;

/**
 * UTV2-1918. Profiled, default-off, internal-only surfaces. Deliberately a
 * SEPARATE list rather than an extra entry in the one above: several of those
 * assertions are false for this service on purpose — it publishes a host port
 * (loopback only) and it has no Caddy route at all — and folding it in would
 * have forced those assertions to be weakened for the services they exist to
 * protect. A property that differs gets its own assertion, never a looser
 * shared one.
 */
const OPTIONAL_NEXTJS_SERVICES = ['command-center'] as const;
const ALL_NEXTJS_SERVICES = [...NEXTJS_SERVICES, ...OPTIONAL_NEXTJS_SERVICES] as const;

/** The repository variable that is the single enable switch for the profiled surfaces. */
const CC_ENABLE_GUARD = 'if [ "${CC_ENABLED:-}" = \'true\' ]';

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

test('every Next.js app is built and pushed by the deploy workflow', () => {
  const buildJob = job('build-nextjs');
  const included = field(buildJob, 'strategy', 'matrix', 'include') as Record<string, string>[];
  assert.ok(Array.isArray(included), 'build-nextjs must build from a matrix include list');
  assert.deepEqual(
    included.map((entry) => entry.service).sort(),
    [...ALL_NEXTJS_SERVICES].sort(),
    'build-nextjs must cover exactly the Next.js services this repository deploys',
  );

  // UTV2-1918: the profiled surface is built UNCONDITIONALLY alongside the other
  // two. Building an image starts nothing — the compose profile decides that —
  // whereas a conditional build would leave the first deploy after enabling the
  // surface with no image to pull, and the registry preflight would refuse it.
  for (const entry of included) {
    assert.ok(
      (ALL_NEXTJS_SERVICES as readonly string[]).includes(entry.service),
      `${entry.service} is built but is not a declared Next.js service`,
    );
    assert.equal(entry.app_dir, `apps/${entry.service}`, 'app_dir must name its own app directory');
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

/**
 * UTV2-1798.
 *
 * Parse the env files the deploy actually writes, rather than searching the
 * whole step script for a string. Each file is produced by one
 * `printf '%s\n' "KEY=VALUE" ... | ssh ... "cat > '$DEPLOY_PATH/<name>'"`
 * pipeline, so the pipeline boundary is what decides which file a key lands in.
 * A substring search over the step cannot tell `.env.smart-form` from
 * `.env.web` — and telling them apart is the whole point of these assertions.
 */
function envFileWrites(jobId: string, stepName: string): Map<string, string[]> {
  const script = String(step(jobId, stepName)['run']);
  const pipeline = /printf '%s\\n' \\\n([\s\S]*?)\| ssh[\s\S]*?cat > '\$DEPLOY_PATH\/(\.env\.[a-z.-]+)'/g;
  const files = new Map<string, string[]>();

  for (const match of script.matchAll(pipeline)) {
    const [, body, fileName] = match;
    const entries = [...body.matchAll(/^\s*"([^"]*)"\s*\\?$/gm)].map((entry) => entry[1]);
    files.set(fileName, entries);
  }

  assert.ok(files.size > 0, `${jobId}/${stepName} must write at least one env file`);
  return files;
}

const keyOf = (entry: string): string => entry.slice(0, entry.indexOf('='));

test('Auth.js trusts the proxied host only where the deployment provisions it', () => {
  // The Smart Form runs Auth.js v5, which answers every /api/auth/* route with
  // 500 UntrustedHost unless the host is declared trusted. Measured on the live
  // deployment at d201fd93: providers, csrf, session and signin all returned 500.
  // NEXTAUTH_URL is a v4 name and does not confer trust, so its presence proves
  // nothing here.
  for (const jobId of ['canary', 'promote']) {
    const files = envFileWrites(jobId, 'Write Next.js service env files to server');

    const smartForm = files.get('.env.smart-form');
    assert.ok(smartForm, `${jobId} must write .env.smart-form`);
    assert.ok(
      smartForm.includes('AUTH_TRUST_HOST=true'),
      `${jobId} must declare AUTH_TRUST_HOST=true in .env.smart-form, or Auth.js refuses every request behind Caddy`,
    );

    // The trust is a statement about one reverse-proxied surface. The public
    // website performs no authentication and must not carry it.
    const web = files.get('.env.web');
    assert.ok(web, `${jobId} must write .env.web`);
    assert.ok(
      !web.some((entry) => keyOf(entry) === 'AUTH_TRUST_HOST'),
      `${jobId} must not write AUTH_TRUST_HOST into the public website env file`,
    );

    // Host trust is not a substitute for the origin: NEXTAUTH_URL still pins the
    // exact public origin Auth.js derives the Google callback URI from.
    assert.ok(
      smartForm.some((entry) => entry === 'NEXTAUTH_URL=https://$SMART_FORM_DOMAIN'),
      `${jobId} must keep NEXTAUTH_URL pinned to the provisioned Smart Form hostname`,
    );

    // Server-only credentials stay in the one container that needs them.
    for (const secret of SERVER_ONLY_SECRETS) {
      assert.ok(
        smartForm.some((entry) => keyOf(entry) === secret),
        `${jobId} must write ${secret} into .env.smart-form`,
      );
      for (const [fileName, entries] of files) {
        if (fileName === '.env.smart-form') continue;
        assert.ok(
          !entries.some((entry) => keyOf(entry) === secret),
          `${jobId} must not write ${secret} into ${fileName}`,
        );
      }
    }

    // The QA bypass is absent from every file this step writes, not merely absent
    // from .env.smart-form.
    for (const [fileName, entries] of files) {
      assert.ok(
        !entries.some((entry) => /^(NEXT_PUBLIC_)?SMART_FORM_QA_AUTH_BYPASS$/.test(keyOf(entry))),
        `${jobId} must never write a QA auth bypass into ${fileName}`,
      );
    }

    // The browser origin stays derived from the deployment's own API hostname.
    // A literal here would survive a hostname change and silently point the
    // browser at a dead origin.
    for (const fileName of ['.env.smart-form', '.env.web']) {
      const entries = files.get(fileName);
      assert.ok(entries, `${jobId} must write ${fileName}`);
      assert.ok(
        entries.includes('NEXT_PUBLIC_API_BASE_URL=https://$CADDY_DOMAIN'),
        `${jobId} must derive ${fileName}'s browser API origin from CADDY_DOMAIN`,
      );
    }
  }
});

test('the host-trust correction leaves parked containment untouched', () => {
  // AUTH_TRUST_HOST governs which Host header Auth.js will answer. It must not
  // reach, and must not perturb, the producers that parked mode shuts off.
  const parked = {
    SYNDICATE_MACHINE_ENABLED: '$SYNDICATE_MACHINE_ENABLED',
    UNIT_TALK_INGESTOR_AUTORUN: '$_ingestor_autorun',
    UNIT_TALK_INGESTOR_SCHEDULING_ENABLED: '$_ingestor_scheduling_enabled',
    UNIT_TALK_WORKER_AUTORUN: '$_worker_autorun',
    UNIT_TALK_ENABLED_TARGETS: '$_enabled_targets',
  };

  for (const jobId of ['canary', 'promote']) {
    const production = envFileWrites(jobId, 'Write .env.production to server').get('.env.production');
    assert.ok(production, `${jobId} must write .env.production`);

    for (const [name, expected] of Object.entries(parked)) {
      assert.ok(
        production.includes(`${name}=${expected}`),
        `${jobId} must keep ${name} resolved from the validated syndicate-machine mode`,
      );
    }

    // Parked mode is what forces every one of those to its safe value.
    const script = String(step(jobId, 'Write .env.production to server')['run']);
    assert.match(
      script,
      /parked\)\s*\n\s*SYNDICATE_MACHINE_ENABLED=false\s*\n\s*_ingestor_autorun=false\s*\n\s*_ingestor_scheduling_enabled=false\s*\n\s*_worker_autorun=false/,
      `${jobId} parked mode must still stop the API scheduler, the ingestor and the worker`,
    );
    assert.match(
      script,
      /if \[ "\$SYNDICATE_MACHINE_MODE" = "parked" \]; then\s*\n\s*_enabled_targets="none"/,
      `${jobId} parked mode must still force delivery targets to none`,
    );

    // Host trust belongs to the Smart Form alone; it is not a production-wide switch.
    assert.ok(
      !production.some((entry) => keyOf(entry) === 'AUTH_TRUST_HOST'),
      `${jobId} must not write AUTH_TRUST_HOST into .env.production`,
    );
  }
});

/*
 * UTV2-1918 — the internal-only Command Center deployment candidate.
 *
 * The whole point of this service is that merging it changes nothing about what
 * runs in production until an operator deliberately enables it, and that when
 * they do, it is reachable only from the deploy host itself. Both halves are
 * easy to lose to an innocuous-looking edit, so both are asserted here.
 */

const COMMAND_CENTER = 'command-center';

/**
 * The body of the first `if [ "${CC_ENABLED:-}" = 'true' ]` block in a script.
 *
 * Anchored on the closing `fi` as a whole LINE. A plain `indexOf('fi')` finds
 * the one inside `compose_profile`, which truncates the slice to nothing and
 * makes every assertion against it vacuously... loud, but for the wrong reason.
 */
function endOfGuardedBlock(script: string): string {
  const start = script.indexOf(CC_ENABLE_GUARD);
  assert.ok(start > -1, 'script must contain the enable guard');
  const body = script.slice(start);
  const close = body.search(/\n\s*fi\s*$/m);
  assert.ok(close > -1, 'the enable guard must be closed');
  return body.slice(0, close);
}

test('the Command Center is off unless a deploy deliberately enables it', () => {
  const svc = service(COMMAND_CENTER);

  // Without a profile the service would start on the next `docker compose up`,
  // which is what makes this the load-bearing line of the whole lane.
  assert.deepEqual(
    svc['profiles'],
    [COMMAND_CENTER],
    'the Command Center must sit behind its own compose profile',
  );
  for (const name of NEXTJS_SERVICES) {
    assert.ok(
      !service(name)['profiles'],
      `${name} must stay in the default profile — it runs on every deploy`,
    );
  }

  // Exactly one place may activate that profile, and it must be guarded.
  const promote = String(step('promote', 'Promote all production containers')['run']);
  assert.ok(
    promote.includes(CC_ENABLE_GUARD),
    'the promote step must gate the profile on the enable variable',
  );
  // Anchored on the closing `fi` LINE: a bare indexOf('fi') matches inside
  // `compose_profile` and would silently assert against an empty slice.
  const guardedProfile = endOfGuardedBlock(promote);
  assert.match(
    guardedProfile,
    /compose_profile="--profile command-center"/,
    'the profile may only be set inside the enable guard',
  );
  assert.ok(
    !promote.replace(guardedProfile, '').includes('--profile'),
    'no unguarded compose invocation may activate the profile',
  );

  // Every other compose invocation in the workflow must be profile-free, or the
  // surface would start somewhere this test does not describe.
  for (const jobId of ['canary', 'promote']) {
    for (const entry of (job(jobId)['steps'] as unknown[]) ?? []) {
      const stepRecord = asRecord(entry);
      const script = String(stepRecord['run'] ?? '');
      if (!script.includes('--profile')) continue;
      assert.equal(
        stepRecord['name'],
        'Promote all production containers',
        `${jobId} step "${String(stepRecord['name'])}" must not activate a compose profile`,
      );
    }
  }
});

test('an enabled Command Center is reachable only from the deploy host', () => {
  const svc = service(COMMAND_CENTER);

  // Internal-only means no public ingress at all, not "public behind a login".
  const ports = (svc['ports'] as string[] | undefined) ?? [];
  assert.deepEqual(ports, ['127.0.0.1:4300:4300'], 'the Command Center must bind loopback only');
  for (const port of ports) {
    assert.ok(port.startsWith('127.0.0.1:'), `${port} would publish the surface on every interface`);
  }

  // No Caddy site block, so nothing resolves to it from the internet.
  assert.ok(
    !caddyfile.includes(COMMAND_CENTER),
    'the Command Center must have no Caddy route — it is reached by an SSH local forward',
  );

  // The probe must be one that exists. apps/command-center has no /login route,
  // so copying the smart-form healthcheck verbatim would fail closed forever.
  assert.deepEqual(
    field(svc, 'healthcheck', 'test'),
    ['CMD', 'curl', '-fsS', 'http://localhost:4300/api/health'],
    'the Command Center healthcheck must probe a route that exists',
  );
});

test('enabling the Command Center cannot break a deploy that does not use it', () => {
  const inventory = String(step('verify', 'Validate production secret inventory')['run']);

  // The `missing` list is unconditionally required, so a Command Center secret
  // appended to it would fail every deploy — which today is all of them.
  const missingEntries = [...inventory.matchAll(/(?<![A-Za-z0-9_])missing\+=\(([^)]*)\)/g)].map(
    (m) => m[1],
  );
  assert.ok(missingEntries.length > 10, 'the unconditional secret list must still be read');
  for (const entry of missingEntries) {
    assert.ok(
      !/COMMAND_CENTER|CC_API_KEY/.test(entry),
      `${entry} must not be an unconditionally required secret`,
    );
  }

  // Its checks exist, and live inside the enable guard.
  assert.ok(inventory.includes(CC_ENABLE_GUARD), 'the inventory must gate its Command Center checks');
  const guardedBlock = inventory.slice(inventory.indexOf(CC_ENABLE_GUARD), inventory.indexOf('case "$SECRET_SYNDICATE_MACHINE_ENABLED"'));
  for (const secret of ['UNIT_TALK_CC_API_KEY', 'COMMAND_CENTER_AUTH_TOKEN']) {
    assert.ok(guardedBlock.includes(secret), `${secret} must be checked when the surface is enabled`);
  }
  assert.match(
    guardedBlock,
    /must be set together/,
    'a partial basic-auth pair must be its own error, not a silent fall-through',
  );

  // Containment is decided after, and by, code this lane does not touch.
  assert.match(
    inventory,
    /case "\$SECRET_SYNDICATE_MACHINE_ENABLED" in\s*\n\s*true\) syndicate_machine_mode=active ;;\s*\n\s*false\) syndicate_machine_mode=parked ;;/,
    'the syndicate-machine mode decision must be unchanged',
  );
});

test('the Command Center container receives no credential it does not need', () => {
  const svc = service(COMMAND_CENTER);
  assert.deepEqual(
    svc['env_file'],
    ['.env.command-center'],
    'the Command Center must read its own narrow env file',
  );
  assert.ok(
    !((svc['env_file'] as string[]) ?? []).includes('.env.production'),
    'the Command Center must not read .env.production',
  );

  for (const jobId of ['canary', 'promote']) {
    const script = String(step(jobId, 'Write Next.js service env files to server')['run']);
    const start = script.indexOf(CC_ENABLE_GUARD);
    assert.ok(start > -1, `${jobId} must write .env.command-center only when enabled`);
    const block = script.slice(start, script.indexOf('.env.command-center'));

    // Auth.js/Google material belongs to the Smart Form alone. The Command
    // Center has its own auth and must not be handed the capper allow-list.
    for (const secret of SERVER_ONLY_SECRETS) {
      assert.ok(
        !block.includes(`${secret}=$`),
        `${jobId} must not write ${secret} into the Command Center env file`,
      );
    }
    // Nothing in this surface is browser-safe configuration.
    assert.ok(
      !/"NEXT_PUBLIC_[A-Z0-9_]+=/.test(block),
      `${jobId} must not inline any value from this env file into a browser bundle`,
    );
    // It opens a service-role Supabase client, so both halves must be present.
    for (const name of ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'UNIT_TALK_CC_API_KEY']) {
      assert.ok(block.includes(`${name}=$`), `${jobId} must write ${name} for the Command Center`);
    }
    assert.ok(
      block.includes('UNIT_TALK_APP_ENV=production'),
      `${jobId} must state the deployed environment explicitly`,
    );
  }
});

test('the Command Center refuses to start on a configuration it cannot serve', () => {
  // Before this branch existed a third app started with NO startup validation:
  // the existing guard is keyed on apps/smart-form alone.
  assert.ok(
    entrypoint.includes("if [ \"$APP_DIR\" = 'apps/command-center' ]"),
    'the entrypoint must validate the Command Center at startup',
  );
  const branch = entrypoint.slice(entrypoint.indexOf("'apps/command-center'"));

  // Each of these mirrors an assertion the application itself already makes;
  // without them the container passes its healthcheck and fails on first use.
  for (const name of [
    'UNIT_TALK_CC_API_KEY',
    'COMMAND_CENTER_AUTH_TOKEN',
    'COMMAND_CENTER_AUTH_USERNAME',
    'COMMAND_CENTER_AUTH_PASSWORD',
    'SUPABASE_URL',
    'SUPABASE_SERVICE_ROLE_KEY',
    'UNIT_TALK_APP_ENV',
  ]) {
    assert.ok(branch.includes(name), `the entrypoint must check ${name}`);
  }
  // Every failure must stop the process rather than warn and continue.
  const refusals = [...branch.matchAll(/FATAL:/g)].length;
  assert.ok(refusals >= 6, `expected every Command Center check to be fatal, found ${refusals}`);
  assert.equal(
    [...branch.matchAll(/exit 1/g)].length,
    refusals,
    'every FATAL message must be followed by a refusal to start',
  );

  // The smart-form guard must be untouched by this branch.
  assert.ok(
    entrypoint.includes("if [ \"$APP_DIR\" = 'apps/smart-form' ]"),
    'the Smart Form startup guard must still exist',
  );
});

test('the canary and promote copies of the Command Center wiring do not drift', () => {
  // This workflow keeps two near-identical deployment bodies, and drift between
  // them is the recorded failure mode. Assert both moved together.
  for (const stepName of [
    'Write Next.js service env files to server',
    'Preflight — verify registry auth and resolve all 6 image tags',
  ]) {
    const canary = String(step('canary', stepName)['run']);
    const promote = String(step('promote', stepName)['run']);
    assert.ok(canary.includes(CC_ENABLE_GUARD), `canary "${stepName}" must carry the enable guard`);
    assert.ok(promote.includes(CC_ENABLE_GUARD), `promote "${stepName}" must carry the enable guard`);
  }

  // A tag predating this lane has no command-center image, so requiring it
  // unconditionally would make every rollback fail the registry preflight.
  for (const jobId of ['canary', 'promote']) {
    const preflight = String(
      step(jobId, 'Preflight — verify registry auth and resolve all 6 image tags')['run'],
    );
    assert.match(
      preflight,
      /for svc in api worker ingestor discord-bot web smart-form \$cc_service; do/,
      `${jobId} preflight must require the always-on images unconditionally`,
    );
    assert.match(
      endOfGuardedBlock(preflight),
      /cc_service="command-center"/,
      `${jobId} must require the Command Center image only when it is enabled`,
    );
    // The default path must resolve to the empty string, so a tag with no
    // command-center image is never demanded by a deploy that does not use it.
    assert.match(
      preflight,
      /cc_service=""/,
      `${jobId} preflight must default the Command Center image out of the loop`,
    );
  }

  // An enabled surface is held to the same health bar as the other two.
  const health = String(step('promote', 'Verify Next.js surfaces are healthy')['run']);
  assert.match(health, /surfaces="web smart-form"/, 'the always-on surfaces stay unconditional');
  assert.ok(health.includes(CC_ENABLE_GUARD), 'an enabled Command Center must be health-gated too');
});
