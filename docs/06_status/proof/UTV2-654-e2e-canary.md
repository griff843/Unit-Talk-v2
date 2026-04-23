# PROOF: UTV2-654
MERGE_SHA: b8481381994cebee9ed67be30aaa31324b1cb319

ASSERTIONS:
- [x] Submission → processSubmission produces pick with promotionScore ≥ 70 and promotionStatus = qualified
- [x] enqueueDistributionWithRunTracking creates distribution_outbox row with target discord:canary
- [x] Background worker claims and delivers outbox row to Discord (outbox.status → sent)
- [x] distribution_receipts row created with real Discord message ID (external_id = 1496378818431029320)
- [x] pick.status transitions to posted after delivery
- [x] recordPickSettlement settles the pick as win/operator/confirmed
- [x] Full pipeline PROVEN in a single end-to-end run against live Supabase + real Discord

EVIDENCE:
```text
=== UTV2-654: E2E Live Canary Proof ===
Canary channel : 1296531122234327100
Discord bot    : set ✓
Supabase       : https://zfzdnfwdarxucxtaojxm.supabase.co

────────────────────────────────────────────────────────────
STEP 1 · Submit pick
────────────────────────────────────────────────────────────
{
  "pickId": "d8e63128-1245-4622-9cce-27cd81bcee11",
  "promotionScore": 83.4,
  "promotionStatus": "qualified",
  "lifecycleState": "validated",
  "promotionTarget": "best-bets"
}
{ "verdict": "PASS", "label": "submission", "evidence": { "pickId": "d8e63128-1245-4622-9cce-27cd81bcee11", "promotionScore": 83.4, "promotionStatus": "qualified", "lifecycleState": "validated" } }

────────────────────────────────────────────────────────────
STEP 2 · Verify distribution_outbox
────────────────────────────────────────────────────────────
{ "id": "14279f86-fc96-4a67-9890-79a3b61489f6", "target": "discord:canary", "status": "sent", "pick_id": "d8e63128-1245-4622-9cce-27cd81bcee11", "created_at": "2026-04-22T05:15:11.082796+00:00" }
{ "verdict": "PASS", "label": "outbox", "evidence": { "outboxId": "14279f86-fc96-4a67-9890-79a3b61489f6", "target": "discord:canary", "status": "sent" } }

────────────────────────────────────────────────────────────
STEP 3 · Waiting for worker delivery (Discord)
────────────────────────────────────────────────────────────
Poll 1/15: outbox status = sent
Worker delivered ✓ {"status":"sent","receipt":{"external_id":"1496378818431029320","channel":"discord:canary","status":"sent","recorded_at":"2026-04-22T05:15:11.818639+00:00"}}

────────────────────────────────────────────────────────────
STEP 4 · Verify pick → posted
────────────────────────────────────────────────────────────
{ "id": "d8e63128-1245-4622-9cce-27cd81bcee11", "status": "posted", "promotion_status": "qualified", "promotion_score": 83.4 }
{ "verdict": "PASS", "label": "pick-status", "evidence": { "pickId": "d8e63128-1245-4622-9cce-27cd81bcee11", "status": "posted", "discordMessageUrl": "https://discord.com/channels/1284478946171293736/1296531122234327100/1496378818431029320" } }

────────────────────────────────────────────────────────────
STEP 5 · Settlement
────────────────────────────────────────────────────────────
{ "verdict": "PASS", "label": "settlement", "evidence": { "pickId": "d8e63128-1245-4622-9cce-27cd81bcee11", "result": "win", "source": "operator" } }

────────────────────────────────────────────────────────────
FINAL VERDICT
────────────────────────────────────────────────────────────
{
  "verdict": "PROVEN",
  "notes": "Full E2E pipeline proven",
  "pickId": "d8e63128-1245-4622-9cce-27cd81bcee11",
  "promotionScore": 83.4,
  "promotionStatus": "qualified",
  "discordMessageUrl": "https://discord.com/channels/1284478946171293736/1296531122234327100/1496378818431029320",
  "workerDelivered": true,
  "settled": true,
  "lifecycleEvents": 0,
  "proofRunAt": "2026-04-22T05:15:14.926Z"
}
```

Proof run at: 2026-04-22T05:15:14.926Z
Discord message: https://discord.com/channels/1284478946171293736/1296531122234327100/1496378818431029320
