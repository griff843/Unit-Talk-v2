import assert from 'node:assert/strict';
import test from 'node:test';
import { lineInputExample, matchupInputExample } from '../lib/input-examples';

test('total examples use the sport and distinguish team totals', () => {
  assert.equal(lineInputExample('NHL', 'total'), 'e.g. 6.5');
  assert.equal(lineInputExample('NHL', 'team-total'), 'e.g. 3.5');
  assert.equal(lineInputExample('NBA', 'total'), 'e.g. 220.5');
  assert.equal(lineInputExample('MLB', 'total'), 'e.g. 8.5');
  assert.equal(lineInputExample('NFL', 'team-total'), 'e.g. 23.5');
  assert.equal(lineInputExample('unknown', 'total'), 'Enter total');
});

test('player examples follow stat and sport without creating input defaults', () => {
  for (const [sport, stat, example] of [
    ['NHL', 'Shots on Goal', '3.5'], ['NHL', 'Saves', '27.5'], ['NHL', 'Points', '0.5'],
    ['NBA', 'Points', '24.5'], ['NBA', 'Assists', '5.5'], ['NBA', 'Rebounds', '7.5'],
    ['NFL', 'Passing Yards', '245.5'], ['NCAAF', 'Receiving Yards', '65.5'],
    ['MLB', 'Pitcher Strikeouts', '5.5'], ['MLB', 'Total Bases', '1.5'],
  ]) assert.equal(lineInputExample(sport, 'player-prop', stat), `e.g. ${example}`);
  assert.equal(lineInputExample('NHL', 'player-prop'), 'Enter line');
  assert.equal(lineInputExample('NBA', 'player-prop', 'Unknown stat'), 'Enter line');
  assert.equal(lineInputExample('NHL', 'spread'), 'e.g. -3.5');
});

test('matchup examples use the selected sport and unknown sports stay generic', () => {
  assert.equal(matchupInputExample('nhl'), 'e.g. Oilers @ Flames');
  assert.equal(matchupInputExample('NBA'), 'e.g. Knicks @ Heat');
  assert.equal(matchupInputExample('MMA'), 'Enter matchup');
});
