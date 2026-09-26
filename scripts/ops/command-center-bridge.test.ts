import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import http from 'node:http';
import net from 'node:net';
import { PassThrough, Transform } from 'node:stream';
import { test } from 'node:test';
import {
  BridgeArgumentError,
  buildSshArgs,
  createBridgeServer,
  evaluateHealthResponse,
  parseBridgeArgs,
  requestHealth,
  runBridge,
  type BridgeChild,
  type SpawnChild,
} from './command-center-bridge.js';

/** A stand-in for the ssh child: upper-cases whatever it is sent, like a far side that answers. */
class FakeChild extends EventEmitter implements BridgeChild {
  stdin: PassThrough;
  stdout: Transform;
  killed = 0;
  constructor() {
    super();
    this.stdin = new PassThrough();
    this.stdout = new Transform({
      transform(chunk: Buffer, _encoding, done) {
        done(null, Buffer.from(chunk.toString('utf8').toUpperCase()));
      },
    });
    this.stdin.pipe(this.stdout);
  }
  kill(): boolean {
    this.killed += 1;
    return true;
  }
}

function listening(server: net.Server): Promise<number> {
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      resolve(typeof address === 'object' && address ? address.port : 0);
    });
  });
}

function waitFor(predicate: () => boolean, timeoutMs = 2000): Promise<void> {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      if (predicate()) return resolve();
      if (Date.now() - started > timeoutMs) return reject(new Error('condition not reached'));
      setTimeout(tick, 10);
    };
    tick();
  });
}

test('defaults bridge the Command Center port on the loopback', () => {
  assert.deepEqual(parseBridgeArgs([]), {
    host: 'unit-talk-prod',
    localPort: 4300,
    remotePort: 4300,
    bindAddress: '127.0.0.1',
    check: false,
  });
});

test('flags are parsed', () => {
  assert.deepEqual(
    parseBridgeArgs(['--host', 'deploy@10.0.0.5', '--local-port', '4399', '--remote-port', '4300', '--bind', '::1', '--check']),
    { host: 'deploy@10.0.0.5', localPort: 4399, remotePort: 4300, bindAddress: '::1', check: true },
  );
});

test('a non-loopback bind is refused, because it would republish an internal-only surface', () => {
  for (const bind of ['0.0.0.0', '::', '192.168.1.10', '']) {
    assert.throws(() => parseBridgeArgs(['--bind', bind]), BridgeArgumentError, bind);
  }
});

test('a host that ssh could read as an option, or a shell fragment, is refused', () => {
  for (const host of ['-oProxyCommand=sh', 'prod;rm', 'prod host', '', '$(id)']) {
    assert.throws(() => parseBridgeArgs(['--host', host]), BridgeArgumentError, host);
  }
});

test('ports must be integers in range', () => {
  for (const port of ['abc', '-1', '65536', '43.5', '']) {
    assert.throws(() => parseBridgeArgs(['--remote-port', port]), BridgeArgumentError, port);
  }
  assert.throws(() => parseBridgeArgs(['--remote-port', '0']), BridgeArgumentError);
  assert.equal(parseBridgeArgs(['--local-port', '0']).localPort, 0);
  assert.throws(() => parseBridgeArgs(['--remote-port']), BridgeArgumentError);
});

test('unknown arguments are refused rather than ignored', () => {
  assert.throws(() => parseBridgeArgs(['--insecure']), BridgeArgumentError);
});

test('ssh runs a shell-exec nc to the host loopback and asks for no forwarding', () => {
  const args = buildSshArgs('unit-talk-prod', 4300);
  assert.equal(args.at(-1), 'nc 127.0.0.1 4300');
  assert.equal(args.at(-2), 'unit-talk-prod');
  // '--' ends ssh option parsing, so neither the host nor the command can be read as an option.
  assert.equal(args.at(-3), '--');
  assert.ok(args.includes('-T'));
  assert.equal(args[args.indexOf('-e') + 1], 'none');
  assert.ok(args.includes('BatchMode=yes'));
  assert.ok(args.includes('ClearAllForwardings=yes'));
  assert.ok(!args.some((arg) => arg === '-L' || arg === '-R' || arg === '-D' || arg === '-W'));
});

test('buildSshArgs re-validates its own inputs rather than trusting the caller', () => {
  for (const host of ['-oProxyCommand=sh', 'prod;id', 'prod host', '', '`id`', 'a'.repeat(254)]) {
    assert.throws(() => buildSshArgs(host, 4300), BridgeArgumentError, host);
  }
  for (const port of [0, -1, 65536, 43.5, Number.NaN]) {
    assert.throws(() => buildSshArgs('unit-talk-prod', port), BridgeArgumentError, String(port));
  }
  // The only shell-interpreted argument is a literal plus an integer.
  assert.match(buildSshArgs('deploy@10.0.0.5', 65535).at(-1) ?? '', /^nc 127\.0\.0\.1 \d{1,5}$/);
});

test('bytes are piped both ways, one ssh child per connection', async () => {
  const children: FakeChild[] = [];
  const seenArgs: string[][] = [];
  const spawnChild: SpawnChild = (args) => {
    seenArgs.push(args);
    const child = new FakeChild();
    children.push(child);
    return child;
  };
  const server = createBridgeServer('unit-talk-prod', 4300, spawnChild);
  const port = await listening(server);
  try {
    for (const message of ['ping', 'second connection']) {
      const reply = await new Promise<string>((resolve, reject) => {
        const socket = net.connect(port, '127.0.0.1', () => socket.write(message));
        socket.once('data', (data) => {
          resolve(data.toString('utf8'));
          socket.end();
        });
        socket.once('error', reject);
      });
      assert.equal(reply, message.toUpperCase());
    }
    assert.equal(children.length, 2);
    assert.deepEqual(seenArgs[0], buildSshArgs('unit-talk-prod', 4300));
  } finally {
    server.close();
  }
});

test('closing the client kills its ssh child', async () => {
  const children: FakeChild[] = [];
  const server = createBridgeServer('unit-talk-prod', 4300, () => {
    const child = new FakeChild();
    children.push(child);
    return child;
  });
  const port = await listening(server);
  try {
    const socket = net.connect(port, '127.0.0.1');
    await new Promise((resolve) => socket.once('connect', resolve));
    await waitFor(() => children.length === 1);
    socket.destroy();
    await waitFor(() => children[0].killed > 0);
  } finally {
    server.close();
  }
});

test('the ssh child closing closes the client', async () => {
  const children: FakeChild[] = [];
  const server = createBridgeServer('unit-talk-prod', 4300, () => {
    const child = new FakeChild();
    children.push(child);
    return child;
  });
  const port = await listening(server);
  try {
    const socket = net.connect(port, '127.0.0.1');
    const closed = new Promise((resolve) => socket.once('close', resolve));
    await new Promise((resolve) => socket.once('connect', resolve));
    await waitFor(() => children.length === 1);
    children[0].emit('close');
    await closed;
  } finally {
    server.close();
  }
});

test('a spawn error closes the client instead of hanging it', async () => {
  const children: FakeChild[] = [];
  const server = createBridgeServer('unit-talk-prod', 4300, () => {
    const child = new FakeChild();
    children.push(child);
    return child;
  });
  const port = await listening(server);
  try {
    const socket = net.connect(port, '127.0.0.1');
    const closed = new Promise((resolve) => socket.once('close', resolve));
    await waitFor(() => children.length === 1);
    children[0].emit('error', new Error('spawn ssh ENOENT'));
    await closed;
  } finally {
    server.close();
  }
});

test('a child that finishes right after writing still delivers every byte', async () => {
  // nc exits as soon as the Command Center closes; the tail of the response is then still queued.
  const payload = Buffer.alloc(4 * 1024 * 1024, 0x61);
  const server = createBridgeServer('unit-talk-prod', 4300, () => {
    const child = Object.assign(new EventEmitter(), {
      stdin: new PassThrough(),
      stdout: new PassThrough(),
      kill: () => true,
    });
    setImmediate(() => {
      child.stdout.end(payload);
      child.emit('close');
    });
    return child as unknown as BridgeChild;
  });
  const port = await listening(server);
  try {
    const received = await new Promise<number>((resolve, reject) => {
      let bytes = 0;
      const socket = net.connect(port, '127.0.0.1');
      socket.on('data', (chunk: Buffer) => {
        bytes += chunk.length;
      });
      socket.once('close', () => resolve(bytes));
      socket.once('error', reject);
    });
    assert.equal(received, payload.length);
  } finally {
    server.close();
  }
});

test('health verdict accepts only the Command Center liveness body', () => {
  assert.equal(evaluateHealthResponse(200, '{"ok":true,"service":"command-center"}').ok, true);
  assert.equal(evaluateHealthResponse(200, '{"ok":true,"service":"api"}').ok, false);
  assert.equal(evaluateHealthResponse(200, '{"ok":false,"service":"command-center"}').ok, false);
  assert.equal(evaluateHealthResponse(200, '<html>').ok, false);
  assert.equal(evaluateHealthResponse(401, '{"ok":true,"service":"command-center"}').ok, false);
  assert.equal(evaluateHealthResponse(null, '').ok, false);
});

async function withHttpServer(
  handler: http.RequestListener,
  run: (port: number) => Promise<void>,
): Promise<void> {
  const server = http.createServer(handler);
  const port = await listening(server);
  try {
    await run(port);
  } finally {
    server.close();
  }
}

test('requestHealth reads /api/health', async () => {
  await withHttpServer(
    (request, response) => {
      assert.equal(request.url, '/api/health');
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end('{"ok":true,"service":"command-center"}');
    },
    async (port) => {
      assert.deepEqual(await requestHealth(port), { ok: true, reason: 'command-center reports ok' });
    },
  );
});

test('requestHealth fails on an unhealthy answer', async () => {
  await withHttpServer(
    (_request, response) => {
      response.writeHead(503);
      response.end('down');
    },
    async (port) => {
      assert.deepEqual(await requestHealth(port), { ok: false, reason: 'HTTP 503' });
    },
  );
});

test('requestHealth fails, not hangs, when nothing answers', async () => {
  const server = net.createServer();
  const port = await listening(server);
  server.close();
  await new Promise((resolve) => server.once('close', resolve));
  const verdict = await requestHealth(port);
  assert.equal(verdict.ok, false);
});

test('requestHealth times out a far side that accepts and never answers', async () => {
  const sockets: net.Socket[] = [];
  const server = net.createServer((socket) => sockets.push(socket));
  const port = await listening(server);
  try {
    const verdict = await requestHealth(port, '127.0.0.1', 100);
    assert.equal(verdict.ok, false);
    assert.match(verdict.reason, /no answer within 100ms/);
  } finally {
    for (const socket of sockets) socket.destroy();
    server.close();
  }
});

test('--check exits 1, not hangs, when ssh cannot reach the host', async () => {
  const spawnChild: SpawnChild = () => {
    const child = Object.assign(new EventEmitter(), {
      stdin: new PassThrough(),
      stdout: new PassThrough(),
      kill: () => true,
    });
    setImmediate(() => child.emit('error', new Error('spawn ssh ENOENT')));
    return child as unknown as BridgeChild;
  };
  const log = console.log;
  const lines: string[] = [];
  console.log = (line: string) => lines.push(line);
  try {
    const code = await runBridge(
      { host: 'unit-talk-prod', localPort: 0, remotePort: 4300, bindAddress: '127.0.0.1', check: true },
      spawnChild,
    );
    assert.equal(code, 1);
    assert.equal(JSON.parse(lines[0]).ok, false);
  } finally {
    console.log = log;
  }
});

test('--check exits 0 through the bridge when the far side is healthy, 1 when it is not', async () => {
  for (const [body, expected] of [
    ['{"ok":true,"service":"command-center"}', 0],
    ['{"ok":false}', 1],
  ] as const) {
    await withHttpServer(
      (_request, response) => {
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(body);
      },
      async (upstreamPort) => {
        // The fake child plays ssh+nc: it connects to the upstream the way nc would on the host.
        const spawnChild: SpawnChild = () => {
          const upstream = net.connect(upstreamPort, '127.0.0.1');
          const child = Object.assign(new EventEmitter(), {
            stdin: upstream,
            stdout: upstream,
            kill: () => {
              upstream.destroy();
              return true;
            },
          });
          upstream.once('close', () => child.emit('close'));
          return child as unknown as BridgeChild;
        };
        const log = console.log;
        console.log = () => undefined;
        try {
          const code = await runBridge(
            { host: 'unit-talk-prod', localPort: 0, remotePort: 4300, bindAddress: '127.0.0.1', check: true },
            spawnChild,
          );
          assert.equal(code, expected);
        } finally {
          console.log = log;
        }
      },
    );
  }
});
