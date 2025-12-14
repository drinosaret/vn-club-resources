import Link from 'next/link';

export default function Footer() {
  return (
    <footer className="bg-gray-900 text-gray-300 py-12">
      <div className="container mx-auto px-4 max-w-6xl">
        <div className="grid md:grid-cols-4 gap-8 mb-8">
          {/* About */}
          <div>
            <h3 className="text-white font-semibold mb-4">VN Club</h3>
            <p className="text-sm">
              A community for Japanese learners passionate about reading visual novels in their original, untranslated form.
            </p>
          </div>

          {/* Resources */}
          <div>
            <h3 className="text-white font-semibold mb-4">Resources</h3>
            <ul className="space-y-2 text-sm">
              <li>
                <Link href="/guide" className="hover:text-primary-400 transition-colors">
                  Getting Started
                </Link>
              </li>
              <li>
                <Link href="/find" className="hover:text-primary-400 transition-colors">
                  Recommendations
                </Link>
              </li>
              <li>
                <Link href="/sources" className="hover:text-primary-400 transition-colors">
                  Where to Get VNs
                </Link>
              </li>
              <li>
                <Link href="/tools" className="hover:text-primary-400 transition-colors">
                  Tools
                </Link>
              </li>
            </ul>
          </div>

          {/* Guides */}
          <div>
            <h3 className="text-white font-semibold mb-4">Setup Guides</h3>
            <ul className="space-y-2 text-sm">
              <li>
                <Link href="/jl-guide" className="hover:text-primary-400 transition-colors">
                  JL Dictionary
                </Link>
              </li>
              <li>
                <Link href="/textractor-guide" className="hover:text-primary-400 transition-colors">
                  Textractor
                </Link>
              </li>
              <li>
                <Link href="/agent-guide" className="hover:text-primary-400 transition-colors">
                  Agent
                </Link>
              </li>
              <li>
                <Link href="/owocr-guide" className="hover:text-primary-400 transition-colors">
                  OwOCR
                </Link>
              </li>
              <li>
                <Link href="/timetracker-guide" className="hover:text-primary-400 transition-colors">
                  VNTimeTracker
                </Link>
              </li>
              <li>
                <Link href="/jdownloader-guide" className="hover:text-primary-400 transition-colors">
                  JDownloader
                </Link>
              </li>
            </ul>
          </div>

          {/* Community */}
          <div>
            <h3 className="text-white font-semibold mb-4">Community</h3>
            <ul className="space-y-2 text-sm">
              <li>
                <Link href="/join" className="hover:text-primary-400 transition-colors">
                  Join Discord
                </Link>
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
