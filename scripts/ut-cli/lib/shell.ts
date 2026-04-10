import { spawnSync } from 'node:child_process';

import type { ShellAdapter, ShellResult } from '../types.js';

export class NodeShellAdapter implements ShellAdapter {
  run(
    command: string,
    args: string[],
    options: {
      cwd?: string;
      allowNonZero?: boolean;
      shell?: boolean;
    } = {},
  ): ShellResult {
    const result = spawnSync(command, args, {
      cwd: options.cwd,
      encoding: 'utf8',
      stdio: 'pipe',
      shell: options.shell ?? false,
    });
    return {
      status: result.status,
      stdout: result.stdout ?? '',
      stderr: result.stderr ?? '',
    };
  }
}

export function currentShellCommand(): { command: string; args: string[] } {
  if (process.platform === 'win32') {
    return { command: 'cmd.exe', args: ['/d', '/s', '/c'] };
  }
  return { command: 'sh', args: ['-c'] };
}
