'use client';

import Image from 'next/image';
import { useEffect, useState } from 'react';

// Curated list of VN cover IDs that exist in the cache
// These are VNDB cover IDs from public/cache/vndb/cv/
const COVER_IDS = [
  '100', // folder 00
  '1000', // folder 00
  '1002', // folder 02
  '10100', // folder 00
  '100002', // folder 02
  '100102', // folder 02
  '100200', // folder 00
  '100300', // folder 00
  '100400', // folder 00
  '100500', // folder 00
  '100600', // folder 00
  '100700', // folder 00
];

// Pre-computed non-overlapping positions (eliminates runtime overlap detection)
const POSITION_SLOTS: { x: number; y: number; size: 'sm' | 'md' | 'lg' }[] = [
  { x: 12, y: 20, size: 'sm' },
  { x: 28, y: 55, size: 'md' },
  { x: 42, y: 22, size: 'lg' },
  { x: 58, y: 70, size: 'sm' },
  { x: 72, y: 35, size: 'md' },
  { x: 85, y: 65, size: 'sm' },
  { x: 18, y: 75, size: 'lg' },
  { x: 50, y: 45, size: 'sm' },
  { x: 35, y: 80, size: 'md' },
  { x: 78, y: 20, size: 'sm' },
];

interface FloatingCover {
  id: string;
  x: number;
  y: number;
  size: 'sm' | 'md' | 'lg';
  delay: number;
  duration: number;
}

// Fisher-Yates shuffle
function shuffleArray<T>(array: T[]): T[] {
  const shuffled = [...array];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

const COVER_COUNT = 8; // Reduced from 10 for better performance

function generateCovers(): FloatingCover[] {
  // Shuffle slots and cover IDs for variety
  const shuffledSlots = shuffleArray(POSITION_SLOTS).slice(0, COVER_COUNT);
  const shuffledIds = shuffleArray(COVER_IDS);

  return shuffledSlots.map((slot, i) => ({
    id: shuffledIds[i % shuffledIds.length],
    x: slot.x,
    y: slot.y,
    size: slot.size,
    delay: Math.random() * 5,
    duration: 15 + Math.random() * 10, // 15-25 seconds
  }));
}

const sizeClasses = {
  sm: 'w-16 h-24 md:w-20 md:h-28',
  md: 'w-20 h-28 md:w-28 md:h-40',
  lg: 'w-24 h-36 md:w-36 md:h-52',
};

export function FloatingCovers() {
  const [covers, setCovers] = useState<FloatingCover[]>([]);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    // Generate covers client-side to avoid hydration mismatch
    setCovers(generateCovers());
    setMounted(true);
  }, []);

  if (!mounted) {
    return null;
  }

  return (
    // Hidden on mobile for better performance, visible on md and up
    <div className="hidden md:block absolute inset-0 overflow-hidden pointer-events-none">
      {covers.map((cover, index) => {
        // Determine the folder based on last 2 digits of cover ID
        const coverId = cover.id.padStart(2, '0');
        const folder = coverId.slice(-2);
        const imagePath = `/img/cv/${folder}/${coverId}.webp`;

        return (
          <div
            key={`${cover.id}-${index}`}
            className={`absolute ${sizeClasses[cover.size]} rounded-lg overflow-hidden shadow-2xl`}
            style={{
              left: `${cover.x}%`,
              top: `${cover.y}%`,
              transform: 'translate(-50%, -50%)',
              opacity: 0.25,
              filter: 'blur(1px)',
              animation: `float ${cover.duration}s ease-in-out infinite`,
              animationDelay: `${cover.delay}s`,
            }}
          >
            <Image
              src={imagePath}
              alt=""
              fill
              className="object-cover"
              sizes="144px"
              loading="lazy"
              unoptimized // Since these are already in cache as webp
            />
          </div>
        );
      })}
    </div>
  );
}
