/**
 * WORK-2026100301 offline presentation proof. No Discord or database network calls.
 * Run: pnpm exec tsx docs/06_status/proof/WORK-2026100301/presentation-proof.ts
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, writeFile, unlink } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
/* global document, window */
import type { OutboxRecord } from '@unit-talk/db';
import {
  buildDiscordMessagePayload,
  createDiscordDeliveryAdapter,
} from '../../../../apps/worker/src/delivery-adapters.js';
import {
  buildPickPresentation,
  buildResultPresentation,
  buildPresentationPages,
  buildUpgradePresentation,
  buildPrivatePresentation,
  buildTrialPresentation,
  buildCapperOnboardingPresentation,
  buildCapperPresentation,
  buildWelcomePresentation,
  buildServicePresentation,
  embedCharacterCount,
  type PresentationEmbed,
} from '../../../../packages/domain/src/discord-presentation.js';

async function main() {
  const root = process.cwd();
  const evidence = resolve(root, 'docs/06_status/proof/WORK-2026100301');
  await mkdir(resolve(root, 'artifacts'), { recursive: true });
  await mkdir(resolve(root, 'apps/worker/.out'), { recursive: true });
  const base = execFileSync('git', ['rev-parse', 'origin/main'], {
    encoding: 'utf8',
  }).trim();
  const baselinePath = resolve(
    root,
    'apps/worker/.out/baseline-delivery-adapters.ts',
  );
  await writeFile(
    baselinePath,
    execFileSync('git', [
      'show',
      base + ':apps/worker/src/delivery-adapters.ts',
    ]),
  );
  const baseline = (await import(
    pathToFileURL(baselinePath).href
  )) as typeof import('../../../../apps/worker/src/delivery-adapters.js');
  const outbox: OutboxRecord = {
    id: '00000000-0000-4000-8000-000000000001',
    pick_id: '00000000-0000-4000-8000-000000000002',
    target: 'discord:canary',
    status: 'pending',
    attempt_count: 0,
    next_attempt_at: null,
    last_error: null,
    claimed_at: null,
    claimed_by: null,
    idempotency_key: 'fixture:discord-design',
    created_at: '2026-10-03T12:00:00.000Z',
    updated_at: '2026-10-03T12:00:00.000Z',
    payload: {
      selection: 'Fixture player Over 24.5',
      market: 'Points',
      odds: -110,
      stakeUnits: 1,
      confidence: 0.81,
      metadata: {
        capper: 'Fixture capper',
        sport: 'NBA',
        eventName: 'Fixture A vs Fixture B',
        capperRecord: '12-4',
        capperClvPct: 2.4,
        domainAnalysis: { impliedProbability: 0.58 },
        gameTime: '2026-10-03T23:00:00.000Z',
      },
    },
  };
  const serialized = JSON.stringify(buildDiscordMessagePayload(outbox));
  const digest = createHash('sha256').update(serialized).digest('hex');
  for (let index = 0; index < 100; index++)
    assert.equal(
      JSON.stringify(buildDiscordMessagePayload(outbox)),
      serialized,
    );
  assert.doesNotMatch(serialized, /confidence|implied|12-4|2.4%/iu);

  const shadow: Array<Record<string, unknown>> = [];
  for (const target of ['discord:canary', 'discord:best-bets']) {
    const row = { ...outbox, target };
    const destinations: string[] = [];
    const receipts = [];
    for (const adapterModule of [baseline, { createDiscordDeliveryAdapter }]) {
      const adapter = adapterModule.createDiscordDeliveryAdapter({
        dryRun: false,
        botToken: 'fixture-token',
        targetMap: { [target]: '1234567890' },
        fetchImpl: async (url, init) => {
          destinations.push(String(url));
          const body = JSON.parse(String(init?.body)) as {
            nonce: string;
            enforce_nonce: boolean;
          };
          assert.equal(body.enforce_nonce, true);
          assert.equal(
            body.nonce,
            (buildDiscordMessagePayload(row) as { nonce: string }).nonce,
          );
          return new Response(JSON.stringify({ id: 'fixture-message' }), {
            status: 200,
          });
        },
      });
      receipts.push(await adapter(row));
    }
    assert.equal(destinations[0], destinations[1]);
    assert.deepEqual(receipts[0], receipts[1]);
    shadow.push({
      target,
      destinationUnchanged: true,
      receiptUnchanged: true,
      nonceUnchanged: true,
      before: baseline.buildDiscordMessagePayload(row),
      after: buildDiscordMessagePayload(row),
    });
  }

  await unlink(baselinePath);
  const faultCases: string[] = [];
  for (const media of [
    undefined,
    '',
    'not-a-url',
    'http://invalid.example/media.png',
  ]) {
    const embed = buildPickPresentation('official-pick', {
      selection: 'Fixture pick',
      thumbnailUrl: media,
    });
    assert.equal(embed.thumbnail, undefined);
    faultCases.push('missing-or-invalid-media:' + String(media));
  }
  for (const clv of [null, undefined, NaN, Infinity]) {
    assert.ok(
      !buildResultPresentation({ result: 'loss', clvPercent: clv }).fields.some(
        (field) => field.name.includes('CLV'),
      ),
    );
    faultCases.push('unknown-clv:' + String(clv));
  }
  assert.ok(
    buildResultPresentation({ result: 'loss', clvPercent: 0 }).fields.some(
      (field) => field.value === '0.0%',
    ),
  );
  const allLosses = Array.from(
    { length: 150 },
    (_, index) => `LOSS-${index} — Fixture selection ${'x'.repeat(80)}\n`,
  ).join('');
  const recap = buildPresentationPages('daily-recap', {
    title: 'Daily Recap · Fixture window',
    fields: [
      { name: 'Record', value: '0-150-0', inline: true },
      { name: 'Sample', value: '150 settled fixture picks' },
      { name: 'Settled picks', value: allLosses },
    ],
  });
  assert.equal(
    recap
      .flatMap((page) => page.fields)
      .filter((field) => field.name.startsWith('Settled picks'))
      .map((field) => field.value)
      .join(''),
    allLosses.trim(),
  );
  assert.ok(
    recap.every(
      (page) => embedCharacterCount(page) <= 6000 && page.fields.length <= 6,
    ),
  );
  faultCases.push('long-recap-150-losses-preserved');

  const specimens: PresentationEmbed[] = [
    buildPickPresentation('official-pick', {
      selection: 'Fixture player Over 24.5',
      market: 'Points',
      odds: -110,
      stakeUnits: 1,
      capper: 'Fixture capper',
      sport: 'NBA',
      eventName: 'Fixture A vs Fixture B',
      eventTime: '2026-10-03T23:00:00.000Z',
      notes: 'Source-supplied fixture thesis.',
    }),
    ...(['win', 'loss', 'push', 'void', 'correction'] as const).map((result) =>
      buildResultPresentation({
        result,
        selection: 'Fixture player Over 24.5',
        market: 'Points',
        odds: -110,
        stakeUnits: 1,
        capper: 'Fixture capper',
        profitLossUnits: result === 'loss' ? -1 : result === 'win' ? 0.91 : 0,
        clvPercent: result === 'loss' ? null : 0,
        previousResult: 'win',
        correctedResult: 'loss',
        timestamp: '2026-10-03T23:50:00.000Z',
      }),
    ),
    ...recap,
    buildCapperPresentation('capper-record', {
      capper: 'Fixture capper',
      record: '2-1-1',
      sample: '4 settled fixture picks',
    }),
    buildPresentationPages('leaderboard', {
      fields: [
        {
          name: 'Rankings',
          value: '1. Fixture capper · 2-1-1 · 4 settled picks',
        },
      ],
    })[0]!,
    buildWelcomePresentation(),
    buildTrialPresentation('trial-started', {
      expiresAt: '2026-10-10T12:00:00.000Z',
    }),
    buildTrialPresentation('trial-expiring'),
    buildUpgradePresentation('vip'),
    buildCapperOnboardingPresentation('Fixture capper'),
    buildServicePresentation('service-alert', {
      message: 'Fixture service delay.',
      impact: 'Delivery may be delayed.',
    }),
    buildServicePresentation('system-maintenance', {
      message: 'Fixture scheduled maintenance.',
    }),
    buildPrivatePresentation(
      'access-denied',
      'This command requires approved access.',
    ).embeds[0]!,
    buildPrivatePresentation(
      'bot-error',
      'This service is temporarily unavailable.',
    ).embeds[0]!,
  ];
  await writeFile(
    resolve(evidence, 'render-fixtures.json'),
    JSON.stringify(
      { mode: 'offline fixture; no live metrics', specimens },
      null,
      2,
    ),
  );
  const escape = (text: string) =>
    text
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;');
  const html = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>Unit Talk presentation proof — simulated Discord</title>
<style>*{box-sizing:border-box}body{margin:0;background:#111111;color:#fff;font:15px/1.5 Arial,sans-serif;padding:28px}header{max-width:1100px;margin:0 auto 24px;color:#c7a34b}header p{color:#bbb}main{max-width:1100px;margin:auto;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:24px}.embed{background:#25252a;border-left:4px solid var(--accent);border-radius:4px;padding:20px;min-width:0}h2{font-size:19px;margin:0 0 12px;color:#fff;overflow-wrap:anywhere}p{margin:0 0 14px;white-space:pre-wrap;overflow-wrap:anywhere}.fields{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px 18px}.field{grid-column:1/-1;min-width:0}.inline{grid-column:auto}.label{font-weight:700;margin-bottom:4px}.value{white-space:pre-wrap;overflow-wrap:anywhere}footer{font-size:12px;color:#b8b8bb;margin-top:18px}@media(max-width:600px){body{padding:14px}main{grid-template-columns:1fr;gap:16px}.embed{padding:16px}.fields{grid-template-columns:1fr}.inline{grid-column:1/-1}h2{font-size:18px}}</style>
<header><h1>Unit Talk · message design proof</h1><p>OFFLINE FIXTURES · Simulated Discord layout · No live delivery or access proof</p></header><main>
${specimens.map((embed) => `<article class="embed" style="--accent:#${embed.color.toString(16).padStart(6, '0')}"><h2>${escape(embed.title)}</h2>${embed.description ? `<p>${escape(embed.description)}</p>` : ''}<div class="fields">${embed.fields.map((field) => `<section class="field ${field.inline ? 'inline' : ''}"><div class="label">${escape(field.name)}</div><div class="value">${escape(field.value).replace(/&lt;t:(\d+):[fF]&gt;/g, (_match, unix: string) => new Date(Number(unix) * 1000).toISOString().replace('T', ' ').slice(0, 16) + ' UTC')}</div></section>`).join('')}</div><footer>${escape(embed.footer.text)}${embed.timestamp ? ' · ' + escape(embed.timestamp) : ''}</footer></article>`).join('')}</main>`;
  await writeFile(resolve(evidence, 'render-preview.html'), html);
  const browser = await chromium.launch({ headless: true });
  const renderChecks: Record<string, unknown>[] = [];
  for (const [name, width] of [
    ['desktop', 1440],
    ['mobile', 390],
  ] as const) {
    const page = await browser.newPage({
      viewport: { width, height: 1000 },
      deviceScaleFactor: 1,
    });
    await page.setContent(html);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    );
    assert.equal(overflow, false);
    await page.screenshot({
      path: resolve(evidence, 'render-' + name + '.png'),
      fullPage: true,
    });
    await page.screenshot({
      path: resolve(evidence, 'render-' + name + '-detail.png'),
      fullPage: false,
    });
    renderChecks.push({
      name,
      width,
      horizontalOverflow: overflow,
      embeds: await page.locator('article').count(),
    });
    await page.close();
  }
  await browser.close();
  const reports = [
    [
      'r2-determinism-WORK-2026100301.json',
      {
        mode: 'offline deterministic presentation',
        base,
        samples: 100,
        identical: true,
        sha256: digest,
      },
    ],
    [
      'shadow-report-WORK-2026100301.json',
      {
        mode: 'offline old/new adapter shadow with mocked transport; no production traffic',
        base,
        cases: shadow,
      },
    ],
    [
      'r4-fault-report-WORK-2026100301.json',
      {
        mode: 'offline presentation fault cases; no chaos activation',
        base,
        cases: faultCases,
        passed: faultCases.length,
      },
    ],
  ] as const;
  for (const [name, report] of reports) {
    const json = JSON.stringify(report, null, 2);
    await writeFile(resolve(root, 'artifacts', name), json);
    await writeFile(resolve(evidence, name), json);
  }
  await writeFile(
    resolve(evidence, 'render-report.json'),
    JSON.stringify(
      {
        mode: 'local simulated Discord; QA sandbox unavailable',
        checks: renderChecks,
      },
      null,
      2,
    ),
  );
  console.log(
    JSON.stringify(
      {
        determinism: 100,
        shadowCases: shadow.length,
        faultCases: faultCases.length,
        renderChecks,
      },
      null,
      2,
    ),
  );
}
void main();
