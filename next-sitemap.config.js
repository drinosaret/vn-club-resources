/** @type {import('next-sitemap').IConfig} */
module.exports = {
  siteUrl: 'https://vnclub.org',
  generateRobotsTxt: true,
  outDir: './out',
  transform: async (config, path) => {
    // Set priorities based on page importance
    let priority = 0.7;
    let changefreq = 'weekly';

    if (path === '/') {
      priority = 1.0;
      changefreq = 'daily';
    } else if (path === '/guide') {
      priority = 1.0;
      changefreq = 'weekly';
    } else if (path === '/guides') {
      priority = 0.9;
      changefreq = 'weekly';
    } else if (path === '/tools' || path === '/sources' || path === '/find') {
      priority = 0.8;
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
}
