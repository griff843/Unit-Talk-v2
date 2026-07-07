/**
 * Site-wide configuration for the Unit Talk public marketing site.
 *
 * Unit Talk is a premium sports betting intelligence product delivered
 * through Discord. It is not a sportsbook — it does not accept or place
 * wagers. All copy on the site must stay consistent with that stance.
 */

// TODO(domain-config): replace with the real production domain once provisioned.
export const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL ?? 'https://unittalk.example.com';

export const BRAND = {
  name: 'Unit Talk',
  wordmark: 'UNIT TALK',
  tagline: 'Betting intelligence built for serious action.',
  description:
    'Unit Talk gives members structured picks, market context, alerts, and a premium Discord experience designed to help bettors make cleaner decisions.',
  notASportsbook:
    'Not a sportsbook. Unit Talk does not accept or place wagers.',
  responsibleLine:
    'Sports betting involves risk. Unit Talk is an information and entertainment product, not financial advice. Only wager what you can afford to lose. Must be of legal wagering age in your jurisdiction.',
} as const;

export interface NavLink {
  label: string;
  href: string;
}

export const NAV_LINKS: NavLink[] = [
  { label: 'How It Works', href: '/how-it-works' },
  { label: 'Results', href: '/results' },
  { label: 'Pricing', href: '/pricing' },
  { label: 'FAQ', href: '/faq' },
];

export const LEGAL_LINKS: NavLink[] = [
  { label: 'Terms', href: '/terms' },
  { label: 'Privacy', href: '/privacy' },
  { label: 'Responsible Play', href: '/responsible-play' },
  { label: 'Contact', href: '/contact' },
];

export interface Tier {
  id: string;
  name: string;
  /**
   * Display price. `null` means pricing is not yet approved for public
   * release and the UI renders "Pricing announced at launch".
   */
  // TODO(pricing-config): replace with approved pricing once released by the PM.
  price: string | null;
  summary: string;
  features: string[];
  highlighted: boolean;
  comingSoon: boolean;
  cta: string;
}

export const TIERS: Tier[] = [
  {
    id: 'free',
    name: 'Free / Watchlist',
    price: null,
    summary:
      'Follow along in the public channels and see how Unit Talk operates before you commit.',
    features: [
      'Public Discord channels',
      'Community discussion',
      'Educational and responsible-betting content',
      'Product and transparency announcements',
    ],
    highlighted: false,
    comingSoon: false,
    cta: 'Join Free',
  },
  {
    id: 'vip',
    name: 'VIP',
    price: null,
    summary:
      'Structured expert picks with the context needed to understand each one.',
    features: [
      'Everything in Free',
      'Structured expert capper picks',
      'Pick alerts delivered in Discord',
      'Market context on every pick',
      'Members-only discussion channels',
    ],
    highlighted: true,
    comingSoon: false,
    cta: 'Get VIP Access',
  },
  {
    id: 'vip-plus',
    name: 'VIP+',
    price: null,
    summary:
      'The full premium experience — deeper access, earlier alerts, richer context.',
    features: [
      'Everything in VIP',
      'Best Bet previews',
      'Priority alert delivery',
      'Expanded market context and analysis',
      'VIP+ member channels',
    ],
    highlighted: false,
    comingSoon: false,
    cta: 'Get VIP+ Access',
  },
  {
    id: 'syndicate',
    name: 'Syndicate',
    price: null,
    summary:
      'A future top tier built around the deepest level of picks intelligence Unit Talk produces.',
    features: [
      'Everything in VIP+',
      'Syndicate-grade intelligence briefings',
      'Details announced closer to launch',
    ],
    highlighted: false,
    comingSoon: true,
    cta: 'Coming Soon',
  },
];

export const PRICE_PLACEHOLDER = 'Pricing announced at launch';

export const CONTACT = {
  // TODO(support-email): no approved public support email exists yet.
  // Support is handled through Discord until one is provisioned.
  supportEmail: null as string | null,
  supportChannel: 'Support via Discord',
  // TODO(discord-invite): replace with the real public invite once created.
  discordInviteUrl: '#discord-invite-coming-soon',
} as const;

export const PAGE_TITLES = {
  home: 'Unit Talk — Betting Intelligence Built for Serious Action',
  pricing: 'Unit Talk Pricing',
  howItWorks: 'How Unit Talk Works',
  results: 'Unit Talk Results & Transparency',
  faq: 'Unit Talk FAQ',
  responsiblePlay: 'Responsible Play — Unit Talk',
  contact: 'Contact Unit Talk',
  terms: 'Unit Talk Terms of Service',
  privacy: 'Unit Talk Privacy Policy',
} as const;
