'use client';

import { ReactNode, useEffect, useState, isValidElement } from 'react';

interface FadeInProps {
  children: ReactNode;
  /** Delay before starting the animation in ms */
  delay?: number;
  /** Duration of the animation in ms */
  duration?: number;
  /** Whether to also slide up from below */
  slideUp?: boolean;
  /** Custom className to apply */
  className?: string;
  /** Whether the content should be shown (controls the fade) */
  show?: boolean;
  /** Start invisible and animate in after one paint frame.
   *  Use for content inside dynamic imports (no SSR) to avoid
   *  Firefox FOIT where text paints one frame behind backgrounds. */
  defer?: boolean;
}

/**
 * FadeIn wrapper component for smooth content transitions.
 * Prevents jarring content "snap" by animating opacity and optional translate.
 */
export function FadeIn({
  children,
  delay = 0,
  duration = 300,
  slideUp = true,
  className = '',
  show = true,
  defer = false,
}: FadeInProps) {
  // When defer=true, always start invisible so the browser gets a paint frame
  // before we animate in (fixes Firefox FOIT on large DOM commits).
  // When defer=false (default), start visible if shown with no delay (SSR-safe).
  const [isVisible, setIsVisible] = useState(!defer && show && delay === 0);

  useEffect(() => {
    // Skip animation during back-nav scroll restoration
    if (show && sessionStorage.getItem('is-popstate-navigation') === 'true') {
      setIsVisible(true);
      return;
    }

    if (show) {
      if (delay > 0) {
        // Only use timeout for delayed animations
        const timer = setTimeout(() => setIsVisible(true), delay);
        return () => clearTimeout(timer);
      } else if (defer) {
        // Wait one paint frame so the browser can rasterize text/backgrounds
        // while the content is still invisible, then transition in
        const id = requestAnimationFrame(() => setIsVisible(true));
        return () => cancelAnimationFrame(id);
      } else {
        // No delay, no defer - show immediately
        setIsVisible(true);
      }
    } else {
      setIsVisible(false);
    }
  }, [show, delay, defer]);

  return (
    <div
      className={`transition-[opacity,transform] ${className}`}
      style={{
        transitionDuration: `${duration}ms`,
        transitionTimingFunction: 'ease-out',
        opacity: isVisible ? 1 : 0,
        transform: slideUp && !isVisible
          ? 'translateY(8px)'
          : undefined,
      }}
    >
      {children}
    </div>
  );
}

interface FadeInGroupProps {
  children: ReactNode[];
  /** Delay between each child animation in ms */
  stagger?: number;
  /** Base delay before starting animations in ms */
  baseDelay?: number;
  /** Duration of each animation in ms */
  duration?: number;
  /** Whether to also slide up from below */
  slideUp?: boolean;
  /** Whether the content should be shown */
  show?: boolean;
}

/**
 * Extract a stable key from a React element if available.
 * Falls back to index-based key if element has no explicit key.
 */
function getChildKey(child: ReactNode, index: number): string | number {
  if (isValidElement(child) && child.key != null) {
    return child.key;
  }
  return `fadein-${index}`;
}

/**
 * Animate multiple children with staggered delays.
 * Note: For best results, pass children with explicit keys to prevent
 * state loss when children reorder.
 */
export function FadeInGroup({
  children,
  stagger = 50,
  baseDelay = 0,
  duration = 300,
  slideUp = true,
  show = true,
}: FadeInGroupProps) {
  return (
    <>
      {children.map((child, index) => (
        <FadeIn
          key={getChildKey(child, index)}
          delay={baseDelay + index * stagger}
          duration={duration}
          slideUp={slideUp}
          show={show}
        >
          {child}
        </FadeIn>
      ))}
    </>
  );
}
