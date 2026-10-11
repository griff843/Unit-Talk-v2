import type { MetadataRoute } from 'next';
import { SITE_URL } from '@/lib/site-config';
const routes = [
  '',
  '/results',
  '/cappers',
  '/pricing',
  '/how-it-works',
  '/faq',
  '/responsible-play',
  '/contact',
  '/terms',
  '/privacy',
];
export default function sitemap(): MetadataRoute.Sitemap {
  return routes.map((route) => ({
    url: SITE_URL + route,
    changeFrequency: 'weekly',
    priority: route === '' ? 1 : 0.7,
  }));
}
