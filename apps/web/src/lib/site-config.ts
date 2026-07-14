/**
 * Site-wide configuration for the Unit Talk public marketing site.
 *
 * Unit Talk is a premium sports-betting intelligence product delivered
 * through Discord. It is not a sportsbook — it does not accept or place
 * wagers, and it does not offer financial advice. All copy on the site must
 * stay consistent with that stance: qualitative, not quantitative; no
 * unverified performance claims (win rate, ROI, CLV, "guaranteed" outcomes).
 *
 * Several launch values below are intentionally undecided (domain, support
 * contact, Discord invite, final pricing amounts) — see UTV2-1482, the
 * public-website launch config decision packet. They are marked TODO and
 * must not be treated as binding until the PM sets real values there.
 */

// TODO(domain-config): replace with the real production domain once provisioned (UTV2-1482).
export const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://unittalk.example.com';

export const BRAND = {
  name: 'Unit Talk',
  wordmark: 'UNIT TALK',
  tagline: 'A disciplined intelligence desk for serious bettors.',
  description:
    'Unit Talk gives members structured picks, market context, alerts, and a premium Discord experience built around process, not promises.',
  notASportsbook: 'Not a sportsbook. Unit Talk does not accept or place wagers.',
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

/** Trust-strip / ticker labels — qualitative only, no numbers or claims. */
export const TICKER_ITEMS: string[] = [
  'Structured picks',
  'Market context on every call',
  'Premium Discord desk',
  'Transparent process',
  'Responsible betting first',
  'No guaranteed outcomes',
];

export interface Tier {
  id: string;
  name: string;
  /**
   * Display price. `null` means pricing is not yet approved for public
   * release and the UI renders the placeholder token instead.
   */
  // TODO(pricing-config): replace with approved pricing once released by the PM (UTV2-1482).
  price: string | null;
  billing: string;
  summary: string;
  features: string[];
  highlighted: boolean;
  comingSoon: boolean;
  cta: string;
}

export const TIERS: Tier[] = [
  {
    id: 'free',
    name: 'Free',
    price: null,
    billing: 'Watchlist',
    summary: 'Follow along in the public channels and see how the desk operates before you commit.',
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
    billing: 'Membership',
    summary: 'Structured expert picks with the context needed to understand each one.',
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
    billing: 'Membership',
    summary: 'The full premium desk — deeper access, earlier alerts, richer context.',
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
    billing: 'Future tier',
    summary: 'A future top tier built around the deepest level of picks intelligence Unit Talk produces.',
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

export const PRICE_PLACEHOLDER = 'Announced at launch';

/** Feature-comparison matrix for the pricing page. `true` = included. */
export interface PricingTableRow {
  feature: string;
  free: boolean;
  vip: boolean;
  vipPlus: boolean;
  syndicate: boolean;
}

export const PRICING_TABLE_ROWS: PricingTableRow[] = [
  { feature: 'Public Discord channels', free: true, vip: true, vipPlus: true, syndicate: true },
  { feature: 'Structured expert picks', free: false, vip: true, vipPlus: true, syndicate: true },
  { feature: 'Market context on every pick', free: false, vip: true, vipPlus: true, syndicate: true },
  { feature: 'Members-only discussion channels', free: false, vip: true, vipPlus: true, syndicate: true },
  { feature: 'Best Bet previews', free: false, vip: false, vipPlus: true, syndicate: true },
  { feature: 'Priority alert delivery', free: false, vip: false, vipPlus: true, syndicate: true },
  { feature: 'Expanded market analysis', free: false, vip: false, vipPlus: true, syndicate: true },
  { feature: 'Syndicate intelligence briefings', free: false, vip: false, vipPlus: false, syndicate: true },
];

export const CONTACT = {
  // TODO(support-email): no approved public support email exists yet (UTV2-1482).
  // Support is handled through Discord until one is provisioned.
  supportEmail: null as string | null,
  supportChannel: 'Support via Discord',
  // TODO(discord-invite): replace with the real public invite once created (UTV2-1482).
  discordInviteUrl: '#discord-invite-coming-soon',
} as const;

/**
 * Established, third-party responsible-gambling resources. These are real
 * public services (not Unit Talk claims) and are safe to publish as-is;
 * only Unit Talk's own launch values (domain/support/pricing) are
 * placeholders.
 */
export interface HelpResource {
  name: string;
  detail: string;
  href?: string;
}

export const RESPONSIBLE_GAMBLING_RESOURCES: HelpResource[] = [
  {
    name: 'National Problem Gambling Helpline',
    detail: 'Call or text 1-800-GAMBLER (1-800-426-2537), 24/7, free and confidential.',
    href: 'tel:18004262537',
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
  home: 'Unit Talk — A Disciplined Intelligence Desk for Serious Bettors',
  pricing: 'Unit Talk Pricing',
  howItWorks: 'How Unit Talk Works',
  results: 'Unit Talk Results & Transparency',
  faq: 'Unit Talk FAQ',
  responsiblePlay: 'Responsible Play — Unit Talk',
  contact: 'Contact Unit Talk',
  terms: 'Unit Talk Terms of Service',
  privacy: 'Unit Talk Privacy Policy',
} as const;
