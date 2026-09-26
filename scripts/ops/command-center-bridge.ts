/**
 * Governed operator access to the Command Center — WORK-2026092407.
 *
 * ## Why this exists
 *
 * The Command Center is internal-only by design. `deploy/production/docker-compose.yml`
 * publishes it on `127.0.0.1:4300` of the production host and gives it no Caddy site
 * block and no public hostname. PM decision 7 (2026-09-24) keeps it that way: no public
 * DNS, no public hostname, no exposure of port 4300.
 *
 * The compose comment names `ssh -L 4300:127.0.0.1:4300` as the way in. That does not
 * work: the host runs `AllowTcpForwarding no`, so the forward connects and is then reset.
 * That is a production security control and this tool does not ask anyone to relax it.
 *
 * Shell exec is not disabled. This bridge listens on the operator's own loopback and,
 * for each connection, runs `nc 127.0.0.1 4300` on the host over an ordinary SSH
 * session, piping bytes both ways. The Command Center sees a loopback client exactly as
 * it would through a forward.
 *
 * ## What it deliberately does NOT do
 *
 * It injects no credential. The hand-started `cc-proxy` container it replaces added the
 * operator bearer token to every request, which meant any process on the host loopback
 * had authenticated access with no credential at all. The Command Center has served its
 * own sign-in page since #1624, so the operator signs in there and the token never
 * leaves the operator's hands.
 *
 * It binds loopback only, and refuses any other address: a bridge on `0.0.0.0` would
 * republish an internal surface to the operator's network.
 *
 * It changes nothing on the host: no sshd setting, no port, no container, no firewall.
 */
import { spawn } from 'node:child_process';
import type { Readable, Writable } from 'node:stream';
import http from 'node:http';
import net from 'node:net';
import { pathToFileURL } from 'node:url';

export const DEFAULT_SSH_HOST = 'unit-talk-prod';
export const DEFAULT_LOCAL_PORT = 4300;
/** The Command Center's own port on the host loopback. */
export const DEFAULT_REMOTE_PORT = 4300;
export const DEFAULT_BIND_ADDRESS = '127.0.0.1';

const LOOPBACK_ADDRESSES = new Set(['127.0.0.1', '::1', 'localhost']);
// A leading '-' would let a host value be read by ssh as an option.
const SSH_HOST_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._@-]*$/;

export interface BridgeOptions {
  host: string;
  localPort: number;
  remotePort: number;
  bindAddress: string;
  check: boolean;
}

export class BridgeArgumentError extends Error {}

function assertSshHost(host: string): void {
  if (host.length > 253 || !SSH_HOST_PATTERN.test(host)) {
    throw new BridgeArgumentError(`--host must be an ssh host or alias, got ${JSON.stringify(host)}`);
  }
}

function parsePort(flag: string, raw: string | undefined, allowZero: boolean): number {
  if (raw === undefined || !/^\d+$/.test(raw)) {
    throw new BridgeArgumentError(`${flag} must be an integer port, got ${JSON.stringify(raw ?? null)}`);
  }
  const port = Number(raw);
  if (port > 65535 || (port === 0 && !allowZero)) {
    throw new BridgeArgumentError(`${flag} must be between ${allowZero ? 0 : 1} and 65535, got ${port}`);
  }
  return port;
}

export function parseBridgeArgs(argv: readonly string[]): BridgeOptions {
  const options: BridgeOptions = {
    host: DEFAULT_SSH_HOST,
    localPort: DEFAULT_LOCAL_PORT,
    remotePort: DEFAULT_REMOTE_PORT,
    bindAddress: DEFAULT_BIND_ADDRESS,
    check: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    switch (flag) {
      case '--host':
        options.host = argv[++i] ?? '';
        break;
      case '--local-port':
        options.localPort = parsePort(flag, argv[++i], true);
        break;
      case '--remote-port':
        options.remotePort = parsePort(flag, argv[++i], false);
        break;
      case '--bind':
        options.bindAddress = argv[++i] ?? '';
        break;
      case '--check':
        options.check = true;
        break;
      default:
        throw new BridgeArgumentError(`unknown argument ${JSON.stringify(flag)}`);
    }
  }
  assertSshHost(options.host);
  if (!LOOPBACK_ADDRESSES.has(options.bindAddress)) {
    throw new BridgeArgumentError(
      `--bind must be a loopback address (127.0.0.1, ::1, localhost); refusing ${JSON.stringify(options.bindAddress)}, which would republish an internal-only surface`,
    );
  }
  return options;
}

/**
 * The ssh invocation for one bridged connection.
 *
 * It is handed to `spawn` as an argv array, never through a local shell. The remote command
 * does pass through the host's shell, so it is built only from a literal and a port that is
 * re-validated here as an integer, whatever the caller did. The host is re-validated too, and
 * `--` stops ssh from reading it, or anything after it, as an option.
 */
export function buildSshArgs(host: string, remotePort: number): string[] {
  assertSshHost(host);
  if (!Number.isInteger(remotePort) || remotePort < 1 || remotePort > 65535) {
    throw new BridgeArgumentError(`remote port must be an integer between 1 and 65535, got ${String(remotePort)}`);
  }
  return [
    '-T', // never a pty: the stream is raw bytes
    '-e', 'none', // no escape character, so no byte sequence in the stream is interpreted by ssh
    '-o', 'BatchMode=yes',
    '-o', 'ServerAliveInterval=30',
    '-o', 'ClearAllForwardings=yes',
    '--',
    host,
    `nc 127.0.0.1 ${remotePort}`,
  ];
}

export interface BridgeChild {
  stdin: Writable | null;
  stdout: Readable | null;
  kill(): boolean;
  /** Emitted after the process has exited AND its stdio has closed, so all output has been read. */
  once(event: 'close', listener: () => void): unknown;
  once(event: 'error', listener: (error: Error) => void): unknown;
}

/** How long a client whose ssh child has finished may take to close before it is destroyed. */
export const CLIENT_DRAIN_MS = 5_000;

export type SpawnChild = (args: string[]) => BridgeChild;

export const spawnSsh: SpawnChild = (args) =>
  spawn('ssh', args, { stdio: ['pipe', 'pipe', 'inherit'] });

/** A server that carries every accepted connection over its own ssh child. */
export function createBridgeServer(
  host: string,
  remotePort: number,
  spawnChild: SpawnChild = spawnSsh,
): net.Server {
  const args = buildSshArgs(host, remotePort);
  return net.createServer((socket) => {
    const child = spawnChild(args);
    let closed = false;
    // Hard teardown: the client went away, or the child could not run. Nothing is left to deliver.
    const teardown = () => {
      if (closed) return;
      closed = true;
      socket.destroy();
      child.kill();
    };
    // Graceful teardown: the child finished. Its last bytes may still be queued for the client,
    // so end the socket (which flushes) instead of destroying it, and destroy only as a backstop.
    // Reacting to 'exit' instead of 'close' here would cut off the tail of a response.
    const drain = () => {
      if (closed) return;
      socket.end();
      setTimeout(teardown, CLIENT_DRAIN_MS).unref();
    };
    child.once('error', teardown);
    child.once('close', drain);
    socket.once('close', teardown);
    socket.on('error', teardown);
    // A write after the far side has gone is EPIPE; the close handler owns cleanup.
    child.stdin?.on('error', () => undefined);
    child.stdout?.on('error', teardown);
    if (child.stdin) socket.pipe(child.stdin);
    child.stdout?.pipe(socket);
  });
}

export interface HealthVerdict {
  ok: boolean;
  reason: string;
}

/** `/api/health` is public and answers only liveness; anything else is a failed check. */
export function evaluateHealthResponse(status: number | null, body: string): HealthVerdict {
  if (status === null) return { ok: false, reason: 'no response' };
  if (status !== 200) return { ok: false, reason: `HTTP ${status}` };
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return { ok: false, reason: 'response is not JSON' };
  }
  const record = parsed as { ok?: unknown; service?: unknown } | null;
  if (record?.ok !== true || record.service !== 'command-center') {
    return { ok: false, reason: `unexpected body ${body.slice(0, 200)}` };
  }
  return { ok: true, reason: 'command-center reports ok' };
}

export function requestHealth(
  port: number,
  address = DEFAULT_BIND_ADDRESS,
  timeoutMs = 20_000,
): Promise<HealthVerdict> {
  return new Promise((resolve) => {
    const request = http.get(
      { host: address, port, path: '/api/health', headers: { Connection: 'close' }, timeout: timeoutMs },
      (response) => {
        let body = '';
        response.setEncoding('utf8');
        response.on('data', (chunk: string) => {
          body += chunk;
        });
        response.on('end', () => resolve(evaluateHealthResponse(response.statusCode ?? null, body)));
        response.on('error', (error) => resolve({ ok: false, reason: error.message }));
      },
    );
    request.on('timeout', () => request.destroy(new Error(`no answer within ${timeoutMs}ms`)));
    request.on('error', (error) => resolve({ ok: false, reason: error.message }));
  });
}

function listen(server: net.Server, port: number, address: string): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, address, () => {
      server.off('error', reject);
      const bound = server.address();
      resolve(typeof bound === 'object' && bound ? bound.port : port);
    });
  });
}

export async function runBridge(options: BridgeOptions, spawnChild: SpawnChild = spawnSsh): Promise<number> {
  const server = createBridgeServer(options.host, options.remotePort, spawnChild);
  if (options.check) {
    const port = await listen(server, 0, options.bindAddress);
    const verdict = await requestHealth(port, options.bindAddress);
    server.close();
    console.log(JSON.stringify({ check: 'command-center-bridge', host: options.host, ...verdict }));
    return verdict.ok ? 0 : 1;
  }
  const port = await listen(server, options.localPort, options.bindAddress);
  console.log(
    `Command Center bridge: http://${options.bindAddress}:${port} -> ${options.host}:127.0.0.1:${options.remotePort} (sign in on the page; Ctrl-C to stop)`,
  );
  return new Promise(() => undefined);
}

const entrypoint = process.argv[1] ? pathToFileURL(process.argv[1]).href : '';
if (import.meta.url === entrypoint) {
  let options: BridgeOptions;
  try {
    options = parseBridgeArgs(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(2);
  }
  runBridge(options).then(
    (code) => process.exit(code),
    (error: unknown) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    },
  );
}
