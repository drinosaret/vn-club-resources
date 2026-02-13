'use client';

import { useState, useMemo, useEffect } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { Eye, EyeOff, Users, User } from 'lucide-react';
import { VNCharacter } from '@/lib/vndb-stats-api';
import { useTitlePreference } from '@/lib/title-preference';
import { getProxiedImageUrl } from '@/lib/vndb-image-cache';
import { useImageFade } from '@/hooks/useImageFade';

interface VNCharactersProps {
  characters: VNCharacter[];
  isLoading?: boolean;
  showSpoilers: boolean;
  onShowSpoilersChange: (show: boolean) => void;
}

// Role order and labels
const roleOrder = ['main', 'primary', 'side', 'appears'];
const roleLabels: Record<string, string> = {
  main: 'Protagonist',
  primary: 'Main Characters',
  side: 'Side Characters',
  appears: 'Makes an Appearance',
};

export function VNCharacters({ characters, isLoading, showSpoilers, onShowSpoilersChange }: VNCharactersProps) {
  const { preference } = useTitlePreference();

  // Group characters by role (filter out spoiler characters unless showSpoilers is true)
  const groupedCharacters = useMemo(() => {
    const groups: Record<string, VNCharacter[]> = {};

    // Filter characters based on spoiler setting
    // Use (char.spoiler ?? 0) to handle cases where spoiler field is undefined
    const visibleCharacters = showSpoilers
      ? characters
      : characters.filter(char => (char.spoiler ?? 0) === 0);

    for (const char of visibleCharacters) {
      const role = char.role || 'appears';
      if (!groups[role]) {
        groups[role] = [];
      }
      groups[role].push(char);
    }

    // Sort within each group by name
    for (const role of Object.keys(groups)) {
      groups[role].sort((a, b) => {
        const nameA = preference === 'romaji' && a.original ? a.original : a.name;
        const nameB = preference === 'romaji' && b.original ? b.original : b.name;
        return nameA.localeCompare(nameB);
      });
    }

    return groups;
  }, [characters, preference, showSpoilers]);

  // Count spoiler characters
  const spoilerCharacterCount = useMemo(() => {
    return characters.filter(char => (char.spoiler ?? 0) > 0).length;
  }, [characters]);

  // Count visible characters (for header display)
  const visibleCharacterCount = useMemo(() => {
    return showSpoilers
      ? characters.length
      : characters.filter(char => (char.spoiler ?? 0) === 0).length;
  }, [characters, showSpoilers]);

  // Count spoiler traits (only from non-spoiler characters, since spoiler characters are hidden)
  const spoilerTraitCount = useMemo(() => {
    let count = 0;
    for (const char of characters) {
      if ((char.spoiler ?? 0) === 0) {
        for (const trait of char.traits) {
          if (trait.spoiler > 0) count++;
        }
      }
    }
    return count;
  }, [characters]);

  // Check if there are any spoilers (characters or traits)
  const hasSpoilers = spoilerCharacterCount > 0 || spoilerTraitCount > 0;

  // Progressive rendering: show first batch immediately, defer the rest
  const [showAll, setShowAll] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setShowAll(true));
    return () => cancelAnimationFrame(id);
  }, []);

  const isReady = !isLoading;
  const isEmpty = isReady && characters.length === 0;

  if (isEmpty) {
    return (
      <div className={`bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 shadow-sm p-6 transition-opacity duration-200 ease-out ${isReady ? 'opacity-100' : 'opacity-0'}`}>
        <div className="flex items-center gap-2 mb-4">
          <Users className="w-5 h-5 text-gray-400" />
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Characters</h2>
        </div>
        <p className="text-gray-500 dark:text-gray-400 text-center py-4">
          No character data available.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header with spoiler toggle */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Users className="w-5 h-5 text-primary-500" />
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
            Characters ({visibleCharacterCount})
          </h2>
        </div>
        {hasSpoilers && (
          <button
            onClick={() => onShowSpoilersChange(!showSpoilers)}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg transition-colors ${
              showSpoilers
                ? 'bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400'
                : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400'
            }`}
          >
            {showSpoilers ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            {showSpoilers ? 'Hide spoilers' : 'Show spoilers'}
          </button>
        )}
      </div>

      {/* Character groups */}
      {(() => {
        const INITIAL_BATCH = 4;
        let charIndex = 0;
        return roleOrder.map((role) => {
          const chars = groupedCharacters[role];
          if (!chars || chars.length === 0) return null;

          return (
            <div key={role} className="space-y-3">
              <h3 className="text-sm font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                {roleLabels[role] || role}
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {chars.map((char) => {
                  const idx = charIndex++;
                  // Defer cards beyond initial batch to split layout across frames
                  if (idx >= INITIAL_BATCH && !showAll) return null;
                  return (
                    <CharacterCard
                      key={char.id}
                      character={char}
                      preference={preference}
                      showSpoilers={showSpoilers}
                      eager={idx < INITIAL_BATCH}
                    />
                  );
                })}
              </div>
            </div>
          );
        });
      })()}
    </div>
  );
}

interface CharacterCardProps {
  character: VNCharacter;
  preference: 'japanese' | 'romaji';
  showSpoilers: boolean;
  eager?: boolean;
}

function CharacterCard({ character, preference, showSpoilers, eager }: CharacterCardProps) {
  const [imageError, setImageError] = useState(false);
  const { onLoad, shimmerClass, fadeClass } = useImageFade();

  // Determine display name based on preference
  const displayName = preference === 'romaji' && character.original
    ? character.original
    : character.name;

  // Show alternate name if different from display
  const alternateName = displayName !== character.name && displayName !== character.original
    ? null
    : preference === 'romaji' && character.original
      ? character.name // Show Japanese as alternate
      : character.original; // Show romaji as alternate

  // Filter traits based on spoiler setting
  const visibleTraits = showSpoilers
    ? character.traits
    : character.traits.filter(t => t.spoiler === 0);

  // Group traits by category
  const traitsByGroup = useMemo(() => {
    const groups: Record<string, typeof visibleTraits> = {};
    for (const trait of visibleTraits) {
      const group = trait.group_name || 'Other';
      if (!groups[group]) {
        groups[group] = [];
      }
      groups[group].push(trait);
    }
    return groups;
  }, [visibleTraits]);

  const imageUrl = getProxiedImageUrl(character.image_url, { width: 128 });

  const isSpoilerCharacter = (character.spoiler ?? 0) > 0;

  return (
    <div className={`bg-white dark:bg-gray-800 rounded-lg border p-4 flex gap-4 ${
      isSpoilerCharacter
        ? 'border-red-300 dark:border-red-700 ring-1 ring-red-200 dark:ring-red-800'
        : 'border-gray-200 dark:border-gray-700'
    }`}>
      {/* Character image */}
      <Link
        href={`/character/${character.id}`}
        className="flex-shrink-0 group"
      >
        <div className="w-20 h-28 rounded overflow-hidden bg-gray-100 dark:bg-gray-700 relative">
          {imageUrl && !imageError ? (
            <>
              <div className={shimmerClass} />
              <Image
                src={imageUrl}
                alt={displayName}
                fill
                unoptimized
                loading={eager ? 'eager' : undefined}
                className={`object-cover group-hover:scale-105 transition-transform ${fadeClass}`}
                sizes="80px"
                onError={() => setImageError(true)}
                onLoad={onLoad}
              />
            </>
          ) : (
            <div className="w-full h-full flex items-center justify-center">
              <User className="w-8 h-8 text-gray-400" />
            </div>
          )}
        </div>
      </Link>

      {/* Character info */}
      <div className="flex-1 min-w-0">
        {/* Name */}
        <Link
          href={`/character/${character.id}`}
          className="flex items-center gap-1.5 group"
        >
          <h4 className="text-sm font-semibold text-gray-900 dark:text-white group-hover:text-primary-600 dark:group-hover:text-primary-400 transition-colors truncate">
            {displayName}
          </h4>
        </Link>

        {/* Alternate name */}
        {alternateName && (
          <p className="text-xs text-gray-500 dark:text-gray-400 truncate">
            {alternateName}
          </p>
        )}

        {/* Traits */}
        {visibleTraits.length > 0 ? (
          <div className="mt-2 space-y-1.5">
            {Object.entries(traitsByGroup).slice(0, 4).map(([group, traits]) => (
              <div key={group} className="flex flex-wrap items-center gap-1">
                <span className="text-[10px] text-gray-400 dark:text-gray-500 w-14 flex-shrink-0 truncate">
                  {group}:
                </span>
                {traits.slice(0, 4).map((trait) => (
                  <Link
                    key={trait.id}
                    href={`/stats/trait/${trait.id}`}
                    className={`text-[11px] px-1.5 py-0.5 rounded transition-colors ${
                      trait.spoiler > 0
                        ? 'bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-900/30'
                        : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-600'
                    }`}
                  >
                    {trait.name}
                  </Link>
                ))}
                {traits.length > 4 && (
                  <span className="text-[10px] text-gray-400">+{traits.length - 4}</span>
                )}
              </div>
            ))}
            {Object.keys(traitsByGroup).length > 4 && (
              <p className="text-[10px] text-gray-400 dark:text-gray-500">
                +{Object.keys(traitsByGroup).length - 4} more categories
              </p>
            )}
          </div>
        ) : (
          <p className="mt-2 text-xs text-gray-400 dark:text-gray-500 italic">
            No traits listed
          </p>
        )}
      </div>
    </div>
  );
}
