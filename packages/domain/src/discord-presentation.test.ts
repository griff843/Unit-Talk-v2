import assert from 'node:assert/strict';
import test from 'node:test';
import {
  allowedMediaUrl,
  buildPickPresentation,
  buildPresentationEmbed,
  buildResultPresentation,
  DISCORD_MEDIA_HOST_ALLOWLIST,
} from './discord-presentation.js';
import { buildRecapEmbedData } from './recap-embed.js';

// WORK-2026110302: the embed host guard. Every builder goes through it.

const ALLOWED = [
  'https://cdn.nba.com/headshots/nba/latest/1040x760/2544.png',
  'https://img.mlbstatic.com/mlb-photos/image/upload/v1/people/660271/headshot/67/current',
  'https://a.espncdn.com/i/headshots/nfl/players/full/3139477.png',
  'https://assets.nhle.com/mugs/nhl/20252026/EDM/8478402.png',
];

const REFUSED: Array<[string, unknown]> = [
  ['dead NHL host', 'https://cms.nhl.bamgrid.com/images/headshots/current/168x168/8478402.jpg'],
  ['http scheme', 'http://cdn.nba.com/headshots/nba/latest/1040x760/2544.png'],
  ['credentials', 'https://user:pass@cdn.nba.com/headshots/2544.png'],
  ['username only', 'https://user@cdn.nba.com/headshots/2544.png'],
  ['foreign host', 'https://example.com/headshot.png'],
  ['allowlisted host as subdomain suffix', 'https://cdn.nba.com.evil.example/headshot.png'],
  ['subdomain of an allowlisted host', 'https://x.cdn.nba.com/headshot.png'],
  ['non-default port', 'https://cdn.nba.com:8443/headshot.png'],
  ['malformed', 'not a url'],
  ['empty', ''],
  ['non-string', 42],
  ['null', null],
];

test('WORK-2026110302: allowlist is exactly the four verified media hosts', () => {
  assert.deepEqual([...DISCORD_MEDIA_HOST_ALLOWLIST].sort(), [
    'a.espncdn.com',
    'assets.nhle.com',
    'cdn.nba.com',
    'img.mlbstatic.com',
  ]);
  assert.ok(!DISCORD_MEDIA_HOST_ALLOWLIST.includes('cms.nhl.bamgrid.com'));
  assert.ok(Object.isFrozen(DISCORD_MEDIA_HOST_ALLOWLIST));
});

test('WORK-2026110302: allowedMediaUrl accepts each allowlisted https host', () => {
  for (const url of ALLOWED) assert.equal(allowedMediaUrl(url), url, url);
});

for (const [label, value] of REFUSED) {
  test(`WORK-2026110302: allowedMediaUrl refuses ${label}`, () => {
    assert.equal(allowedMediaUrl(value), undefined);
  });
}

test('WORK-2026110302: buildPresentationEmbed shows no thumbnail for a refused host and keeps the text brand', () => {
  for (const [, value] of REFUSED) {
    const embed = buildPresentationEmbed('pick-posted', { title: 'Pick', thumbnailUrl: value as string });
    assert.equal(embed.thumbnail, undefined);
    assert.equal(embed.footer.text, 'Unit Talk');
  }
});

test('WORK-2026110302: buildPickPresentation renders an allowlisted thumbnail and drops a foreign one', () => {
  const base = { selection: 'Over 24.5', market: 'Player points', sport: 'NBA' };
  assert.deepEqual(
    buildPickPresentation('pick-posted', { ...base, thumbnailUrl: ALLOWED[0] }).thumbnail,
    { url: ALLOWED[0] },
  );
  const foreign = buildPickPresentation('pick-posted', {
    ...base,
    thumbnailUrl: 'https://example.com/someone-else.png',
  });
  assert.equal(foreign.thumbnail, undefined);
  assert.equal(foreign.footer.text, 'Unit Talk');
});

test('WORK-2026110302: the result recap goes through the host guard', () => {
  const recapInput = {
    market: 'Player points',
    selection: 'Over 24.5',
    result: 'win' as const,
    stakeUnits: 1,
    profitLossUnits: 0.91,
    clvPercent: null,
    submittedBy: 'griff843',
  };
  assert.equal(
    buildRecapEmbedData({
      ...recapInput,
      thumbnailUrl: 'https://cms.nhl.bamgrid.com/images/headshots/current/168x168/1.jpg',
    }).thumbnail,
    undefined,
  );
  assert.equal(
    buildResultPresentation({ ...recapInput, capper: 'griff843', thumbnailUrl: 'https://example.com/a.png' })
      .thumbnail,
    undefined,
  );
  assert.deepEqual(buildRecapEmbedData({ ...recapInput, thumbnailUrl: ALLOWED[1] }).thumbnail, {
    url: ALLOWED[1],
  });
});
