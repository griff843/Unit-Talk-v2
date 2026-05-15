import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildAgentScoreboard, type AgentLaneInput } from './agent-scoreboard.js';

test('buildAgentScoreboard groups lanes and computes stale/missing/truth rates', () => {
  const now = new Date('2026-05-14T20:00:00.000Z');
  const lanes: AgentLaneInput[] = [
    {
      issue_id: 'UTV2-1',
      lane_type: 'codex-cli',
      created_by: 'codex',
      status: 'done',
      started_at: '2026-05-14T10:00:00.000Z',
      closed_at: '2026-05-14T12:00:00.000Z',
      heartbeat_at: '2026-05-14T12:00:00.000Z',
      truth_check_history: [{ verdict: 'PASS', exit_code: 0 }],
    },
    {
      issue_id: 'UTV2-2',
      lane_type: 'codex-cli',
      created_by: 'codex',
      status: 'started',
      started_at: '2026-05-13T10:00:00.000Z',
      heartbeat_at: '2026-05-13T11:00:00.000Z',
    },
    {
      issue_id: 'UTV2-3',
      lane_type: 'claude',
      created_by: 'claude',
      status: 'done',
      started_at: '2026-05-14T10:00:00.000Z',
      closed_at: null,
      heartbeat_at: '2026-05-14T12:00:00.000Z',
      truth_check_history: [{ verdict: 'FAIL', exit_code: 1 }],
    },
  ];

  const report = buildAgentScoreboard(lanes, now);
  const codex = report.agents.find((entry) => entry.agent === 'codex');
  const claude = report.agents.find((entry) => entry.agent === 'claude');

  assert.equal(report.lane_count, 3);
  assert.equal(report.active_lane_count, 1);
  assert.equal(report.stale_lane_count, 1);
  assert.equal(report.missing_closed_at_count, 1);
  assert.equal(report.truth_failure_count, 1);

  assert.ok(codex);
  assert.equal(codex.total_lanes, 2);
  assert.equal(codex.stale_rate, 1);
  assert.equal(codex.median_cycle_hours, 2);

  assert.ok(claude);
  assert.equal(claude.missing_closed_at_rate, 1);
  assert.equal(claude.truth_failure_rate, 1);
});
