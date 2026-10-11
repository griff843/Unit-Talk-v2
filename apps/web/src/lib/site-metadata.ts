import type { Metadata } from 'next';
import { BRAND, SITE_URL } from './site-config';
export function pageMetadata(
  title: string,
  description: string,
  path: string,
): Metadata {
  const image = {
    url: '/brand/unit-talk-horizontal-white-2400.png',
    width: 2400,
    height: 738,
    alt: 'Unit Talk — sports betting intelligence',
  };
  return {
    title: { absolute: title },
    description,
    alternates: { canonical: path },
    openGraph: {
      title,
      description,
      url: new URL(path, SITE_URL),
      type: 'website',
      siteName: BRAND.name,
      images: [image],
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      images: [image.url],
    },
  };
}
