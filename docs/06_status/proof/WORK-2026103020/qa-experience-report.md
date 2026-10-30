# Browser acceptance — WORK-2026103020

MERGE_SHA: pending merge

Genuine local browser acceptance of the actual Next application with synthetic loopback data. Normal fixture username/password authentication succeeded; no auth bypass or production credentials were used. The user's authenticated real session on port 14302 was left untouched.

| Case | Observed result | Evidence |
| --- | --- | --- |
| Corrected Track Only pick, desktop window 1440×1000 | Settled At 2026-10-28T12:00:00Z agrees with the older correction, rather than original 2026-10-29 time. Lifecycle remains validated. | desktop.png, desktop-ax.txt |
| Same pick, actual emulated 390×844 DPR1 mobile/touch viewport | Same effective timestamp is readable in Submission Details; no lifecycle rewrite. | mobile.png, mobile-ax.txt |
| Manual review with historical timestamp | Settled At shows —, despite the history row carrying a time. | manual-review-ax.txt |
| No settlement | Pending settlement and Settled At —. | pending-ax.txt |
| Settlement-read HTTP 500 fixture | PICK DETAIL UNAVAILABLE; canonical history could not load; governed actions disabled. No obsolete timestamp appears. | error-ax.txt |
| Keyboard | Tab focuses Skip to main content; Enter navigates to #main-content without invoking any write action. | observed through browser accessibility snapshots |

The initial plain window resize hit the browser's minimum width (485 pixels). It was not accepted as 390-pixel proof. The saved mobile capture was taken after explicit device viewport emulation returned width 390, height 844, DPR1, mobile/touch enabled. Desktop emulation was restored afterwards.

Screenshot transport could not write directly to the WSL workspace through its filePath option, so captures were returned by the browser tool and saved byte-for-byte to the named proof directory with the authorized filesystem tool. No image was edited. Full captures include the surrounding page, not only a mocked timestamp component.

Fixture API health/provider intelligence are intentionally unconfigured. This acceptance does not prove actual database persistence, Discord delivery, deployed changes or production acceptance. No settle/correct/promote/retry action was submitted. The real-pick acceptance waits for separately authorized deployment, as the work order requires.
