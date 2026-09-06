'use client';

import { useState, useRef, useEffect, useCallback } from 'react';

interface RangeSliderProps {
  min: number;
  max: number;
  step?: number;
  minValue: number | undefined;
  maxValue: number | undefined;
  onChange: (min: number | undefined, max: number | undefined) => void;
  formatValue?: (value: number) => string;
  label?: string;
  /** One short line under the label, for a caveat the range itself cannot express. */
  hint?: string;
  /** Compact mode: inline label+value on one row, tighter spacing */
  compact?: boolean;
}

export function RangeSlider({
  min,
  max,
  step = 1,
  minValue,
  maxValue,
  onChange,
  formatValue = (v) => String(v),
  label,
  hint,
  compact = false,
}: RangeSliderProps) {
  // Internal state for dragging (to avoid calling onChange on every pixel)
  const [localMin, setLocalMin] = useState(minValue ?? min);
  const [localMax, setLocalMax] = useState(maxValue ?? max);
  const [isDragging, setIsDragging] = useState<'min' | 'max' | null>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  // Cache getBoundingClientRect on drag start to avoid layout thrashing on every move
  const cachedRectRef = useRef<DOMRect | null>(null);

  // Sync with external values
  useEffect(() => {
    setLocalMin(minValue ?? min);
    setLocalMax(maxValue ?? max);
  }, [minValue, maxValue, min, max]);

  const getPercentage = (value: number) => {
    return ((value - min) / (max - min)) * 100;
  };

  const getValueFromPosition = useCallback((clientX: number) => {
    const rect = cachedRectRef.current;
    if (!rect) return min;
    const percentage = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    const rawValue = min + percentage * (max - min);
    // Round to step
    return Math.round(rawValue / step) * step;
  }, [min, max, step]);

  const handleMouseDown = (type: 'min' | 'max') => (e: React.MouseEvent) => {
    e.preventDefault();
    if (trackRef.current) cachedRectRef.current = trackRef.current.getBoundingClientRect();
    setIsDragging(type);
  };

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (!isDragging) return;
    const value = getValueFromPosition(e.clientX);

    if (isDragging === 'min') {
      const newMin = Math.min(value, localMax); // Allow min === max for single value selection
      setLocalMin(Math.max(min, newMin));
    } else {
      const newMax = Math.max(value, localMin); // Allow min === max for single value selection
      setLocalMax(Math.min(max, newMax));
    }
  }, [isDragging, getValueFromPosition, localMax, localMin, min, max, step]);

  const handleMouseUp = useCallback(() => {
    if (isDragging) {
      // Only trigger onChange when drag ends
      const newMin = localMin === min ? undefined : localMin;
      const newMax = localMax === max ? undefined : localMax;
      onChange(newMin, newMax);
    }
    setIsDragging(null);
  }, [isDragging, localMin, localMax, min, max, onChange]);

  useEffect(() => {
    if (isDragging) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
      return () => {
        window.removeEventListener('mousemove', handleMouseMove);
        window.removeEventListener('mouseup', handleMouseUp);
      };
    }
  }, [isDragging, handleMouseMove, handleMouseUp]);

  // Touch support
  const handleTouchStart = (type: 'min' | 'max') => (e: React.TouchEvent) => {
    if (trackRef.current) cachedRectRef.current = trackRef.current.getBoundingClientRect();
    setIsDragging(type);
  };

  const handleTouchMove = useCallback((e: TouchEvent) => {
    if (!isDragging || !e.touches[0]) return;
    const value = getValueFromPosition(e.touches[0].clientX);

    if (isDragging === 'min') {
      const newMin = Math.min(value, localMax); // Allow min === max for single value selection
      setLocalMin(Math.max(min, newMin));
    } else {
      const newMax = Math.max(value, localMin); // Allow min === max for single value selection
      setLocalMax(Math.min(max, newMax));
    }
  }, [isDragging, getValueFromPosition, localMax, localMin, min, max, step]);

  const handleTouchEnd = useCallback(() => {
    if (isDragging) {
      const newMin = localMin === min ? undefined : localMin;
      const newMax = localMax === max ? undefined : localMax;
      onChange(newMin, newMax);
    }
    setIsDragging(null);
  }, [isDragging, localMin, localMax, min, max, onChange]);

  useEffect(() => {
    if (isDragging) {
      window.addEventListener('touchmove', handleTouchMove, { passive: true });
      window.addEventListener('touchend', handleTouchEnd, { passive: true });
      window.addEventListener('touchcancel', handleTouchEnd, { passive: true });
      return () => {
        window.removeEventListener('touchmove', handleTouchMove);
        window.removeEventListener('touchend', handleTouchEnd);
        window.removeEventListener('touchcancel', handleTouchEnd);
      };
    }
  }, [isDragging, handleTouchMove, handleTouchEnd]);

  // Reset to full range
  const handleReset = () => {
    setLocalMin(min);
    setLocalMax(max);
    onChange(undefined, undefined);
  };

  const minPercent = getPercentage(localMin);
  const maxPercent = getPercentage(localMax);
  const isFiltered = localMin !== min || localMax !== max;

  // Click on track to move closest thumb (helps when thumbs overlap)
  const handleTrackClick = (e: React.MouseEvent) => {
    // Ignore if already dragging or if click was on a thumb
    if (isDragging) return;
    if ((e.target as HTMLElement).closest('[data-thumb]')) return;

    if (trackRef.current) cachedRectRef.current = trackRef.current.getBoundingClientRect();
    const clickedValue = getValueFromPosition(e.clientX);
    const distToMin = Math.abs(clickedValue - localMin);
    const distToMax = Math.abs(clickedValue - localMax);

    // Pick closest thumb, preferring min if equal distance
    if (distToMin <= distToMax) {
      const newMin = Math.min(clickedValue, localMax); // Allow min === max for single value selection
      setLocalMin(Math.max(min, newMin));
      onChange(newMin === min ? undefined : newMin, localMax === max ? undefined : localMax);
    } else {
      const newMax = Math.max(clickedValue, localMin); // Allow min === max for single value selection
      setLocalMax(Math.min(max, newMax));
      onChange(localMin === min ? undefined : localMin, newMax === max ? undefined : newMax);
    }
  };

  const stepBy = (thumb: 'min' | 'max', delta: number) => {
    if (thumb === 'min') {
      const next = Math.max(min, Math.min(localMax, localMin + delta));
      setLocalMin(next);
      onChange(next === min ? undefined : next, localMax === max ? undefined : localMax);
    } else {
      const next = Math.min(max, Math.max(localMin, localMax + delta));
      setLocalMax(next);
      onChange(localMin === min ? undefined : localMin, next === max ? undefined : next);
    }
  };

  const handleThumbKey = (thumb: 'min' | 'max') => (e: React.KeyboardEvent) => {
    const big = step * 10;
    const current = thumb === 'min' ? localMin : localMax;
    let target: number | null = null;
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp') target = current + step;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') target = current - step;
    else if (e.key === 'PageUp') target = current + big;
    else if (e.key === 'PageDown') target = current - big;
    else if (e.key === 'Home') target = thumb === 'min' ? min : localMin;
    else if (e.key === 'End') target = thumb === 'min' ? localMax : max;
    if (target === null) return;
    e.preventDefault();
    stepBy(thumb, target - current);
  };

  return (
    <div className={compact ? 'space-y-1' : 'space-y-2'}>
      {compact ? (
        label && (
          <div className="flex items-center justify-between">
            {/* Not a form label: the range it names is two independent sliders below, not one control. */}
            <span className="bw-label" title={hint}>{label}</span>
            <div className="flex items-center gap-1">
              <span className={`bw-num text-xs ${isFiltered ? 'text-[color:var(--ai)]' : 'text-[color:var(--text-faint)]'}`}>
                {formatValue(localMin)} — {formatValue(localMax)}
              </span>
              {isFiltered && (
                <button onClick={handleReset} className="bw-chip-btn text-xs ml-0.5 hit-24 text-[color:var(--ai)]">×</button>
              )}
            </div>
          </div>
        )
      ) : (
        <>
          {label && (
            <div className="flex items-center justify-between">
              <span className="bw-label block">
                {label}
                {hint && (
                  <span className="block normal-case tracking-normal text-[color:var(--text-faint)]">{hint}</span>
                )}
              </span>
              {isFiltered && (
                <button
                  onClick={handleReset}
                  className="sec-more"
                >
                  Reset
                </button>
              )}
            </div>
          )}

          {/* Value display */}
          <div className="bw-num flex items-center justify-between text-sm">
            <span className={isFiltered ? 'text-[color:var(--ai)]' : 'text-[color:var(--nezu)]'}>
              {formatValue(localMin)}
            </span>
            <span className="text-[color:var(--text-faint)] mx-2">—</span>
            <span className={isFiltered ? 'text-[color:var(--ai)]' : 'text-[color:var(--nezu)]'}>
              {formatValue(localMax)}
            </span>
          </div>
        </>
      )}

      {/* Slider track */}
      <div
        ref={trackRef}
        className="bw-track"
        onClick={handleTrackClick}
      >
        {/* Active range */}
        <div
          className="bw-track-fill"
          style={{
            left: `${minPercent}%`,
            width: `${maxPercent - minPercent}%`,
          }}
        />

        {/* Min thumb: outer div is the touch target, inner div is the visual thumb */}
        {/* z-index: min=10, max=20, dragging=30 so when thumbs overlap both remain accessible */}
        <div
          data-thumb="min"
          role="slider"
          tabIndex={0}
          aria-label={`${label ?? 'Range'} minimum`}
          aria-valuemin={min}
          aria-valuemax={max}
          aria-valuenow={localMin}
          aria-valuetext={formatValue(localMin)}
          className="absolute top-1/2 -translate-y-1/2 w-8 h-8 flex items-center justify-center cursor-grab focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--ai)] rounded-full"
          style={{
            left: `${minPercent}%`,
            marginLeft: '-16px',
            zIndex: isDragging === 'min' ? 30 : 10,
          }}
          onMouseDown={handleMouseDown('min')}
          onTouchStart={handleTouchStart('min')}
          onKeyDown={handleThumbKey('min')}
        >
          <div
            className={`bw-thumb transition-transform hover:scale-110 ${
              isDragging === 'min' ? 'scale-125 cursor-grabbing' : ''
            }`}
          />
        </div>

        {/* Max thumb */}
        <div
          data-thumb="max"
          role="slider"
          tabIndex={0}
          aria-label={`${label ?? 'Range'} maximum`}
          aria-valuemin={min}
          aria-valuemax={max}
          aria-valuenow={localMax}
          aria-valuetext={formatValue(localMax)}
          className="absolute top-1/2 -translate-y-1/2 w-8 h-8 flex items-center justify-center cursor-grab focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--ai)] rounded-full"
          style={{
            left: `${maxPercent}%`,
            marginLeft: '-16px',
            zIndex: isDragging === 'max' ? 30 : 20,
          }}
          onMouseDown={handleMouseDown('max')}
          onTouchStart={handleTouchStart('max')}
          onKeyDown={handleThumbKey('max')}
        >
          <div
            className={`bw-thumb transition-transform hover:scale-110 ${
              isDragging === 'max' ? 'scale-125 cursor-grabbing' : ''
            }`}
          />
        </div>
      </div>
    </div>
  );
}
