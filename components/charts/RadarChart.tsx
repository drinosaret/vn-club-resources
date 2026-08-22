'use client';

import { useId, useMemo, useState } from 'react';

/**
 * A radar chart over a handful of 0-100 axes.
 *
 * The viewBox is deliberately wider than it is tall. Axis labels sit outside the polygon,
 * and in a square viewBox the side labels have nowhere to go: they render past the edge and
 * get clipped. The extra horizontal room is where they live. The polygon itself stays
 * circular because its radius is expressed in the same units on both axes, and the aspect
 * ratio is preserved rather than stretched.
 */

export interface RadarAxis {
  key: string;
  label: string;
  value: number;
}

interface RadarChartProps {
  axes: RadarAxis[];
  /** Target height. Width follows from the viewBox aspect ratio. */
  size?: number;
  color?: string;
}

/** Rings drawn behind the shape, as fractions of the full radius. */
const RINGS = [0.25, 0.5, 0.75, 1];

const VIEW_WIDTH = 150;
const VIEW_HEIGHT = 100;
const CENTRE_X = VIEW_WIDTH / 2;
const CENTRE_Y = VIEW_HEIGHT / 2;
const RADIUS = 36;
/** How far out the labels sit. The gap to the edge is the room they get. */
const LABEL_RADIUS = 44;

function pointFor(index: number, count: number, fraction: number): [number, number] {
  // Starting at twelve o'clock reads more naturally than at three.
  const angle = (index / count) * Math.PI * 2 - Math.PI / 2;
  return [
    CENTRE_X + Math.cos(angle) * RADIUS * fraction,
    CENTRE_Y + Math.sin(angle) * RADIUS * fraction,
  ];
}

function labelPointFor(index: number, count: number): [number, number, number] {
  const angle = (index / count) * Math.PI * 2 - Math.PI / 2;
  return [
    CENTRE_X + Math.cos(angle) * LABEL_RADIUS,
    CENTRE_Y + Math.sin(angle) * LABEL_RADIUS,
    Math.cos(angle),
  ];
}

const clamp = (value: number) => Math.max(0, Math.min(100, value));

export function RadarChart({ axes, size = 260, color = '#4f46e5' }: RadarChartProps) {
  const gradientId = useId();
  const [hover, setHover] = useState<string | null>(null);

  const { shape, count } = useMemo(() => {
    const count = axes.length;
    const shape = axes
      .map((axis, i) => {
        const [x, y] = pointFor(i, count, clamp(axis.value) / 100);
        return `${x.toFixed(2)},${y.toFixed(2)}`;
      })
      .join(' ');
    return { shape, count };
  }, [axes]);

  if (axes.length < 3) return null;


  return (
    <div className="flex flex-col items-center">
      <svg
        viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`}
        preserveAspectRatio="xMidYMid meet"
        style={{
          width: '100%',
          maxWidth: (size * VIEW_WIDTH) / VIEW_HEIGHT,
          aspectRatio: `${VIEW_WIDTH} / ${VIEW_HEIGHT}`,
        }}
        role="img"
        aria-label="Taste fingerprint"
      >
        <defs>
          <radialGradient id={gradientId}>
            <stop offset="0%" stopColor={color} stopOpacity={0.45} />
            <stop offset="100%" stopColor={color} stopOpacity={0.15} />
          </radialGradient>
        </defs>

        {RINGS.map((ring) => (
          <polygon
            key={ring}
            points={axes
              .map((_, i) => {
                const [x, y] = pointFor(i, count, ring);
                return `${x.toFixed(2)},${y.toFixed(2)}`;
              })
              .join(' ')}
            fill="none"
            className="stroke-gray-200 dark:stroke-gray-700"
            strokeWidth={0.4}
          />
        ))}

        {axes.map((axis, i) => {
          const [x, y] = pointFor(i, count, 1);
          return (
            <line
              key={axis.key}
              x1={CENTRE_X}
              y1={CENTRE_Y}
              x2={x}
              y2={y}
              className="stroke-gray-200 dark:stroke-gray-700"
              strokeWidth={0.4}
            />
          );
        })}

        <polygon points={shape} fill={`url(#${gradientId})`} stroke={color} strokeWidth={1} />

        {axes.map((axis, i) => {
          const [x, y] = pointFor(i, count, clamp(axis.value) / 100);
          return (
            <circle
              key={axis.key}
              cx={x}
              cy={y}
              r={hover === axis.key ? 2.4 : 1.4}
              fill={color}
            />
          );
        })}

        {/* Generous invisible targets at each vertex, since the dots are too small to hit. */}
        {axes.map((axis, i) => {
          const [x, y] = pointFor(i, count, 1);
          return (
            <circle
              key={`${axis.key}-target`}
              cx={x}
              cy={y}
              r={9}
              fill="transparent"
              className="cursor-help"
              onMouseEnter={() => setHover(axis.key)}
              onMouseLeave={() => setHover(null)}
            />
          );
        })}

        {axes.map((axis, i) => {
          const [x, y, cos] = labelPointFor(i, count);
          // Anchored away from the centre so a label never overlaps the shape, and centred
          // at the top and bottom where there is no side to lean away from.
          const anchor = cos < -0.2 ? 'end' : cos > 0.2 ? 'start' : 'middle';
          return (
            <text
              key={`${axis.key}-label`}
              x={x}
              y={y}
              textAnchor={anchor}
              dominantBaseline="middle"
              className={`fill-gray-500 dark:fill-gray-400 ${
                hover === axis.key ? 'font-semibold' : ''
              }`}
              style={{ fontSize: 4.6 }}
            >
              {/* The value rides with the label rather than waiting behind a hover, which
                  no touch screen has. */}
              {axis.label} {Math.round(axis.value)}
            </text>
          );
        })}
      </svg>


    </div>
  );
}
