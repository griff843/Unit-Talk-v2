# WORK-2026110304 diff summary

Source SHA: f4c34cb62541883c8be560b320a7a528cd4199aa
Merge SHA: pending merge

The accepted calendar-window and operator-error implementation is preserved. Rework fixes the one rejected path: invalid calendar dates now reach the existing Picks error state with actionable date guidance.

- `describe-error.ts`: export OperatorInputError for application-authored input guidance; return its message before diagnostic classification. describeThrown is unchanged.
- `queues.ts`: throw OperatorInputError for impossible calendar dates.
- `queues-count-relation.test.ts`: check real invalid From/To and empty-result errors through describeOperatorFailure with the page's fallback.
- `describe-error.test.ts`: plain Error, database-shaped object and string with identical text still receive safe generic wording.

Regression first: 3 failures out of 39 on the unmodified rework baseline, then 39/39 passing. Original main regression evidence and prepared candidates remain copied into evidence.json. No tests removed, no any casts added, no UI/caller/schema/data-write changes. Only four allowed source/test files and the explicitly required proof files changed in this epoch. PR opening remains deferred to Production Claude.
