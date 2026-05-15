import { spawnSync } from 'node:child_process';

function readStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    let input = '';

    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk: string) => {
      input += chunk;
    });
    process.stdin.on('end', () => resolve(input));
    process.stdin.on('error', reject);
  });
}

function readStopReason(input: string): string {
  if (!input.trim()) {
    return 'session-end';
  }

  try {
    const payload = JSON.parse(input) as { stop_reason?: unknown };
    return typeof payload.stop_reason === 'string' && payload.stop_reason.trim()
      ? payload.stop_reason.trim()
      : 'session-end';
  } catch {
    return 'session-end';
  }
}

function eventForStopReason(stopReason: string): 'complete' | 'fail' {
  const normalized = stopReason.toLowerCase();
  return normalized.includes('error') || normalized.includes('abort') ? 'fail' : 'complete';
}

function notifyCommand(stopReason: string): { command: string; args: string[] } {
  const args = [
    'tsx',
    'scripts/agent-notify/notify.ts',
    `--event=${eventForStopReason(stopReason)}`,
    '--agent=claude',
    `--detail=${stopReason}`,
  ];

  return process.platform === 'win32'
    ? { command: 'cmd.exe', args: ['/d', '/s', '/c', 'npx', ...args] }
    : { command: 'npx', args };
}

readStdin()
  .then((input) => {
    const stopReason = readStopReason(input);
    const command = notifyCommand(stopReason);
    const child = spawnSync(command.command, command.args, { stdio: 'inherit' });

    if (child.error) {
      process.stderr.write(`agent-stop-hook: notification skipped: ${child.error.message}\n`);
    }

    process.exitCode = 0;
  })
  .catch(() => {
    process.exitCode = 0;
  });
