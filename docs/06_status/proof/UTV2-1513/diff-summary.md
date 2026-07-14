# UTV2-1513 Diff Summary

Generated at: 2026-07-14T05:04:43.220Z
Issue: UTV2-1513
Tier: T2
Lane type: delivery-ui
Branch: claude/utv2-1513-public-website-mvp-v2
PR URL: https://github.com/griff843/Unit-Talk-v2/pull/1201
Head SHA: 9782da7a3efdb4d5550929383f83ff4801b73e13
Merge SHA: c9531ae7616f6812bb1f743c5d46704b213b70c4
Diff base: c9531ae7616f6812bb1f743c5d46704b213b70c4^1
Diff target: c9531ae7616f6812bb1f743c5d46704b213b70c4

## Git Diff Stat
```
apps/web/next-env.d.ts                             |   5 +
 apps/web/next.config.mjs                           |  12 +
 apps/web/package.json                              |  25 ++
 apps/web/postcss.config.mjs                        |   9 +
 apps/web/src/app/contact/page.tsx                  |  66 ++++
 apps/web/src/app/faq/page.tsx                      | 129 +++++++
 apps/web/src/app/globals.css                       | 429 +++++++++++++++++++++
 apps/web/src/app/how-it-works/page.tsx             | 101 +++++
 apps/web/src/app/layout.tsx                        |  45 +++
 apps/web/src/app/page.tsx                          | 300 ++++++++++++++
 apps/web/src/app/pricing/page.tsx                  | 120 ++++++
 apps/web/src/app/privacy/page.tsx                  | 106 +++++
 apps/web/src/app/responsible-play/page.tsx         | 111 ++++++
 apps/web/src/app/results/page.tsx                  |  92 +++++
 apps/web/src/app/robots.ts                         |  12 +
 apps/web/src/app/sitemap.ts                        |  23 ++
 apps/web/src/app/terms/page.tsx                    | 111 ++++++
 apps/web/src/components/CTAButton.tsx              |  20 +
 apps/web/src/components/ComingSoonCard.tsx         |  17 +
 apps/web/src/components/FAQAccordion.tsx           |  28 ++
 apps/web/src/components/LegalDisclaimer.tsx        |   8 +
 apps/web/src/components/PageHeader.tsx             |  21 +
 apps/web/src/components/PlanCard.tsx               |  55 +++
 apps/web/src/components/PricingTable.tsx           |  38 ++
 apps/web/src/components/PublicFooter.tsx           |  72 ++++
 apps/web/src/components/PublicHeader.tsx           |  79 ++++
 apps/web/src/components/ResponsiblePlayBanner.tsx  |  30 ++
 apps/web/src/components/SectionHeader.tsx          |  20 +
 apps/web/src/lib/site-config.ts                    | 215 +++++++++++
 apps/web/tailwind.config.ts                        |  65 ++++
 apps/web/tsconfig.json                             |  24 ++
 docs/06_status/lanes/UTV2-1513.json                |  69 ++++
 docs/06_status/proof/UTV2-1513/.gitkeep            |   0
 docs/06_status/proof/UTV2-1513/diff-summary.md     |  96 +++++
 .../proof/UTV2-1513/executor-result-proof.md       |  42 ++
 docs/06_status/proof/UTV2-1513/verification.md     |  28 ++
 pnpm-lock.yaml                                     |  34 ++
 37 files changed, 2657 insertions(+)
```

## Git Name Status
```
A	apps/web/next-env.d.ts
A	apps/web/next.config.mjs
A	apps/web/package.json
A	apps/web/postcss.config.mjs
A	apps/web/src/app/contact/page.tsx
A	apps/web/src/app/faq/page.tsx
A	apps/web/src/app/globals.css
A	apps/web/src/app/how-it-works/page.tsx
A	apps/web/src/app/layout.tsx
A	apps/web/src/app/page.tsx
A	apps/web/src/app/pricing/page.tsx
A	apps/web/src/app/privacy/page.tsx
A	apps/web/src/app/responsible-play/page.tsx
A	apps/web/src/app/results/page.tsx
A	apps/web/src/app/robots.ts
A	apps/web/src/app/sitemap.ts
A	apps/web/src/app/terms/page.tsx
A	apps/web/src/components/CTAButton.tsx
A	apps/web/src/components/ComingSoonCard.tsx
A	apps/web/src/components/FAQAccordion.tsx
A	apps/web/src/components/LegalDisclaimer.tsx
A	apps/web/src/components/PageHeader.tsx
A	apps/web/src/components/PlanCard.tsx
A	apps/web/src/components/PricingTable.tsx
A	apps/web/src/components/PublicFooter.tsx
A	apps/web/src/components/PublicHeader.tsx
A	apps/web/src/components/ResponsiblePlayBanner.tsx
A	apps/web/src/components/SectionHeader.tsx
A	apps/web/src/lib/site-config.ts
A	apps/web/tailwind.config.ts
A	apps/web/tsconfig.json
A	docs/06_status/lanes/UTV2-1513.json
A	docs/06_status/proof/UTV2-1513/.gitkeep
A	docs/06_status/proof/UTV2-1513/diff-summary.md
A	docs/06_status/proof/UTV2-1513/executor-result-proof.md
A	docs/06_status/proof/UTV2-1513/verification.md
M	pnpm-lock.yaml
```

## Manifest Files Changed
- No files_changed entries recorded.

## SHA Binding
Head SHA: 9782da7a3efdb4d5550929383f83ff4801b73e13
Merge SHA: c9531ae7616f6812bb1f743c5d46704b213b70c4
