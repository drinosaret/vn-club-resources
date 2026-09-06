'use client';

import { useState, useEffect, useCallback } from 'react';
import { ArrowUp } from 'lucide-react';

const SCROLL_THRESHOLD = 400;

/**
 * Floating button that appears when user scrolls past threshold.
 * Provides quick scroll-to-top functionality for long pages.
 */
export function ScrollToTopButton() {
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    const handleScroll = () => {
      setIsVisible(window.scrollY > SCROLL_THRESHOLD);
    };

    handleScroll(); // Check initial position
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  const scrollToTop = useCallback(() => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  // The hidden state stays mounted so the fade and slide can play; while it is
  // unclickable it is also kept out of the tab order and the accessibility tree.
  return (
    <button
      onClick={scrollToTop}
      aria-label="Scroll to top"
      tabIndex={isVisible ? 0 : -1}
      aria-hidden={!isVisible}
      className={`
        sw-top fixed bottom-6 right-6 z-50
        transition-[opacity,transform,background-color] duration-300 ease-out
        ${isVisible
          ? 'opacity-100 translate-y-0'
          : 'opacity-0 translate-y-4 pointer-events-none'
        }
      `}
    >
      <ArrowUp className="w-5 h-5" />
    </button>
  );
}
