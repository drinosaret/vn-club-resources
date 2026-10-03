import type { Metadata } from 'next';
import { generatePageMetadata, SITE_URL, safeJsonLdStringify, generateBreadcrumbJsonLd } from '@/lib/metadata-utils';

export const metadata: Metadata = generatePageMetadata({
  title: 'Privacy Policy',
  description:
    'The privacy policy for VN Club, a free open source site about Japanese visual novels: no accounts, no ads, no tracking cookies, a brief technical log, and your rights under GDPR.',
  path: '/privacy/',
});

const jsonLd = [
  {
    '@context': 'https://schema.org',
    '@type': 'WebPage',
    name: 'Privacy Policy',
    description:
      'No accounts, no ads, no tracking cookies: what little VN Club keeps, and your rights under GDPR.',
    url: `${SITE_URL}/privacy/`,
  },
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
      <div className="container mx-auto max-w-3xl px-4 py-12">
        <h1 className="sec-title">
          Privacy Policy
        </h1>
        <p className="op-label mt-3">
          Last updated: October 3, 2026
        </p>

        <div className="prose op-doc mt-8">
          <p>
            VN Club (vnclub.org) is a free, open source site about Japanese visual novels. All of it
            works without an account, and it is built to need as little information about you as
            possible.
          </p>

          <h2>The short version</h2>
          <ul>
            <li>No accounts, no sign-ups, no email addresses.</li>
            <li>No ads, no tracking cookies, and nothing is ever sold.</li>
            <li>Your preferences stay in your own browser.</li>
            <li>Visits are counted anonymously, without cookies, on our own server.</li>
            <li>The server keeps a brief technical log for security, which clears itself.</li>
            <li>The site is open source, so all of this can be checked in the code.</li>
          </ul>

          <h2>On your device</h2>
          <p>
            Your preferences, such as tier list settings and language toggles, are saved in your
            browser&apos;s local storage and never leave your device. The one cookie the site sets
            remembers the grid size you picked on the browse page, for a year.
          </p>
          <p>
            Images you upload to the grid maker also stay in your browser and are never sent to us.
          </p>

          <h2>Visit counts</h2>
          <p>
            We count visits with{' '}
            <a href="https://umami.is" target="_blank" rel="noopener noreferrer">
              Umami
            </a>
            , a privacy-focused analytics tool that runs on our own server in the Netherlands. It
            uses no cookies, stores no personal data and does not follow you across sites. It counts
            page views, where visitors arrived from, and general details such as country and
            browser, all in aggregate, so we can see which parts of the site get used.
          </p>

          <h2>Technical logs</h2>
          <p>
            As on almost every website, the web server keeps a brief technical log of requests so
            problems can be fixed and abuse blocked. An entry records the IP address, the time, the
            page and the browser type. Entries usually clear themselves within about a week, and the
            log is never used to track or profile visitors, or shared with anyone unless the law
            requires it. You can see exactly what is recorded in{' '}
            <a
              href="https://github.com/drinosaret/vn-club-resources/blob/main/deploy/nginx/nginx.conf"
              target="_blank"
              rel="noopener noreferrer"
            >
              the server configuration
            </a>
            .
          </p>

          <h2>Shared layouts</h2>
          <p>
            When you share a tier list or 3x3, the layout (which VNs, their placements, your labels)
            is saved on our server so others can open it from the link. No name, email or IP address
            is attached to it, and it can only use pictures from the site&apos;s own VN data.
          </p>

          <h2>VNDB user data</h2>
          <p>
            The stats and recommendation pages work from VNDB&apos;s public database dump, which
            includes the lists and votes VNDB users have made public. When you look up a VNDB
            username, we read that user&apos;s public list from our copy and may keep the stats and
            recommendations worked out from it, so the page loads quickly next time. The only thing
            we take from you is the username you type. If you&apos;d like your VNDB data removed
            from our copy, email us.
          </p>

          <h2>Cover images</h2>
          <p>
            VN cover images are served from our own server rather than VNDB&apos;s, so your browser
            never connects to VNDB.
          </p>

          <h2>Third-party services</h2>
          <p>
            Visual novel data and images come from{' '}
            <a href="https://vndb.org" target="_blank" rel="noopener noreferrer">
              VNDB
            </a>
            ; difficulty, vocabulary and example sentence data from{' '}
            <a href="https://jiten.moe" target="_blank" rel="noopener noreferrer">
              Jiten.moe
            </a>
            ; and kanji and dictionary data from KanjiAPI, Jisho.org and Tatoeba. Our server fetches
            what it needs from them, so they never receive any data about you.
          </p>
          <p>
            The site is served through{' '}
            <a href="https://www.cloudflare.com/privacypolicy/" target="_blank" rel="noopener noreferrer">
              Cloudflare
            </a>
            , which protects it from attacks and may set its own cookies for bot detection,
            including Turnstile, the check on the share button. We don&apos;t control or access
            Cloudflare&apos;s data; their privacy policy covers it.
          </p>

          <h2>Where data is stored</h2>
          <p>
            The site is hosted in the Netherlands, and everything described here is stored on
            servers there. Cloudflare may route requests through servers in other countries as part
            of its network.
          </p>

          <h2>Your rights under GDPR</h2>
          <p>
            Since we&apos;re hosted in the EU, GDPR applies. The personal data we hold is limited to
            the short-lived technical logs and the public VNDB data described above. We process it on
            the basis of legitimate interest: running the site securely and providing the features
            you choose to use.
          </p>
          <p>
            You can ask what we hold about you, or ask us to correct or delete it, by emailing{' '}
            <a href="mailto:contact@vnclub.org">contact@vnclub.org</a>. You also have the right to
            complain to a data protection authority; in the Netherlands that is the{' '}
            <a
              href="https://autoriteitpersoonsgegevens.nl"
              target="_blank"
              rel="noopener noreferrer"
            >
              Autoriteit Persoonsgegevens
            </a>
            .
          </p>

          <h2>Changes</h2>
          <p>If this policy changes, the date at the top updates.</p>

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
