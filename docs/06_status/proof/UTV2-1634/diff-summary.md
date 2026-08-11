# UTV2-1634 Diff Summary — increment 2 (bounded discovery retry)

Issue: UTV2-1634
Tier: T2
Lane type: governance
Branch: claude/utv2-1634-lane-discovery-retry
Head SHA: 6e80b9b212e02781551db3d56224437fd03a52ce
Merge SHA: bound post-merge by `post-merge-lane-close.yml`
Diff base: 0fe1b39910758bc499cac0af8621c7a1ae6c96b9

> Increment 1 (authoritative active-lane discovery, merged `5b0c20b3`) is
> unchanged by this diff. Its fail-closed behaviour is preserved; only the
> retry budget around each network call is added.

## Git Diff Stat

```
 docs/06_status/lanes/UTV2-1634.json |  49 +++-------
 scripts/ops/shared.test.ts          | 140 ++++++++++++++++++++++++++++
 scripts/ops/shared.ts               | 176 +++++++++++++++++++++++++++++++-----
 3 files changed, 305 insertions(+), 60 deletions(-)
```

## Git Name Status

```
M	docs/06_status/lanes/UTV2-1634.json
M	scripts/ops/shared.test.ts
M	scripts/ops/shared.ts
```

## Change Detail

### `scripts/ops/shared.ts`

- `isRetryableDiscoveryFailure(stderr, status)` — classifies a failure as transient.
  Never retryable: a confirmed 404 (a definitive answer) and permanent auth
  failures (401/403/bad credentials/permission denied). Unrecognised errors
  default to **retryable**, which is the safe direction: the worst case is a few
  wasted attempts before the same fail-closed error, whereas misclassifying a
  transient fault as permanent reintroduces the abort being fixed.
- `withDiscoveryRetry(operation, classify, deps)` — bounded retry with capped
  exponential backoff. Rethrows the **last** error unchanged so the caller's
  fail-closed handling and message survive verbatim. Sleep is injectable so
  tests never wait.
- `DISCOVERY_FETCH_ATTEMPTS = 6`, `DISCOVERY_RETRY_BASE_DELAY_MS = 500`,
  `DISCOVERY_RETRY_MAX_DELAY_MS = 4000` — tuned against the live board, not
  guessed (4 attempts of linear 250ms reached only 3/6).
- `defaultListOpenPullRequests` and `defaultReadManifestAtRef` wrapped. The
  latter's `catch` block is untouched, so a confirmed 404 still returns `null`
  for that one PR and everything else still raises `ActiveLaneDiscoveryError`.

### `scripts/ops/shared.test.ts`

7 new tests: transient-then-success, permanent-fails-closed (asserting error
**identity**, not merely that something threw), normal-path-unchanged,
non-retryable-auth, 404-never-retried, transport/server faults retryable, and
backoff doubling with cap.

### `docs/06_status/lanes/UTV2-1634.json`

Lane manifest for this increment.

## Manifest Files Changed

- `scripts/ops/shared.ts`
- `scripts/ops/shared.test.ts`

## SHA Binding

Head SHA: 6e80b9b212e02781551db3d56224437fd03a52ce
Merge SHA: bound post-merge via `ops:proof-generate --merge-sha`
