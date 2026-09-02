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

const NEXTJS_SERVICES = ['web', 'smart-form', 'command-center'] as const;

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
    [...NEXTJS_SERVICES].sort(),
    'build-nextjs must cover exactly the repository\'s Next.js services',
  );

  for (const entry of included) {
    assert.match(
      entry.app_dir,
      /^apps\/(web|smart-form|command-center)$/,
      'app_dir must name a Next.js app',
    );
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
    '{$UNIT_TALK_COMMAND_CENTER_DOMAIN}': 'command-center:4300',
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

test('the operator console ships on every release but is routable only once it has a hostname', () => {
  // The console is the operator observation path, so it has to be deployed
  // before anyone can be asked to look at anything. But publishing it needs a
  // hostname that only Griff can provision, and the two must not be the same
  // decision: an unset hostname expands to an empty Caddy site address, which
  // does not degrade the console -- it crash-loops the whole edge and takes the
  // API, the website and the intake form down with it.
  for (const jobId of ['canary', 'promote']) {
    const script = String(step(jobId, 'Write Next.js service env files to server')['run']);

    assert.match(
      script,
      /UNIT_TALK_COMMAND_CENTER_DOMAIN=\$_command_center_site/,
      `${jobId} must always write a non-empty site address for the console`,
    );
    assert.match(
      script,
      /_command_center_site="http:\/\/command-center\.invalid"/,
      `${jobId} must fall back to a scheme-qualified, non-resolvable placeholder`,
    );
    // `http://` is what suppresses Caddy's automatic HTTPS. Without it Caddy
    // would request a certificate for a name Let's Encrypt can never validate,
    // on every deploy, forever.
    assert.ok(
      !/_command_center_site="command-center\.invalid"/.test(script),
      `${jobId} must not use a bare placeholder hostname; Caddy would try to certificate it`,
    );
  }

  // A console that cannot be reached must still not be able to break the edge.
  const caddyDependsOn = Object.keys(
    (service('caddy')['depends_on'] as Record<string, unknown>) ?? {},
  );
  assert.ok(
    !caddyDependsOn.includes('command-center'),
    'caddy must not depend on command-center; a broken console would take the API offline',
  );
});

test('publishing the operator console requires the credentials that make it usable', () => {
  // A reachable console with no auth token answers 401 to Griff and 401 to
  // everyone else. That is indistinguishable from an outage, and it is the
  // failure mode a half-configured secret set produces, so the deploy refuses
  // the combination outright rather than shipping it.
  for (const jobId of ['canary', 'promote']) {
    const script = String(step(jobId, 'Write Next.js service env files to server')['run']);
    const guard = script.slice(
      script.indexOf('if [ -n "${COMMAND_CENTER_DOMAIN:-}" ]'),
      script.indexOf('_command_center_site="http'),
    );
    assert.ok(guard.length > 0, `${jobId} must gate console credentials on the hostname being set`);
    for (const name of ['COMMAND_CENTER_AUTH_TOKEN', 'UNIT_TALK_CC_API_KEY']) {
      assert.ok(guard.includes(name), `${jobId} must require ${name} once the console is published`);
    }
    assert.match(guard, /exit 1/, `${jobId} must fail the deploy rather than publish a console nobody can enter`);
  }
});

test('the deployed operator console cannot be configured fail-open', () => {
  for (const jobId of ['canary', 'promote']) {
    const script = String(step(jobId, 'Write Next.js service env files to server')['run']);
    const block = script.slice(
      script.indexOf('"PORT=4300"'),
      script.indexOf(".env.command-center' && echo"),
    );
    assert.ok(block.length > 0, `${jobId} must write a console env file`);

    // Stated, not inferred. `isCommandCenterAuthRequired` also honours
    // UNIT_TALK_OPERATOR_RUNTIME_MODE and falls back to NODE_ENV, so leaving the
    // mode implicit means a later env change can silently switch auth off.
    assert.ok(
      block.includes('"COMMAND_CENTER_AUTH_MODE=fail_closed"'),
      `${jobId} must state fail_closed explicitly rather than rely on NODE_ENV`,
    );

    // And assert the written file, because a printf is not evidence.
    const assertion = script.slice(script.indexOf(".env.command-center' && echo"));
    assert.match(
      assertion,
      /fail_open\|disabled/,
      `${jobId} must verify the written console env does not downgrade authentication`,
    );
  }
});

test('the operator console is not given a Supabase management token', () => {
  // SUPABASE_ACCESS_TOKEN is an account-scoped PAT: it runs DDL and ignores
  // RLS. The console only wants it for a storage-growth panel, which degrades
  // without it. A browser-facing server is the wrong place to keep one.
  for (const jobId of ['canary', 'promote']) {
    const script = String(step(jobId, 'Write Next.js service env files to server')['run']);
    const block = script.slice(
      script.indexOf('"PORT=4300"'),
      script.indexOf(".env.command-center' && echo"),
    );
    assert.ok(
      !block.includes('SUPABASE_ACCESS_TOKEN'),
      `${jobId} must not write a Supabase management token into the console env file`,
    );
  }

  assert.deepEqual(
    service('command-center')['env_file'],
    ['.env.command-center'],
    'the console reads its own narrow env file',
  );
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
