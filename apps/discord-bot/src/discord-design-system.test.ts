import assert from 'node:assert/strict';
import test from 'node:test';
import type { ChatInputCommandInteraction, Interaction } from 'discord.js';
import {
  DISCORD_FAMILIES,
  DISCORD_PRESENTATION,
  SETTLED_COLORS,
  buildPresentationEmbed,
  buildPresentationPages,
  buildPickPresentation,
  buildResultPresentation,
  buildPrivatePresentation,
  buildTrialPresentation,
  buildUpgradePresentation,
  buildCapperPresentation,
  buildWelcomePresentation,
  buildServicePresentation,
  embedCharacterCount,
} from '@unit-talk/domain';
import { buildRecapEmbedData } from './embeds/recap-embed.js';
import { createInteractionHandler } from './router.js';
import type { CommandRegistry } from './command-registry.js';
import {
  createLeaderboardCommand,
  buildLeaderboardEmbeds,
} from './commands/leaderboard.js';
import { buildStatsEmbed } from './commands/stats.js';
import { buildResultsEmbeds } from './commands/results.js';
import type { ApiClient } from './api-client.js';

const pick = {
  selection: 'Under 24.5',
  market: 'Player points',
  odds: -110,
  stakeUnits: 2,
  capper: 'Canonical Capper',
};
test('presentation ignores technical confidence and arbitrary source enrichment', () => {
  const source = {
    ...pick,
    result: 'loss' as const,
    profitLossUnits: -2,
    confidence: 0.98,
    metadata: { confidence: 0.98, edge: 88, capperRecord: '999-0' },
  };
  for (const embed of [
    buildPickPresentation('official-pick', source),
    buildResultPresentation(source),
    buildRecapEmbedData({
      ...source,
      submittedBy: source.capper,
      clvPercent: null,
    }),
  ]) {
    const output = JSON.stringify(embed);
    assert.doesNotMatch(output, /confidence|High|Medium|Low|999-0|88/iu);
    assert.equal(
      embed.fields.some((field) => /edge|probability/iu.test(field.name)),
      false,
    );
  }
  const injected = buildPresentationEmbed('capper-record', {
    fields: [{ name: 'Confidence', value: '98% (High)' }],
  });
  assert.equal(injected.fields.length, 0);
});
test('null, undefined and non-finite CLV disappear; measured zero remains visible', () => {
  for (const clvPercent of [null, undefined, NaN, Infinity]) {
    assert.equal(
      buildResultPresentation({
        ...pick,
        result: 'loss',
        clvPercent,
      }).fields.some((field) => /CLV/u.test(field.name)),
      false,
    );
  }
  for (const result of ['win', 'loss'] as const) {
    assert.equal(
      buildResultPresentation({ ...pick, result, clvPercent: 0 }).fields.find(
        (field) => /CLV/u.test(field.name),
      )?.value,
      '0.0%',
    );
  }
});
test('missing optional data and missing/invalid media render cleanly without synthesized timestamps', () => {
  const embed = buildPickPresentation('official-pick', {
    selection: 'Recorded selection',
  });
  assert.deepEqual(embed.fields, []);
  assert.equal(embed.thumbnail, undefined);
  assert.equal(embed.timestamp, undefined);
  assert.equal(embed.description, undefined);
  for (const thumbnailUrl of [
    '',
    'not-a-url',
    'file:///private',
    'http://insecure.example/image',
  ]) {
    assert.equal(
      buildResultPresentation({ result: 'loss', thumbnailUrl }).thumbnail,
      undefined,
    );
  }
  const enriched = buildResultPresentation({
    ...pick,
    result: 'loss',
    thumbnailUrl: 'https://assets.example/headshot.png',
  });
  assert.equal(enriched.thumbnail?.url, 'https://assets.example/headshot.png');
});
test('win/loss/push/void/correction have distinct settled identities and colors with equal detail', () => {
  const embeds = (['win', 'loss', 'push', 'void', 'correction'] as const).map(
    (result) =>
      buildResultPresentation({
        ...pick,
        result,
        profitLossUnits: result === 'loss' ? -2 : 0,
        clvPercent: 0,
        previousResult: 'Win',
        correctedResult: 'loss',
      }),
  );
  assert.equal(new Set(embeds.map((embed) => embed.color)).size, 5);
  for (const [index, result] of (
    ['win', 'loss', 'push', 'void', 'correction'] as const
  ).entries()) {
    assert.equal(embeds[index]?.color, SETTLED_COLORS[result]);
    assert.match(
      embeds[index]?.title ?? '',
      new RegExp(DISCORD_FAMILIES[result]),
    );
  }
  assert.deepEqual(
    embeds[0]?.fields.map((field) => field.name),
    embeds[1]?.fields.map((field) => field.name),
  );
  assert.equal(
    embeds[4]?.fields.find((field) => field.name === 'Corrected result')?.value,
    'Loss',
  );
});
test('every nonsettlement launch family uses gold and the quiet brand footer', () => {
  for (const family of Object.keys(DISCORD_FAMILIES) as Array<
    keyof typeof DISCORD_FAMILIES
  >) {
    const embed = buildPresentationEmbed(family);
    assert.equal(
      embed.color,
      family in SETTLED_COLORS
        ? SETTLED_COLORS[family as keyof typeof SETTLED_COLORS]
        : DISCORD_PRESENTATION.gold,
    );
    assert.equal(embed.footer.text, 'Unit Talk');
    assert.ok(embed.title.length > 0);
  }
});
test('long recap pages preserve late losses and obey field and combined message limits', () => {
  const rows = Array.from(
    { length: 150 },
    (_, i) => `Loss · selection-${i} · ${'market context '.repeat(8)} · -1.0u`,
  );
  const pages = buildPresentationPages('monthly-recap', {
    fields: [{ name: 'Settled Picks', value: rows.join('\n') }],
  });
  const output = pages
    .flatMap((page) => page.fields.map((field) => field.value))
    .join('');
  for (const row of rows) assert.ok(output.includes(row), row);
  assert.ok(pages.length > 1);
  for (const page of pages) {
    assert.ok(embedCharacterCount(page) <= 6000);
    assert.ok(page.fields.length <= 6);
    assert.ok(
      page.fields.every(
        (field) => field.name.length <= 256 && field.value.length <= 1024,
      ),
    );
    assert.ok(page.title.length <= 256);
  }
});
test('presentation is deterministic and preserves source time without consulting a clock', () => {
  const source = { ...pick, eventTime: '2026-10-03T23:00:00.000Z' };
  assert.deepEqual(
    buildPickPresentation('official-pick', source),
    buildPickPresentation('official-pick', source),
  );
  assert.equal(buildTrialPresentation('trial-expiring').fields.length, 0);
  assert.equal(
    buildTrialPresentation('trial-started', {
      expiresAt: '2026-10-10T23:00:00.000Z',
    }).fields[0]?.name,
    'Expires',
  );
  assert.equal(buildWelcomePresentation().timestamp, undefined);
  assert.equal(
    buildServicePresentation('system-maintenance', {
      message: 'Scheduled maintenance',
    }).color,
    DISCORD_PRESENTATION.gold,
  );
  assert.equal(
    buildCapperPresentation('capper-profile', {
      capper: 'Canonical Capper',
      clvPercent: 0,
    }).fields.some((field) => /CLV/u.test(field.name)),
    false,
  );
});
test('upgrade never invents a VIP+ price or presents Black Label as purchasable', () => {
  for (const tier of [
    'free',
    'trial',
    'vip',
    'vip-plus',
    'black-label',
  ] as const) {
    const output = JSON.stringify(buildUpgradePresentation(tier));
    assert.doesNotMatch(output, /\$\d/u);
    assert.doesNotMatch(
      output,
      /buy Black Label|unlock Black Label|Black Label.*available now/iu,
    );
  }
  assert.match(
    buildUpgradePresentation('black-label').description ?? '',
    /unavailable for purchase/,
  );
});
test('access denied and bot error specs carry private visibility', () => {
  for (const family of ['access-denied', 'bot-error'] as const) {
    assert.equal(
      buildPrivatePresentation(family, 'Safe message').ephemeral,
      true,
    );
  }
});
test('router refusal is private and never executes the protected command', async () => {
  let executed = false;
  let reply:
    | { ephemeral?: boolean; embeds?: Array<{ title?: string }> }
    | undefined;
  const registry = {
    get: () => ({
      requiredRoles: ['paid-role'],
      execute: async () => {
        executed = true;
      },
    }),
  } as unknown as CommandRegistry;
  await createInteractionHandler(registry)({
    isChatInputCommand: () => true,
    commandName: 'protected',
    guildId: 'guild',
    member: { roles: { cache: { has: () => false } } },
    reply: async (value: typeof reply) => {
      reply = value;
    },
  } as unknown as Interaction);
  assert.equal(executed, false);
  assert.equal(reply?.ephemeral, true);
  assert.equal(reply?.embeds?.[0]?.title, 'Access Denied');
});
test('router errors after a public defer delete the public reply and follow up privately', async () => {
  const calls: string[] = [];
  let response:
    | {
        ephemeral?: boolean;
        embeds?: Array<{ title?: string; description?: string }>;
      }
    | undefined;
  const registry = {
    get: () => ({
      responseVisibility: 'public',
      execute: async () => {
        throw new Error('private diagnostic');
      },
    }),
  } as unknown as CommandRegistry;
  await createInteractionHandler(registry, { error: () => {} })({
    isChatInputCommand: () => true,
    commandName: 'public',
    deferReply: async () => {
      calls.push('defer');
    },
    deleteReply: async () => {
      calls.push('delete');
    },
    editReply: async () => {
      calls.push('edit');
    },
    followUp: async (value: typeof response) => {
      calls.push('followUp');
      response = value;
    },
  } as unknown as Interaction);
  assert.deepEqual(calls, ['defer', 'delete', 'followUp']);
  assert.equal(response?.ephemeral, true);
  assert.equal(response?.embeds?.[0]?.title, 'Bot Error');
  assert.doesNotMatch(JSON.stringify(response), /private diagnostic/u);
});
test('leaderboard API errors remain private despite its approved public success path', async () => {
  let deleted = false;
  let privateReply = false;
  const api = {
    get: async () => {
      throw new Error('diagnostic');
    },
    post: async () => ({}),
  } as unknown as ApiClient;
  await createLeaderboardCommand(api).execute({
    options: { getInteger: () => null, getString: () => null },
    deleteReply: async () => {
      deleted = true;
    },
    followUp: async (value: { ephemeral?: boolean }) => {
      privateReply = value.ephemeral === true;
    },
    editReply: async () => {
      assert.fail('error must not edit public reply');
    },
  } as unknown as ChatInputCommandInteraction);
  assert.equal(deleted, true);
  assert.equal(privateReply, true);
});
test('leaderboard renders every returned entry and its sample without inventing unknown metrics', () => {
  const entries = Array.from({ length: 25 }, (_, i) => ({
    rank: i + 1,
    capper: `capper-${i}`,
    picks: 5,
    wins: 1,
    losses: 4,
    pushes: 0,
    winRate: null,
    roiPct: null,
    avgClvPct: null,
    streak: -4,
  }));
  const pages = buildLeaderboardEmbeds({
    window: 30,
    sport: null,
    minPicks: 3,
    entries,
    observedAt: '2026-10-03T12:00:00.000Z',
  });
  const output = JSON.stringify(pages.map((page) => page.toJSON()));
  for (const entry of entries) assert.ok(output.includes(entry.capper));
  assert.doesNotMatch(output, /n\/a|ROI|CLV/u);
});
test('stats omits null CLV while showing measured zero with its canonical sample', () => {
  const stats = {
    scope: 'capper' as const,
    capper: 'Known Capper',
    window: 30 as const,
    sport: null,
    picks: 6,
    wins: 2,
    losses: 4,
    pushes: 0,
    winRate: 1 / 3,
    roiPct: -10,
    avgClvPct: null,
    beatsLine: null,
    picksWithClv: 4,
    lastFive: ['L' as const],
  };
  assert.doesNotMatch(JSON.stringify(buildStatsEmbed(stats).toJSON()), /CLV/u);
  const zero = buildStatsEmbed({ ...stats, avgClvPct: 0 }).toJSON();
  assert.match(
    zero.fields?.find((field) => field.name === 'Avg CLV%')?.value ?? '',
    /^0.0%/,
  );
});
test('results never assume a missing stake, odds or capper identity for display', () => {
  const settlements = [
    {
      id: 's',
      pick_id: 'p',
      status: 'settled',
      result: 'loss',
      settled_at: '2026-10-02T12:00:00Z',
      created_at: '2026-10-02T12:00:00Z',
      payload: null,
    },
  ];
  const missing = buildResultsEmbeds(settlements, []).map((embed) =>
    embed.toJSON(),
  );
  assert.doesNotMatch(JSON.stringify(missing), /-1.0u|P\/L n\/a/u);
  assert.doesNotMatch(JSON.stringify(missing), /"p"/u);
});
