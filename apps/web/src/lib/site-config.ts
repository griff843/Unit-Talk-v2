/** Public membership copy follows MEMBERSHIP_PRODUCT_CONTRACT.md.
 * Entitlements describe the product; no checkout or feature activation is inferred.
 */
export function resolveSiteUrl(value?: string): string {
  if (!value) {
    throw new Error(
      'NEXT_PUBLIC_SITE_URL is required and must be the public HTTPS origin.',
    );
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(
      'NEXT_PUBLIC_SITE_URL must be a valid public HTTPS origin.',
    );
  }
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== '/' ||
    !url.hostname.includes('.') ||
    !/[a-z]$/i.test(url.hostname) ||
    /(^|\.)(example\.(com|org|net)|localhost|local|invalid|test)$/.test(
      url.hostname,
    )
  ) {
    throw new Error(
      'NEXT_PUBLIC_SITE_URL must be a public HTTPS origin, not a placeholder.',
    );
  }
  return url.origin;
}
export const SITE_URL = resolveSiteUrl(process.env.NEXT_PUBLIC_SITE_URL);
export const BRAND = {
  name: 'Unit Talk',
  tagline: 'Sports betting intelligence',
  description:
    'Official capper picks through Discord. Complete settled results, transparent performance, and membership from Free through Trial and VIP.',
  notASportsbook:
    'Not a sportsbook. Unit Talk does not accept or place wagers.',
  responsibleLine:
    'Sports betting involves risk. Only wager what you can afford to lose. Set limits and never chase losses. Must be of legal wagering age in your jurisdiction.',
} as const;
export interface NavLink {
  label: string;
  href: string;
}
export const NAV_LINKS: NavLink[] = [
  { label: 'Home', href: '/' },
  { label: 'Results', href: '/results' },
  { label: 'Cappers', href: '/cappers' },
  { label: 'Membership', href: '/pricing' },
  { label: 'How It Works', href: '/how-it-works' },
  { label: 'FAQ', href: '/faq' },
];
export const LEGAL_LINKS: NavLink[] = [
  { label: 'Responsible Play', href: '/responsible-play' },
  { label: 'Support', href: '/contact' },
  { label: 'Terms', href: '/terms' },
  { label: 'Privacy', href: '/privacy' },
];
export interface Tier {
  id: string;
  name: string;
  price: string;
  billing: string;
  summary: string;
  features: string[];
  highlighted: boolean;
  state: string;
  cta: string | null;
  href: string | null;
}
export const TIERS: Tier[] = [
  {
    id: 'free',
    name: 'Free',
    price: 'Free',
    billing: 'Community & settled history',
    summary:
      'Start with the record. Every settled official pick belongs in the Free membership.',
    features: [
      'All settled official picks, recaps and corrections',
      'Capper records, units and ROI where supported',
      'Public community access',
      'Active paid picks and premium alerts are excluded',
    ],
    highlighted: false,
    state: 'Public archive unavailable on this site',
    cta: 'Read the results policy',
    href: '/results',
  },
  {
    id: 'trial',
    name: 'Trial',
    price: '$1',
    billing: '/ 7 days',
    summary:
      'Full VIP access for seven consecutive days. Trial does not include VIP+.',
    features: [
      'Every official capper pick',
      'The complete VIP experience while active',
      'VIP Discord feed, community and education',
    ],
    highlighted: false,
    state: 'Website checkout unavailable',
    cta: 'Read Trial details',
    href: '/faq#trial',
  },
  {
    id: 'vip',
    name: 'VIP',
    price: '$49.99',
    billing: '/ month',
    summary:
      'Every official capper pick. The complete official-pick membership across supported sports.',
    features: [
      'All official capper picks',
      'Official-pick Discord alerts upon activation',
      'Capper Corner and private community',
      'Recaps, supported performance breakdowns, education and support',
    ],
    highlighted: true,
    state: 'Website checkout unavailable',
    cta: 'Understand VIP',
    href: '/how-it-works',
  },
  {
    id: 'vip-plus',
    name: 'VIP+',
    price: 'Price not published',
    billing: 'Advanced intelligence',
    summary:
      'VIP plus advanced market intelligence, analytics, personalization and premium access.',
    features: [
      'Adds to VIP; does not complete an incomplete pick feed',
      'Individual capabilities require proven activation',
      'Current availability is not established here',
    ],
    highlighted: false,
    state: 'Availability unconfirmed — not for sale here',
    cta: 'Review capability status',
    href: '/pricing#capabilities',
  },
  {
    id: 'black-label',
    name: 'Black Label',
    price: 'Future tier',
    billing: 'Not currently available',
    summary: 'A future membership tier. Enrollment is closed.',
    features: ['Not currently available', 'No price published'],
    highlighted: false,
    state: 'Future tier — not currently available',
    cta: null,
    href: null,
  },
];
export const VIP_PLUS_CAPABILITIES = [
  'Steam and line-movement alerts',
  'Injury intelligence',
  'Hedge and middle intelligence',
  'Personal bet tracking and ROI analytics',
  'Personalized hedge triggers',
  'AI ticket analysis',
  'Advanced analytics and trends',
  'Personalized recaps',
  'External notifications',
];
export interface HelpResource {
  name: string;
  detail: string;
  href?: string;
}
export const RESPONSIBLE_GAMBLING_RESOURCES: HelpResource[] = [
  {
    name: 'National Problem Gambling Helpline',
    detail:
      'Call or text 1-800-MY-RESET (1-800-697-3738), 24/7. Confidential support and local resources; message and data rates may apply.',
    href: 'tel:18006973738',
  },
  {
    name: 'National Council on Problem Gambling',
    detail: 'Resources, state-by-state help lines, and chat support.',
    href: 'https://www.ncpgambling.org',
  },
  {
    name: 'Gamblers Anonymous',
    detail: 'Peer support meetings for people affected by problem gambling.',
    href: 'https://www.gamblersanonymous.org',
  },
];
export const PAGE_TITLES = {
  home: 'Unit Talk — Official Picks. Every Settled Result.',
  pricing: 'Unit Talk Membership — Free, Trial, VIP, VIP+ & Black Label',
  howItWorks: 'How Unit Talk Works',
  results: 'Unit Talk Results & Transparency',
  cappers: 'Unit Talk Cappers',
  faq: 'Unit Talk FAQ',
  responsiblePlay: 'Responsible Play — Unit Talk',
  contact: 'Contact Unit Talk',
  terms: 'Unit Talk Terms of Service',
  privacy: 'Unit Talk Privacy Policy',
} as const;
