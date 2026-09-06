import Link from '@/components/Link';

function FooterLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="transition-colors hover:text-[color:var(--kohaku)]"
    >
      {children}
    </Link>
  );
}

export default function Footer() {
  return (
    <footer className="box-band on-box py-12">
      <div className="container mx-auto px-4 max-w-6xl">
        <div className="grid md:grid-cols-5 gap-8 mb-8">
          {/* About */}
          <div>
            <h2 className="nameplate nameplate--quiet mb-4">VN Club</h2>
            <p className="text-sm">
              A community for those passionate about reading Japanese visual novels in their original, untranslated form.
            </p>
          </div>

          {/* Guides */}
          <div>
            <h2 className="nameplate nameplate--quiet mb-4">Setup Guides</h2>
            <ul className="space-y-2 text-sm">
              <li>
                <FooterLink href="/guides/">All Guides</FooterLink>
              </li>
              <li>
                <FooterLink href="/anki-guide/">Anki Guide</FooterLink>
              </li>
              <li>
                <FooterLink href="/jl-guide/">JL Guide</FooterLink>
              </li>
              <li>
                <FooterLink href="/textractor-guide/">Textractor Guide</FooterLink>
              </li>
              <li>
                <FooterLink href="/owocr-guide/">OwOCR Guide</FooterLink>
              </li>
              <li>
                <FooterLink href="/bottles-guide/">Bottles Guide</FooterLink>
              </li>
              <li>
                <FooterLink href="/jdownloader-guide/">JDownloader Guide</FooterLink>
              </li>
            </ul>
          </div>

          {/* Resources */}
          <div>
            <h2 className="nameplate nameplate--quiet mb-4">Resources</h2>
            <ul className="space-y-2 text-sm">
              <li>
                <FooterLink href="/guide/">Getting Started</FooterLink>
              </li>
              <li>
                <FooterLink href="/faq/">FAQ</FooterLink>
              </li>
              <li>
                <FooterLink href="/find/">Find VNs</FooterLink>
              </li>
              <li>
                <FooterLink href="/sources/">Where to Get VNs</FooterLink>
              </li>
              <li>
                <FooterLink href="/tools/">Tools</FooterLink>
              </li>
            </ul>
          </div>

          {/* Features */}
          <div>
            <h2 className="nameplate nameplate--quiet mb-4">Features</h2>
            <ul className="space-y-2 text-sm">
              <li>
                <FooterLink href="/browse/">Browse VNs</FooterLink>
              </li>
              <li>
                <FooterLink href="/recommendations/">Recommendations</FooterLink>
              </li>
              <li>
                <FooterLink href="/stats/">VNDB Stats</FooterLink>
              </li>
              <li>
                <FooterLink href="/news/">VN News</FooterLink>
              </li>
              <li>
                <FooterLink href="/news/upcoming/">Upcoming Releases</FooterLink>
              </li>
              <li>
                <FooterLink href="/word-of-the-day/">Word of the Day</FooterLink>
              </li>
              <li>
                <FooterLink href="/quiz/">Kana Quiz</FooterLink>
              </li>
              <li>
                <FooterLink href="/tierlist/">Tier List</FooterLink>
              </li>
              <li>
                <FooterLink href="/3x3-maker/">3x3 Maker</FooterLink>
              </li>
              <li>
                <FooterLink href="/roulette/">Roulette</FooterLink>
              </li>
              <li>
                <FooterLink href="/higher-or-lower/">Higher or Lower</FooterLink>
              </li>
            </ul>
          </div>

          {/* Community */}
          <div>
            <h2 className="nameplate nameplate--quiet mb-4">Community</h2>
            <ul className="space-y-2 text-sm">
              <li>
                <FooterLink href="/join/">Join Discord</FooterLink>
              </li>
              <li>
                <FooterLink href="/events/">Events</FooterLink>
              </li>
              <li>
                <FooterLink href="/events/history/">Past Club Picks</FooterLink>
              </li>
              <li>
                <FooterLink href="/changelog/">Changelog</FooterLink>
              </li>
              <li>
                <a
                  href="https://github.com/drinosaret/vn-club-resources"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="transition-colors hover:text-[color:var(--kohaku)]"
                >
                  Contribute on GitHub
                </a>
              </li>
              {process.env.NEXT_PUBLIC_VNDB_STATS_API && (
                <li>
                  <a
                    href={`${process.env.NEXT_PUBLIC_VNDB_STATS_API}/docs`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="transition-colors hover:text-[color:var(--kohaku)]"
                  >
                    Public API
                  </a>
                </li>
              )}
              <li>
                <a
                  href="mailto:contact@vnclub.org"
                  className="transition-colors hover:text-[color:var(--kohaku)]"
                >
                  Contact
                </a>
              </li>
            </ul>
          </div>
        </div>

        {/* Bottom Bar */}
        <div className="border-t border-[color:var(--rule)] pt-8 text-center text-sm">
          <p>A free and open community resource.</p>
          {/* Two records feed the site. One is licensed, and the licence asks to be named
              wherever the data is shown; the other supplies the language figures and is
              credited alongside it. Stating both once in the footer covers every page,
              including the ones whose own headings already credit a source. */}
          <p className="mt-2 text-[color:var(--text-faint)]">
            Contains data from{' '}
            <a
              href="https://vndb.org"
              target="_blank"
              rel="noopener noreferrer"
              className="transition-colors hover:text-[color:var(--kohaku)]"
            >
              VNDB
            </a>
            , available under the{' '}
            <a
              href="https://opendatacommons.org/licenses/odbl/1-0/"
              target="_blank"
              rel="noopener noreferrer"
              className="transition-colors hover:text-[color:var(--kohaku)]"
            >
              Open Database License
            </a>
            . Reading difficulty and script measurements come from{' '}
            <a
              href="https://jiten.moe"
              target="_blank"
              rel="noopener noreferrer"
              className="transition-colors hover:text-[color:var(--kohaku)]"
            >
              jiten.moe
            </a>
            .
          </p>
          <p className="mt-2 text-[color:var(--text-faint)]">
            <FooterLink href="/privacy/">Privacy</FooterLink>
            <span className="mx-2">·</span>
            <FooterLink href="/terms/">Terms</FooterLink>
          </p>
        </div>
      </div>
    </footer>
  );
}
