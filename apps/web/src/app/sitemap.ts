import type { MetadataRoute } from 'next';
import { SITE_URL } from '@/lib/site-config';

const ROUTES = [
  '',
  '/pricing',
  '/how-it-works',
  '/results',
  '/faq',
  '/responsible-play',
  '/terms',
  '/privacy',
  '/contact',
];

export default function sitemap(): MetadataRoute.Sitemap {
  return ROUTES.map((route) => ({
    url: `${SITE_URL}${route}`,
    lastModified: new Date(),
    changeFrequency: 'weekly',
    priority: route === '' ? 1 : 0.7,
  }));
}
