'use client';

import { useRef, useEffect, useCallback } from 'react';
import { getDisplayTitle, type TitlePreference } from '@/lib/title-preference';
import type { WheelEntry, SpinState } from './RoulettePageClient';

// The wheel is drawn on a canvas, so its fills cannot be tokens. They are the site
// palette written out: teal, amber and crimson at the weights that carry white type,
// with neutral inks between them so adjacent wedges stay told apart.
const WHEEL_COLORS = [
  '#235C66', '#3C4046', '#9C6D10', '#A62432', '#2E6E5E',
  '#17181A', '#4A5A6B', '#7A4A1E', '#1C4A53', '#5A5F66',
];

const MAX_CANVAS_SIZE = 520;
const MIN_CANVAS_SIZE = 120;
const FALLBACK_CANVAS_SIZE = 320;

/**
 * The parts of the wheel that sit against the page rather than on a wedge: the empty disc and
 * the hairlines around the rim and the hub. Painted pixels do not follow a stylesheet, so the
 * tokens are resolved where the canvas sits and re-resolved when the theme changes. The
 * fallbacks are the light theme's values, which is what an element reporting nothing shows.
 */
interface WheelTheme {
  inset: string;
  rule: string;
  faint: string;
  ink: string;
}

const LIGHT_THEME: WheelTheme = {
  inset: '#F6F7F8',
  rule: '#E3E5E8',
  faint: '#70767F',
  ink: '#17181A',
};

function readTheme(el: Element): WheelTheme {
  const style = getComputedStyle(el);
  const token = (name: string, fallback: string) => style.getPropertyValue(name).trim() || fallback;
  return {
    inset: token('--surface-inset', LIGHT_THEME.inset),
    rule: token('--rule', LIGHT_THEME.rule),
    faint: token('--text-faint', LIGHT_THEME.faint),
    ink: token('--ink', LIGHT_THEME.ink),
  };
}

interface RouletteWheelProps {
  entries: WheelEntry[];
  spinState: SpinState;
  winnerIndex: number | null;
  onSpinComplete: () => void;
  titlePreference: TitlePreference;
  emptyText?: string;
}

export function RouletteWheel({
  entries,
  spinState,
  winnerIndex,
  onSpinComplete,
  titlePreference,
  emptyText,
}: RouletteWheelProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const angleRef = useRef(0);
  const animFrameRef = useRef<number | null>(null);
  const onSpinCompleteRef = useRef(onSpinComplete);
  onSpinCompleteRef.current = onSpinComplete;

  // Track entries/preference in refs so the draw function doesn't need them as deps
  const entriesRef = useRef(entries);
  entriesRef.current = entries;
  const prefRef = useRef(titlePreference);
  prefRef.current = titlePreference;
  const emptyTextRef = useRef(emptyText || 'Add VNs to start');
  emptyTextRef.current = emptyText || 'Add VNs to start';
  const themeRef = useRef<WheelTheme>(LIGHT_THEME);

  // A container that has not been laid out yet reports a width of zero, and a canvas
  // sized from that gives the wheel a negative radius, which the arc call rejects.
  const getCanvasSize = useCallback(() => {
    const containerWidth = containerRef.current?.clientWidth ?? 0;
    if (containerWidth <= 0) return FALLBACK_CANVAS_SIZE;
    return Math.max(MIN_CANVAS_SIZE, Math.min(containerWidth, MAX_CANVAS_SIZE));
  }, []);

  const drawWheel = useCallback((ctx: CanvasRenderingContext2D, size: number, rotation: number) => {
    const currentEntries = entriesRef.current;
    const pref = prefRef.current;
    const theme = themeRef.current;
    const centerX = size / 2;
    const centerY = size / 2;
    const radius = size / 2 - 6;
    if (radius <= 0) return;

    ctx.clearRect(0, 0, size, size);

    if (currentEntries.length === 0) {
      // Empty state: an inset disc with the prompt on it
      ctx.beginPath();
      ctx.arc(centerX, centerY, radius, 0, 2 * Math.PI);
      ctx.fillStyle = theme.inset;
      ctx.fill();
      ctx.strokeStyle = theme.rule;
      ctx.lineWidth = 1;
      ctx.stroke();

      ctx.font = 'bold 16px system-ui, -apple-system, sans-serif';
      ctx.fillStyle = theme.faint;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(emptyTextRef.current, centerX, centerY);
      return;
    }

    if (currentEntries.length === 1) {
      // Single entry: fill the whole circle
      ctx.beginPath();
      ctx.arc(centerX, centerY, radius, 0, 2 * Math.PI);
      ctx.fillStyle = WHEEL_COLORS[0];
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.25)';
      ctx.lineWidth = 1;
      ctx.stroke();

      ctx.font = 'bold 16px system-ui, -apple-system, sans-serif';
      ctx.fillStyle = '#F2F3F4';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const title = getDisplayTitle(currentEntries[0], pref);
      ctx.fillText(truncateText(ctx, title, radius * 1.2), centerX, centerY - radius * 0.15);

      // Center dot
      ctx.beginPath();
      ctx.arc(centerX, centerY, radius * 0.06, 0, 2 * Math.PI);
      ctx.fillStyle = '#E8A317';
      ctx.fill();
      return;
    }

    const segmentAngle = (2 * Math.PI) / currentEntries.length;

    // Draw segments
    for (let i = 0; i < currentEntries.length; i++) {
      const startAngle = rotation + i * segmentAngle - Math.PI / 2;
      const endAngle = startAngle + segmentAngle;
      const color = WHEEL_COLORS[i % WHEEL_COLORS.length];

      // Segment arc
      ctx.beginPath();
      ctx.moveTo(centerX, centerY);
      ctx.arc(centerX, centerY, radius, startAngle, endAngle);
      ctx.closePath();
      ctx.fillStyle = color;
      ctx.fill();

      // Segment border
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.25)';
      ctx.lineWidth = 1;
      ctx.stroke();

      // Title text (clipped to segment)
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(centerX, centerY);
      ctx.arc(centerX, centerY, radius, startAngle, endAngle);
      ctx.closePath();
      ctx.clip();
      ctx.translate(centerX, centerY);
      const midAngle = startAngle + segmentAngle / 2;
      ctx.rotate(midAngle);

      const fontSize = currentEntries.length <= 4 ? 15
        : currentEntries.length <= 8 ? 13
        : currentEntries.length <= 14 ? 11 : 10;
      ctx.font = `bold ${fontSize}px system-ui, -apple-system, sans-serif`;
      ctx.fillStyle = '#F2F3F4';
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';

      const maxWidth = radius * 0.68;
      const title = getDisplayTitle(currentEntries[i], pref);
      ctx.fillText(truncateText(ctx, title, maxWidth), radius - 14, 0);
      ctx.restore();
    }

    // Outer ring. Drawn in the ink of whichever theme is showing, so the rim reads against
    // the ground behind it rather than sinking into it.
    ctx.beginPath();
    ctx.arc(centerX, centerY, radius, 0, 2 * Math.PI);
    ctx.strokeStyle = theme.ink;
    ctx.globalAlpha = 0.28;
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.globalAlpha = 1;

    // Center circle
    ctx.beginPath();
    ctx.arc(centerX, centerY, radius * 0.07, 0, 2 * Math.PI);
    ctx.fillStyle = '#E8A317';
    ctx.fill();
    ctx.strokeStyle = theme.ink;
    ctx.globalAlpha = 0.35;
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.globalAlpha = 1;
  }, []);

  // Set up canvas and draw
  const setupCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const size = getCanvasSize();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    canvas.style.width = `${size}px`;
    canvas.style.height = `${size}px`;
    ctx.scale(dpr, dpr);

    // Resolved once per setup rather than once per frame: a spin redraws sixty times a second
    // and the tokens cannot change without the effect below running.
    themeRef.current = readTheme(canvas);
    drawWheel(ctx, size, angleRef.current);
  }, [getCanvasSize, drawWheel]);

  // Redraw on entries/preference change
  useEffect(() => {
    setupCanvas();
  }, [entries, titlePreference, setupCanvas]);

  // Painted pixels do not follow a stylesheet, so the theme is repainted rather than
  // recascaded. The root element's class is where the theme is recorded.
  useEffect(() => {
    if (typeof MutationObserver === 'undefined') return;
    const observer = new MutationObserver(() => setupCanvas());
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, [setupCanvas]);

  // Observing the container rather than the window catches the first measurable width,
  // which the initial draw can miss, as well as every later resize.
  useEffect(() => {
    const container = containerRef.current;
    if (container && typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver(() => setupCanvas());
      observer.observe(container);
      return () => observer.disconnect();
    }
    const handleResize = () => setupCanvas();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [setupCanvas]);

  // Spin animation
  useEffect(() => {
    if (spinState !== 'spinning' || winnerIndex === null || entries.length < 2) return;

    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const size = getCanvasSize();
    const segmentAngle = (2 * Math.PI) / entries.length;

    // Target: winner segment center aligned with pointer (top, -PI/2)
    const winnerCenter = winnerIndex * segmentAngle + segmentAngle / 2;
    const jitter = (Math.random() - 0.5) * segmentAngle * 0.6;
    const targetAngle = -winnerCenter + jitter;

    // Normalize target relative to current angle and add full rotations
    const fullRotations = 4 + Math.floor(Math.random() * 4);
    let delta = targetAngle - angleRef.current;
    // Normalize delta to be negative (wheel spins clockwise visually = positive angle mathematically,
    // but we want the delta to represent forward spinning)
    delta = ((delta % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
    const totalRotation = fullRotations * 2 * Math.PI + delta;

    const duration = 3500 + Math.random() * 1500;
    const startTime = performance.now();
    const startAngle = angleRef.current;

    function animate(now: number) {
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / duration, 1);

      // Cubic ease-out
      const eased = 1 - Math.pow(1 - progress, 3);

      angleRef.current = startAngle + totalRotation * eased;

      const dpr = window.devicePixelRatio || 1;
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
      drawWheel(ctx!, size, angleRef.current);

      if (progress < 1) {
        animFrameRef.current = requestAnimationFrame(animate);
      } else {
        animFrameRef.current = null;
        onSpinCompleteRef.current();
      }
    }

    animFrameRef.current = requestAnimationFrame(animate);

    return () => {
      if (animFrameRef.current !== null) {
        cancelAnimationFrame(animFrameRef.current);
        animFrameRef.current = null;
      }
    };
  }, [spinState, winnerIndex, entries.length, getCanvasSize, drawWheel]);

  return (
    <div ref={containerRef} className="relative w-full max-w-[520px] aspect-square">
      {/* Pointer */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-0.5 z-10">
        <div
          className="w-0 h-0"
          style={{
            borderLeft: '10px solid transparent',
            borderRight: '10px solid transparent',
            borderTop: '18px solid var(--kohaku)',
          }}
        />
      </div>

      <canvas
        ref={canvasRef}
        className="block mx-auto"
      />
    </div>
  );
}

function truncateText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let truncated = text;
  while (truncated.length > 3 && ctx.measureText(truncated + '\u2026').width > maxWidth) {
    truncated = truncated.slice(0, -1);
  }
  return truncated + '\u2026';
}
