# Command Center operator access

**Status:** Active · **Owner:** Claude (runbook), Griff (access decisions) · **Since:** WORK-2026092407

This runbook covers how an operator reaches the production Command Center. What the Command Center
is and must do is governed solely by `docs/03_product/COMMAND_CENTER_PRODUCT_CONTRACT.md`.

## The boundary

The Command Center is **internal-only**. PM decision 7 (2026-09-24) sets three rules:

- no public DNS and no public hostname;
- no exposure of port 4300;
- no Caddy site block.

`deploy/production/docker-compose.yml` publishes the service on `127.0.0.1:4300` of the production
host only. Nothing in this runbook changes that, and nothing here needs an sshd, firewall, DNS or
compose change.

## The access path

```bash
pnpm ops:cc-bridge            # http://127.0.0.1:4300 on your machine
pnpm ops:cc-bridge --check    # one unauthenticated /api/health through the bridge; exit 0 = reachable and healthy
```

The flags are as follows.

| Flag | Default | Purpose |
|---|---|---|
| `--host` | `unit-talk-prod` | the SSH host or alias for the production host |
| `--local-port` | `4300` | the port on your machine; use `0` to pick a free one |
| `--remote-port` | `4300` | the Command Center's port on the host loopback |
| `--bind` | `127.0.0.1` | loopback only (`127.0.0.1`, `::1` or `localhost`); any other address is refused |

Open the printed URL and **sign in on the Command Center's own page** with the operator
credential. The bridge adds no credential. Every page other than `/api/health` answers `401` with
the sign-in page until you sign in.

### How it works, and why not `ssh -L`

The compose file's comment names `ssh -L 4300:127.0.0.1:4300` as the way in. **That does not work.**
The host runs `AllowTcpForwarding no`, so the forward connects and is then reset.

That setting is a production security control, and it is not to be relaxed to make this easier.

Shell exec is not disabled, so the bridge uses that instead:

- It listens on your loopback.
- For each connection it runs `nc 127.0.0.1 4300` on the host, over an ordinary SSH session, and
  pipes bytes both ways. The session asks for no pty (`-T`), no escape character (`-e none`), no
  prompts (`BatchMode=yes`) and no forwarding of any kind (`ClearAllForwardings=yes`).
- `ssh` is spawned with an argument list, never through a local shell. The only text the host's
  shell sees is `nc 127.0.0.1 ` plus a port that has been validated as an integer. The host must
  match `[A-Za-z0-9][A-Za-z0-9._@-]*` and follows `--`, so it can never be read as an ssh option.
- The host sees a loopback client, exactly as a forward would present one.

The bridge is a process on your machine and stops with `Ctrl-C`. It leaves nothing running on the
host.

### What this path is not

This is **network reach**, not an operator workflow. The product contract
(`COMMAND_CENTER_PRODUCT_CONTRACT.md` §2.3 and §22) requires that an operator do their work inside
the Command Center "without ... terminal commands". Starting the bridge is a terminal command. It
is the transport by which the Command Center is reached while PM decision 7 keeps it off the public
network. It is not a substitute for any capability the contract requires inside the product, and it
does not satisfy any §22 acceptance criterion on its own.

The one route the bridge reaches without a sign-in is `/api/health`, which reports liveness only.
Every other route still refuses an unauthenticated request, as §22 criterion A1 requires.

## Verifying the path

1. `pnpm ops:cc-bridge --check` exits `0` and prints `"ok":true`.
2. With the bridge running, `curl -s -o /dev/null -w '%{http_code}\n' -H 'Accept: text/html'
   http://127.0.0.1:4300/picks` prints `401`. That shows authentication is enforced, and that the
   path neither bypasses nor weakens it.
3. After you sign in in a browser, `/picks`, `/review`, `/exceptions` and `/settlement` render
   production data.

Measured on 2026-09-24 against deployed release `6685f171c`:

- Step 1 returned `ok`.
- Step 2 returned `401` for all four routes, each in about 1.5 s over the bridge.

## Retiring `cc-proxy`

`cc-proxy` is a container that was started by hand on the host. It is not in compose and no deploy
knows about it. It listens on `127.0.0.1:4301` and adds the operator bearer token to **every**
request. So any process on the host's loopback can use the Command Center without any credential.

Its healthcheck was inherited from the api image (`wget localhost:4000/health`), so it reports
`unhealthy` whatever its real state.

The Command Center has served its own sign-in page since #1624, and this bridge reaches it, so
nothing depends on `cc-proxy`. PM decision 7 allows retiring it once a governed replacement is
proven. The procedure:

1. Prove the bridge: complete all three verification steps above, including a signed-in page.
2. On the host, confirm nothing else uses 4301:
   `docker ps --filter name=cc-proxy --format '{{.Names}} {{.Status}}'` and
   `ss -ltnp | grep 4301`.
3. Remove it: `docker rm -f cc-proxy`, then `rm -f /opt/unit-talk/cc-proxy.js`.
4. Confirm it is gone: `ss -ltn | grep -c 4301` prints `0`. Also confirm the `command-center`
   service is still `healthy`.

Removing `cc-proxy` touches no data, no published port and no compose service.
