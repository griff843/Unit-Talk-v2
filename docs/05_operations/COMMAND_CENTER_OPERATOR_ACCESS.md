# Command Center operator access

**Status:** Active · **Owner:** Claude (runbook), Griff (access decisions) · **Since:** WORK-2026092407

This runbook covers how an operator reaches the production Command Center. What the Command Center
is and must do is governed solely by `docs/03_product/COMMAND_CENTER_PRODUCT_CONTRACT.md`.

## The boundary

**Since 2026-11-25 (Griff, decision card in the project thread), the Command Center has a public
hostname behind Google sign-in.** This supersedes PM decision 7 (2026-09-24, internal-only).

- The container still publishes only `127.0.0.1:4300` on the host. Port 4300 is never exposed.
- The only public route is the Caddy site `caddy-sites/command-center.caddy`, rendered from
  `deploy/production/command-center.caddy` by `deploy/production/command-center-edge.sh`. Every request
  on it is checked by the `command-center-auth` gate (oauth2-proxy, Google provider). Only Google
  accounts listed in the secret `COMMAND_CENTER_ALLOWED_EMAILS` get through. There is no
  unauthenticated path, `/api/health` included.
- Behind the gate, the Command Center's own operator sign-in still applies.
- It is default-off. It is on only when the repository variables `UNIT_TALK_COMMAND_CENTER_ENABLED`
  and `UNIT_TALK_COMMAND_CENTER_PUBLIC` are both `true` and a deploy has run. With
  `UNIT_TALK_COMMAND_CENTER_PUBLIC` off, the deploy removes the site and the gate, and the SSH bridge
  below is the only path.

### Turning the public URL on

1. DNS: an `A` record for the chosen hostname (for example `cc.unit-talk.com`) pointing at the
   production host, the same address `picks.unit-talk.com` resolves to.
2. Google Cloud console: on the OAuth client Smart Form already uses, add the authorised redirect URI
   `https://<hostname>/oauth2/callback`.
3. GitHub repository settings: secret `UNIT_TALK_COMMAND_CENTER_DOMAIN` = the hostname; secret
   `COMMAND_CENTER_ALLOWED_EMAILS` = the operator Google addresses, comma separated; variable
   `UNIT_TALK_COMMAND_CENTER_PUBLIC` = `true` (and `UNIT_TALK_COMMAND_CENTER_ENABLED` = `true`).
4. Dispatch a production deploy. The promote job reloads Caddy and refuses to finish unless an
   unauthenticated `GET https://<hostname>/picks` is redirected to `/oauth2/start`.

Turning it off is step 3 in reverse (variable to anything but `true`) and a deploy.

## The SSH bridge (fallback path)

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

Measured results:

- **Step 1, re-measured 2026-09-25T23:07:57Z** with the version of the bridge in this runbook's
  commit, from the operator workstation against host alias `unit-talk-prod`. It was one
  unauthenticated `GET /api/health`. It printed
  `{"check":"command-center-bridge","host":"unit-talk-prod","ok":true,"reason":"command-center reports ok"}`
  and exited `0` at 23:08:01Z.
- **Step 2, not re-measured.** On 2026-09-24, against deployed release `6685f171c`, an earlier
  draft of the bridge returned `401` for `/picks`, `/review`, `/exceptions` and `/settlement`, each
  in about 1.5 s. That result predates the current code and has not been repeated with it.
- **Step 3 has not been performed.** It must be performed before `cc-proxy` is retired.

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
