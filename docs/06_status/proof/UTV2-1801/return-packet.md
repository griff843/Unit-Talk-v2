# Website return packet — UTV2-1801

MERGE_SHA: pending merge

## 1. Starting truth
Audit authority was main c800234b77295265210cba9965e36e29a0673494; website execution lane starts from f9536812a1de8be8b79f92d7c0bcf72b36bd07f1 after the separately approved admission fix merged as PR #1731. Website code and canonical brand authority were unchanged between these bases. The implementation commit is 01e2c460173fd3f3e79e97d22f7aece1cc4c18be. source-snapshot.json records the original prepared handoff; the registered review corrections are listed below. The later direct brand instruction resolves the packet's historical logo conflict.

## 2. Current-site audit
See claims-and-launch-gaps.md. The starting code used a typed wordmark, unsupported decorative live-desk presentation, incomplete membership progression, omitted approved prices, blanket capabilities and placeholder canonical metadata. Before screenshots are a read-only production reference from unit-talk.com; its served commit is unknown and they are not an exact build of starting main.

## 3. Page and component changes
See diff-summary.md. Ten public routes now have coherent premium black/soft-white/gold styling and approved identity. Home, Results, Cappers, Membership, How It Works and FAQ form the primary journey. Support, responsible play and draft legal pages remain accessible. Accessible menu, native disclosures, isolated table scrolling and reduced-motion support are included.

## 4. Claims disposition
See claims-and-launch-gaps.md. Trial is $1 for seven consecutive days of full VIP, excluding VIP+. VIP is $49.99/month for every official capper pick across supported sports. Entitlements are distinguished from activation. VIP+ has no published price and each intended capability is unconfirmed. Black Label is future and closed. No fake numbers, testimonials, identities, conversations, streaks or runtime activation were created.

## 5. Desktop/mobile visuals
screenshot-desktop.png and screenshot-mobile.png are the final home previews. screenshots/ contains desktop/mobile captures of all ten routes and two before references. browser-routes.json covers 1440 px and 390 px; browser-boundaries.json adds 320/768/1024 px home and pricing checks, with no page overflow.

## 6. Verification and exact HEAD
See verification.md and logs/. App production build, seven focused tests, app type-check and lint pass. Final registered-review pnpm verify:static passed (exit 0). Full pnpm verify passes static stages then exits 1 at the live DB target identity guard; the protected staging-ci environment must complete it. Mechanical route/link/asset/metadata and keyboard checks pass. Desktop LCP is 208 ms; mobile LCP 896 ms, INP 85 ms and CLS 0 under 4x CPU/Fast 4G. These are local lab measurements, not production field results.
The website is committed and pushed. Committed-source R-level and T2 classification pass. Model provenance is actual registered gpt-5.6-sol / medium, CLI 0.153.3; resumed closeout completed with executor and wrapper exit 0. The protected staging job is serialized behind another repository lane, not awaiting environment approval. Exact candidate SHA and final CI results are bound in the PR review comment after all code/proof commits.

## 7. Launch gaps
Checkout, public results feed, publishable capper directory, approved invite/email and automatic onboarding remain unavailable. VIP+ activation is unproved and Black Label enrollment remains closed. Terms/Privacy are visible drafts pending counsel. No deployment or commerce activation is included. These gaps are stated in the interface.

## 8. PR, exact SHA, checks and PM status
Website PR: https://github.com/griff843/Unit-Talk-v2/pull/1732 (draft, tier:T2). Source commit: 01e2c460173fd3f3e79e97d22f7aece1cc4c18be. Registered review SUCCESS; actual receipt is model-routing.json. Protected staging verification remains pending until its serialized job completes. Final approval state: PM review and governed merge approval are required; no merge is authorized by this review packet. Admission PR #1731 is merged and closed; it does not stand in for website review or checks.

## Registered review findings and corrections
- Required NEXT_PUBLIC_SITE_URL rather than relying on a fallback; missing-variable production build fails as required, and placeholder rejection is tested. Deployment must explicitly supply the approved HTTPS origin.
- Social metadata uses the existing approved 2400×738 wordmark PNG for the large-image card; no logo was drawn or transformed.
- Added dark viewport metadata and expanded node:test coverage from four to seven tests, including mechanical internal routes/anchors and rendered-page claims.
- Restored the generated Next shim to the repository version after build; no generated source artifact is included.
- Corrected PR-only issue references and added the screenshot evidence README required by the nested proof auditor.
- Executor attempt 1 reached its bounded 30-minute closeout limit; attempt 2 resumed the same epoch, skipped completed review/implementation/verification phases and returned SUCCESS.
- No material product, pricing, billing, legal or backend decision was absorbed. All launch gaps remain explicit.
