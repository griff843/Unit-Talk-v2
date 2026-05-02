import assert from 'node:assert/strict';
import test from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import AgentsPage from './agents/page';
import ApiHealthPage from './api-health/page';
import EventsPage from './events/page';
import IntelligencePage from './intelligence/page';
import OpsPage from './ops/page';
import OverviewPage from './page';
import PicksPage from './picks/page';
import PipelinePage from './pipeline/page';

test('overview route renders new command deck shell', async () => {
  const html = renderToStaticMarkup(await OverviewPage());
  assert.match(html, /Overview/);
  assert.match(html, /Pipeline status band/);
});

test('picks route renders operator workflow content', async () => {
  const html = renderToStaticMarkup(await PicksPage());
  assert.match(html, /Picks/);
  assert.match(html, /Picks waiting for action/);
});

test('pipeline route renders flow surface', async () => {
  const html = renderToStaticMarkup(await PipelinePage());
  assert.match(html, /Pipeline/);
  assert.match(html, /Current lane posture/);
});

test('events route renders readable event replay', async () => {
  const html = renderToStaticMarkup(await EventsPage());
  assert.match(html, /Events/);
  assert.match(html, /Readable event replay/);
});

test('api health route renders provider matrix', async () => {
  const html = renderToStaticMarkup(await ApiHealthPage());
  assert.match(html, /API Health/);
  assert.match(html, /Provider matrix/);
});

test('agents route renders execution network', async () => {
  const html = renderToStaticMarkup(await AgentsPage());
  assert.match(html, /Agents/);
  assert.match(html, /Execution network/);
});

test('intelligence route renders model economics', async () => {
  const html = renderToStaticMarkup(await IntelligencePage());
  assert.match(html, /Intelligence/);
  assert.match(html, /Model economics at a glance/);
});

test('ops route renders control room surfaces', async () => {
  const html = renderToStaticMarkup(await OpsPage());
  assert.match(html, /Ops/);
  assert.match(html, /Recent operator interventions/);
});
