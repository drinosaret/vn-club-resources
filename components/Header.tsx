'use client';

import Link from 'next/link';
import Image from 'next/image';
import { useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { Menu, X, ChevronDown } from 'lucide-react';
import { ThemeToggle } from './ThemeToggle';
import { TitleLanguageToggle } from './TitleLanguageToggle';
import SearchBar from './SearchBar';
import { getHeaderNavigation } from '@/lib/navigation';

const DiscordIcon = ({ className }: { className?: string }) => (
  <svg className={className} viewBox="0 0 24 24" fill="currentColor">
    <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z"/>
  </svg>
);

const DISCORD_URL = '/join';

// Get navigation from single source of truth
const { mobile: mobileNavigation, desktop: desktopNavigation } = getHeaderNavigation();

export default function Header() {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [expandedSections, setExpandedSections] = useState<string[]>([]);
  const pathname = usePathname();
  const router = useRouter();

  const toggleSection = (sectionName: string) => {
    setExpandedSections(prev =>
      prev.includes(sectionName)
        ? prev.filter(name => name !== sectionName)
        : [...prev, sectionName]
    );
  };

  // Handle navigation for links that should reset when clicked while on the same page
  const handleNavClick = (e: React.MouseEvent<HTMLAnchorElement>, href: string) => {
    // Normalize paths for comparison (handle trailingSlash: true in next.config)
    const normalizedPathname = pathname.endsWith('/') ? pathname.slice(0, -1) : pathname;
    const normalizedHref = href.endsWith('/') ? href.slice(0, -1) : href;

    // If already on this path, force a clean navigation (clears query params)
    if (normalizedPathname === normalizedHref) {
      e.preventDefault();
      router.push(href);
    }
  };

  return (
    <header className="bg-white dark:bg-gray-900 shadow-sm border-b border-gray-200 dark:border-gray-800 fixed top-0 left-0 right-0 z-50">
      <nav className="container mx-auto px-4 py-4 max-w-7xl">
        <div className="flex justify-between items-center gap-4">
          {/* Logo */}
          <Link href="/" className="flex items-center space-x-1.5 sm:space-x-2 group flex-shrink-0">
            <Image
              src="/assets/hikaru-icon2.webp"
              alt="Hikaru"
              width={32}
              height={32}
              className="w-7 h-7 sm:w-8 sm:h-8"
            />
            <div className="flex items-center gap-0.5 sm:gap-1">
              <span className="text-xl sm:text-2xl font-bold bg-gradient-to-r from-indigo-600 to-purple-600 dark:from-indigo-400 dark:to-purple-400 bg-clip-text text-transparent">
                VN
              </span>
              <span className="text-xl sm:text-2xl font-bold text-gray-900 dark:text-gray-100">
                Club
              </span>
            </div>
          </Link>

          {/* Desktop Navigation */}
          <div className="hidden lg:flex items-center space-x-6">
            {desktopNavigation.map((item) => {
              const normalizedPathname = pathname.endsWith('/') ? pathname.slice(0, -1) : pathname;
              const isActive = item.href === '/'
                ? normalizedPathname === ''
                : normalizedPathname.startsWith(item.href);

              return (
                <Link
                  key={item.name}
                  href={item.href}
                  onClick={(e) => handleNavClick(e, item.href)}
                  className={`transition-colors font-medium ${
                    isActive
                      ? 'text-primary-600 dark:text-primary-400'
                      : 'text-gray-700 dark:text-gray-300 hover:text-primary-600 dark:hover:text-primary-400'
                  }`}
                >
                  {item.name}
                </Link>
              );
            })}
            <SearchBar className="w-48 lg:w-64" />
            <Link
              href={DISCORD_URL}
              className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
              aria-label="Join Discord"
            >
              <DiscordIcon className="w-5 h-5 text-gray-700 dark:text-gray-300 hover:text-indigo-600 dark:hover:text-indigo-400" />
            </Link>
            <TitleLanguageToggle />
            <ThemeToggle />
          </div>

          {/* Mobile Menu Button */}
          <div className="lg:hidden flex items-center space-x-1">
            <Link
              href={DISCORD_URL}
              className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
              aria-label="Join Discord"
            >
              <DiscordIcon className="w-5 h-5 text-gray-700 dark:text-gray-300" />
            </Link>
            <TitleLanguageToggle />
            <ThemeToggle />
            <button
              onClick={() => setIsMenuOpen(!isMenuOpen)}
              className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700"
              aria-label="Toggle menu"
            >
              {isMenuOpen ? (
                <X className="w-5 h-5 text-gray-700 dark:text-gray-300" />
              ) : (
                <Menu className="w-5 h-5 text-gray-700 dark:text-gray-300" />
              )}
            </button>
          </div>
        </div>

        {/* Mobile Navigation */}
        {isMenuOpen && (
          <div className="lg:hidden mt-4 pb-4 max-h-[calc(100vh-5rem)] overflow-y-auto overflow-x-hidden animate-slide-down">
            <div className="flex flex-col space-y-1">
              <SearchBar
                className="mb-3"
                isMobile={true}
                onClose={() => setIsMenuOpen(false)}
              />
              {mobileNavigation.map((section) => (
                <div key={section.name}>
                  {section.items ? (
                    // Expandable section
                    <>
                      <button
                        onClick={() => toggleSection(section.name)}
                        className="w-full flex items-center justify-between text-gray-700 dark:text-gray-300 hover:text-primary-600 dark:hover:text-primary-400 transition-colors py-2 font-medium"
                      >
                        {section.name}
                        <ChevronDown
                          className={`w-4 h-4 transition-transform duration-200 ${
                            expandedSections.includes(section.name) ? 'rotate-180' : ''
                          }`}
                        />
                      </button>
                      {expandedSections.includes(section.name) && (
                        <div className="ml-4 border-l-2 border-gray-200 dark:border-gray-700 pl-4 space-y-1">
                          {section.items.map((item) => {
                            const normalizedPath = pathname.endsWith('/') ? pathname.slice(0, -1) : pathname;
                            const isItemActive = item.href === '/'
                              ? normalizedPath === ''
                              : normalizedPath.startsWith(item.href);
                            return (
                              <Link
                                key={item.href}
                                href={item.href}
                                onClick={(e) => {
                                  setIsMenuOpen(false);
                                  handleNavClick(e, item.href);
                                }}
                                className={`block transition-colors py-2.5 text-sm ${
                                  isItemActive
                                    ? 'text-primary-600 dark:text-primary-400 font-medium'
                                    : 'text-gray-600 dark:text-gray-400 hover:text-primary-600 dark:hover:text-primary-400'
                                }`}
                              >
                                {item.name}
                              </Link>
                            );
                          })}
                        </div>
                      )}
                    </>
                  ) : (
                    // Simple link
                    (() => {
                      const normalizedPath = pathname.endsWith('/') ? pathname.slice(0, -1) : pathname;
                      const isSectionActive = section.href === '/'
                        ? normalizedPath === ''
                        : normalizedPath.startsWith(section.href!);
                      return (
                        <Link
                          href={section.href!}
                          onClick={(e) => {
                            setIsMenuOpen(false);
                            handleNavClick(e, section.href!);
                          }}
                          className={`block transition-colors py-2 font-medium ${
                            isSectionActive
                              ? 'text-primary-600 dark:text-primary-400'
                              : 'text-gray-700 dark:text-gray-300 hover:text-primary-600 dark:hover:text-primary-400'
                          }`}
                        >
                          {section.name}
                        </Link>
                      );
                    })()
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </nav>
    </header>
  );
}
