'use client';

import { useState, useMemo, useRef, useCallback, useEffect } from 'react';
import Link from 'next/link';
import { Calendar, Star, Search, ZoomIn, ZoomOut, X } from 'lucide-react';
import { VNDBListItem } from '@/lib/vndb-stats-api';
import { useTitlePreference, getDisplayTitle } from '@/lib/title-preference';

type ScoreCategory = 'high' | 'medium' | 'low' | 'unrated';

// Grid constants for day-by-day layout
const CELL_SIZE = 6;  // px - width per day
const BAR_HEIGHT = 10;  // px - height of bars
const TRACK_GAP = 2;  // px between tracks
const TRACK_HEIGHT = BAR_HEIGHT + TRACK_GAP;  // Total height per track
const MS_PER_DAY = 24 * 60 * 60 * 1000;

interface VNTimelineChartProps {
  novels: VNDBListItem[];
}

interface GanttItem {
  vnId: string;
  title: string;
  titleRaw?: string;      // Raw title for search fallback
  titleJp?: string;       // Japanese title for search fallback
  startDate: Date | null;
  endDate: Date | null;
  score: number | null;
  imageUrl?: string;
  hasDateRange: boolean;
}

interface TrackItem extends GanttItem {
  track: number;
}

// Allocate VNs to tracks, minimizing vertical space
function allocateTracks(items: GanttItem[]): TrackItem[] {
  // Sort by start date (or end date if no start)
  const sorted = [...items].sort((a, b) => {
    const dateA = a.startDate || a.endDate;
    const dateB = b.startDate || b.endDate;
    if (!dateA) return 1;
    if (!dateB) return -1;
    return dateA.getTime() - dateB.getTime();
  });

  // Track end times for each track (when that track becomes free)
  const trackEndTimes: number[] = [];

  return sorted.map(item => {
    const startTime = (item.startDate || item.endDate)?.getTime() || 0;

    // Find first available track (ends BEFORE this item starts - strict inequality to prevent same-day overlap)
    let track = trackEndTimes.findIndex(endTime => endTime < startTime);
    if (track === -1) {
      track = trackEndTimes.length; // Need a new track
    }

    // Update track end time - ensure minimum 1 day occupancy for visual spacing
    const endTime = (item.endDate || item.startDate)?.getTime() || startTime;
    const minOccupancy = 24 * 60 * 60 * 1000; // 1 day in ms
    trackEndTimes[track] = Math.max(endTime, startTime + minOccupancy);

    return { ...item, track };
  });
}

// Get color based on score (red → yellow → green gradient)
function getScoreColor(score: number | null): string {
  if (score === null) return '#6b7280'; // gray
  if (score >= 8) return '#22c55e'; // green
  if (score >= 6) return '#eab308'; // yellow
  if (score >= 4) return '#f97316'; // orange
  return '#ef4444'; // red
}

// Get darker border color based on score
function getBorderColor(score: number | null): string {
  if (score === null) return '#4b5563'; // darker gray
  if (score >= 8) return '#16a34a'; // darker green
  if (score >= 6) return '#ca8a04'; // darker yellow
  if (score >= 4) return '#ea580c'; // darker orange
  return '#dc2626'; // darker red
}

// Get score category for filtering
function getScoreCategory(score: number | null): ScoreCategory {
  if (score === null) return 'unrated';
  if (score >= 8) return 'high';
  if (score >= 6) return 'medium';
  return 'low';
}

// Format date for display
function formatDate(date: Date): string {
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' });
}

export function VNTimelineChart({ novels }: VNTimelineChartProps) {
  const { preference } = useTitlePreference();
  const [hoveredItem, setHoveredItem] = useState<GanttItem | null>(null);
  const [tooltipPos, setTooltipPos] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [scoreFilter, setScoreFilter] = useState<Set<ScoreCategory>>(new Set(['high', 'medium', 'low', 'unrated']));
  const [searchQuery, setSearchQuery] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const verticalScrollRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef<number>(0);
  const RENDER_BUFFER = 200; // px buffer on each side to prevent pop-in

  // Viewport state for virtualization
  const [viewport, setViewport] = useState({
    scrollLeft: 0, scrollTop: 0, viewWidth: 1200, viewHeight: 600,
  });

  const updateViewport = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(() => {
      const h = scrollContainerRef.current;
      const v = verticalScrollRef.current;
      if (!h) return;
      setViewport({
        scrollLeft: h.scrollLeft,
        scrollTop: v?.scrollTop ?? 0,
        viewWidth: h.clientWidth,
        viewHeight: v?.clientHeight ?? 600,
      });
    });
  }, []);

  // Initialize viewport on mount and handle resize
  useEffect(() => {
    updateViewport();
    window.addEventListener('resize', updateViewport);
    return () => {
      window.removeEventListener('resize', updateViewport);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [updateViewport]);

  // Process novels into Gantt items
  const ganttData = useMemo(() => {
    return novels
      .filter(n => n.started || n.finished)
      .map(n => ({
        vnId: n.id,
        title: n.vn ? getDisplayTitle({ title: n.vn.title, title_jp: n.vn.title_jp, title_romaji: n.vn.title_romaji }, preference) : n.id,
        titleRaw: n.vn?.title,
        titleJp: n.vn?.title_jp,
        startDate: n.started ? new Date(n.started) : null,
        endDate: n.finished ? new Date(n.finished) : null,
        score: n.vote ? n.vote / 10 : null,
        imageUrl: n.vn?.image?.url,
        hasDateRange: !!(n.started && n.finished),
      }));
  }, [novels, preference]);

  // Calculate time range
  const { minDate, maxDate, totalDays } = useMemo(() => {
    const dates = ganttData.flatMap(item => [item.startDate, item.endDate].filter(Boolean) as Date[]);
    if (dates.length === 0) {
      const now = new Date();
      return { minDate: now, maxDate: now, totalDays: 1 };
    }
    const min = new Date(Math.min(...dates.map(d => d.getTime())));
    const max = new Date(Math.max(...dates.map(d => d.getTime())));
    // Add some padding
    min.setMonth(min.getMonth() - 1);
    max.setMonth(max.getMonth() + 1);
    const days = Math.max(1, (max.getTime() - min.getTime()) / (1000 * 60 * 60 * 24));
    return { minDate: min, maxDate: max, totalDays: days };
  }, [ganttData]);

  // Generate month markers for the time axis
  const monthMarkers = useMemo(() => {
    const markers: { date: Date; label: string; position: number }[] = [];
    const current = new Date(minDate);
    current.setDate(1);

    while (current <= maxDate) {
      const position = ((current.getTime() - minDate.getTime()) / (1000 * 60 * 60 * 24)) / totalDays * 100;
      const isJanuary = current.getMonth() === 0;
      markers.push({
        date: new Date(current),
        label: isJanuary ? current.getFullYear().toString() : current.toLocaleDateString('en-US', { month: 'short' }),
        position,
      });
      current.setMonth(current.getMonth() + 1);
    }
    return markers;
  }, [minDate, maxDate, totalDays]);

  // Compute track allocation for compact view
  const trackData = useMemo(() => {
    return allocateTracks(ganttData);
  }, [ganttData]);

  // Filter track data by score category
  const filteredTrackData = useMemo(() => {
    return trackData.filter(item => scoreFilter.has(getScoreCategory(item.score)));
  }, [trackData, scoreFilter]);

  // Calculate filtered max track
  const filteredMaxTrack = useMemo(() => {
    return Math.max(0, ...filteredTrackData.map(t => t.track));
  }, [filteredTrackData]);

  // Search matching logic - search across display title, raw title, and Japanese title
  const searchMatches = useMemo(() => {
    if (!searchQuery.trim()) return new Set<string>();
    const query = searchQuery.toLowerCase();
    return new Set(
      ganttData
        .filter(item => {
          const display = item.title.toLowerCase();
          const raw = item.titleRaw?.toLowerCase() || '';
          const jp = item.titleJp?.toLowerCase() || '';
          return display.includes(query) || raw.includes(query) || jp.includes(query);
        })
        .map(item => item.vnId)
    );
  }, [ganttData, searchQuery]);

  const isHighlighted = (vnId: string) => searchQuery.trim() !== '' && searchMatches.has(vnId);
  const isDimmed = (vnId: string) => searchQuery.trim() !== '' && !searchMatches.has(vnId);

  // Get unique years for navigation
  const years = useMemo(() => {
    const yearSet = new Set<number>();
    ganttData.forEach(item => {
      if (item.startDate) yearSet.add(item.startDate.getFullYear());
      if (item.endDate) yearSet.add(item.endDate.getFullYear());
    });
    return Array.from(yearSet).sort();
  }, [ganttData]);

  // Scroll to a specific year (pixel-based)
  const scrollToYear = (year: number) => {
    const yearStart = new Date(year, 0, 1);
    const dayOffset = Math.floor((yearStart.getTime() - minDate.getTime()) / MS_PER_DAY);
    const pixelPos = dayOffset * CELL_SIZE * zoom;
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollLeft = Math.max(0, pixelPos - 100);
    }
  };

  // Calculate grid dimensions based on days and zoom
  const gridDimensions = useMemo(() => {
    const gridWidth = Math.max(800, totalDays * CELL_SIZE * zoom);
    const gridHeight = (filteredMaxTrack + 1) * TRACK_HEIGHT;
    return { gridWidth, gridHeight };
  }, [totalDays, zoom, filteredMaxTrack]);

  // Recalculate visible items when zoom or data changes
  useEffect(() => { updateViewport(); }, [zoom, filteredTrackData, updateViewport]);

  // Virtualization: only render elements visible in the scroll viewport + buffer
  const visibleBars = useMemo(() => {
    const { scrollLeft, scrollTop, viewWidth, viewHeight } = viewport;
    const left = scrollLeft - RENDER_BUFFER;
    const right = scrollLeft + viewWidth + RENDER_BUFFER;
    const top = scrollTop - RENDER_BUFFER;
    const bottom = scrollTop + viewHeight + RENDER_BUFFER;

    return filteredTrackData.filter(item => {
      const startDate = item.startDate || item.endDate;
      if (!startDate) return false;
      const startDay = Math.floor((startDate.getTime() - minDate.getTime()) / MS_PER_DAY);
      const endDate = item.endDate || item.startDate;
      const endDay = Math.ceil(((endDate?.getTime() || startDate.getTime()) - minDate.getTime()) / MS_PER_DAY);
      const barLeft = startDay * CELL_SIZE * zoom;
      const barWidth = Math.max(1, endDay - startDay) * CELL_SIZE * zoom;
      const barTop = item.track * TRACK_HEIGHT;
      return (barLeft + barWidth >= left && barLeft <= right)
          && (barTop + BAR_HEIGHT >= top && barTop <= bottom);
    });
  }, [filteredTrackData, viewport, minDate, zoom, RENDER_BUFFER]);

  const visibleGridLines = useMemo(() => {
    const spacing = 7 * CELL_SIZE * zoom;
    const startIdx = Math.max(0, Math.floor((viewport.scrollLeft - RENDER_BUFFER) / spacing));
    const endIdx = Math.min(
      Math.ceil(totalDays / 7),
      Math.ceil((viewport.scrollLeft + viewport.viewWidth + RENDER_BUFFER) / spacing)
    );
    return Array.from({ length: endIdx - startIdx }, (_, i) => startIdx + i);
  }, [viewport, zoom, totalDays, RENDER_BUFFER]);

  const visibleTracks = useMemo(() => {
    const startTrack = Math.max(0, Math.floor((viewport.scrollTop - RENDER_BUFFER) / TRACK_HEIGHT));
    const endTrack = Math.min(
      filteredMaxTrack + 1,
      Math.ceil((viewport.scrollTop + viewport.viewHeight + RENDER_BUFFER) / TRACK_HEIGHT)
    );
    return Array.from({ length: endTrack - startTrack }, (_, i) => startTrack + i);
  }, [viewport, filteredMaxTrack, RENDER_BUFFER]);

  const visibleMonthMarkers = useMemo(() => {
    const left = viewport.scrollLeft - RENDER_BUFFER;
    const right = viewport.scrollLeft + viewport.viewWidth + RENDER_BUFFER;
    return monthMarkers.filter(marker => {
      const dayOffset = Math.floor((marker.date.getTime() - minDate.getTime()) / MS_PER_DAY);
      const pixelPos = dayOffset * CELL_SIZE * zoom;
      return pixelPos >= left && pixelPos <= right;
    });
  }, [monthMarkers, viewport, minDate, zoom, RENDER_BUFFER]);

  // Toggle score filter
  const toggleScoreFilter = (category: ScoreCategory) => {
    setScoreFilter(prev => {
      const newSet = new Set(prev);
      if (newSet.has(category)) {
        newSet.delete(category);
      } else {
        newSet.add(category);
      }
      return newSet;
    });
  };

  // Handle mouse move for tooltip
  const handleMouseMove = (e: React.MouseEvent, item: GanttItem) => {
    setHoveredItem(item);
    setTooltipPos({ x: e.clientX, y: e.clientY });
  };

  if (ganttData.length === 0) {
    return (
      <div className="bg-white dark:bg-gray-800 rounded-xl p-5 border border-gray-200/60 dark:border-gray-700/80 shadow-md shadow-gray-200/50 dark:shadow-none">
        <div className="flex items-center gap-2 mb-4">
          <Calendar className="w-4 h-4" />
          <h3 className="text-sm font-medium text-gray-900 dark:text-white">Reading Timeline</h3>
        </div>
        <div className="h-32 flex items-center justify-center text-gray-400 dark:text-gray-500 text-sm">
          No timeline data available. Add started/finished dates to your VNs on VNDB to see them here.
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl p-5 border border-gray-200/60 dark:border-gray-700/80 shadow-md shadow-gray-200/50 dark:shadow-none">
      {/* Header */}
      <div className="flex flex-col gap-3 mb-4">
        {/* Top row: Title */}
        <div className="flex items-center gap-2">
          <Calendar className="w-4 h-4 text-gray-500" />
          <h3 className="text-sm font-medium text-gray-900 dark:text-white">Reading Timeline</h3>
          <span className="text-xs text-gray-400">({filteredTrackData.length}/{ganttData.length} VNs)</span>
        </div>

        {/* Controls row */}
        <div className="flex flex-wrap items-center gap-3">
            {/* Zoom controls */}
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => setZoom(z => Math.max(0.5, z - 0.25))}
                className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-500 dark:text-gray-400"
                title="Zoom out"
              >
                <ZoomOut className="w-3.5 h-3.5" />
              </button>
              <input
                type="range"
                min="0.5"
                max="3"
                step="0.25"
                value={zoom}
                onChange={(e) => setZoom(parseFloat(e.target.value))}
                className="w-16 h-1 accent-primary-500"
              />
              <button
                onClick={() => setZoom(z => Math.min(3, z + 0.25))}
                className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-500 dark:text-gray-400"
                title="Zoom in"
              >
                <ZoomIn className="w-3.5 h-3.5" />
              </button>
              <span className="text-[10px] text-gray-400 w-7">{zoom}x</span>
            </div>

            {/* Score filter toggles */}
            <div className="flex items-center gap-1">
              <button
                onClick={() => toggleScoreFilter('high')}
                className={`px-1.5 py-0.5 text-[10px] rounded transition-colors ${
                  scoreFilter.has('high')
                    ? 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400'
                    : 'bg-gray-100 text-gray-400 dark:bg-gray-700 dark:text-gray-500'
                }`}
                title="8+ rated"
              >
                8+
              </button>
              <button
                onClick={() => toggleScoreFilter('medium')}
                className={`px-1.5 py-0.5 text-[10px] rounded transition-colors ${
                  scoreFilter.has('medium')
                    ? 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-400'
                    : 'bg-gray-100 text-gray-400 dark:bg-gray-700 dark:text-gray-500'
                }`}
                title="6-8 rated"
              >
                6-8
              </button>
              <button
                onClick={() => toggleScoreFilter('low')}
                className={`px-1.5 py-0.5 text-[10px] rounded transition-colors ${
                  scoreFilter.has('low')
                    ? 'bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-400'
                    : 'bg-gray-100 text-gray-400 dark:bg-gray-700 dark:text-gray-500'
                }`}
                title="<6 rated"
              >
                &lt;6
              </button>
              <button
                onClick={() => toggleScoreFilter('unrated')}
                className={`px-1.5 py-0.5 text-[10px] rounded transition-colors ${
                  scoreFilter.has('unrated')
                    ? 'bg-gray-200 text-gray-600 dark:bg-gray-600 dark:text-gray-300'
                    : 'bg-gray-100 text-gray-400 dark:bg-gray-700 dark:text-gray-500'
                }`}
                title="Unrated"
              >
                ?
              </button>
            </div>

            {/* Search input */}
            <div className="relative flex items-center">
              <Search className="w-3 h-3 absolute left-2 text-gray-400" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search..."
                className="w-28 pl-6 pr-6 py-1 text-xs bg-gray-100 dark:bg-gray-700 border-none rounded-md text-gray-700 dark:text-gray-300 placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-primary-500"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  className="absolute right-1.5 p-0.5 rounded hover:bg-gray-200 dark:hover:bg-gray-600"
                >
                  <X className="w-3 h-3 text-gray-400" />
                </button>
              )}
            </div>

            {/* Year navigation */}
            {years.length > 0 && (
              <div className="flex items-center gap-1">
                {years.map(year => (
                  <button
                    key={year}
                    onClick={() => scrollToYear(year)}
                    className="px-1.5 py-0.5 text-[10px] rounded bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400 hover:bg-primary-100 hover:text-primary-700 dark:hover:bg-primary-900/30 dark:hover:text-primary-400 transition-colors"
                  >
                    {year}
                  </button>
                ))}
              </div>
            )}
          </div>
      </div>

      {/* Gantt Chart */}
      <div ref={containerRef} className="relative">
        {/* Compact view - day-by-day pixel grid with horizontal scroll */}
        <div ref={scrollContainerRef} className="overflow-x-auto" onScroll={updateViewport}>
            <div
              className="relative"
              style={{ width: `${gridDimensions.gridWidth}px` }}
            >
              {/* Time axis - pixel-based positioning (virtualized) */}
              <div className="relative h-6 border-b border-gray-200 dark:border-gray-700 mb-2">
                {visibleMonthMarkers.map((marker, i) => {
                  const dayOffset = Math.floor((marker.date.getTime() - minDate.getTime()) / MS_PER_DAY);
                  const pixelPos = dayOffset * CELL_SIZE * zoom;
                  return (
                    <div
                      key={i}
                      className="absolute text-[10px] text-gray-400 dark:text-gray-500 whitespace-nowrap"
                      style={{ left: `${pixelPos}px`, transform: 'translateX(-50%)' }}
                    >
                      {marker.label}
                    </div>
                  );
                })}
              </div>

              {/* Timeline tracks - pixel-based grid (virtualized) */}
              <div
                ref={verticalScrollRef}
                className="relative overflow-y-auto"
                style={{ maxHeight: '600px' }}
                onScroll={updateViewport}
              >
                <div
                  className="relative"
                  style={{ height: `${gridDimensions.gridHeight + 8}px` }}
                >
                  {/* Track row backgrounds (virtualized) */}
                  {visibleTracks.map(i => (
                    <div
                      key={`track-bg-${i}`}
                      className={`absolute w-full ${
                        i % 2 === 0 ? 'bg-gray-50 dark:bg-gray-700/30' : 'bg-white dark:bg-gray-800'
                      }`}
                      style={{
                        top: `${i * TRACK_HEIGHT}px`,
                        height: `${TRACK_HEIGHT}px`,
                      }}
                    />
                  ))}

                  {/* Weekly grid lines for visual reference (virtualized) */}
                  <div className="absolute inset-0 pointer-events-none">
                    {visibleGridLines.map(i => (
                      <div
                        key={i}
                        className="absolute h-full border-l border-gray-100 dark:border-gray-700/30"
                        style={{ left: `${i * 7 * CELL_SIZE * zoom}px` }}
                      />
                    ))}
                  </div>

                  {/* VN bars - snapped to pixel grid (virtualized) */}
                  {visibleBars.map((item) => {
                    const startDate = item.startDate || item.endDate;
                    const endDate = item.endDate || item.startDate;
                    if (!startDate) return null;

                    const startDay = Math.floor((startDate.getTime() - minDate.getTime()) / MS_PER_DAY);
                    const endDay = Math.ceil(((endDate?.getTime() || startDate.getTime()) - minDate.getTime()) / MS_PER_DAY);
                    const duration = Math.max(1, endDay - startDay);

                    const barLeft = startDay * CELL_SIZE * zoom;
                    const barWidth = duration * CELL_SIZE * zoom;
                    const barTop = item.track * TRACK_HEIGHT;

                    const highlighted = isHighlighted(item.vnId);
                    const dimmed = isDimmed(item.vnId);

                    return item.hasDateRange ? (
                      /* Bar for date range - snapped to grid */
                      <Link
                        key={item.vnId}
                        href={`/vn/${item.vnId}`}
                        className={`absolute rounded-sm shadow-sm transition-all hover:ring-2 hover:ring-primary-400 hover:brightness-110 ${
                          highlighted ? 'ring-2 ring-primary-500 z-10' : ''
                        }`}
                        style={{
                          top: `${barTop}px`,
                          left: `${barLeft}px`,
                          width: `${Math.max(CELL_SIZE * zoom, barWidth)}px`,
                          height: `${BAR_HEIGHT}px`,
                          backgroundColor: getScoreColor(item.score),
                          border: `1px solid ${getBorderColor(item.score)}`,
                          opacity: dimmed ? 0.25 : 1,
                        }}
                        onMouseMove={(e) => handleMouseMove(e, item)}
                        onMouseLeave={() => setHoveredItem(null)}
                      />
                    ) : (
                      /* Point marker for single date */
                      <Link
                        key={item.vnId}
                        href={`/vn/${item.vnId}`}
                        className={`absolute rounded-sm shadow-sm transition-all hover:ring-2 hover:ring-primary-400 hover:brightness-110 ${
                          highlighted ? 'ring-2 ring-primary-500 z-10' : ''
                        }`}
                        style={{
                          top: `${barTop}px`,
                          left: `${barLeft}px`,
                          width: `${CELL_SIZE * zoom}px`,
                          height: `${BAR_HEIGHT}px`,
                          backgroundColor: getScoreColor(item.score),
                          border: `1px solid ${getBorderColor(item.score)}`,
                          opacity: dimmed ? 0.25 : 1,
                        }}
                        onMouseMove={(e) => handleMouseMove(e, item)}
                        onMouseLeave={() => setHoveredItem(null)}
                      />
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        </div>

      {/* Tooltip */}
      {hoveredItem && (
        <div
          className="fixed z-50 bg-white dark:bg-gray-800 px-3 py-2 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 pointer-events-none max-w-xs"
          style={{
            left: tooltipPos.x + 12,
            top: tooltipPos.y + 12,
          }}
        >
          <p className="text-sm font-medium text-gray-900 dark:text-white mb-1 line-clamp-2">
            {hoveredItem.title}
          </p>
          <div className="text-xs text-gray-500 dark:text-gray-400 space-y-0.5">
            {hoveredItem.startDate && (
              <p>Started: {formatDate(hoveredItem.startDate)}</p>
            )}
            {hoveredItem.endDate && (
              <p>Finished: {formatDate(hoveredItem.endDate)}</p>
            )}
            {hoveredItem.hasDateRange && hoveredItem.startDate && hoveredItem.endDate && (
              <p>
                Duration: {Math.round((hoveredItem.endDate.getTime() - hoveredItem.startDate.getTime()) / (1000 * 60 * 60 * 24))} days
              </p>
            )}
          </div>
          {hoveredItem.score !== null && (
            <div className="flex items-center gap-1 mt-1 text-xs font-medium" style={{ color: getScoreColor(hoveredItem.score) }}>
              <Star className="w-3 h-3 fill-current" />
              {hoveredItem.score.toFixed(1)}
            </div>
          )}
        </div>
      )}

      {/* Legend */}
      <div className="flex justify-center gap-4 mt-4 text-[10px] text-gray-400 dark:text-gray-500">
        <div className="flex items-center gap-1">
          <div className="w-6 h-2 rounded" style={{ backgroundColor: '#22c55e', border: '1px solid #16a34a' }} />
          <span>8-10</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-6 h-2 rounded" style={{ backgroundColor: '#eab308', border: '1px solid #ca8a04' }} />
          <span>6-8</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-6 h-2 rounded" style={{ backgroundColor: '#f97316', border: '1px solid #ea580c' }} />
          <span>4-6</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-6 h-2 rounded" style={{ backgroundColor: '#ef4444', border: '1px solid #dc2626' }} />
          <span>&lt;4</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-6 h-2 rounded" style={{ backgroundColor: '#6b7280', border: '1px solid #4b5563' }} />
          <span>Unrated</span>
        </div>
      </div>
    </div>
  );
}
