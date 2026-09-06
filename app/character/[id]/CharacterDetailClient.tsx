'use client';

import { useEffect, useState, use, useMemo } from 'react';
import Link from '@/components/Link';
import {
  vndbStatsApi,
  CharacterDetail,
  SimilarCharacter,
} from '@/lib/vndb-stats-api';
import { useSimilarCharacters } from '@/lib/vndb-stats-cached';
import { useTitlePreference, getDisplayTitle } from '@/lib/title-preference';
import { getProxiedImageUrl } from '@/lib/vndb-image-cache';
import { CARD_IMAGE_WIDTH, CARD_IMAGE_SIZES, buildCardSrcSet } from '@/components/vn/card-image-utils';
import { hasJapanese } from '@/components/vn/vn-utils';
import { LoadingScreen } from '@/components/LoadingScreen';
import { LanguageFilter, LanguageFilterValue } from '@/components/stats/LanguageFilter';
import { parseBBCode, hasSpoilerContent } from '@/lib/bbcode';
import { VNDBAttribution } from '@/components/VNDBAttribution';
import { NSFWImage, NSFWNextImage } from '@/components/NSFWImage';
import { ImageLightbox } from '@/components/ImageLightbox';
import { useImageFade } from '@/hooks/useImageFade';

interface PageProps {
  params: Promise<{ id: string }>;
  /**
   * The record the server already fetched for this page's metadata. Seeding it here is
   * what puts the appearances, voice actors and traits into the delivered HTML, and
   * spares the browser a round trip it would otherwise make before showing anything.
   */
  initialCharacter?: CharacterDetail | null;
}

// Format sex display
function formatSex(sex?: string): string {
  switch (sex) {
    case 'm': return 'Male';
    case 'f': return 'Female';
    case 'b': return 'Both';
    default: return '';
  }
}

// Format blood type
function formatBloodType(type?: string): string {
  if (!type) return '';
  return type.toUpperCase();
}

// Format birthday
function formatBirthday(birthday?: number[]): string {
  if (!birthday || birthday.length === 0) return '';
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const month = birthday[0];
  const day = birthday[1];
  if (month < 1 || month > 12) return '';
  if (day) {
    return `${months[month - 1]} ${day}`;
  }
  return months[month - 1];
}

// Role order and labels
const roleLabels: Record<string, string> = {
  main: 'Protagonist',
  primary: 'Main',
  side: 'Side',
  appears: 'Appears',
};

/**
 * What stands in the frame when the record carries no art. A word rather than a figure
 * glyph, which is what the rest of the site puts in an empty cover.
 */
function NoArt({ size = 'sm' }: { size?: 'sm' | 'lg' }) {
  return (
    <div
      className={`absolute inset-0 flex items-center justify-center font-mono uppercase text-[color:var(--text-faint)] ${
        size === 'lg' ? 'text-[11px] tracking-[0.12em]' : 'text-[10px] tracking-[0.08em]'
      }`}
    >
      No art
    </div>
  );
}

export default function CharacterDetailPage({ params, initialCharacter }: PageProps) {
  const resolvedParams = use(params);
  const charId = resolvedParams.id;
  const { preference } = useTitlePreference();

  const [character, setCharacter] = useState<CharacterDetail | null>(initialCharacter ?? null);
  const [isLoading, setIsLoading] = useState(!initialCharacter);
  const [error, setError] = useState<string | null>(null);
  const [showSpoilers, setShowSpoilers] = useState(false);
  const [showSexual, setShowSexual] = useState(false);
  const [showFullDescription, setShowFullDescription] = useState(false);
  const [similarLanguageFilter, setSimilarLanguageFilter] = useState<LanguageFilterValue>('ja');
  const { onLoad: onMainImageLoad, shimmerClass: mainImageShimmer, fadeClass: mainImageFade } = useImageFade();

  // SWR for similar characters, cached across navigations, instant on revisit
  const { data: similarCharacters = [], isLoading: isSimilarLoading } = useSimilarCharacters(charId);

  useEffect(() => {
    // The parent keys this component by id, so a seeded record always belongs to the id
    // being rendered and there is nothing left to fetch.
    if (initialCharacter) return;
    loadCharacter();
  }, [charId]);

  // Set page title
  useEffect(() => {
    if (character) {
      const name = preference === 'romaji' && character.original ? character.original : character.name;
      document.title = `${name} | VN Club`;
    }
  }, [character, preference]);

  const loadCharacter = async () => {
    setIsLoading(true);
    setError(null);

    try {
      const charData = await vndbStatsApi.getCharacter(charId);
      if (!charData) {
        setError('Character not found.');
        return;
      }
      setCharacter(charData);
    } catch {
      setError('Failed to load character data.');
    } finally {
      setIsLoading(false);
    }
  };

  // Determine display name based on preference
  const displayName = character
    ? (preference === 'romaji' && character.original ? character.original : character.name)
    : '';
  const alternateName = character
    ? (preference === 'romaji' ? character.name : character.original)
    : '';

  // The script a name is written in picks its face, so a Japanese name is never set in the
  // Latin display face and is announced in the language it is written in.
  const nameIsJapanese = hasJapanese(displayName);
  const alternateIsJapanese = alternateName ? hasJapanese(alternateName) : false;

  // Group traits by category
  const traitsByGroup = useMemo(() => {
    if (!character) return {};
    const groups: Record<string, typeof character.traits> = {};
    const visibleTraits = character.traits.filter(t =>
      (showSpoilers || t.spoiler === 0) && (showSexual || !t.group_name?.includes('(Sexual)'))
    );

    for (const trait of visibleTraits) {
      const group = trait.group_name || 'Other';
      if (!groups[group]) {
        groups[group] = [];
      }
      groups[group].push(trait);
    }
    return groups;
  }, [character, showSpoilers, showSexual]);

  // Counts respect the other toggle's state so they reflect what would actually appear
  const spoilerTraitCount = character?.traits.filter(t => t.spoiler > 0 && (showSexual || !t.group_name?.includes('(Sexual)'))).length || 0;
  const hasDescriptionSpoiler = character?.description ? hasSpoilerContent(character.description) : false;
  const spoilerCount = spoilerTraitCount + (hasDescriptionSpoiler ? 1 : 0);
  const sexualTraitCount = character?.traits.filter(t => t.group_name?.includes('(Sexual)') && (showSpoilers || t.spoiler === 0)).length || 0;

  if (isLoading) {
    return <LoadingScreen />;
  }

  if (error || !character) {
    return <ErrorState error={error} charId={charId} />;
  }

  const vndbUrl = `https://vndb.org/${character.id}`;
  const imageUrl = getProxiedImageUrl(character.image_url);
  const traitGroups = Object.entries(traitsByGroup);

  return (
    <div className="max-w-5xl mx-auto px-4 pt-6 pb-12">
      {/* Header */}
      <div className="flex items-center justify-between gap-2 mb-4">
        <button
          onClick={() => window.history.back()}
          className="sec-more min-h-6"
        >
          <span aria-hidden>&#8592;</span>
          Back
        </button>
        <a
          href={vndbUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="tab"
        >
          View on VNDB
          <span aria-hidden>&#8599;</span>
        </a>
      </div>

      {/* Main content grid */}
      <div className="grid grid-cols-1 lg:grid-cols-[240px_1fr] gap-6 lg:gap-8">
        {/* Left column - Image */}
        <div className="lg:sticky lg:top-20 lg:self-start">
          {/* The portrait is the only saturated thing in this column, so nothing frames it
              but a hairline and a square corner. */}
          <div className="vn-cover relative max-w-[240px] mx-auto lg:mx-0">
            {imageUrl ? (
              <ImageLightbox src={imageUrl} alt={displayName} imageSexual={character.image_sexual} vnId={character.id}>
                <div className="relative aspect-3/4 rounded-[1px] overflow-hidden bg-[color:var(--surface-inset)] ring-1 ring-[color:var(--rule)] cursor-pointer">
                  <div className={mainImageShimmer} />
                  <NSFWNextImage
                    src={imageUrl}
                    alt={displayName}
                    imageSexual={character.image_sexual}
                    vnId={character.id}
                    fill
                    className={`object-cover ${mainImageFade}`}
                    sizes="240px"
                    priority
                    unoptimized // Proxied images already optimized as WebP
                    hideOverlay // ImageLightbox provides its own overlay
                    onLoad={onMainImageLoad}
                  />
                </div>
              </ImageLightbox>
            ) : (
              <div className="relative aspect-3/4 rounded-[1px] overflow-hidden bg-[color:var(--surface-inset)] ring-1 ring-[color:var(--rule)]">
                <NoArt size="lg" />
              </div>
            )}
          </div>
        </div>

        {/* Right column - Details */}
        <div className="space-y-4 min-w-0">
          {/* Name and basic info */}
          <div>
            <h1
              lang={nameIsJapanese ? 'ja' : undefined}
              className={`flex flex-wrap items-baseline gap-2 text-xl sm:text-2xl lg:text-3xl font-bold leading-tight text-[color:var(--ink)] ${nameIsJapanese ? 'font-jp' : 'font-display'}`}
            >
              {displayName}
              {character.sex && (
                <span className="font-mono text-lg text-[color:var(--nezu)]">
                  {character.sex === 'f' ? '♀' : character.sex === 'm' ? '♂' : '⚥'}
                </span>
              )}
            </h1>
            {alternateName && alternateName !== displayName && (
              <p
                lang={alternateIsJapanese ? 'ja' : undefined}
                className={`mt-1 text-sm text-[color:var(--nezu)] ${alternateIsJapanese ? 'font-jp' : ''}`}
              >
                {alternateName}
              </p>
            )}

            {/* Each measurement under the label it answers. A label carries what the figure
                glyph beside it used to, and says it in words. */}
            <dl className="flex flex-wrap gap-x-6 gap-y-3 mt-4">
              {character.blood_type && character.blood_type.toLowerCase() !== 'unknown' && (
                <div>
                  <dt className="fig-label">Blood type</dt>
                  <dd className="vn-num mt-1 text-sm text-[color:var(--ink)]">{formatBloodType(character.blood_type)}</dd>
                </div>
              )}
              {character.age != null && character.age > 0 && (
                <div>
                  <dt className="fig-label">Age</dt>
                  <dd className="vn-num mt-1 text-sm text-[color:var(--ink)]">{character.age}</dd>
                </div>
              )}
              {character.birthday && formatBirthday(character.birthday) && (
                <div>
                  <dt className="fig-label">Birthday</dt>
                  <dd className="vn-num mt-1 text-sm text-[color:var(--ink)]">{formatBirthday(character.birthday)}</dd>
                </div>
              )}
              {character.height != null && character.height > 0 && (
                <div>
                  <dt className="fig-label">Height</dt>
                  <dd className="vn-num mt-1 text-sm text-[color:var(--ink)]">{character.height}cm</dd>
                </div>
              )}
              {character.weight != null && character.weight > 0 && (
                <div>
                  <dt className="fig-label">Weight</dt>
                  <dd className="vn-num mt-1 text-sm text-[color:var(--ink)]">{character.weight}kg</dd>
                </div>
              )}
            </dl>
          </div>

          {/* Description */}
          {character.description && (
            <section className="vn-sec p-4 sm:p-5">
              <div className="vn-sec-head">
                <h2 className="vn-sec-title">Description</h2>
                {hasDescriptionSpoiler && (
                  <button
                    onClick={() => setShowSpoilers(!showSpoilers)}
                    aria-pressed={showSpoilers}
                    className={`tab${showSpoilers ? ' tab--on' : ''}`}
                  >
                    {showSpoilers ? 'Hide' : 'Show'} spoilers
                  </button>
                )}
              </div>
              <div className={`text-sm text-[color:var(--text-secondary)] whitespace-pre-wrap ${!showFullDescription && character.description.length > 500 ? 'line-clamp-4' : ''}`}>
                {parseBBCode(character.description, { showSpoilers })}
              </div>
              {character.description.length > 500 && (
                <button
                  onClick={() => setShowFullDescription(!showFullDescription)}
                  aria-expanded={showFullDescription}
                  className="sec-more mt-3 min-h-6"
                >
                  {showFullDescription ? 'Show less' : 'Show more'}
                  <span aria-hidden>{showFullDescription ? '▴' : '▾'}</span>
                </button>
              )}
            </section>
          )}

          {/* Aliases */}
          {character.aliases && character.aliases.length > 0 && (
            <section className="vn-sec p-4 sm:p-5">
              <div className="vn-sec-head">
                <h2 className="vn-sec-title">Aliases</h2>
              </div>
              <p className="text-sm text-[color:var(--text-secondary)]">
                {character.aliases.join(', ')}
              </p>
            </section>
          )}

          {/* Traits */}
          {character.traits.length > 0 && (
            <section className="vn-sec">
              <div className="flex flex-wrap items-center justify-between gap-2 p-4 border-b border-[color:var(--rule)]">
                <h2 className="vn-sec-title">Traits</h2>
                <div className="flex flex-wrap items-center gap-1.5">
                  {sexualTraitCount > 0 && (
                    <button
                      onClick={() => setShowSexual(!showSexual)}
                      aria-pressed={showSexual}
                      className={`tab${showSexual ? ' tab--on' : ''}`}
                    >
                      <span>{showSexual ? 'Hide' : 'Show'} sexual</span>
                      <span className="tab-count">{sexualTraitCount}</span>
                    </button>
                  )}
                  {spoilerCount > 0 && (
                    <button
                      onClick={() => setShowSpoilers(!showSpoilers)}
                      aria-pressed={showSpoilers}
                      className={`tab${showSpoilers ? ' tab--on' : ''}`}
                    >
                      <span>{showSpoilers ? 'Hide' : 'Show'} spoilers</span>
                      <span className="tab-count">{spoilerCount}</span>
                    </button>
                  )}
                </div>
              </div>
              <div className="p-4 space-y-3">
                {traitGroups.length === 0 ? (
                  <p className="text-sm text-[color:var(--nezu)]">
                    Every trait on this record is held back by the current filters.
                  </p>
                ) : (
                  traitGroups.map(([group, traits]) => (
                    <div key={group} className="flex flex-wrap items-start gap-2">
                      <span className="fig-label w-24 shrink-0 pt-1">
                        {group}:
                      </span>
                      <div className="flex flex-wrap gap-1.5 flex-1">
                        {traits.map(trait => (
                          <Link
                            key={trait.id}
                            href={`/stats/trait/${trait.id}`}
                            className={`vn-chip${trait.spoiler > 0 ? ' vn-chip--held' : ''}`}
                          >
                            {trait.name}
                          </Link>
                        ))}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </section>
          )}

          {/* Appears In */}
          {character.vns.length > 0 && (
            <section className="vn-sec p-4 sm:p-5">
              <div className="vn-sec-head">
                <h2 className="vn-sec-title">Appears In</h2>
              </div>
              <div className="vn-shelf">
                {character.vns.map(vn => (
                  <AppearsInCard key={vn.id} vn={vn} preference={preference} />
                ))}
              </div>
            </section>
          )}

          {/* Voiced By */}
          {character.voiced_by && character.voiced_by.length > 0 && (
            <section className="vn-sec p-4 sm:p-5">
              <div className="vn-sec-head">
                <h2 className="vn-sec-title">Voiced By</h2>
              </div>
              <ul className="dg-list">
                {character.voiced_by.map(va => {
                  const vaDisplayName = preference === 'romaji' && va.original ? va.original : va.name;
                  return (
                    <li key={va.id} className="dg-row">
                      <Link
                        href={`/stats/seiyuu/${va.id}`}
                        className="dg-name min-h-6"
                      >
                        {vaDisplayName}
                      </Link>
                      {va.note && (
                        <span className="dg-when">
                          ({va.note})
                        </span>
                      )}
                    </li>
                  );
                })}
              </ul>
            </section>
          )}

          {/* Similar Characters */}
          <SimilarCharactersSection
            characters={similarCharacters}
            isLoading={isSimilarLoading}
            preference={preference}
            languageFilter={similarLanguageFilter}
            onLanguageFilterChange={setSimilarLanguageFilter}
          />

          <VNDBAttribution />
        </div>
      </div>
    </div>
  );
}

function SimilarCharactersSection({
  characters,
  isLoading,
  preference,
  languageFilter,
  onLanguageFilterChange,
}: {
  characters: SimilarCharacter[];
  isLoading: boolean;
  preference: 'japanese' | 'romaji';
  languageFilter: LanguageFilterValue;
  onLanguageFilterChange: (value: LanguageFilterValue) => void;
}) {
  // Filter characters based on language
  const filteredCharacters = useMemo(() => {
    if (languageFilter === 'all') return characters;
    return characters.filter(char => char.olang === 'ja');
  }, [characters, languageFilter]);

  if (isLoading) {
    return (
      <section className="vn-sec p-4 sm:p-5">
        <div className="vn-sec-head">
          <h2 className="vn-sec-title">Similar Characters</h2>
        </div>
        <div className="vn-shelf">
          {[...Array(5)].map((_, i) => (
            <div key={i}>
              <div className="aspect-3/4 rounded-xs mb-2 image-placeholder" />
              <div className="h-4 rounded-xs w-3/4 image-placeholder" />
            </div>
          ))}
        </div>
      </section>
    );
  }

  if (characters.length === 0) {
    return null;
  }

  return (
    <section className="vn-sec p-4 sm:p-5">
      <div className="vn-sec-head">
        <div className="flex items-baseline gap-2">
          <h2 className="vn-sec-title">Similar Characters</h2>
          <span className="vn-num text-sm text-[color:var(--text-faint)]">
            ({filteredCharacters.length}{languageFilter === 'ja' && characters.length !== filteredCharacters.length ? ` of ${characters.length}` : ''})
          </span>
        </div>
        <LanguageFilter value={languageFilter} onChange={onLanguageFilterChange} />
      </div>
      {filteredCharacters.length === 0 ? (
        <p className="text-sm text-[color:var(--nezu)] text-center py-4">
          No similar characters from Japanese VNs found. Try switching to &quot;All Languages&quot;.
        </p>
      ) : (
        <div className="vn-shelf">
          {filteredCharacters.map(char => (
            <SimilarCharacterCard key={char.id} char={char} preference={preference} />
          ))}
        </div>
      )}
    </section>
  );
}

function AppearsInCard({ vn, preference }: { vn: CharacterDetail['vns'][number]; preference: 'japanese' | 'romaji' }) {
  const { onLoad, shimmerClass, fadeClass } = useImageFade();
  const vnDisplayTitle = getDisplayTitle(vn, preference);
  const vnImageUrl = getProxiedImageUrl(vn.image_url, { width: CARD_IMAGE_WIDTH });
  const vnSrcSet = vn.image_url ? buildCardSrcSet(vn.image_url) : undefined;

  return (
    <Link
      href={`/vn/${vn.id}`}
      className="shelf-item block"
      style={{ contentVisibility: 'auto', containIntrinsicSize: '0 280px' }}
    >
      <div className="shelf-art">
        {vnImageUrl ? (
          <>
            <div className={shimmerClass} />
            <NSFWImage
              src={vnImageUrl}
              alt={vnDisplayTitle}
              imageSexual={vn.image_sexual}
              className={`w-full h-full object-cover ${fadeClass}`}
              loading="lazy"
              srcSet={vnSrcSet}
              sizes={CARD_IMAGE_SIZES}
              onLoad={onLoad}
            />
          </>
        ) : (
          <NoArt />
        )}
        <span className="vn-mark bottom-1.5 left-1.5">
          {roleLabels[vn.role] || vn.role}
        </span>
      </div>
      {/* A card is an entry in a list of works, so its name is a heading one level below the
          section heading it sits under. */}
      <h3 className="shelf-name">{vnDisplayTitle}</h3>
    </Link>
  );
}

function SimilarCharacterCard({ char, preference }: { char: SimilarCharacter; preference: 'japanese' | 'romaji' }) {
  const { onLoad, shimmerClass, fadeClass } = useImageFade();
  const charDisplayName = preference === 'romaji' && char.original ? char.original : char.name;
  const charImageUrl = getProxiedImageUrl(char.image_url, { width: CARD_IMAGE_WIDTH });
  const charSrcSet = char.image_url ? buildCardSrcSet(char.image_url) : undefined;

  return (
    <Link
      href={`/character/${char.id}`}
      className="shelf-item group block"
      style={{ contentVisibility: 'auto', containIntrinsicSize: '0 280px' }}
    >
      <div className="shelf-art">
        {charImageUrl ? (
          <>
            <div className={shimmerClass} />
            <NSFWImage
              src={charImageUrl}
              alt={charDisplayName}
              imageSexual={char.image_sexual}
              className={`w-full h-full object-cover ${fadeClass}`}
              loading="lazy"
              srcSet={charSrcSet}
              sizes={CARD_IMAGE_SIZES}
              onLoad={onLoad}
            />
          </>
        ) : (
          <NoArt />
        )}
        <span className="vn-mark bottom-1.5 left-1.5">
          {Math.round(char.similarity * 100)}% match
        </span>
        {/* What the two records share, over the art rather than over the whole card, so the
            name underneath stays readable while it is up. */}
        {char.shared_traits.length > 0 && (
          <div className="on-box absolute inset-0 z-20 flex items-center justify-center p-2 bg-[color:var(--box)]/90 opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100 transition-opacity pointer-events-none">
            <p className="text-[10px] leading-snug text-center text-[color:var(--ink-box)] line-clamp-4">
              Shared: {char.shared_traits.slice(0, 5).join(', ')}
              {char.shared_traits.length > 5 && ` +${char.shared_traits.length - 5}`}
            </p>
          </div>
        )}
      </div>
      <h3 className="shelf-name">{charDisplayName}</h3>
      {char.vn_title && (() => {
        const vnTitle = getDisplayTitle(
          { title: char.vn_title, title_jp: char.vn_title_jp, title_romaji: char.vn_title_romaji },
          preference
        );
        return vnTitle ? (
          <p className="shelf-alt">
            {vnTitle}
          </p>
        ) : null;
      })()}
    </Link>
  );
}

function ErrorState({ error, charId }: { error: string | null; charId: string }) {
  const vndbUrl = `https://vndb.org/${charId.startsWith('c') ? charId : `c${charId}`}`;

  return (
    <div className="max-w-2xl mx-auto px-4 py-16 text-center">
      <span className="nameplate">Not loaded</span>
      <h1 className="font-display text-2xl font-bold text-[color:var(--ink)] mt-4 mb-2">
        Unable to Load Character
      </h1>
      <p className="text-[color:var(--nezu)] mb-6">
        {error || 'Something went wrong while loading the character.'}
      </p>
      <div className="tabs justify-center">
        <button
          onClick={() => window.history.back()}
          className="tab"
        >
          <span aria-hidden>&#8592;</span>
          Go Back
        </button>
        <a
          href={vndbUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="tab"
        >
          Try on VNDB
          <span aria-hidden>&#8599;</span>
        </a>
      </div>
    </div>
  );
}
