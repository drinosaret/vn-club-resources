'use client';

import { useRef, useEffect, useCallback } from 'react';
import { getDisplayTitle, type TitlePreference } from '@/lib/title-preference';
import type { WheelEntry, SpinState } from './RoulettePageClient';

const WHEEL_COLORS = [
  '#6366f1', '#8b5cf6', '#ec4899', '#f43f5e', '#f97316',
  '#eab308', '#22c55e', '#06b6d4', '#3b82f6', '#a855f7',
];

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

  const getCanvasSize = useCallback(() => {
    if (!containerRef.current) return 320;
    const containerWidth = containerRef.current.clientWidth;
    return Math.min(containerWidth, 520);
  }, []);

  const drawWheel = useCallback((ctx: CanvasRenderingContext2D, size: number, rotation: number) => {
    const currentEntries = entriesRef.current;
    const pref = prefRef.current;
    const centerX = size / 2;
    const centerY = size / 2;
    const radius = size / 2 - 6;

    ctx.clearRect(0, 0, size, size);

    if (currentEntries.length === 0) {
      // Empty state: draw a gray circle with text
      ctx.beginPath();
      ctx.arc(centerX, centerY, radius, 0, 2 * Math.PI);
      ctx.fillStyle = '#f3f4f6';
      ctx.fill();
      ctx.strokeStyle = '#d1d5db';
      ctx.lineWidth = 2;
      ctx.stroke();

      ctx.font = 'bold 16px system-ui, -apple-system, sans-serif';
      ctx.fillStyle = '#9ca3af';
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
      ctx.strokeStyle = 'rgba(255,255,255,0.3)';
      ctx.lineWidth = 2;
      ctx.stroke();

      ctx.font = 'bold 16px system-ui, -apple-system, sans-serif';
      ctx.fillStyle = '#ffffff';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const title = getDisplayTitle(currentEntries[0], pref);
      ctx.fillText(truncateText(ctx, title, radius * 1.2), centerX, centerY - radius * 0.15);

      // Center dot
      ctx.beginPath();
      ctx.arc(centerX, centerY, radius * 0.06, 0, 2 * Math.PI);
      ctx.fillStyle = '#ffffff';
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
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
      ctx.lineWidth = 2;
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
      ctx.fillStyle = '#ffffff';
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';

      const maxWidth = radius * 0.68;
      const title = getDisplayTitle(currentEntries[i], pref);
      ctx.fillText(truncateText(ctx, title, maxWidth), radius - 14, 0);
      ctx.restore();
    }

    // Outer ring
    ctx.beginPath();
    ctx.arc(centerX, centerY, radius, 0, 2 * Math.PI);
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.1)';
    ctx.lineWidth = 3;
    ctx.stroke();

    // Center circle
    ctx.beginPath();
    ctx.arc(centerX, centerY, radius * 0.07, 0, 2 * Math.PI);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.15)';
    ctx.lineWidth = 2;
    ctx.stroke();
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

    drawWheel(ctx, size, angleRef.current);
  }, [getCanvasSize, drawWheel]);

  // Redraw on entries/preference change
  useEffect(() => {
    setupCanvas();
  }, [entries, titlePreference, setupCanvas]);

  // Handle resize
  useEffect(() => {
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
          className="w-0 h-0 drop-shadow-md"
          style={{
            borderLeft: '10px solid transparent',
            borderRight: '10px solid transparent',
            borderTop: '18px solid #7c3aed',
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
