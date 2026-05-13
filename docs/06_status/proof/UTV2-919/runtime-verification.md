# Runtime Verification — UTV2-919

**Issue:** UT-P0-006 Enforce Service-to-Service Authentication  
**Branch:** griffadavi/utv2-919-ut-p0-006-enforce-service-to-service-authentication  
**Merge SHA:** (to be populated after merge)  
**Date:** (to be completed by PM before merge)

---

## Required Checks

All items must end in `: PASS` before merge is authorized.

- [ ] API started with `UNIT_TALK_INGESTOR_API_KEY` configured: ingestor grading trigger request → API log shows `settler:ingestor:XXXXXXXX` identity: PENDING
- [ ] API started in fail_closed mode, ingestor triggers grading without key → HTTP 401 returned + auth failure logged with route + reason: PENDING
- [ ] API started with `UNIT_TALK_BOT_API_KEY` configured: bot mutation (`/api/member-tiers` or `/api/submissions`) → API log shows `submitter:discord-bot:XXXXXXXX` identity: PENDING

## Bottom Line

result: pending

---

*To be completed by PM during runtime verification step of P0 protocol.*
*Runbook: docs/05_operations/P0_PROTOCOL_SPEC.md*
