/** @type {import('next').NextConfig} */

// Determine output mode:
// - STATIC_EXPORT=true → static export (GitHub Pages)
// - Default → standalone (Railway/Docker)
const getOutputConfig = () => {
  if (process.env.STATIC_EXPORT === 'true') {
    return { output: 'export' };
  }
  // Standalone output for Docker/Railway deployment
  return { output: 'standalone' };
};

// Build connect-src with backend API URL if configured
const backendUrl = process.env.NEXT_PUBLIC_VNDB_STATS_API;
const connectSrc = [
  "'self'",
  'https://vnclub.org',
  'https://api.vnclub.org',
  'https://gc.zgo.at',
  'https://vnclub.goatcounter.com',
  ...(backendUrl ? [backendUrl] : []),
].join(' ');

const isDev = process.env.NODE_ENV === 'development';

const nextConfig = {
  ...getOutputConfig(),
  trailingSlash: true,
  // Security and caching headers
  async headers() {
    return [
      // Security headers for all routes
      // CSP is production-only — dev mode needs 'unsafe-eval' for
      // Turbopack/webpack source maps which breaks a strict CSP
      {
        source: '/:path*',
        headers: [
          {
            key: 'X-Content-Type-Options',
            value: 'nosniff',
          },
          {
            key: 'X-Frame-Options',
            value: 'DENY',
          },
          {
            key: 'Strict-Transport-Security',
            value: 'max-age=31536000; includeSubDomains; preload',
          },
          {
            key: 'Referrer-Policy',
            value: 'strict-origin-when-cross-origin',
          },
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), midi=(), accelerometer=(), gyroscope=()',
          },
          ...(!isDev ? [{
            // CSP: Next.js requires 'unsafe-inline' for scripts due to inline
            // hydration scripts. We still get value from restricting other directives.
            key: 'Content-Security-Policy',
            value: [
              "default-src 'self'",
              "script-src 'self' 'unsafe-inline' https://static.cloudflareinsights.com https://gc.zgo.at",
              "style-src 'self' 'unsafe-inline'",
              "img-src 'self' data: blob: https://t.vndb.org https://pbs.twimg.com https://video.twimg.com https://ton.twimg.com https://abs.twimg.com https://store.steampowered.com https://cdn.akamai.steamstatic.com https://vnclub.org https://vnclub.goatcounter.com",
              "font-src 'self'",
              `connect-src ${connectSrc}`,
              "frame-ancestors 'none'",
              "base-uri 'self'",
              "form-action 'self'",
              "object-src 'none'",
            ].join('; '),
          }] : []),
        ],
      },
      // Cache static assets for 1 year (immutable)
      {
        source: '/assets/:path*',
        headers: [
          {
            key: 'Cache-Control',
            value: 'public, max-age=31536000, immutable',
          },
          {
            key: 'Content-Disposition',
            value: 'inline',
          },
        ],
      },
      // Cache Next.js static files (JS/CSS bundles) for 1 year
      {
        source: '/_next/static/:path*',
        headers: [
          {
            key: 'Cache-Control',
            value: 'public, max-age=31536000, immutable',
          },
        ],
      },
      // Cache /img/ route responses (VNDB images) for 30 days
      {
        source: '/img/:path*',
        headers: [
          {
            key: 'Cache-Control',
            value: 'public, max-age=2592000, stale-while-revalidate=86400',
          },
        ],
      },
    ];
  },
  images: {
    // Enable image optimization for standalone mode (Railway)
    // Static export will still be unoptimized due to Next.js limitations
    unoptimized: process.env.STATIC_EXPORT === 'true',
    contentDispositionType: 'inline',
    formats: ['image/webp'],
    deviceSizes: [640, 750, 828, 1080, 1200, 1920],
    imageSizes: [16, 32, 48, 64, 96, 128, 256],
    // Allow local image paths (explicit config required in Next.js 16+)
    localPatterns: [
      {
        pathname: '/assets/**',
      },
      {
        pathname: '/img/**',
      },
      {
        pathname: '/api/proxy-image',
      },
    ],
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 't.vndb.org',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: 'vnclub.org',
        pathname: '/assets/**',
      },
      {
        protocol: 'https',
        hostname: 'store.steampowered.com',
        pathname: '/steam/**',
      },
      {
        protocol: 'https',
        hostname: 'cdn.akamai.steamstatic.com',
        pathname: '/**',
      },
    ],
  },
  // Rewrite /sitemap.xml to the manual sitemap index route handler.
  // Next.js bug #77304: generateSitemaps() doesn't auto-generate a sitemap index.
  async rewrites() {
    return [
      {
        source: '/sitemap.xml',
        destination: '/api/sitemap-index',
      },
    ];
  },
  // Disable source maps in production to avoid leaking source code
  productionBrowserSourceMaps: false,
  // Required for Next.js 16+ with existing webpack config
  turbopack: {},
  webpack: (config, { dev }) => {
    if (dev) {
      config.watchOptions = {
        ...config.watchOptions,
        ignored: ['**/.cache/**', '**/node_modules/**'],
      };
    }
    return config;
  },
}

export default nextConfig
