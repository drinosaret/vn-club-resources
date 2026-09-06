import type { MetadataRoute } from 'next';

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://vnclub.org';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        // The random page never answers the same way twice, so it is not for crawlers.
        disallow: ['/api/', '/3x3-maker/s/', '/tierlist/s/', '/random/'],
      },
      // Search engines are not on this list.
      {
        userAgent: [
          'TerraCotta',
          'meta-externalagent',
          'AhrefsBot',
          'SemrushBot',
          'Reflectionbot',
          'Bytespider',
          'DotBot',
          'PetalBot',
          'MJ12bot',
          'ExaSearchBot',
          'DataForSeoBot',
        ],
        disallow: '/',
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
