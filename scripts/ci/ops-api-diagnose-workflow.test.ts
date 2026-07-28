import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import YAML from 'yaml';

const DIAGNOSE = path.join(process.cwd(), '.github', 'workflows', 'ops-api-diagnose.yml');
const CONTAINMENT = path.join(process.cwd(), '.github', 'workflows', 'ops-p0-containment.yml');

interface Step { name?: string; run?: string; uses?: string; with?: Record<string, unknown>; if?: string }
interface Workflow { on?: Record<string, unknown>; jobs?: Record<string, { steps?: Step[] }> }

function load(file: string): { text: string; workflow: Workflow; steps: Step[] } {
  const text = fs.readFileSync(file, 'utf8');
  const workflow = YAML.parse(text) as Workflow;
  const job = Object.values(workflow.jobs ?? {})[0];
  return { text, workflow, steps: job?.steps ?? [] };
}

/** Body of the quoted heredoc delivered to the host on ssh stdin. */
function remoteBody(steps: Step[], delim: string): string {
  const run = steps.map((s) => s.run ?? '').find((r) => r.includes(`<<'${delim}'`)) ?? '';
  const start = run.indexOf(`<<'${delim}'`);
  assert.ok(start >= 0, `expected a quoted ${delim} heredoc`);
  const bodyStart = run.indexOf('\n', start) + 1;
  const end = run.indexOf(`\n${delim}\n`, bodyStart);
  assert.ok(end > bodyStart, `${delim} heredoc must be terminated`);
  return run.slice(bodyStart, end);
}

// ---------------------------------------------------------------------------
// 1. Containment: every compose evaluation receives UNIT_TALK_IMAGE_TAG.
// ---------------------------------------------------------------------------

test('REGRESSION (first production run): every compose evaluation has UNIT_TALK_IMAGE_TAG', () => {
  const { steps } = load(CONTAINMENT);
  const body = remoteBody(steps, 'REMOTE_SCRIPT');

  const exportIndex = body.indexOf('export UNIT_TALK_IMAGE_TAG');
  assert.ok(exportIndex >= 0, 'the release tag must be exported, not passed inline on one command');

  // The production compose file declares ${UNIT_TALK_IMAGE_TAG:?required} for every
  // service, so a compose call evaluated before the export fails to interpolate.
  // That is exactly why run 30363396719 could not verify its own containment.
  const composeLines = body
    .split('\n')
    .map((line, i) => ({ line: line.replace(/#.*$/, ''), i }))
    .filter(({ line }) => /\bdocker compose\b/.test(line))
    .filter(({ line }) => !/^\s*(echo|printf)\b/.test(line.trim()));

  assert.ok(composeLines.length >= 4, 'expected pre-state, restart and post-state compose calls');
  const exportLine = body.slice(0, exportIndex).split('\n').length;
  for (const { line, i } of composeLines) {
    assert.ok(
      i + 1 > exportLine,
      `compose call evaluated before the tag is exported (line ${i + 1}): ${line.trim()}`,
    );
  }
});

test('REGRESSION: the DIAGNOSE workflow also exports the tag before its own compose calls', () => {
  // The ordering test above covers only the containment workflow. The review
  // proved that removing `export UNIT_TALK_IMAGE_TAG` from ops-api-diagnose.yml
  // left all its tests green — the exact defect class this lane exists to close,
  // reproduced in the sibling file with no coverage.
  const body = remoteBody(load(DIAGNOSE).steps, 'REMOTE');

  const exportIndex = body.indexOf('export UNIT_TALK_IMAGE_TAG');
  assert.ok(exportIndex >= 0, 'the diagnostic must export the release tag, not rely on ambient context');
  const exportLine = body.slice(0, exportIndex).split('\n').length;

  const composeLines = body
    .split('\n')
    .map((line, i) => ({ line: line.replace(/#.*$/, ''), i }))
    .filter(({ line }) => /\bdocker compose\b/.test(line))
    .filter(({ line }) => !/^\s*(echo|printf)\b/.test(line.trim()));

  assert.ok(composeLines.length >= 3, 'expected compose ps and both exec calls');
  for (const { line, i } of composeLines) {
    assert.ok(
      i + 1 > exportLine,
      `diagnose compose call evaluated before the tag is exported (line ${i + 1}): ${line.trim()}`,
    );
  }
});

test('the containment release tag is read once and fails closed when empty', () => {
  const body = remoteBody(load(CONTAINMENT).steps, 'REMOTE_SCRIPT');
  assert.match(body, /UNIT_TALK_IMAGE_TAG="\$\(tr -d '\\r\\n' < \.unit-talk-release\)"/);
  assert.match(body, /if \[ -z "\$UNIT_TALK_IMAGE_TAG" \]; then/);
  assert.match(body, /\.unit-talk-release is empty; containment stopped\./);
});

// ---------------------------------------------------------------------------
// 2-5. Diagnostic verdict contract.
// ---------------------------------------------------------------------------

test('REGRESSION (flag drift): a failed containment check makes the job red', () => {
  const { steps } = load(DIAGNOSE);
  const body = remoteBody(steps, 'REMOTE');
  const runner = steps.map((s) => s.run ?? '').join('\n');

  // Drift sets CONTAINMENT_RC, which sets RC, which the script exits with.
  assert.match(body, /CONTAINMENT_RC=1/);
  assert.match(body, /exit "\$RC"/, 'the remote script must exit with its accumulated status');
  const exitIndex = body.lastIndexOf('exit "$RC"');
  assert.ok(exitIndex > body.indexOf('DIAGNOSTIC_COMPLETE'), 'exit must come after the receipts');

  // And the runner independently fails on the verdict.
  assert.match(runner, /CONTAINMENT_VERIFIED=true'.*\n[\s\S]{0,200}?exit 1/, 'runner must exit 1 on a failed containment verdict');
});

test('REGRESSION (internal health failure): required verdict makes the job red', () => {
  const { steps } = load(DIAGNOSE);
  const body = remoteBody(steps, 'REMOTE');
  const runner = steps.map((s) => s.run ?? '').join('\n');
  assert.match(body, /INTERNAL_HEALTH_RC=1/);
  assert.match(body, /INTERNAL_API_HEALTHY=(true|false)/);
  assert.ok(
    /INTERNAL_API_HEALTHY=true'[\s\S]{0,200}?exit 1/.test(runner),
    'a failed internal-health verdict must fail the job',
  );
});

test('REGRESSION (host-only failure): advisory verdict does NOT make the job red', () => {
  const { steps } = load(DIAGNOSE);
  const body = remoteBody(steps, 'REMOTE');
  const runner = steps.map((s) => s.run ?? '').join('\n');

  assert.match(body, /HOST_ENDPOINT_RC=1/);
  assert.match(body, /HOST_ENDPOINT_SEVERITY=advisory/);
  // Host reachability must not feed RC — it is a separate defect class.
  const hostBlock = body.slice(body.indexOf('HOST PORT HEALTH PROBE'), body.indexOf('CONTAINER-INTERNAL'));
  assert.doesNotMatch(hostBlock, /(^|\n)\s*RC=1/, 'host reachability must not set the overall RC');
  // The runner warns rather than failing.
  // Scope to the RUNNER side only: `runner` also contains the remote heredoc,
  // whose earlier required-verdict checks legitimately exit 1.
  const runnerSide = runner.slice(runner.indexOf('\nREMOTE\n'));
  const verdictBlock = runnerSide.slice(
    runnerSide.indexOf('HOST_ENDPOINT_REACHABLE=true'),
    runnerSide.indexOf('All required verdicts passed.'),
  );
  assert.match(verdictBlock, /::warning::/);
  assert.doesNotMatch(verdictBlock, /exit 1/, 'the advisory verdict must not fail the job');
});

test('REGRESSION (truncated execution): a missing sentinel fails the job', () => {
  const runner = load(DIAGNOSE).steps.map((s) => s.run ?? '').join('\n');
  assert.match(runner, /DIAGNOSTIC_COMPLETE=UTV2-1610'/);
  assert.ok(
    /DIAGNOSTIC_COMPLETE=UTV2-1610'[\s\S]{0,240}?exit 1/.test(runner),
    'an absent completion sentinel must fail the job, not warn',
  );
  // pipefail is what lets an ssh failure propagate through `tee`.
  assert.match(runner, /set -euo pipefail/);
  assert.match(runner, /\| tee "\$TRANSCRIPT"/);
});

test('the verdict contract is documented in the workflow itself', () => {
  const body = remoteBody(load(DIAGNOSE).steps, 'REMOTE');
  for (const marker of ['CONTAINMENT_VERIFIED', 'INTERNAL_API_HEALTHY', 'HOST_ENDPOINT_REACHABLE', 'DIAGNOSTIC_COMPLETE']) {
    assert.ok(body.includes(marker), `missing verdict: ${marker}`);
  }
  assert.match(body, /REQUIRED\./);
  assert.match(body, /ADVISORY\./);
});

// ---------------------------------------------------------------------------
// 6. Secret-log regression.
// ---------------------------------------------------------------------------

test('REGRESSION (secret exposure): the removed SERVICE_ROLE log path cannot return', () => {
  const { text, steps } = load(DIAGNOSE);
  const body = remoteBody(steps, 'REMOTE');

  // The previous revision printed the first 20 characters of the service-role key.
  assert.doesNotMatch(body, /SUPABASE_SERVICE_ROLE_KEY/, 'the remote script must never reference the service-role key');
  assert.doesNotMatch(body, /head -c 20/);

  // Only the three permitted keys may be read out of .env.production.
  const readKeys = [...body.matchAll(/\^\$\{?key\}?=|\^([A-Z_]+)=/g)].map((m) => m[1]).filter(Boolean);
  for (const key of readKeys) {
    assert.ok(
      ['SYNDICATE_MACHINE_ENABLED', 'BOARD_PICK_WRITER_ENABLED', 'UNIT_TALK_API_HOST_PORT'].includes(key),
      `unexpected env key read from .env.production: ${key}`,
    );
  }

  // The published artifact is redacted and guarded.
  assert.match(text, /diagnose-redacted\.log/);
  assert.match(text, /\(KEY\|SECRET\|TOKEN\|PASSWORD\|SERVICE_ROLE\)/);
  assert.match(text, /refusing to publish the artifact/);
  assert.match(text, /retention-days: 30/);
});

test('env value normalization is deterministic and preserves raw evidence', () => {
  const body = remoteBody(load(DIAGNOSE).steps, 'REMOTE');
  assert.match(body, /normalize_env_value\(\)/);
  // CR, surrounding whitespace and one layer of quotes.
  assert.match(body, /tr -d '\\r'/);
  assert.match(body, /s\/\^\[\[:space:\]\]\*\/\//);
  assert.ok(body.includes('raw=%s'), 'the raw value must still be reported as classified evidence');

  // Behavioural check of the same normalisation logic.
  const script = `
normalize_env_value() {
  printf '%s' "$1" | tr -d '\\r' | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//' -e 's/^"\\(.*\\)"$/\\1/' -e "s/^'\\(.*\\)'$/\\1/"
}
for v in 'false' "$(printf 'false\\r')" '  false  ' '"false"' "'false'" 'true' '' 'FALSE'; do
  printf '%s|' "$(normalize_env_value "$v")"
done
`;
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'norm-')), 'n.sh');
  fs.writeFileSync(file, script);
  const out = spawnSync('bash', [file], { encoding: 'utf8' });
  assert.strictEqual(out.status, 0, out.stderr);
  assert.strictEqual(out.stdout, 'false|false|false|false|false|true||FALSE|');
});

test('both workflows remain valid shell after hardening', () => {
  for (const file of [DIAGNOSE, CONTAINMENT]) {
    const { steps } = load(file);
    for (const [index, step] of steps.entries()) {
      if (!step.run) continue;
      const scratch = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'wf-')), `s${index}.sh`);
      fs.writeFileSync(scratch, step.run);
      const result = spawnSync('bash', ['-n', scratch], { encoding: 'utf8' });
      assert.strictEqual(result.status, 0, `${path.basename(file)} step ${index}: ${result.stderr}`);
    }
  }
  // And the remote heredoc bodies, which `bash -n` on the run block never parses.
  for (const [file, delim] of [[DIAGNOSE, 'REMOTE'], [CONTAINMENT, 'REMOTE_SCRIPT']] as const) {
    const scratch = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'wf-remote-')), 'remote.sh');
    fs.writeFileSync(scratch, remoteBody(load(file).steps, delim));
    const result = spawnSync('bash', ['-n', scratch], { encoding: 'utf8' });
    assert.strictEqual(result.status, 0, `${path.basename(file)} remote body: ${result.stderr}`);
  }
});

// ---------------------------------------------------------------------------
// Exact-head review remediation: artifact gating and host-port validation.
// ---------------------------------------------------------------------------

test('a failed redaction guard cannot publish an artifact', () => {
  const { workflow, steps } = load(DIAGNOSE);
  const redact = steps.find((s) => s.name === 'Redact diagnostic transcript');
  const publish = steps.find((s) => s.uses?.startsWith('actions/upload-artifact'));

  assert.ok(redact, 'the redaction step must exist');
  assert.strictEqual((redact as { id?: string }).id, 'redact', 'the redaction step needs a stable id');

  // The guard makes the job red.
  assert.match(redact?.run ?? '', /::error::/);
  assert.match(redact?.run ?? '', /exit 1/);

  // Publication is conditioned on that step SUCCEEDING — `always()` alone would
  // publish precisely when the secret guard tripped.
  assert.ok(publish, 'the upload step must exist');
  assert.match(String(publish?.if ?? ''), /steps\.redact\.outcome == 'success'/);
  assert.ok(
    !/^\s*always\(\)\s*$/.test(String(publish?.if ?? '')),
    'upload must not fall back through a bare always()',
  );
  assert.strictEqual((publish?.with ?? {})['retention-days'], 30);
  void workflow;
});

test('the host port is normalized and validated before a URL is built', () => {
  const body = remoteBody(load(DIAGNOSE).steps, 'REMOTE');

  // Normalised with the SAME function as the containment keys.
  assert.match(body, /HOST_PORT="\$\(normalize_env_value "\$HOST_PORT_RAW"\)"/);
  // Rejected when non-numeric or outside the valid TCP range.
  assert.match(body, /\*\[!0-9\]\*\) HOST_PORT_VALID=false/);
  assert.match(body, /-lt 1 \]\s*\|\|\s*\[ "\$HOST_PORT" -gt 65535/);
  // And the probe refuses to construct a URL from an invalid port.
  const probe = body.slice(body.indexOf('HOST PORT HEALTH PROBE'));
  assert.match(probe, /if \[ "\$HOST_PORT_VALID" != 'true' \]; then/);
  const skipIndex = probe.indexOf('refusing to construct a probe URL');
  const curlIndex = probe.indexOf('curl -fsS');
  assert.ok(skipIndex >= 0 && skipIndex < curlIndex, 'the invalid-port branch must precede any curl');
  // Raw value still surfaced as classified evidence.
  assert.match(body, /UNIT_TALK_API_HOST_PORT raw=%s normalized=%s source=%s valid=%s/);
});

test('port normalization and validation behave correctly across real inputs', () => {
  const script = `
normalize_env_value() {
  printf '%s' "$1" | tr -d '\\r' | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//' -e 's/^"\\(.*\\)"$/\\1/' -e "s/^'\\(.*\\)'$/\\1/"
}
classify() {
  HOST_PORT="$(normalize_env_value "$1")"
  SRC=env
  if [ -z "$HOST_PORT" ]; then HOST_PORT=4000; SRC=default; fi
  VALID=true
  case "$HOST_PORT" in
    ''|*[!0-9]*) VALID=false ;;
    *) if [ "$HOST_PORT" -lt 1 ] || [ "$HOST_PORT" -gt 65535 ]; then VALID=false; fi ;;
  esac
  printf '%s:%s:%s|' "$HOST_PORT" "$SRC" "$VALID"
}
classify '4001'
classify '"4001"'
classify '  4001  '
classify "$(printf '4001\\r')"
classify ''
classify 'abc'
classify '99999'
classify '0'
classify '65535'
`;
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'port-')), 'p.sh');
  fs.writeFileSync(file, script);
  const out = spawnSync('bash', [file], { encoding: 'utf8' });
  assert.strictEqual(out.status, 0, out.stderr);
  assert.strictEqual(
    out.stdout,
    [
      '4001:env:true',      // plain
      '4001:env:true',      // quoted
      '4001:env:true',      // whitespace-padded
      '4001:env:true',      // CRLF
      '4000:default:true',  // empty -> documented default
      'abc:env:false',      // non-numeric rejected
      '99999:env:false',    // above range rejected
      '0:env:false',        // below range rejected
      '65535:env:true',     // boundary accepted
    ].join('|') + '|',
  );
});
