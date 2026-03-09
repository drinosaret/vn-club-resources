import type { MetadataRoute } from 'next';

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://vnclub.org';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: ['/api/', '/3x3-maker/s/', '/tierlist/s/'],
      },
      // Explicitly allow crawlers to access all public content
      {
        userAgent: [
          'GPTBot',
          'ChatGPT-User',
          'Claude-Web',
          'ClaudeBot',
          'Amazonbot',
          'PerplexityBot',
          'YouBot',
          'Google-Extended',
          'Applebot-Extended',
          'CCBot',
          'cohere-ai',
        ],
        allow: '/',
        disallow: ['/api/', '/3x3-maker/s/', '/tierlist/s/'],
      },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
