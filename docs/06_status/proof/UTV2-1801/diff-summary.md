# Diff summary: UTV2-1801

Public website conversion in apps/web, using canonical brand assets and membership contract.

| Files | Change |
|---|---|
| src/app/page.tsx and globals.css | Results-first editorial homepage, black/white/gold visual system, responsive spacing and focus states |
| PublicHeader, PublicFooter, BrandLogo | Approved wordmark/monogram assets, six-page navigation, accessible mobile menu and footer |
| pricing, PlanCard, PricingTable, site-config | Free → Trial → VIP → VIP+ → Black Label; approved prices and clear activation boundaries |
| results, ResultsAvailability, cappers | Complete-history policy and truthful unavailable data/profile states |
| how-it-works, FAQAccordion, faq, DiscordPreview | Intended journey, native disclosures, labeled Discord structure illustration |
| contact, responsible-play, terms, privacy | Accurate support availability and risk copy; existing legal draft status preserved |
| layout, sitemap, site-metadata, public/brand | Real canonical origin, per-page metadata, approved favicons/social assets and cappers sitemap entry |
| site-config.test.ts, package.json | Seven directly runnable node:test checks covering URL inversion, social artwork, internal routes/anchors, canonical assets, commercial authority and claim safety; no package added |
| next.config.mjs, tailwind.config.ts | Correct monorepo standalone tracing root; obsolete decorative animation theme removed |
| Issue-owned proof folder | Claims/audit, screenshots, browser/HTTP/performance evidence and verification logs |

No API, worker, DB, contracts, domain, brand masters, mission, checkout, VIP+ activation, Black Label enrollment or production deployment changed. No new dependency, any cast or removed test.

## SHA Binding

Prepared source is bound by source-snapshot.json.
Implementation SHA: `01e2c460173fd3f3e79e97d22f7aece1cc4c18be`
Merge SHA: pending merge
PR: pending
