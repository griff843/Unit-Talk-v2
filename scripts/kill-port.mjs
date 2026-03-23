/**
 * kill-port.mjs — kill any process listening on the given TCP port.
 *
 * Usage: node scripts/kill-port.mjs <port>
 *
 * Cross-platform: Windows uses netstat+taskkill, Unix uses lsof+kill.
 * Exits 0 regardless (port already free = success).
 */

import { execSync } from 'child_process';

const port = process.argv[2];
if (!port || !/^\d+$/.test(port)) {
  console.error('Usage: node scripts/kill-port.mjs <port>');
  process.exit(1);
}

function getPidsOnPortWindows(port) {
  try {
    const out = execSync(`netstat -ano`, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] });
    const pids = new Set();
    for (const line of out.split('\n')) {
      // Match lines like "TCP    0.0.0.0:4100    0.0.0.0:0    LISTENING    36184"
      if (line.includes(`:${port} `) || line.includes(`:${port}\t`)) {
        const parts = line.trim().split(/\s+/);
        const pid = parts[parts.length - 1];
        if (pid && /^\d+$/.test(pid) && pid !== '0') {
          pids.add(pid);
        }
      }
    }
    return [...pids];
  } catch {
    return [];
  }
}

function killWindows(pids) {
  for (const pid of pids) {
    try {
      execSync(`taskkill /PID ${pid} /F`, { stdio: 'ignore' });
      console.log(`Killed PID ${pid} (was holding port ${port})`);
    } catch {
      // Already gone
    }
  }
}

function killUnix(port) {
  try {
    execSync(`lsof -ti:${port} | xargs kill -9`, { shell: true, stdio: 'ignore' });
    console.log(`Killed process(es) on port ${port}`);
  } catch {
    // No process on port — that's fine
  }
}

if (process.platform === 'win32') {
  const pids = getPidsOnPortWindows(port);
  if (pids.length === 0) {
    console.log(`Port ${port} is free.`);
  } else {
    killWindows(pids);
  }
} else {
  killUnix(port);
}
