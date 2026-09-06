'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { BookOpen, EyeOff, Info } from 'lucide-react';

import Link from '@/components/Link';
import { NSFWImage } from '@/components/NSFWImage';
import { useImageFade } from '@/hooks/useImageFade';
import { getProxiedImageUrl } from '@/lib/vndb-image-cache';
import {
  CARD_IMAGE_WIDTH,
  COMPACT_CARD_IMAGE_SIZES,
  COMPACT_CARD_IMAGE_WIDTH,
  RECOMMENDATION_CARD_SIZES,
  RECOMMENDATION_DETAIL_SIZES,
  THUMBNAIL_IMAGE_WIDTH,
  buildCardSrcSet,
  buildCompactCardSrcSet,
} from '@/components/vn/card-image-utils';
import { TitlePreference, getDisplayTitle } from '@/lib/title-preference';
import { RecommendationList, SIGNAL_LABELS, listByName } from '@/lib/recommendation-weights';
import { ResultLayout } from '@/lib/recommendation-layout';
import { HiddenReason } from '@/lib/recommendation-hidden';
import { Recommendation } from '@/lib/recommendation-types';
import { VNBlurb } from '@/lib/recommendation-blurbs';
import {
  AgreementLine,
  FactsLine,
  PredictedRatingLine,
  ReasonLine,
  reasonSentence,
} from './RecommendationEvidence';

/**
 * One recommendation, drawn four ways.
 *
 * Which layout is in force changes how much of a title is on screen, never what is true of it.
 * A figure appearing in more than one of them carries the same words and the same tooltip
 * everywhere, so a reader moving between layouts is not asked to learn the page twice.
 */

const RATING_TOOLTIP = "VNDB's average rating across everyone who voted";

/**
 * The info button's own rule names the properties it animates, and that rule is written outside
 * any cascade layer, so it outranks a utility class asking for opacity as well. The list is
 * restated here, where nothing outranks it, so the button fades in with the control beside it.
 */
const INFO_TRANSITION: React.CSSProperties = {
  transitionProperty: 'border-color, color, background-color, opacity',
};

/** The wrapper each layout's results sit in. Shared with the skeleton so the two cannot drift. */
export const LAYOUT_CONTAINER_CLASS: Record<ResultLayout, string> = {
  list: 'border-y border-[color:var(--rule)]',
  grid: 'grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-3',
  cards: 'grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4',
  detail: 'grid grid-cols-1 lg:grid-cols-2 gap-3',
};

export interface RecommendationResultProps {
  rec: Recommendation;
  index: number;
  titlePreference: TitlePreference;
  onInfoClick: (rec: Recommendation) => void;
  /** The list on screen, which decides what the result's own number means. */
  list: RecommendationList;
  /** Whether the list's ranking signal separated the page at all. */
  signalRanks: boolean;
  /** How many lists an agreement figure is out of. */
  totalLists: number;
  layout: ResultLayout;
  /** Detail layout only. Undefined until the descriptions for the page have arrived. */
  blurb?: VNBlurb;
  /** Detail layout only. False while the space a description will occupy is being held. */
  blurbsLoaded?: boolean;
  /** Take the title off the page, for the reason given. */
  onHide?: (rec: Recommendation, reason: HiddenReason) => void;
  /** True while the page is showing titles the reader hid. */
  isHidden?: boolean;
}

/** What every layout needs to know about a result, worked out the same way in each. */
function resultParts(
  rec: Recommendation,
  titlePreference: TitlePreference,
  list: RecommendationList,
) {
  return {
    displayTitle: getDisplayTitle(
      { title: rec.title, title_jp: rec.title_jp, title_romaji: rec.title_romaji },
      titlePreference,
    ),
    href: `/vn/${rec.vn_id.replace('v', '')}`,
    reasonList: listByName(rec.reason?.list) ?? list,
  };
}

/** VNDB's own average, written as a figure with its scale rather than as a mark. */
function ratingLabel(rating: number): string {
  return `${rating.toFixed(1)}/10`;
}

/** The distance the menu keeps from its trigger, and from an edge it is pushed against. */
const MENU_GAP = 4;

/**
 * Two ways off the page. A menu rather than two buttons, since a row has room for one
 * more control and the two reasons are chosen far less often than the breakdown is.
 *
 * The menu is drawn into the document rather than beside its trigger. Three of the four
 * layouts stand this control on a cover that clips what leaves it, and the fourth gives its
 * rows containment that clips the same way, so a menu left where it is written is cut down
 * to a few pixels. Placed against the viewport it is whole in every layout, at the price of
 * having to be measured, and of closing when the page moves under it.
 */
function HideMenu({
  onHide,
  title,
  className = '',
  buttonClassName = 'rc-info',
}: {
  onHide: (reason: HiddenReason) => void;
  title: string;
  className?: string;
  buttonClassName?: string;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null);
  // Held so focus can return to the trigger once a menu item unmounts: a choice or an
  // Escape both remove the focused element, and losing focus to the document reads as
  // the keyboard silently dropping the reader mid-page.
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLSpanElement>(null);
  // The wrapper is what the menu is measured against, but only supplies its own `relative`
  // positioning when nothing else set one: a caller standing this over a cover passes an
  // `absolute` className of its own, and the two utilities would otherwise contend for the
  // same CSS property.
  const position = className || 'relative';

  useEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    const trigger = buttonRef.current;
    const menu = menuRef.current;
    if (trigger && menu) {
      const rect = trigger.getBoundingClientRect();
      const view = document.documentElement;
      const height = menu.offsetHeight;
      const below = rect.bottom + MENU_GAP;
      // Hangs under the trigger where the space below holds it and over it otherwise, and
      // is held inside both edges: a menu placed against the viewport cannot be scrolled
      // back into view, so a trigger near an edge would put it permanently out of reach.
      const width = menu.offsetWidth;
      const rightGap = view.clientWidth - rect.right;
      setPos({
        top:
          below + height <= view.clientHeight
            ? below
            : Math.max(MENU_GAP, rect.top - MENU_GAP - height),
        right: Math.min(
          Math.max(MENU_GAP, rightGap),
          Math.max(MENU_GAP, view.clientWidth - width - MENU_GAP),
        ),
      });
    }
    // The menu is placed against the viewport rather than the page, so it closes when the
    // page moves instead of drifting away from the title it belongs to.
    const dismiss = () => {
      if (menuRef.current?.contains(document.activeElement)) {
        buttonRef.current?.focus({ preventScroll: true });
      }
      setOpen(false);
    };
    window.addEventListener('scroll', dismiss, { capture: true, passive: true });
    window.addEventListener('resize', dismiss);
    return () => {
      window.removeEventListener('scroll', dismiss, { capture: true } as EventListenerOptions);
      window.removeEventListener('resize', dismiss);
    };
  }, [open]);

  // The menu is not written next to its trigger in the document, so Tab alone does not
  // arrive at it. Focus follows the menu once it has been placed, which is also what a
  // control that opens a menu is expected to do.
  useEffect(() => {
    if (!pos) return;
    menuRef.current?.querySelector<HTMLButtonElement>('button')?.focus({ preventScroll: true });
  }, [pos]);

  return (
    <span
      className={`inline-flex ${position}`}
      // A caller over a cover reveals this on hover or on focus held inside it, and while a
      // menu is open focus is held in the menu instead. An open menu is the control in use,
      // so it stays shown for as long as it is open.
      style={open ? { opacity: 1 } : undefined}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          setOpen(false);
          buttonRef.current?.focus();
        }
      }}
      onBlur={(event) => {
        const next = event.relatedTarget as Node | null;
        // The menu sits elsewhere in the document, so it is asked separately whether focus
        // is still somewhere inside this control.
        if (event.currentTarget.contains(next) || menuRef.current?.contains(next)) return;
        setOpen(false);
      }}
    >
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Hide ${title}`}
        className={buttonClassName}
        // The variant worn over a cover places itself, and the wrapper is what carries the
        // offsets here, so the trigger has to fill the wrapper rather than leave it a point.
        style={{ position: 'static' }}
      >
        <EyeOff aria-hidden className="w-3.5 h-3.5" />
      </button>
      {open &&
        createPortal(
          <span
            ref={menuRef}
            role="menu"
            className="rc-menu fixed z-50 min-w-40 flex flex-col"
            // Held out of sight for the frame it takes to measure, so it is never seen in
            // the corner it is measured in.
            style={
              pos ? { top: pos.top, right: pos.right } : { top: 0, right: 0, visibility: 'hidden' }
            }
          >
            <button
              type="button"
              role="menuitem"
              className="rc-opt w-full px-3 py-2 text-left"
              onClick={() => {
                setOpen(false);
                onHide('skip');
                buttonRef.current?.focus();
              }}
            >
              Not interested
            </button>
            <button
              type="button"
              role="menuitem"
              className="rc-opt w-full px-3 py-2 text-left"
              onClick={() => {
                setOpen(false);
                onHide('read');
                buttonRef.current?.focus();
              }}
            >
              Already read
            </button>
          </span>,
          document.body,
        )}
    </span>
  );
}

export function RecommendationResult(props: RecommendationResultProps) {
  switch (props.layout) {
    case 'list':
      return <RecommendationRow {...props} />;
    case 'grid':
      return <RecommendationGridCard {...props} />;
    case 'detail':
      return <RecommendationDetailRow {...props} />;
    default:
      return <RecommendationCard {...props} />;
  }
}

/* ------------------------------------------------------------------- list */

function RecommendationRow({
  rec,
  index,
  titlePreference,
  onInfoClick,
  list,
  signalRanks,
  totalLists,
  onHide,
  isHidden,
}: RecommendationResultProps) {
  const { displayTitle, href, reasonList } = resultParts(rec, titlePreference, list);
  // The slot is fixed and small enough that the narrowest cached width covers it at every
  // pixel ratio, so the row asks for one file rather than offering a choice of them.
  const imageUrl = getProxiedImageUrl(rec.image_url, {
    width: THUMBNAIL_IMAGE_WIDTH,
    vnId: rec.vn_id,
  });
  const sentence = rec.reason ? reasonSentence(rec.reason, reasonList, titlePreference) : null;

  const figures = (
    <>
      {list.signal && signalRanks && (
        <span className="rc-num font-semibold text-[color:var(--ink)]">{rec.normalized_score}%</span>
      )}
      {list.name === 'combined' && rec.signals_ranked !== undefined && rec.signals_ranked > 0 && (
        <span className="rc-num">{rec.signals_ranked}/{totalLists}</span>
      )}
      {rec.predicted_rating && <span className="rc-num">~{rec.predicted_rating.mean.toFixed(1)}</span>}
    </>
  );

  return (
    <li
      className={`rc-row${isHidden ? ' opacity-60' : ''}`}
      style={{ contentVisibility: 'auto', containIntrinsicSize: '0 52px' }}
    >
      <Link href={href} className="flex items-center gap-2 sm:gap-3 flex-1 min-w-0">
        {/* One weight for every place. A ranking signal that gave the whole page the same
            score has ordered nothing, which the note above the results says outright, and a
            podium under that sentence would contradict it. */}
        <span className="rc-rank">{index + 1}</span>

        <span className="rc-art shrink-0 w-8 h-11">
          {rec.image_url ? (
            <NSFWImage
              src={imageUrl || rec.image_url}
              /* The title is written beside it, and alt text painted inside a thumbnail
                 while the image loads reads as a rendering fault. */
              alt=""
              imageSexual={rec.image_sexual}
              vnId={rec.vn_id}
              compact
              className="w-full h-full object-cover"
              loading="lazy"
            />
          ) : (
            <span className="w-full h-full flex items-center justify-center text-[color:var(--text-faint)]">
              <BookOpen aria-hidden className="w-3 h-3" />
            </span>
          )}
        </span>

        <span className="min-w-0 flex-1">
          <span className="rc-name block truncate" title={displayTitle}>
            {displayTitle}
          </span>
          {sentence && (
            <span className="rc-why block truncate" title={sentence}>
              {sentence}
            </span>
          )}
          {/* Below the narrow breakpoint the figures move under the title rather than off
              the row: the evidence is the point of the page and a phone is most of its
              readers. */}
          <span className="rc-why flex sm:hidden flex-wrap items-center gap-x-2">
            {figures}
            <FactsLine
              year={rec.year}
              length={rec.length}
              lengthMinutes={rec.length_minutes}
              difficulty={rec.difficulty}
              as="span"
              className="inline"
            />
          </span>
        </span>

        <span className="rc-why hidden sm:flex shrink-0 items-center gap-3">{figures}</span>

        <FactsLine
          year={rec.year}
          length={rec.length}
          lengthMinutes={rec.length_minutes}
          difficulty={rec.difficulty}
          className="hidden sm:block shrink-0"
        />

        {rec.rating !== null && (
          <span className="rc-num shrink-0 text-xs text-[color:var(--nezu)]" title={RATING_TOOLTIP}>
            {ratingLabel(rec.rating)}
          </span>
        )}
      </Link>

      {/* A row has no cover to hover over and touch has no hover at all, so the control that
          opens the breakdown stays on the face of it. */}
      <button
        type="button"
        onClick={() => onInfoClick(rec)}
        className="rc-info"
        title="Why this recommendation?"
        aria-label={`Why ${displayTitle} was recommended`}
      >
        <Info aria-hidden className="w-4 h-4" />
      </button>
      {onHide && <HideMenu title={displayTitle} onHide={(reason) => onHide(rec, reason)} />}
    </li>
  );
}

/* ------------------------------------------------------------------- grid */

function RecommendationGridCard({
  rec,
  index,
  titlePreference,
  onInfoClick,
  list,
  signalRanks,
  onHide,
  isHidden,
}: RecommendationResultProps) {
  const { onLoad, shimmerClass, fadeClass } = useImageFade();
  const { displayTitle, href } = resultParts(rec, titlePreference, list);
  const imageUrl = getProxiedImageUrl(rec.image_url, {
    width: COMPACT_CARD_IMAGE_WIDTH,
    vnId: rec.vn_id,
  });
  const srcSet = rec.image_url ? buildCompactCardSrcSet(rec.image_url, rec.vn_id) : undefined;

  return (
    <div
      className={`group relative${isHidden ? ' opacity-60' : ''}`}
      style={{ contentVisibility: 'auto', containIntrinsicSize: '0 220px' }}
    >
      <div className="rc-art aspect-3/4">
        <Link href={href} className="block w-full h-full">
          <div className={shimmerClass} />
          {rec.image_url ? (
            <NSFWImage
              src={imageUrl || rec.image_url}
              alt={displayTitle}
              imageSexual={rec.image_sexual}
              vnId={rec.vn_id}
              compact
              className={`w-full h-full object-cover ${fadeClass}`}
              loading="lazy"
              srcSet={srcSet}
              sizes={COMPACT_CARD_IMAGE_SIZES}
              onLoad={onLoad}
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-[color:var(--text-faint)]">
              <BookOpen aria-hidden className="w-6 h-6" />
            </div>
          )}
        </Link>

        <div className="rc-mark top-1 left-1 pointer-events-none">{index + 1}</div>
        {rec.rating !== null && (
          <div className="rc-mark top-1 right-1 pointer-events-none">
            {ratingLabel(rec.rating)}
          </div>
        )}
        {list.signal && signalRanks && (
          <div className="rc-mark rc-mark--on bottom-1 left-1 pointer-events-none">
            {rec.normalized_score}%
          </div>
        )}
        <button
          type="button"
          onClick={() => onInfoClick(rec)}
          className="rc-info rc-info--art bottom-1 right-1 z-10 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 sm:focus:opacity-100 transition-opacity"
          style={INFO_TRANSITION}
          title="Why this recommendation?"
          aria-label={`Why ${displayTitle} was recommended`}
        >
          <Info aria-hidden className="w-3 h-3" />
        </button>
        {onHide && (
          <HideMenu
            title={displayTitle}
            onHide={(reason) => onHide(rec, reason)}
            className="absolute bottom-1 right-8 z-10 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 sm:focus-within:opacity-100 transition-opacity"
            buttonClassName="rc-info rc-info--art"
          />
        )}
      </div>

      {/* Year, length and difficulty sit beside the name at every width the grid renders,
          rather than only where a hover or a tap can reach the info button. */}
      <Link href={href} className="block mt-1">
        <span className="rc-name rc-name--small line-clamp-2" title={displayTitle}>
          {displayTitle}
        </span>
      </Link>
    </div>
  );
}

/* ------------------------------------------------------------------ cards */

function RecommendationCard({
  rec,
  index,
  titlePreference,
  onInfoClick,
  list,
  signalRanks,
  totalLists,
  onHide,
  isHidden,
}: RecommendationResultProps) {
  const { onLoad, shimmerClass, fadeClass } = useImageFade();
  const { displayTitle, href, reasonList } = resultParts(rec, titlePreference, list);
  const imageUrl = getProxiedImageUrl(rec.image_url, { width: CARD_IMAGE_WIDTH, vnId: rec.vn_id });
  const srcSet = rec.image_url ? buildCardSrcSet(rec.image_url, rec.vn_id) : undefined;

  return (
    <div
      className={`rc-card group${isHidden ? ' opacity-60' : ''}`}
      style={{ contentVisibility: 'auto', containIntrinsicSize: '0 360px' }}
    >
      {/* The cover carries the marks and the info button, so neither sits over the reasons
          below it and neither has to be nested inside the link that wraps the cover. It does
          not grow with the card: a row is as tall as its longest reason, and the covers have
          to stay level across it. */}
      <div className="relative aspect-3/4 shrink-0 overflow-hidden">
        <Link href={href} className="block w-full h-full">
          <div className={shimmerClass} />
          {rec.image_url ? (
            <NSFWImage
              src={imageUrl || rec.image_url}
              alt={rec.title}
              imageSexual={rec.image_sexual}
              vnId={rec.vn_id}
              className={`w-full h-full object-cover ${fadeClass}`}
              loading="lazy"
              srcSet={srcSet}
              sizes={RECOMMENDATION_CARD_SIZES}
              onLoad={onLoad}
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center bg-[color:var(--surface-inset)] text-[color:var(--text-faint)]">
              <BookOpen aria-hidden className="w-8 h-8" />
            </div>
          )}
        </Link>

        <div className="rc-mark top-2 left-2 pointer-events-none">{index + 1}</div>
        {/* VNDB's own average, which is a fact about the title rather than about the reader */}
        {rec.rating !== null && (
          <div className="rc-mark top-2 right-2 pointer-events-none">
            {ratingLabel(rec.rating)}
          </div>
        )}
        {/* How strongly this list's own signal matched, which is a statement about one
            measurable thing. The combined list has no such number: nine scores on nine
            scales do not add up to a quantity, and its cards report agreement instead. */}
        {list.signal && signalRanks && (
          <div className="rc-mark rc-mark--on bottom-2 left-2 pointer-events-none">
            {rec.normalized_score}%
          </div>
        )}

        <button
          type="button"
          onClick={() => onInfoClick(rec)}
          className="rc-info rc-info--art bottom-2 right-2 z-10 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 sm:focus:opacity-100 transition-opacity"
          style={INFO_TRANSITION}
          title="Why this recommendation?"
          aria-label={`Why ${displayTitle} was recommended`}
        >
          <Info aria-hidden className="w-3.5 h-3.5" />
        </button>
        {onHide && (
          <HideMenu
            title={displayTitle}
            onHide={(reason) => onHide(rec, reason)}
            className="absolute bottom-2 right-9 z-10 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 sm:focus-within:opacity-100 transition-opacity"
            buttonClassName="rc-info rc-info--art"
          />
        )}
      </div>

      <div className="px-2 pt-2 pb-2 flex flex-col gap-1">
        <Link href={href} className="block">
          <span className="rc-name rc-name--small line-clamp-2" title={displayTitle}>
            {displayTitle}
          </span>
        </Link>
        <FactsLine
          year={rec.year}
          length={rec.length}
          lengthMinutes={rec.length_minutes}
          difficulty={rec.difficulty}
        />

        {/* Why this title is here, said on every card. A percentage answers "how much"
            without ever answering "of what"; these three lines answer the second. */}
        {rec.predicted_rating && <PredictedRatingLine prediction={rec.predicted_rating} />}
        {list.name === 'combined' &&
          rec.confidence != null &&
          rec.signals_ranked !== undefined && (
            <AgreementLine
              confidence={rec.confidence}
              signalsRanked={rec.signals_ranked}
              totalLists={totalLists}
            />
          )}
        {rec.reason && <ReasonLine reason={rec.reason} list={reasonList} preference={titlePreference} />}
      </div>
    </div>
  );
}

/* ----------------------------------------------------------------- detail */

function RecommendationDetailRow({
  rec,
  index,
  titlePreference,
  onInfoClick,
  list,
  signalRanks,
  totalLists,
  blurb,
  blurbsLoaded,
  onHide,
  isHidden,
}: RecommendationResultProps) {
  const { onLoad, shimmerClass, fadeClass } = useImageFade();
  const { displayTitle, href, reasonList } = resultParts(rec, titlePreference, list);
  const imageUrl = getProxiedImageUrl(rec.image_url, {
    width: COMPACT_CARD_IMAGE_WIDTH,
    vnId: rec.vn_id,
  });
  const srcSet = rec.image_url ? buildCardSrcSet(rec.image_url, rec.vn_id) : undefined;

  return (
    <div className={`rc-card rc-card--row group gap-3 sm:gap-4 p-3${isHidden ? ' opacity-60' : ''}`}>
      <div className="rc-art shrink-0 w-[96px] sm:w-[120px] aspect-3/4">
        <Link href={href} className="block w-full h-full">
          <div className={shimmerClass} />
          {rec.image_url ? (
            <NSFWImage
              src={imageUrl || rec.image_url}
              alt={displayTitle}
              imageSexual={rec.image_sexual}
              vnId={rec.vn_id}
              compact
              className={`w-full h-full object-cover ${fadeClass}`}
              loading="lazy"
              srcSet={srcSet}
              sizes={RECOMMENDATION_DETAIL_SIZES}
              onLoad={onLoad}
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-[color:var(--text-faint)]">
              <BookOpen aria-hidden className="w-6 h-6" />
            </div>
          )}
        </Link>
      </div>

      <div className="flex flex-col min-w-0 flex-1 gap-1.5">
        <div className="flex items-center gap-2">
          <span className="rc-num text-[11px] text-[color:var(--text-faint)]">{index + 1}</span>
          {list.signal && signalRanks && (
            <span
              className="rc-mark rc-mark--inline rc-mark--on"
              title={`How strongly the ${SIGNAL_LABELS[list.signal]} signal matched, against the strongest match on this page`}
            >
              {rec.normalized_score}%
            </span>
          )}
          <button
            type="button"
            onClick={() => onInfoClick(rec)}
            className="rc-info ml-auto"
            title="Why this recommendation?"
            aria-label={`Why ${displayTitle} was recommended`}
          >
            <Info aria-hidden className="w-3.5 h-3.5" />
          </button>
          {onHide && <HideMenu title={displayTitle} onHide={(reason) => onHide(rec, reason)} />}
        </div>

        <Link href={href}>
          <span className="rc-name line-clamp-2" title={displayTitle}>
            {displayTitle}
          </span>
        </Link>

        <p className="rc-why flex flex-wrap items-center gap-x-3 gap-y-0.5">
          {rec.rating !== null && (
            <span className="rc-num" title={RATING_TOOLTIP}>
              {ratingLabel(rec.rating)}
            </span>
          )}
          <FactsLine
            as="span"
            year={rec.year}
            length={rec.length}
            lengthMinutes={rec.length_minutes}
            difficulty={rec.difficulty}
            className="inline"
          />
        </p>

        {/* The space three lines will occupy is held while the descriptions are outstanding.
            They arrive together, so a row that grows on arrival moves every row below it at
            once. Once they have arrived, a title without one gives the space back. */}
        {blurb?.description ? (
          <p className="rc-blurb line-clamp-3">{blurb.description}</p>
        ) : (
          !blurbsLoaded && (
            <span aria-hidden className="block space-y-1 py-0.5">
              <span className="rc-ghost block h-2.5" />
              <span className="rc-ghost block h-2.5 w-4/5" />
            </span>
          )
        )}

        <div className="rc-evidence mt-auto">
          {rec.predicted_rating && <PredictedRatingLine prediction={rec.predicted_rating} />}
          {list.name === 'combined' &&
            rec.confidence != null &&
            rec.signals_ranked !== undefined && (
              <AgreementLine
                confidence={rec.confidence}
                signalsRanked={rec.signals_ranked}
                totalLists={totalLists}
              />
            )}
          {rec.reason && <ReasonLine reason={rec.reason} list={reasonList} preference={titlePreference} />}
        </div>
      </div>
    </div>
  );
}
