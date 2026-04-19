import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { pathToFileURL } from 'node:url';
import { ROOT, ensureDir, relativeToRoot } from './shared.js';

type CleanupAction = 'commit' | 'move' | 'delete' | 'abort';

export function normalizeUntrackedScriptFiles(stdout: string): string[] {
  return stdout
    .split(/\r?\n/)
    .map((entry) => entry.trim().replaceAll('\\', '/'))
    .filter((entry) => entry.length > 0)
    .filter((entry) => entry.startsWith('scripts/'))
    .filter((entry) => !entry.includes('../'))
    .sort((left, right) => left.localeCompare(right));
}

function git(args: string[]): { ok: boolean; stdout: string; stderr: string; status: number | null } {
  const result = spawnSync('git', args, {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: 'pipe',
  });
  return {
    ok: result.status === 0,
    stdout: result.stdout.trim(),
    stderr: result.stderr.trim(),
    status: result.status,
  };
}

function listUntrackedScriptFiles(): string[] {
  const result = git(['ls-files', '--others', '--exclude-standard', '--', 'scripts']);
  if (!result.ok) {
    throw new Error(`Unable to list untracked scripts: ${result.stderr || result.status}`);
  }
  return normalizeUntrackedScriptFiles(result.stdout);
}

function resolveRepoFile(filePath: string): string {
  const absolute = path.resolve(ROOT, filePath);
  const relative = path.relative(ROOT, absolute);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`Refusing path outside repo: ${filePath}`);
  }
  if (!filePath.replaceAll('\\', '/').startsWith('scripts/')) {
    throw new Error(`Refusing non-scripts path: ${filePath}`);
  }
  return absolute;
}

async function promptAction(files: string[]): Promise<{ action: CleanupAction; message?: string }> {
  const rl = readline.createInterface({ input, output });
  try {
    const actionRaw = (await rl.question('Action [commit/move/delete/abort]: ')).trim().toLowerCase();
    const action = actionRaw as CleanupAction;
    if (!['commit', 'move', 'delete', 'abort'].includes(action)) {
      return { action: 'abort' };
    }
    if (action === 'abort') {
      return { action };
    }

    const expected = `${action} ${files.length} scripts`;
    const confirmation = (await rl.question(`Type "${expected}" to confirm: `)).trim();
    if (confirmation !== expected) {
      return { action: 'abort' };
    }

    if (action === 'commit') {
      const message = (await rl.question('Commit message: ')).trim();
      if (!message) {
        throw new Error('Commit message is required for commit action');
      }
      return { action, message };
    }

    return { action };
  } finally {
    rl.close();
  }
}

function commitFiles(files: string[], message: string): void {
  const add = git(['add', '--', ...files]);
  if (!add.ok) {
    throw new Error(`git add failed: ${add.stderr || add.status}`);
  }

  const commit = git(['commit', '-m', message, '--', ...files]);
  if (!commit.ok) {
    throw new Error(`git commit failed: ${commit.stderr || commit.status}`);
  }
  console.log(commit.stdout);
}

function moveFiles(files: string[]): void {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const targetRoot = path.join(ROOT, 'scratch', 'scripts-cleanup', stamp);
  ensureDir(targetRoot);

  for (const file of files) {
    const source = resolveRepoFile(file);
    const target = path.join(targetRoot, path.relative(path.join(ROOT, 'scripts'), source));
    ensureDir(path.dirname(target));
    if (fs.existsSync(target)) {
      throw new Error(`Refusing to overwrite existing scratch file: ${relativeToRoot(target)}`);
    }
    fs.renameSync(source, target);
    console.log(`${file} -> ${relativeToRoot(target)}`);
  }
}

function deleteFiles(files: string[]): void {
  for (const file of files) {
    const absolute = resolveRepoFile(file);
    fs.rmSync(absolute, { force: false, recursive: false });
    console.log(`deleted ${file}`);
  }
}

export async function main(): Promise<number> {
  const files = listUntrackedScriptFiles();
  if (files.length === 0) {
    console.log('No untracked files under scripts/.');
    return 0;
  }

  console.log('Untracked files under scripts/:');
  files.forEach((file, index) => {
    console.log(`${index + 1}. ${file}`);
  });
  console.log('');
  console.log('Choose exactly one action. Delete is permanent.');

  const { action, message } = await promptAction(files);
  if (action === 'abort') {
    console.log('Aborted. No files changed.');
    return 0;
  }
  if (action === 'commit') {
    commitFiles(files, message ?? '');
    return 0;
  }
  if (action === 'move') {
    moveFiles(files);
    return 0;
  }
  if (action === 'delete') {
    deleteFiles(files);
    return 0;
  }

  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    });
}
