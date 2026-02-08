/** @type {import('next-sitemap').IConfig} */
module.exports = {
  siteUrl: 'https://vnclub.org',
  generateRobotsTxt: true,
  outDir: process.env.STATIC_EXPORT === 'true' ? './out' : './public',
  transform: async (config, path) => {
    // Set priorities based on page importance for SEO
    let priority = 0.7;
    let changefreq = 'weekly';

    if (path === '/') {
      priority = 1.0;
      changefreq = 'daily';
    } else if (path === '/guide') {
      // Main guide — flagship content, highest priority
      priority = 1.0;
      changefreq = 'weekly';
    } else if (path === '/guides') {
      priority = 0.9;
      changefreq = 'weekly';
    } else if (path === '/browse') {
      // VN browser — high engagement page
      priority = 0.9;
      changefreq = 'daily';
    } else if (path === '/tools' || path === '/sources' || path === '/find') {
      priority = 0.8;
      changefreq = 'weekly';
    } else if (path === '/quiz') {
      priority = 0.8;
      changefreq = 'monthly';
    } else if (path === '/news') {
      priority = 0.8;
      changefreq = 'daily';
    } else if (path === '/recommendations') {
      priority = 0.8;
      changefreq = 'weekly';
    } else if (path === '/stats') {
      priority = 0.7;
      changefreq = 'weekly';
    } else if (path.includes('-guide')) {
      priority = 0.8;
      changefreq = 'monthly';
    }

    return {
      loc: path,
      changefreq,
      priority,
      lastmod: config.autoLastmod ? new Date().toISOString() : undefined,
    };
  },
  robotsTxtOptions: {
    policies: [
      {
        userAgent: '*',
        allow: '/',
        disallow: ['/api/'],
      },
    ],
    additionalSitemaps: [
      'https://vnclub.org/sitemap.xml',
    ],
  },
}
