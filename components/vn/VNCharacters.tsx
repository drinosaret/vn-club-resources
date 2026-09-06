'use client';

import { useState, useMemo, useEffect } from 'react';
import Link from '@/components/Link';
import Image from 'next/image';
import { VNCharacter } from '@/lib/vndb-stats-api';
import { useTitlePreference } from '@/lib/title-preference';
import { getProxiedImageUrl } from '@/lib/vndb-image-cache';
import { useImageFade } from '@/hooks/useImageFade';

interface VNCharactersProps {
  characters: VNCharacter[];
  isLoading?: boolean;
  showSpoilers: boolean;
  onShowSpoilersChange: (show: boolean) => void;
  showSexual: boolean;
  onShowSexualChange: (show: boolean) => void;
}

// Role order and labels
const roleOrder = ['main', 'primary', 'side', 'appears'];
const roleLabels: Record<string, string> = {
  main: 'Protagonist',
  primary: 'Main Characters',
  side: 'Side Characters',
  appears: 'Makes an Appearance',
};

export function VNCharacters({ characters, isLoading, showSpoilers, onShowSpoilersChange, showSexual, onShowSexualChange }: VNCharactersProps) {
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

  // Count spoiler traits (respects sexual toggle - excludes traits that won't appear even with spoilers on)
  const spoilerTraitCount = useMemo(() => {
    let count = 0;
    for (const char of characters) {
      if ((char.spoiler ?? 0) === 0) {
        for (const trait of char.traits) {
          if (trait.spoiler > 0 && (showSexual || !trait.group_name?.includes('(Sexual)'))) count++;
        }
      }
    }
    return count;
  }, [characters, showSexual]);

  // Count sexual traits (only those visible given current spoiler state)
  const sexualTraitCount = useMemo(() => {
    let count = 0;
    const visibleChars = showSpoilers
      ? characters
      : characters.filter(char => (char.spoiler ?? 0) === 0);
    for (const char of visibleChars) {
      for (const trait of char.traits) {
        if (trait.group_name?.includes('(Sexual)') && (showSpoilers || trait.spoiler === 0)) count++;
      }
    }
    return count;
  }, [characters, showSpoilers]);

  // Combined spoiler count for display
  const spoilerCount = spoilerCharacterCount + spoilerTraitCount;
  const hasSpoilers = spoilerCount > 0;

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
      <section className={`vn-sec p-4 sm:p-6 transition-opacity duration-200 ease-out ${isReady ? 'opacity-100' : 'opacity-0'}`}>
        <div className="vn-sec-head">
          <h2 className="vn-sec-title">Characters</h2>
        </div>
        <p className="text-[color:var(--nezu)] text-center py-4">
          No character data available.
        </p>
      </section>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header with spoiler toggle */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-baseline gap-2 w-full sm:w-auto">
          <h2 className="vn-sec-title">Characters</h2>
          <span className="vn-num text-sm text-[color:var(--text-faint)]">{visibleCharacterCount}</span>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {sexualTraitCount > 0 && (
            <button
              onClick={() => onShowSexualChange(!showSexual)}
              aria-pressed={showSexual}
              className={`tab${showSexual ? ' tab--on' : ''}`}
            >
              <span><span className="hidden sm:inline">{showSexual ? 'Hide' : 'Show'} </span>sexual</span>
              <span className="tab-count">{sexualTraitCount}</span>
            </button>
          )}
          {hasSpoilers && (
            <button
              onClick={() => onShowSpoilersChange(!showSpoilers)}
              aria-pressed={showSpoilers}
              className={`tab${showSpoilers ? ' tab--on' : ''}`}
            >
              <span><span className="hidden sm:inline">{showSpoilers ? 'Hide' : 'Show'} </span>spoilers</span>
              <span className="tab-count">{spoilerCount}</span>
            </button>
          )}
        </div>
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
              <h3 className="fig-label">
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
                      showSexual={showSexual}
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
  showSexual: boolean;
  eager?: boolean;
}

function CharacterCard({ character, preference, showSpoilers, showSexual, eager }: CharacterCardProps) {
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

  // Filter traits based on spoiler and sexual settings
  const visibleTraits = character.traits.filter(t =>
    (showSpoilers || t.spoiler === 0) && (showSexual || !t.group_name?.includes('(Sexual)'))
  );

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
    <div className={`vn-sec p-3 sm:p-4 flex gap-3 sm:gap-4 ${
      isSpoilerCharacter ? 'vn-sec--held' : ''
    }`}>
      {/* Character image */}
      <Link
        href={`/character/${character.id}`}
        className="shrink-0 group"
      >
        <div className="w-20 h-28 rounded-[1px] overflow-hidden bg-[color:var(--surface-inset)] relative">
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
            <div className="w-full h-full flex items-center justify-center font-mono text-[10px] uppercase tracking-[0.08em] text-[color:var(--text-faint)]">
              No art
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
          <h4 className="text-sm font-semibold text-[color:var(--ink)] group-hover:text-[color:var(--ai)] transition-colors truncate">
            {displayName}
          </h4>
        </Link>

        {/* Alternate name */}
        {alternateName && (
          <p className="text-xs text-[color:var(--nezu)] truncate">
            {alternateName}
          </p>
        )}

        {/* Traits */}
        {visibleTraits.length > 0 ? (
          <div className="mt-2 space-y-1.5">
            {Object.entries(traitsByGroup).slice(0, 4).map(([group, traits]) => (
              <div key={group} className="flex flex-wrap items-center gap-1">
                <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-[color:var(--text-faint)] w-14 shrink-0 truncate">
                  {group}:
                </span>
                {traits.slice(0, 4).map((trait) => (
                  <Link
                    key={trait.id}
                    href={`/stats/trait/${trait.id}`}
                    className={`vn-chip${trait.spoiler > 0 ? ' vn-chip--held' : ''}`}
                  >
                    {trait.name}
                  </Link>
                ))}
                {traits.length > 4 && (
                  <span className="vn-num text-[11px] text-[color:var(--text-faint)]">+{traits.length - 4}</span>
                )}
              </div>
            ))}
            {Object.keys(traitsByGroup).length > 4 && (
              <p className="text-[11px] text-[color:var(--text-faint)]">
                +{Object.keys(traitsByGroup).length - 4} more categories
              </p>
            )}
          </div>
        ) : (
          <p className="mt-2 text-xs text-[color:var(--text-faint)]">
            No traits listed
          </p>
        )}
      </div>
    </div>
  );
}
