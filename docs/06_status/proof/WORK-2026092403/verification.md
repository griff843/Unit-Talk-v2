# PROOF: WORK-2026092403

MERGE_SHA: pending merge

> Pre-merge, the merge row is intentionally a placeholder. The Execution SHA row carries the last commit on this lane that changes
> anything outside `docs/06_status/proof/WORK-2026092403/` and the lane manifest.
> `post-merge-lane-close.yml` rebinds merge authority only after GitHub supplies the merged-PR
> attestation.

Generated at: 2026-09-24T14:00:23.000Z
Issue: WORK-2026092403
Tier: T1
Lane type: governance
Branch: claude/work-2026092403-host-disk-hygiene
PR URL: https://github.com/griff843/Unit-Talk-v2/pull/1645
Head SHA: 9ed381b0ec6ebf1b7631c2e7247693d298e1e42b
result: pass

## ASSERTIONS:

- [x] After a production promote has passed every check, `deploy.yml` removes Unit Talk release
      images whose tag is neither the running release (`.unit-talk-release`), the previous one
      (`.unit-talk-release.previous`), nor a release the host keeps a configuration snapshot for
      (`.env.production.<sha>`). This is proven by executing the exact heredoc the step sends,
      against a stub `docker`.
- [x] The reclaim never touches a third-party image, never forces, removes nothing when the host
      records no release, and is refused for an image a container still references.
- [x] The reclaim is the last promote step and is `continue-on-error`: it cannot fail a deploy.
- [x] Every service in `deploy/production/docker-compose.yml` (11 of 11) rotates its json-file
      log at 10 MB x 5 files.
- [x] Neither monitoring cron job redirects into `/var/log`. Both log under
      `${DEPLOY_PATH}/logs`, which the step creates first.
- [x] Each property is mutation-proven: each of 6 mutations, applied alone, turns a named test red.
- [x] No deploy or monitoring deploy was dispatched, no host command changed state, and nothing on
      the host was deleted. The change takes effect only at the next dispatched run.

## EVIDENCE:

Measured at `9ed381b0ec6ebf1b7631c2e7247693d298e1e42b` in the lane worktree.

Production host, read-only, 2026-09-24 (the defect this lane corrects):

```
$ df -h /
/dev/sda1  226G  140G  76G  65% /
$ docker system df
Images  398 total  20 active  141.2GB  79.96GB (56%) reclaimable
$ docker images --format '{{.Repository}}' | sort | uniq -c   (top)
68 .../worker  68 .../ingestor  68 .../discord-bot  68 .../api  19 .../web  19 .../smart-form  11 .../command-center
$ docker inspect <every container> --format '{{json .HostConfig.LogConfig}}'
{"Type":"json-file","Config":{}}
largest container log: loki, 5067853456 bytes
$ ls -ld /var/log ; ls /var/log/unit-talk-*
drwxrwxr-x 10 root syslog /var/log
ls: cannot access '/var/log/unit-talk-*': No such file or directory
```

```
$ pnpm exec tsx --test scripts/ci/deploy-config-rollback.test.ts
# tests 24
# pass 24
# fail 0

$ pnpm type-check
rc=0

$ pnpm exec eslint scripts/ci/deploy-config-rollback.test.ts
rc=0

$ pnpm test
# pass 6848 (summed across every suite)
# fail 0
rc=0

$ pnpm exec tsx scripts/ci/r-level-check.ts --issue WORK-2026092403 --base origin/main --head 9ed381b0ec6ebf1b7631c2e7247693d298e1e42b
Verdict: PASS
Changed files: 7
Rules matched: (none) — no R-level artifacts required for this diff
```

Mutation battery. Each mutation was applied alone, the file was run, and the source was restored
from a pre-mutation copy:

| # | Mutation | Observed |
|---|---|---|
| M1 | keep set drops `.unit-talk-release.previous` | red: test 21 (keep set) |
| M2 | keep set drops the `.env.production.<sha>` snapshots | red: test 21 |
| M3 | the `grep -F "$NAMESPACE/"` filter removed | red: test 21 |
| M4 | `continue-on-error` removed | red: test 20 |
| M5 | caddy loses its `logging` | red: test 23 |
| M6 | disk-alert cron redirected back to `/var/log` | red: test 24 |

Restore check: 24/24.

## Verification
- [x] `pnpm type-check`: rc=0
- [x] `pnpm test`: 6848 passed, 0 failed
- [x] `pnpm verify`: not claimed locally. `scripts/ci/assert-staging-target.ts` refuses the
      containment placeholder target by design. The lane manifest records
      `t1_live_db_precondition: deferred_to_ci`, so `verify` and `Writable DB proof (staging only)`
      come from CI on this PR and on the merge SHA.
- [x] `pnpm exec tsx scripts/ci/r-level-check.ts --issue WORK-2026092403 --base origin/main --head 9ed381b0ec6ebf1b7631c2e7247693d298e1e42b`: PASS, 7 changed files, no R-level artifacts required

## Runtime Verification

The reclaim test is an execution proof, not a text check. It extracts the `RECLAIM_REMOTE`
heredoc from the promote job and runs it with `bash -s` in a temp directory holding real release
markers and snapshot files, with a stub `docker` first on `PATH` that lists a fixed image set and
records every `image rm` it receives:

| Image | Why | Outcome |
|---|---|---|
| `api:<current>` | `.unit-talk-release` | kept |
| `api:<previous>` | `.unit-talk-release.previous` | kept |
| `api:<snapshotted>` | `.env.production.<sha>` present | kept |
| `api:<stale>`, `worker:<stale>` | none | removed |
| `api:<stale, in use>` | a container references it | refused, kept |
| `louislam/uptime-kuma:1`, `grafana/grafana:<stale>` | third-party | never considered |

With no release record on the host the body removes nothing and exits 0. No production host,
database or credential was touched to produce this proof.

## Merge SHA Binding

Merge SHA: pending merge
PR: https://github.com/griff843/Unit-Talk-v2/pull/1645
Execution SHA: 9ed381b0ec6ebf1b7631c2e7247693d298e1e42b

Execution anchor: `9ed381b0ec6ebf1b7631c2e7247693d298e1e42b` is the only implementation commit on this lane. Its parent is the lane
manifest commit, whose parent is `origin/main` `decd67afaf99eeb41320c40eca14a9d9e9cf92a6`.

`work-order.md` in this directory is a byte-identical copy of the repository-owned work order
`.ops/work/WORK-2026092403.md`, which exists only as an uncommitted file. It is kept here because
the lane's own proof directory is the one path that the closeout scope check (S1) and the
file-scope guard both admit without widening `file_scope_lock`.
