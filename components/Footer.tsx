import Link from 'next/link';

function FooterLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="hover:text-primary-400 transition-colors"
    >
      {children}
    </Link>
  );
}

export default function Footer() {
  return (
    <footer className="bg-gray-900 text-gray-300 py-12">
      <div className="container mx-auto px-4 max-w-6xl">
        <div className="grid md:grid-cols-5 gap-8 mb-8">
          {/* About */}
          <div>
            <h3 className="text-white font-semibold mb-4">VN Club</h3>
            <p className="text-sm">
              A community for Japanese learners passionate about reading visual novels in their original, untranslated form.
            </p>
          </div>

          {/* Guides */}
          <div>
            <h3 className="text-white font-semibold mb-4">Setup Guides</h3>
            <ul className="space-y-2 text-sm">
              <li>
                <FooterLink href="/anki-guide">Anki Guide</FooterLink>
              </li>
              <li>
                <FooterLink href="/jl-guide">JL Guide</FooterLink>
              </li>
              <li>
                <FooterLink href="/textractor-guide">Textractor Guide</FooterLink>
              </li>
              <li>
                <FooterLink href="/owocr-guide">OwOCR Guide</FooterLink>
              </li>
              <li>
                <FooterLink href="/bottles-guide">Bottles Guide</FooterLink>
              </li>
              <li>
                <FooterLink href="/jdownloader-guide">JDownloader Guide</FooterLink>
              </li>
            </ul>
          </div>

          {/* Resources */}
          <div>
            <h3 className="text-white font-semibold mb-4">Resources</h3>
            <ul className="space-y-2 text-sm">
              <li>
                <FooterLink href="/guide">Getting Started</FooterLink>
              </li>
              <li>
                <FooterLink href="/find">Find VNs</FooterLink>
              </li>
              <li>
                <FooterLink href="/sources">Where to Get VNs</FooterLink>
              </li>
              <li>
                <FooterLink href="/tools">Tools</FooterLink>
              </li>
            </ul>
          </div>

          {/* Features */}
          <div>
            <h3 className="text-white font-semibold mb-4">Features</h3>
            <ul className="space-y-2 text-sm">
              <li>
                <FooterLink href="/browse">Browse VNs</FooterLink>
              </li>
              <li>
                <FooterLink href="/recommendations">Recommendations</FooterLink>
              </li>
              <li>
                <FooterLink href="/stats">VNDB Stats</FooterLink>
              </li>
              <li>
                <FooterLink href="/news">VN News</FooterLink>
              </li>
              <li>
                <FooterLink href="/quiz">Kana Quiz</FooterLink>
              </li>
            </ul>
          </div>

          {/* Community */}
          <div>
            <h3 className="text-white font-semibold mb-4">Community</h3>
            <ul className="space-y-2 text-sm">
              <li>
                <FooterLink href="/join">Join Discord</FooterLink>
              </li>
              <li>
                <a
                  href="https://github.com/drinosaret/vn-club-resources"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hover:text-primary-400 transition-colors"
                >
                  Contribute on GitHub
                </a>
              </li>
            </ul>
          </div>
        </div>

        {/* Bottom Bar */}
        <div className="border-t border-gray-800 pt-8 text-center text-sm">
          <p>A free and open community resource.</p>
        </div>
      </div>
    </footer>
  );
}
