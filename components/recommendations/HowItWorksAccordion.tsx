'use client';

import { useState } from 'react';
import { ChevronDown } from 'lucide-react';

import {
  RECOMMENDATION_LISTS,
  SIGNAL_LABELS,
  SIGNAL_WEIGHTS,
  listByName,
  maxContributionPct,
  type RecommendationList,
} from '@/lib/recommendation-weights';
import { FigureKey } from '@/components/recommendations/RecommendationEvidence';

interface AccordionSectionProps {
  title: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}

function AccordionSection({ title, children, defaultOpen = false }: AccordionSectionProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  const id = `how-${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;

  return (
    <div className="border-b border-[color:var(--rule)] last:border-b-0">
      <h3 className="m-0">
        <button
          type="button"
          onClick={() => setIsOpen(!isOpen)}
          aria-expanded={isOpen}
          aria-controls={id}
          className="rc-disclose"
        >
          {title}
          <ChevronDown
            aria-hidden
            className={`w-4 h-4 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`}
          />
        </button>
      </h3>
      <div
        id={id}
        hidden={!isOpen}
        className={`overflow-hidden transition-all duration-200 ${
          isOpen ? 'max-h-[2000px] opacity-100 pb-4' : ''
        }`}
      >
        {children}
      </div>
    </div>
  );
}

// Presentation only. The weights themselves come from the shared table so this explainer
// cannot drift from the arithmetic it describes.
const signals = [
  { name: SIGNAL_LABELS.description, weight: SIGNAL_WEIGHTS.description, desc: 'How a title describes itself, which it carries whether or not anyone has read it' },
  { name: SIGNAL_LABELS.tag, weight: SIGNAL_WEIGHTS.tag, desc: 'Themes and content tags matching your preferences' },
  { name: SIGNAL_LABELS.similar_games, weight: SIGNAL_WEIGHTS.similar_games, desc: 'VNs similar to your highly-rated favorites' },
  { name: SIGNAL_LABELS.users_also_read, weight: SIGNAL_WEIGHTS.users_also_read, desc: 'VNs that fans of your favorites also enjoyed' },
  { name: SIGNAL_LABELS.quality, weight: SIGNAL_WEIGHTS.quality, desc: 'VNDB global average rating' },
  { name: SIGNAL_LABELS.developer, weight: SIGNAL_WEIGHTS.developer, desc: 'Studios/publishers you\'ve enjoyed' },
  { name: SIGNAL_LABELS.staff, weight: SIGNAL_WEIGHTS.staff, desc: 'Writers, artists, composers you like' },
  { name: SIGNAL_LABELS.trait, weight: SIGNAL_WEIGHTS.trait, desc: 'Character archetypes you prefer' },
  { name: SIGNAL_LABELS.seiyuu, weight: SIGNAL_WEIGHTS.seiyuu, desc: 'Voice actors from VNs you rated highly' },
];

interface HowItWorksAccordionProps {
  /** The list on screen, so the key describes the percentage that list actually shows. */
  list?: RecommendationList;
  totalLists?: number;
}

export function HowItWorksAccordion({
  list = listByName('combined') ?? RECOMMENDATION_LISTS[0],
  totalLists = RECOMMENDATION_LISTS.filter((entry) => entry.signal !== null).length,
}: HowItWorksAccordionProps = {}) {
  return (
    <div className="text-sm text-[color:var(--nezu)] space-y-0">
      {/* Overview Section */}
      <AccordionSection title="Overview" defaultOpen={true}>
        <div className="space-y-3">
          <p>
            There is not one list here, there are nine. Each of the eight signal tabs is a
            complete ranking on <strong className="text-[color:var(--ink)]">one</strong> kind
            of evidence: the tags you rate highly, how a title describes itself, the studios and
            staff behind what you enjoy, and so on. A tab is fetched when you open it.
          </p>
          <p>
            <strong className="text-[color:var(--ink)]">Combined</strong> is not a sum of the
            other eight. A title places somewhere in each of them, and Combined ranks by how high
            it placed across the lot. That matters because the eight are on eight different scales:
            adding them together lets a signal that gives almost every title the same score add the
            same amount to every title, which cannot change an order no matter what it is set to.
            Counting places has no such blind spot.
          </p>
          <p>
            <strong className="text-[color:var(--ink)]">In N of M lists, X% agreement</strong> on
            a card is that count and that standing. N is how many of the engine&apos;s rankings
            placed the title, the global-rating ranking among them though it has no tab of its
            own, and M is the tab count. 100% would be first in every ranking. The
            count comes first because the percentage alone is ambiguous: one first place and three
            middling ones can reach the same figure, and they are different recommendations.
          </p>
          <p>
            <strong className="text-[color:var(--ink)]">Predicted</strong> is the mark the
            signals expect you to give a title, combined over the ones that had anything to go on.
            Each is read off marks you have already given: your own average for that studio, for
            those tags, for the titles this one sits closest to. They do not count equally. Each is
            weighted by how close it has been measured to land on ratings readers went on to give,
            so a signal that predicts well decides more of the number than one that barely improves
            on your own average. The range beside it is where those signals agree, and nothing
            more. It is not a forecast of what you would really rate the title, and it is not
            calibrated against your actual ratings.
          </p>
          <p>
            Every card also says <strong className="text-[color:var(--ink)]">why it is
            there</strong>: which entries matched and the strongest few by name. Where a count is
            written as &quot;10+&quot;, the matched entries were cut before the page saw them, so
            that is a floor rather than a total.
          </p>
          <p>
            The weights below are the balance Combined starts from, not a fixed one. The{' '}
            <strong className="text-[color:var(--ink)]">Tune the signals</strong> panel under
            the filters moves any of them, and a tuned balance travels in the page address so a link
            reproduces the list it was copied from. Three of the nine barely vary between titles and
            are marked as such in that panel; their tabs are the useful way to reach them.
          </p>
        </div>
      </AccordionSection>

      <AccordionSection title="What the Figures Mean">
        <FigureKey list={list} totalLists={totalLists} />
      </AccordionSection>

      {/* Signal Weights Section */}
      <AccordionSection title="Signal Weights">
        <div className="space-y-2">
          {signals.map((signal) => (
            <div key={signal.name} className="flex items-center gap-3">
              <span className="w-32 shrink-0 font-medium text-[color:var(--ink)]">{signal.name}</span>
              <span className="rc-num w-14 text-right text-[color:var(--nezu)]">
                ×{signal.weight.toFixed(1)}
              </span>
              <div className="rc-meter flex-1 h-2">
                <div
                  className="rc-meter-fill"
                  style={{ width: `${maxContributionPct(signal.weight) * 4}%` }}
                />
              </div>
              <span className="rc-num w-10 text-right text-xs text-[color:var(--nezu)]">
                {maxContributionPct(signal.weight)}%
              </span>
            </div>
          ))}
          <p className="rc-why mt-3">
            Percentages show maximum possible contribution if all signals score 100%.
            In practice, a signal&apos;s actual % of a VN&apos;s score will be higher when other signals score lower.
          </p>
        </div>
      </AccordionSection>

      {/* How Each Signal Works */}
      <AccordionSection title="How Each Signal Works">
        <div className="space-y-4">
          {/* Premise */}
          <div>
            <h4 className="rc-label mb-1">Premise</h4>
            <ul className="list-disc list-inside space-y-1 text-xs ml-1">
              <li>Compares a numeric summary of a title&apos;s own description against the descriptions of the titles you rated highly</li>
              <li>Neighbours are taken per favourite and interleaved, so every favourite is represented before any of them is represented twice</li>
              <li>The one signal that works on a title nobody has voted on, because a title carries its description from the day it is announced</li>
            </ul>
          </div>

          {/* Tags */}
          <div>
            <h4 className="rc-label mb-1">Tags</h4>
            <ul className="list-disc list-inside space-y-1 text-xs ml-1">
              <li><strong>IDF Weighting:</strong> Rare tags worth more than common ones
                <br/><span className="ml-4 text-[color:var(--text-faint)]">A tag carried by a few hundred titles counts for much more than one carried by several thousand</span>
              </li>
              <li><strong>Elite Tier Boosting:</strong> Your top tags get extra emphasis
                <br/><span className="ml-4 text-[color:var(--text-faint)]">Top 5: ×4.0 | Tags 6-10: ×2.5 | Tags 11-20: ×1.6</span>
              </li>
              <li><strong>Formula:</strong> 60% sum-based + 40% best-match on elite tags</li>
              <li><strong>Bonus:</strong> +1% per matching tag (up to +10%)</li>
            </ul>
          </div>

          {/* Similar titles */}
          <div>
            <h4 className="rc-label mb-1">Similar titles</h4>
            <ul className="list-disc list-inside space-y-1 text-xs ml-1">
              <li>Uses precomputed similarity data (same as &quot;Similar Games&quot; on VN pages)</li>
              <li>Checks your <strong>top 20 highest-rated VNs</strong> for similarity matches</li>
              <li><strong>Formula:</strong> (60% × best_match + 40% × average) × match_bonus</li>
              <li><strong>Match bonus:</strong> +5% per additional matching favorite (up to +30%)</li>
            </ul>
          </div>

          {/* Also read */}
          <div>
            <h4 className="rc-label mb-1">Also read</h4>
            <ul className="list-disc list-inside space-y-1 text-xs ml-1">
              <li>Uses co-occurrence data (same as &quot;Users Also Read&quot; on VN pages)</li>
              <li>Shows VNs commonly read alongside your favorites</li>
              <li><strong>Confidence factor:</strong> Scales with evidence (~50 users for full confidence)</li>
              <li><strong>Formula:</strong> (60% × best + 40% × avg) × confidence × match_bonus</li>
            </ul>
          </div>

          {/* Quality */}
          <div>
            <h4 className="rc-label mb-1">Global rating</h4>
            <ul className="list-disc list-inside space-y-1 text-xs ml-1">
              <li>Based on VNDB&apos;s <strong>raw average rating</strong> (not Bayesian-adjusted)</li>
              <li><strong>Formula:</strong> (average_rating - 5.0) / 5.0</li>
              <li className="ml-4 text-[color:var(--text-faint)]">Rating 5.0 → 0% | Rating 7.5 → 50% | Rating 10.0 → 100%</li>
              <li>Penalizes poorly-rated VNs, rewards highly-rated ones</li>
            </ul>
          </div>

          {/* Developer/Staff/Seiyuu */}
          <div>
            <h4 className="rc-label mb-1">Studios, Staff and Voices</h4>
            <ul className="list-disc list-inside space-y-1 text-xs ml-1">
              <li>Based on your average rating for VNs with that creator</li>
              <li><strong>Bayesian smoothing:</strong> Prevents overweighting one-off ratings
                <br/><span className="ml-4 font-mono text-[color:var(--text-faint)]">(count × your_avg + 3 × overall_avg) / (count + 3)</span>
              </li>
              <li><strong>Confidence penalty:</strong> Creators with &lt;5 VNs in your list are dampened
                <br/><span className="ml-4 text-[color:var(--text-faint)]">1 VN = 20% confidence | 5+ VNs = 100% confidence</span>
              </li>
            </ul>
          </div>

          {/* Characters */}
          <div>
            <h4 className="rc-label mb-1">Characters</h4>
            <ul className="list-disc list-inside space-y-1 text-xs ml-1">
              <li>Based on your average rating for VNs with that archetype</li>
              <li><strong>Multi-character bonus:</strong> VNs with multiple matching characters score higher
                <br/><span className="ml-4 text-[color:var(--text-faint)]">1 char: ×1.0 | 2 chars: ×1.3 | 4+ chars: ×2.0 (capped)</span>
              </li>
            </ul>
          </div>
        </div>
      </AccordionSection>

      {/* Behind the Scenes */}
      <AccordionSection title="Behind the Scenes">
        <div className="space-y-4">
          <div>
            <h4 className="rc-label mb-1">User Profile Building</h4>
            <ul className="list-disc list-inside space-y-1 text-xs ml-1">
              <li><strong>Analyzed from:</strong> The VNs you&apos;ve rated on VNDB and marked Finished</li>
              <li><strong>Your top twenty, by your own marks:</strong> used for Similar titles and Also read</li>
              <li><strong>Tag preferences:</strong> IDF-weighted analysis with elite tier boosting</li>
              <li><strong>Creator preferences:</strong> Bayesian-weighted average ratings per staff/developer</li>
              <li><strong>Excluded:</strong> titles on your list and, where the relation rule is on, anything related to them</li>
            </ul>
          </div>

          <div>
            <h4 className="rc-label mb-1">Candidate Selection</h4>
            <p className="text-xs">
              Nine searches run in parallel, one per signal plus a broad draw: titles VNDB relates
              to your top twenty, titles carrying your elite tags (your top ten), titles whose
              description resembles what you rate highly, titles read alongside yours, and titles
              from the studios, staff, voice actors and character types you mark above your
              average. The broad draw adds titles unconnected to anything you have read. Each
              source&apos;s share of the budget scales with the weight you give its signal. Your
              filters then apply to the whole pool.
            </p>
          </div>

          <div>
            <h4 className="rc-label mb-1">IDF (Inverse Document Frequency)</h4>
            <p className="text-xs">
              Tags appearing in fewer VNs are considered more distinctive and receive higher weights.
              This makes niche preferences (like &quot;Nakige&quot; or &quot;Chuunige&quot;) more influential than
              generic tags (like &quot;Romance&quot; or &quot;Comedy&quot;).
            </p>
            <p className="rc-num mt-1 p-2 text-xs bg-[color:var(--surface-inset)] rounded-xs">
              IDF = log(total_vns / tag_vn_count)
            </p>
          </div>

          <div>
            <h4 className="rc-label mb-1">Bayesian Smoothing</h4>
            <p className="text-xs">
              Prevents unreliable signals from dominating. Tags/creators with few instances in your
              list are pulled toward your overall average. With prior_weight=3, you need ~3 instances
              for the signal to approach its raw value.
            </p>
          </div>
        </div>
      </AccordionSection>

      {/* Reading the Details View */}
      <AccordionSection title="Reading the Details View">
        <div className="space-y-3">
          <p>
            Click the <strong className="text-[color:var(--ink)]">info button</strong> on any
            recommendation to see where each list placed it and the evidence behind that placement.
          </p>
          <ul className="list-disc list-inside space-y-1 text-xs ml-1">
            <li><strong>Weighted score (0-100):</strong> Your affinity for each matched tag/staff/etc,
              relative to your strongest preference in that category</li>
            <li><strong>Count:</strong> How many VNs in your list have that tag/creator</li>
          </ul>
        </div>
      </AccordionSection>
    </div>
  );
}
