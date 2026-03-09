import type { Metadata } from 'next';
import { generatePageMetadata, safeJsonLdStringify, generateBreadcrumbJsonLd } from '@/lib/metadata-utils';

export const metadata: Metadata = generatePageMetadata({
  title: 'Privacy Policy',
  description:
    'VN Club privacy policy. What data we collect (not much), how images are proxied, and how your preferences are stored locally.',
  path: '/privacy/',
});

const jsonLd = [
  generateBreadcrumbJsonLd([
    { name: 'Home', path: '/' },
    { name: 'Privacy Policy', path: '/privacy/' },
  ]),
];

export default function PrivacyPage() {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: safeJsonLdStringify(jsonLd) }}
      />
      <div className="container mx-auto px-4 py-12 max-w-3xl">
        <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-2">
          Privacy Policy
        </h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-8">
          Last updated: March 9, 2026
        </p>

        <div className="prose dark:prose-invert max-w-none prose-headings:text-xl prose-headings:font-semibold prose-headings:mt-8 prose-headings:mb-3 prose-p:text-gray-600 dark:prose-p:text-gray-300 prose-p:leading-relaxed prose-li:text-gray-600 dark:prose-li:text-gray-300">
          <p>
            VN Club (vnclub.org) is a free resource site for learning Japanese through visual novels.
          </p>

          <h2>What we collect</h2>
          <p>
            There are no accounts, no login, and no tracking cookies.
          </p>
          <p>
            When you share a tier list or 3x3, the layout data (which VNs, tier placements, labels)
            gets saved to our server so others can view it via the link. No name, email, or IP
            address is attached to it.
          </p>

          <h2>Images</h2>
          <p>
            VN cover images are proxied through our server from VNDB, so your browser connects to
            vnclub.org instead of VNDB directly. We don&apos;t log these requests.
          </p>

          <h2>Cloudflare</h2>
          <p>
            The site is behind Cloudflare, which may set its own cookies for bot detection and DDoS
            protection. We don&apos;t control or access Cloudflare&apos;s analytics. Their privacy
            policy covers the details.
          </p>

          <h2>Analytics</h2>
          <p>
            We use{' '}
            <a href="https://umami.is" target="_blank" rel="noopener noreferrer">
              Umami
            </a>
            , a privacy-focused analytics tool. Umami does not use cookies, does not collect personal
            data, and does not track you across sites. It records aggregate page views and referrers
            so we can understand which parts of the site get used. All analytics data is stored on
            our own server in the Netherlands.
          </p>

          <h2>Cookies and local storage</h2>
          <p>
            We don&apos;t set cookies. Your browser&apos;s local storage saves your preferences (tier
            list settings, language toggles) - that data stays on your device and never leaves it.
          </p>

          <h2>Third-party services</h2>
          <ul>
            <li>
              <strong>VNDB</strong> - VN data and images come from VNDB. We don&apos;t share
              anything with them.
            </li>
            <li>
              <strong>Jiten.moe</strong> - Language difficulty and reading statistics come from
              Jiten.moe. We don&apos;t share user data with them.
            </li>
            <li>
              <strong>Cloudflare</strong> - CDN, security, and Turnstile (bot verification on some
              forms).
            </li>
            <li>
              <strong>Umami</strong> - Privacy-focused, cookie-free analytics. Self-hosted on our
              server. No personal data collected.
            </li>
          </ul>

          <h2>Where data is processed</h2>
          <p>
            The site is hosted in the Netherlands. Shared layout data is stored on servers in the
            Netherlands. Cloudflare may route requests through servers in other countries as part of
            their CDN.
          </p>

          <h2>Your rights under GDPR</h2>
          <p>
            Since we&apos;re hosted in the EU, GDPR applies. In practice, we collect very little
            personal data - shared layouts don&apos;t contain any, and we don&apos;t have accounts
            or track users. But if you believe we hold any data related to you and want it deleted,
            email{' '}
            <a href="mailto:contact@vnclub.org">contact@vnclub.org</a> and we&apos;ll handle it.
          </p>

          <h2>Changes</h2>
          <p>If this changes, the date at the top updates.</p>

          <h2>Contact</h2>
          <p>
            Questions? Email us at{' '}
            <a href="mailto:contact@vnclub.org">contact@vnclub.org</a>, find us on{' '}
            <a
              href="https://discord.gg/Ze7dYKVTHf"
              target="_blank"
              rel="noopener noreferrer"
            >
              Discord
            </a>
            , or open an issue on{' '}
            <a
              href="https://github.com/drinosaret/vn-club-resources"
              target="_blank"
              rel="noopener noreferrer"
            >
              GitHub
            </a>
            .
          </p>
        </div>
      </div>
    </>
  );
}
