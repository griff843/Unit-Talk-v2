# WORK-2026102807 browser verification

Source: `943303fafeae286863184451f6b23d301990f7c3`.

The optimized production build ran at `http://localhost:14431` with an isolated loopback read-only HTTP fixture at port 15433. Existing fail-closed Basic operator authentication was configured with synthetic local credentials; no production session or database was used. The fixture refuses POST writes. Its unavailable API-health indicator is expected because no API service was supplied.

The fixture returns a stale view loss for a pick whose original loss has a newer timestamp than its correction to win. Two additional rows have manual-review and absent settlement histories. These deliberately exercise the defect rather than mirror a timestamp-based resolver.

| Check | Browser observation |
| --- | --- |
| Desktop, 1424 × 1248, unfiltered list | First row displays WIN and `(corrected)`; both other rows display pending; total is three. See desktop.png. |
| Filtered win | Only the corrected pick remains, with total one and the same result. |
| Pick detail | SETTLEMENT displays `win (corrected)` and retains both original and correction records. See detail.png. |
| Mobile, 390 × 844 | Filters wrap within the viewport; innerWidth and document scrollWidth both equal 390. See mobile.png. |
| Mobile result column | The table scrolls internally (356px viewport, 1180px table); revealing its result cell shows WIN `(corrected)` and both pending rows without document overflow. See mobile-result.png. |
| Mobile detail | Same corrected settlement; innerWidth and document scrollWidth both equal 390. |
| Keyboard | Tab reaches Skip to main content; Enter activates it. From the Result selector, four Tabs reach Apply filters, and Enter navigates to result=win with one matching pick. |
| Empty, desktop and mobile | Filtering loss yields zero matches, the zero-match summary and `No picks match this filter.` See empty.png. |
| Loading | A delayed history response displays `Loading page…` and skeleton rows. See loading.png. |
| Database error, mobile | HTTP 500 history response produces ACTIVE PICKS UNAVAILABLE with the history error, without stale result rows. See error.png. |
| Incomplete history, desktop | Declared count exceeds returned records: ACTIVE PICKS UNAVAILABLE, `Pick page settlement histories are incomplete`, and zero table rows. |

Screenshots are genuine browser captures saved without image editing. No settlement, correction, promotion, delivery or other production mutation was submitted. This proof covers the admitted follow-up; staging persistence proof remains the current-head CI responsibility.
