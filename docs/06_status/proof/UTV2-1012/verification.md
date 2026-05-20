# UTV2-1012 — Verification Instructions

## Summary

**Issue:** UTV2-1012 — Supervisor verification tooling  
**Tier:** T2  

## Verification

---

### How to run the verification

### 1. Trigger the workflow

```bash
gh workflow run ops-supervisor-status.yml --repo griff843/unit-talk-v2
```

Or via the GitHub UI: Actions → "Ops — Supervisor Status" → Run workflow.

No inputs required.

### 2. Wait for completion

```bash
# List recent runs
gh run list --workflow=ops-supervisor-status.yml --limit=5

# Watch the most recent run
gh run watch
```

### 3. Download and inspect the artifact

```bash
# Get the run ID from step 2, then:
gh run download <run_id> --name supervisor-status-<run_id>
cat supervisor-status.json
```

### 4. Check the verdict field

```bash
python3 -c "import json; d=json.load(open('supervisor-status.json')); print(d['verdict'], d['failures'])"
```

Expected passing output:
```
PASS []
```

---

## Expected JSON shape (PASS)

```json
{
  "checkedAt": "2026-05-20T12:00:00Z",
  "verdict": "PASS",
  "services": {
    "unit-talk-api-1":       { "state": "running", "health": "healthy",  "restartCount": 0, "image": "ghcr.io/griff843/...", "startedAt": "..." },
    "unit-talk-worker-1":    { "state": "running", "health": "none",     "restartCount": 0, "image": "ghcr.io/griff843/...", "startedAt": "..." },
    "unit-talk-ingestor-1":  { "state": "running", "health": "none",     "restartCount": 0, "image": "ghcr.io/griff843/...", "startedAt": "..." },
    "unit-talk-discord-bot-1":{ "state": "running", "health": "none",    "restartCount": 0, "image": "ghcr.io/griff843/...", "startedAt": "..." }
  },
  "failures": []
}
```

---

## FAIL conditions

| Condition | Failure message |
|---|---|
| Container not found | `<svc>: state=missing (expected running)` |
| Container exited/restarting | `<svc>: state=exited (expected running)` |
| API health not healthy | `unit-talk-api-1: health=starting (expected healthy)` |
| Crash loop | `<svc>: restartCount=12 (threshold: <10, possible crash loop)` |

When FAIL: the GHA job exits with code 1 and the artifact still uploads for diagnosis.

---

## Proof binding

The workflow artifact `supervisor-status-<run_id>` is the runtime proof for this lane.  
The `checkedAt` timestamp in the JSON confirms the check ran against live production containers.  
Tie the run ID to the merge SHA once this PR is merged.
