# Member-reader audit — WORK-2026103005

MERGE_SHA: 916228ed77abdfc05f49549148f2e22818786f78

This is a bounded source/consumer audit, not production canary acceptance. Production Claude's decisions are recorded in CODEX-HANDOFF-2026-10-30.md and #1810 comment 6530441718.

| Reader / consumer | Decision |
| --- | --- |
| `/live`, `/today` → `/api/member/picks` | Guard actual route before projection and count; inspect associated outbox pins. Existing authenticated operator/bot boundary and official population unchanged. |
| `/results` → `/api/picks` | Guard generic result projection; keep canonical records and operator trace. |
| `/results` → `/api/settlements/recent` | Join associated picks; exclude absent evidence and non-member pin histories before count. Filtering the picks half alone is insufficient. |
| `/stats`, `/leaderboard` → `/api/operator/stats`, `/api/operator/leaderboard` | Shared member-performance service guards pick and outbox pins before totals; keeps strict canonical attribution/real receipt/snapshot checks. Authenticated bot handler tests exercise both endpoints. |
| `/my-picks` | No protected reads at baseline: unavailable pending canonical Discord identity linkage. Preserve zero-read behavior; corrected stale generic-picks comment. |
| `/recap` → `/api/operator/capper-recap` | Absent API reader at baseline; returns 404. Do not invent an endpoint in this lane or present client mocks as API protection. |
| Daily / weekly / monthly human-capper aggregate recaps | Guard joined pick/outbox evidence before records, units and top play. Existing independent Track Only and delivery-stop guards retained. |
| Immediate per-pick settlement recap | Preserve pinned receipt destination with both recap controls; private per-pick recap is intentionally allowed, unlike member aggregates. Test uses simulated HTTP and local fixture controls. |
| `apps/web` results | Static unavailable feed, no connected pick/settlement reader. No new feed implemented. |
| Pre-auth routing-preview / promotion-preview | Outside lock; Claude classified as anonymously reachable by UUID and assigned WORK-2026103021 after 3005 merges. Isolation remains incomplete until that lane lands. |
| Pre-auth `/api/operator/promotion-scores?pickId=` | Same separate WORK-2026103021 treatment; operator URL prefix does not supply auth. |
| QA pick-status | Guard runs before repository reads: explicit QA flag required, production NODE_ENV rejected. No flags changed, no endpoint invoked. |
| Pick trace / Command Center | Operator trace stays behind explicit auth; canonical records are retained. Insert-time pick audience belongs to WORK-2026103021 Part B per Claude's split; no operator identity or lifecycle is rewritten by this lane. |

No member command, missing API reader or static web page was built to manufacture test coverage. No real submission, settlement, correction, delivery, audience change, kill switch or deployment was performed.
