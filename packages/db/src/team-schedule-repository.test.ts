import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { InMemoryTeamScheduleRepository } from './runtime-repositories.js';

const TEAM_A = 'team-a';
const TEAM_B = 'team-b';

describe('InMemoryTeamScheduleRepository.getTeamPreviousGameDate', () => {
  it('returns the most recent completed game date before beforeDate', async () => {
    const repo = new InMemoryTeamScheduleRepository();
    repo.seed({ event_date: '2024-01-10', status: 'completed', participant_ids: [TEAM_A] });
    repo.seed({ event_date: '2024-01-15', status: 'completed', participant_ids: [TEAM_A] });
    repo.seed({ event_date: '2024-01-20', status: 'completed', participant_ids: [TEAM_A] });

    const result = await repo.getTeamPreviousGameDate(TEAM_A, '2024-01-18');
    assert.equal(result, '2024-01-15');
  });

  it('returns null when no prior game exists for the team', async () => {
    const repo = new InMemoryTeamScheduleRepository();
    repo.seed({ event_date: '2024-01-20', status: 'completed', participant_ids: [TEAM_A] });

    const result = await repo.getTeamPreviousGameDate(TEAM_A, '2024-01-20');
    assert.equal(result, null);
  });

  it('returns null when no games exist at all', async () => {
    const repo = new InMemoryTeamScheduleRepository();
    const result = await repo.getTeamPreviousGameDate(TEAM_A, '2024-01-20');
    assert.equal(result, null);
  });

  it('filters by status: only completed and in_progress qualify', async () => {
    const repo = new InMemoryTeamScheduleRepository();
    repo.seed({ event_date: '2024-01-10', status: 'scheduled', participant_ids: [TEAM_A] });
    repo.seed({ event_date: '2024-01-12', status: 'cancelled', participant_ids: [TEAM_A] });
    repo.seed({ event_date: '2024-01-14', status: 'in_progress', participant_ids: [TEAM_A] });

    const result = await repo.getTeamPreviousGameDate(TEAM_A, '2024-01-20');
    assert.equal(result, '2024-01-14');
  });

  it('does not return games for other teams', async () => {
    const repo = new InMemoryTeamScheduleRepository();
    repo.seed({ event_date: '2024-01-15', status: 'completed', participant_ids: [TEAM_B] });

    const result = await repo.getTeamPreviousGameDate(TEAM_A, '2024-01-20');
    assert.equal(result, null);
  });

  it('returns correct result when team appears in multi-team events', async () => {
    const repo = new InMemoryTeamScheduleRepository();
    repo.seed({
      event_date: '2024-01-12',
      status: 'completed',
      participant_ids: [TEAM_A, TEAM_B],
    });
    repo.seed({
      event_date: '2024-01-16',
      status: 'completed',
      participant_ids: [TEAM_A, TEAM_B],
    });

    const resultA = await repo.getTeamPreviousGameDate(TEAM_A, '2024-01-20');
    const resultB = await repo.getTeamPreviousGameDate(TEAM_B, '2024-01-20');
    assert.equal(resultA, '2024-01-16');
    assert.equal(resultB, '2024-01-16');
  });
});
