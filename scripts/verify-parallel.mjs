#!/usr/bin/env node
/**
 * Agent-facing full verification wrapper.
 *
 * Runs the canonical `pnpm verify` unchanged, records its complete output under
 * .out/verify, and keeps the console concise. The old implementation duplicated
 * only part of `verify` and could silently drift behind the real gate.
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const FAILURE_TAIL_LINES = 60;

export function boundedTail(value, limit = FAILURE_TAIL_LINES) {
  return value.split(/\r?\n/u).filter(Boolean).slice(-limit).join('\n');
}

export function verificationLogPath(root, now = new Date()) {
  const stamp = now.toISOString().replace(/[:.]/gu, '-');
  return path.join(root, '.out', 'verify', `verify-${stamp}.log`);
}

export function runVerification({
  root = process.cwd(),
  command = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm',
  args = ['run', 'verify'],
  now = new Date(),
} = {}) {
  const logPath = verificationLogPath(root, now);
  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  const log = fs.createWriteStream(logPath, { flags: 'wx' });
  const startedAt = Date.now();
  let output = '';
  let pending = '';

  process.stdout.write(
    `[verify:agent] running canonical pnpm verify; full log: ${logPath}\n`,
  );

  const child = spawn(command, args, {
    cwd: root,
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: false,
  });

  const capture = (chunk) => {
    const text = chunk.toString();
    output += text;
    log.write(text);
    pending += text;
    const lines = pending.split(/\r?\n/u);
    pending = lines.pop() ?? '';
    for (const line of lines) {
      const match = /^> @unit-talk\/[^ ]+@[^ ]+ ([^ ]+) /u.exec(line);
      if (match) process.stdout.write(`[verify:agent] ${match[1]}\n`);
    }
  };

  child.stdout.on('data', capture);
  child.stderr.on('data', capture);

  return new Promise((resolve) => {
    let settled = false;
    child.on('error', (error) => {
      if (settled) return;
      settled = true;
      const message = `[verify:agent] failed to spawn canonical verify: ${error.message}`;
      output += `${message}\n`;
      log.end(`${message}\n`, () => resolve({ code: 1, logPath, output }));
    });
    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      log.end(() => {
        const elapsedSeconds = ((Date.now() - startedAt) / 1000).toFixed(1);
        if (code === 0) {
          process.stdout.write(
            `[verify:agent] PASS in ${elapsedSeconds}s; full log: ${logPath}\n`,
          );
        } else {
          process.stderr.write(
            `[verify:agent] FAIL (exit ${code ?? 1}) in ${elapsedSeconds}s; full log: ${logPath}\n` +
              `${boundedTail(output)}\n`,
          );
        }
        resolve({ code: code ?? 1, logPath, output });
      });
    });
  });
}

const isMain =
  process.argv[1] &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  const result = await runVerification();
  process.exitCode = result.code;
}
