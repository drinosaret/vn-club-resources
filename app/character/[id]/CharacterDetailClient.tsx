'use client';

import { useEffect, useState, use, useMemo } from 'react';
import Link from 'next/link';
import {
  ArrowLeft, ExternalLink, AlertCircle, Eye, EyeOff,
  User, Heart, Calendar, Ruler, Scale, Droplet, Users
} from 'lucide-react';
import {
  vndbStatsApi,
  CharacterDetail,
  SimilarCharacter,
} from '@/lib/vndb-stats-api';
import { useSimilarCharacters } from '@/lib/vndb-stats-cached';
import { useTitlePreference, getDisplayTitle } from '@/lib/title-preference';
import { getProxiedImageUrl } from '@/lib/vndb-image-cache';
import { CARD_IMAGE_WIDTH, CARD_IMAGE_SIZES, buildCardSrcSet } from '@/components/vn/card-image-utils';
import { LoadingScreen } from '@/components/LoadingScreen';
import { LanguageFilter, LanguageFilterValue } from '@/components/stats/LanguageFilter';
import { parseBBCode, hasSpoilerContent } from '@/lib/bbcode';
import { VNDBAttribution } from '@/components/VNDBAttribution';
import { NSFWImage, NSFWNextImage } from '@/components/NSFWImage';
import { ImageLightbox } from '@/components/ImageLightbox';
import { useImageFade } from '@/hooks/useImageFade';

interface PageProps {
  params: Promise<{ id: string }>;
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

export default function CharacterDetailPage({ params }: PageProps) {
  const resolvedParams = use(params);
  const charId = resolvedParams.id;
  const { preference } = useTitlePreference();

  const [character, setCharacter] = useState<CharacterDetail | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showSpoilers, setShowSpoilers] = useState(false);
  const [showSexual, setShowSexual] = useState(false);
  const [showFullDescription, setShowFullDescription] = useState(false);
  const [similarLanguageFilter, setSimilarLanguageFilter] = useState<LanguageFilterValue>('ja');
  const { onLoad: onMainImageLoad, shimmerClass: mainImageShimmer, fadeClass: mainImageFade } = useImageFade();

  // SWR for similar characters — cached across navigations, instant on revisit
  const { data: similarCharacters = [], isLoading: isSimilarLoading } = useSimilarCharacters(charId);

  useEffect(() => {
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

  return (
    <div className="max-w-5xl mx-auto px-4 py-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <button
          onClick={() => window.history.back()}
          className="flex items-center gap-2 text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white transition-colors"
        >
          <ArrowLeft className="w-5 h-5" />
          <span className="hidden sm:inline">Back</span>
        </button>
        <a
          href={vndbUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1.5 px-4 py-2 text-sm bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
        >
          View on VNDB
          <ExternalLink className="w-4 h-4" />
        </a>
      </div>

      {/* Main content grid */}
      <div className="grid grid-cols-1 lg:grid-cols-[240px_1fr] gap-8">
        {/* Left column - Image */}
        <div className="lg:sticky lg:top-20 lg:self-start">
          {imageUrl ? (
            <ImageLightbox src={imageUrl} alt={displayName} imageSexual={character.image_sexual} vnId={character.id}>
              <div className="relative aspect-3/4 max-w-[240px] mx-auto lg:mx-0 rounded-xl overflow-hidden bg-gray-100 dark:bg-gray-800 shadow-lg cursor-pointer">
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
            <div className="relative aspect-3/4 max-w-[240px] mx-auto lg:mx-0 rounded-xl overflow-hidden bg-gray-100 dark:bg-gray-800 shadow-lg">
              <div className="w-full h-full flex items-center justify-center">
                <User className="w-16 h-16 text-gray-400" />
              </div>
            </div>
          )}
        </div>

        {/* Right column - Details */}
        <div className="space-y-6">
          {/* Name and basic info */}
          <div>
            <h1 className="text-2xl md:text-3xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
              {displayName}
              {character.sex && (
                <span className={`text-lg ${character.sex === 'f' ? 'text-pink-500' : character.sex === 'm' ? 'text-blue-500' : 'text-purple-500'}`}>
                  {character.sex === 'f' ? '♀' : character.sex === 'm' ? '♂' : '⚥'}
                </span>
              )}
            </h1>
            {alternateName && alternateName !== displayName && (
              <p className="text-lg text-gray-500 dark:text-gray-400 mt-1">{alternateName}</p>
            )}

            {/* Metadata row */}
            <div className="flex flex-wrap gap-4 mt-4 text-sm text-gray-600 dark:text-gray-400">
              {character.blood_type && character.blood_type.toLowerCase() !== 'unknown' && (
                <div className="flex items-center gap-1.5">
                  <Droplet className="w-4 h-4" />
                  Blood Type {formatBloodType(character.blood_type)}
                </div>
              )}
              {character.age != null && character.age > 0 && (
                <div className="flex items-center gap-1.5">
                  <Calendar className="w-4 h-4" />
                  Age {character.age}
                </div>
              )}
              {character.birthday && (
                <div className="flex items-center gap-1.5">
                  <Heart className="w-4 h-4" />
                  {formatBirthday(character.birthday)}
                </div>
              )}
              {character.height != null && character.height > 0 && (
                <div className="flex items-center gap-1.5">
                  <Ruler className="w-4 h-4" />
                  {character.height}cm
                </div>
              )}
              {character.weight != null && character.weight > 0 && (
                <div className="flex items-center gap-1.5">
                  <Scale className="w-4 h-4" />
                  {character.weight}kg
                </div>
              )}
            </div>
          </div>

          {/* Description */}
          {character.description && (
            <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 p-4">
              {hasDescriptionSpoiler && (
                <div className="flex items-center justify-between mb-3">
                  <h2 className="text-sm font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                    Description
                  </h2>
                  <button
                    onClick={() => setShowSpoilers(!showSpoilers)}
                    className={`flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg transition-colors ${
                      showSpoilers
                        ? 'bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400'
                        : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400'
                    }`}
                  >
                    {showSpoilers ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                    {showSpoilers ? 'Hide' : 'Show'} spoilers
                  </button>
                </div>
              )}
              <div className={`text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap ${!showFullDescription && character.description.length > 500 ? 'line-clamp-4' : ''}`}>
                {parseBBCode(character.description, { showSpoilers })}
              </div>
              {character.description.length > 500 && (
                <button
                  onClick={() => setShowFullDescription(!showFullDescription)}
                  className="mt-2 text-sm text-primary-600 dark:text-primary-400 hover:underline"
                >
                  {showFullDescription ? 'Show less' : 'Show more'}
                </button>
              )}
            </div>
          )}

          {/* Aliases */}
          {character.aliases && character.aliases.length > 0 && (
            <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 p-4">
              <h2 className="text-sm font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2">
                Aliases
              </h2>
              <p className="text-sm text-gray-700 dark:text-gray-300">
                {character.aliases.join(', ')}
              </p>
            </div>
          )}

          {/* Traits */}
          {character.traits.length > 0 && (
            <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 overflow-hidden">
              <div className="flex flex-wrap items-center justify-between gap-2 p-4 border-b border-gray-100 dark:border-gray-700">
                <h2 className="text-sm font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                  Traits
                </h2>
                <div className="flex items-center gap-1.5">
                  {sexualTraitCount > 0 && (
                    <button
                      onClick={() => setShowSexual(!showSexual)}
                      className={`flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg transition-colors ${
                        showSexual
                          ? 'bg-pink-100 dark:bg-pink-900/30 text-pink-600 dark:text-pink-400'
                          : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400'
                      }`}
                    >
                      {showSexual ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                      <span>{showSexual ? 'Hide' : 'Show'} sexual ({sexualTraitCount})</span>
                    </button>
                  )}
                  {spoilerCount > 0 && (
                    <button
                      onClick={() => setShowSpoilers(!showSpoilers)}
                      className={`flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg transition-colors ${
                        showSpoilers
                          ? 'bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400'
                          : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400'
                      }`}
                    >
                      {showSpoilers ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                      <span>{showSpoilers ? 'Hide' : 'Show'} spoilers ({spoilerCount})</span>
                    </button>
                  )}
                </div>
              </div>
              <div className="p-4 space-y-3">
                {Object.entries(traitsByGroup).map(([group, traits]) => (
                  <div key={group} className="flex flex-wrap items-start gap-2">
                    <span className="text-xs font-medium text-gray-500 dark:text-gray-400 w-24 shrink-0 pt-1">
                      {group}:
                    </span>
                    <div className="flex flex-wrap gap-1.5 flex-1">
                      {traits.map(trait => (
                        <Link
                          key={trait.id}
                          href={`/stats/trait/${trait.id}`}
                          className={`text-xs px-2 py-1 rounded transition-colors ${
                            trait.spoiler > 0
                              ? 'bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-900/30'
                              : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
                          }`}
                        >
                          {trait.name}
                        </Link>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Appears In */}
          {character.vns.length > 0 && (
            <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 p-4">
              <h2 className="text-sm font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-4">
                Appears In
              </h2>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                {character.vns.map(vn => (
                  <AppearsInCard key={vn.id} vn={vn} preference={preference} />
                ))}
              </div>
            </div>
          )}

          {/* Voiced By */}
          {character.voiced_by && character.voiced_by.length > 0 && (
            <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 p-4">
              <h2 className="text-sm font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-3">
                Voiced By
              </h2>
              <div className="space-y-2">
                {character.voiced_by.map(va => {
                  const vaDisplayName = preference === 'romaji' && va.original ? va.original : va.name;
                  return (
                    <div key={va.id} className="flex items-center gap-2">
                      <Link
                        href={`/stats/seiyuu/${va.id}`}
                        className="text-sm text-gray-900 dark:text-white hover:text-primary-600 dark:hover:text-primary-400 transition-colors"
                      >
                        {vaDisplayName}
                      </Link>
                      {va.note && (
                        <span className="text-xs text-gray-500 dark:text-gray-400">
                          ({va.note})
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
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
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 p-4">
        <div className="flex items-center gap-2 mb-4">
          <Users className="w-5 h-5 text-gray-400" />
          <h2 className="text-sm font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">
            Similar Characters
          </h2>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3">
          {[...Array(5)].map((_, i) => (
            <div key={i}>
              <div className="aspect-3/4 rounded-lg mb-2 image-placeholder" />
              <div className="h-4 rounded-sm w-3/4 image-placeholder" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (characters.length === 0) {
    return null;
  }

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 p-4">
      <div className="flex items-center justify-between gap-2 mb-4 flex-wrap">
        <div className="flex items-center gap-2">
          <Users className="w-5 h-5 text-primary-500" />
          <h2 className="text-sm font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">
            Similar Characters
          </h2>
          <span className="text-xs text-gray-400">
            ({filteredCharacters.length}{languageFilter === 'ja' && characters.length !== filteredCharacters.length ? ` of ${characters.length}` : ''})
          </span>
        </div>
        <LanguageFilter value={languageFilter} onChange={onLanguageFilterChange} />
      </div>
      {filteredCharacters.length === 0 ? (
        <p className="text-sm text-gray-500 dark:text-gray-400 text-center py-4">
          No similar characters from Japanese VNs found. Try switching to &quot;All Languages&quot;.
        </p>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3">
          {filteredCharacters.map(char => (
            <SimilarCharacterCard key={char.id} char={char} preference={preference} />
          ))}
        </div>
      )}
    </div>
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
      className="group block bg-gray-50 dark:bg-gray-700/50 rounded-lg overflow-hidden hover:ring-2 hover:ring-primary-500 transition-all"
      style={{ contentVisibility: 'auto', containIntrinsicSize: '0 280px' }}
    >
      <div className="relative aspect-3/4 bg-gray-200 dark:bg-gray-700">
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
          <div className="w-full h-full flex items-center justify-center text-gray-400">
            <User className="w-8 h-8" />
          </div>
        )}
        <div className="absolute bottom-1 left-1 px-1.5 py-0.5 bg-black/70 text-white text-[10px] rounded-sm z-10">
          {roleLabels[vn.role] || vn.role}
        </div>
      </div>
      <div className="p-2">
        <h4 className="font-medium text-xs text-gray-900 dark:text-white line-clamp-2 group-hover:text-primary-600 dark:group-hover:text-primary-400 transition-colors">
          {vnDisplayTitle}
        </h4>
      </div>
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
      className="group block relative bg-gray-50 dark:bg-gray-700/50 rounded-lg overflow-hidden hover:ring-2 hover:ring-primary-500 transition-all"
      style={{ contentVisibility: 'auto', containIntrinsicSize: '0 280px' }}
    >
      <div className="relative aspect-3/4 bg-gray-200 dark:bg-gray-700">
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
          <div className="w-full h-full flex items-center justify-center text-gray-400">
            <User className="w-8 h-8" />
          </div>
        )}
        <div className="absolute bottom-1 left-1 px-1.5 py-0.5 bg-primary-600/90 text-white text-[10px] rounded-sm z-10">
          {Math.round(char.similarity * 100)}% match
        </div>
      </div>
      <div className="p-2">
        <h4 className="font-medium text-xs text-gray-900 dark:text-white line-clamp-2 group-hover:text-primary-600 dark:group-hover:text-primary-400 transition-colors">
          {charDisplayName}
        </h4>
        {char.vn_title && (() => {
          const vnTitle = getDisplayTitle(
            { title: char.vn_title, title_jp: char.vn_title_jp, title_romaji: char.vn_title_romaji },
            preference
          );
          return vnTitle ? (
            <p className="text-[10px] text-gray-500 dark:text-gray-400 line-clamp-1 mt-0.5">
              {vnTitle}
            </p>
          ) : null;
        })()}
      </div>
      {/* Shared traits tooltip on hover */}
      {char.shared_traits.length > 0 && (
        <div className="absolute inset-0 bg-black/80 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center p-2 pointer-events-none">
          <p className="text-[10px] text-white text-center line-clamp-4">
            Shared: {char.shared_traits.slice(0, 5).join(', ')}
            {char.shared_traits.length > 5 && ` +${char.shared_traits.length - 5}`}
          </p>
        </div>
      )}
    </Link>
  );
}

function ErrorState({ error, charId }: { error: string | null; charId: string }) {
  const vndbUrl = `https://vndb.org/${charId.startsWith('c') ? charId : `c${charId}`}`;

  return (
    <div className="max-w-2xl mx-auto px-4 py-16 text-center">
      <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-red-100 dark:bg-red-900/30 mb-4">
        <AlertCircle className="w-8 h-8 text-red-500" />
      </div>
      <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">
        Unable to Load Character
      </h1>
      <p className="text-gray-600 dark:text-gray-400 mb-6">
        {error || 'Something went wrong while loading the character.'}
      </p>
      <div className="flex flex-col sm:flex-row gap-3 justify-center">
        <button
          onClick={() => window.history.back()}
          className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-lg bg-primary-600 text-white hover:bg-primary-700 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Go Back
        </button>
        <a
          href={vndbUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
        >
          Try on VNDB
          <ExternalLink className="w-4 h-4" />
        </a>
      </div>
    </div>
  );
}
