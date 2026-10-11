import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import test from 'node:test';
import {
  resolveSiteUrl,
  TIERS,
  NAV_LINKS,
  LEGAL_LINKS,
  BRAND,
} from './site-config';
import { FAQ_ITEMS } from './faq';
import { pageMetadata } from './site-metadata';

test('public canonical origin refuses placeholder and malformed deployment values', () => {
  assert.throws(() => resolveSiteUrl(), /NEXT_PUBLIC_SITE_URL is required/);
  assert.equal(
    resolveSiteUrl('https://unit-talk.com/'),
    'https://unit-talk.com',
  );
  for (const value of [
    'not-a-url',
    'https://unittalk.example.com',
    'https://example.org',
    'http://unit-talk.com',
    'https://localhost',
    'https://unit-talk.com/pricing',
    'https://unit-talk.com/?tracking=1',
    'https://user:password@unit-talk.com',
  ]) {
    assert.throws(() => resolveSiteUrl(value), /NEXT_PUBLIC_SITE_URL/);
  }
});

test('social metadata references real public artwork for large image cards', () => {
  const metadata = pageMetadata('Unit Talk', BRAND.description, '/');
  const serialized = JSON.stringify(metadata);
  const imagePath = new URL(
    '../../public/brand/unit-talk-icon-1024.png',
    import.meta.url,
  );

  assert.ok(statSync(imagePath).size > 0);
  assert.match(serialized, /summary_large_image/);
  assert.match(serialized, /unit-talk-icon-1024\.png/);
});

test('every internal navigation target resolves to an application route or anchor', () => {
  const appRoot = new URL('../app/', import.meta.url);
  const sourceRoot = new URL('../', import.meta.url);
  const sourceFiles: URL[] = [];
  const visit = (directory: URL) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const child = new URL(entry.name + (entry.isDirectory() ? '/' : ''), directory);
      if (entry.isDirectory()) visit(child);
      else if (/\.(?:ts|tsx)$/.test(entry.name)) sourceFiles.push(child);
    }
  };
  visit(sourceRoot);

  const routes = new Set(
    sourceFiles
      .filter((file) => file.pathname.endsWith('/page.tsx'))
      .map((file) => {
        const relative = decodeURIComponent(file.pathname).split('/src/app/')[1];
        const segment = relative === 'page.tsx' ? '' : relative.replace(/\/page\.tsx$/, '');
        return segment ? `/${segment}` : '/';
      }),
  );
  assert.ok(routes.size >= 9, 'all public application routes must be discoverable');

  const source = sourceFiles.map((file) => readFileSync(file, 'utf8')).join('\n');
  const literalLinks = [...source.matchAll(/href=["'](\/?#[^"']+|\/[^"']*)["']/g)].map(
    (match) => match[1],
  );
  const configuredLinks = [
    ...NAV_LINKS.map((link) => link.href),
    ...LEGAL_LINKS.map((link) => link.href),
    ...TIERS.flatMap((tier) => (tier.href ? [tier.href] : [])),
  ];
  const knownIds = new Set([
    ...[...source.matchAll(/\bid=["']([^"']+)["']/g)].map((match) => match[1]),
    ...FAQ_ITEMS.flatMap((item) => (item.id ? [item.id] : [])),
  ]);

  for (const href of new Set([...literalLinks, ...configuredLinks])) {
    const [pathname, fragment] = href.split('#');
    const route = pathname || '/';
    assert.ok(routes.has(route), `${href} must resolve to an application route`);
    if (fragment) assert.ok(knownIds.has(fragment), `${href} must resolve to an anchor`);
  }

  assert.ok(appRoot.pathname.endsWith('/src/app/'));
});
test('commercial authority preserves the Trial, complete VIP and unavailable future tiers', () => {
  assert.deepEqual(
    TIERS.map((tier) => tier.name),
    ['Free', 'Trial', 'VIP', 'VIP+', 'Black Label'],
  );
  const trial = TIERS.find((tier) => tier.id === 'trial')!;
  const vip = TIERS.find((tier) => tier.id === 'vip')!;
  const advanced = TIERS.find((tier) => tier.id === 'vip-plus')!;
  const future = TIERS.find((tier) => tier.id === 'black-label')!;
  assert.equal(trial.price, '$1');
  assert.match(trial.summary, /Full VIP access for seven consecutive days/);
  assert.match(trial.summary, /does not include VIP\+/);
  assert.equal(vip.price, '$49.99');
  assert.match(vip.summary, /Every official capper pick/);
  assert.equal(advanced.price, 'Price not published');
  assert.equal(future.cta, null);
  assert.equal(future.href, null);
  assert.ok(
    TIERS.every(
      (tier) => !tier.href || !/checkout|buy|subscribe/.test(tier.href),
    ),
  );
  assert.ok(NAV_LINKS.some((link) => link.href === '/cappers'));
});
test('website brand assets are byte-identical copies of canonical masters', () => {
  for (const name of [
    'unit-talk-horizontal-white.svg',
    'unit-talk-mark-white.svg',
    'unit-talk-discord.svg',
    'unit-talk-icon-512.png',
    'unit-talk-icon-256.png',
    'favicon-32.png',
    'favicon-64.png',
    'unit-talk-icon-1024.png',
  ]) {
    const master = readFileSync(
      new URL(
        '../../../../docs/03_product/brand/assets/' + name,
        import.meta.url,
      ),
    );
    const publicAsset = readFileSync(
      new URL('../../public/brand/' + name, import.meta.url),
    );
    assert.deepEqual(publicAsset, master, name);
  }
});

test('membership and FAQ copy contains no fabricated performance figures or affirmative guarantees', () => {
  const copy = [
    BRAND.description,
    ...TIERS.flatMap((tier) => [tier.summary, ...tier.features]),
    ...FAQ_ITEMS.flatMap((item) => [item.question, item.answer]),
  ].join(' ');
  assert.doesNotMatch(
    copy,
    /(?:\d+(?:\.\d+)?\s*%\s*(?:win|roi|return)|(?:win rate|roi|return)\s*[:=]\s*\d|guaranteed\s+(?:profit|wins?|returns?)|risk[- ]free)/i,
  );
});

test('all rendered site copy contains no numeric performance or win-rate claim', () => {
  const copyFiles: URL[] = [];
  const visit = (directory: URL) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const child = new URL(entry.name + (entry.isDirectory() ? '/' : ''), directory);
      if (entry.isDirectory()) visit(child);
      else if (/\.(?:ts|tsx)$/.test(entry.name)) copyFiles.push(child);
    }
  };
  visit(new URL('../app/', import.meta.url));
  visit(new URL('../components/', import.meta.url));

  const copy = copyFiles.map((file) => readFileSync(file, 'utf8')).join('\n');
  assert.doesNotMatch(
    copy,
    /(?:\b\d+(?:\.\d+)?\s*%\s*(?:win|roi|return)|(?:win rate|roi|return)\s*(?:of|:|=)\s*\d)/i,
  );
});
