'use client';

import { useState } from 'react';
import { ChevronDown, Tag, Users, BookOpen, Building2, Pen, Mic, Heart, Star } from 'lucide-react';

interface AccordionSectionProps {
  title: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}

function AccordionSection({ title, children, defaultOpen = false }: AccordionSectionProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  return (
    <div className="border-b border-gray-200 dark:border-gray-700 last:border-b-0">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center justify-between py-3 text-left text-sm font-medium text-gray-900 dark:text-white hover:text-violet-600 dark:hover:text-violet-400 transition-colors"
      >
        {title}
        <ChevronDown
          className={`w-4 h-4 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`}
        />
      </button>
      <div
        className={`overflow-hidden transition-all duration-200 ${
          isOpen ? 'max-h-[2000px] opacity-100 pb-4' : 'max-h-0 opacity-0'
        }`}
      >
        {children}
      </div>
    </div>
  );
}

// Signal configuration for consistent styling
const signals = [
  { name: 'Tag Matching', weight: 2.5, maxPct: 24, Icon: Tag, color: 'blue', desc: 'Themes and content tags matching your preferences' },
  { name: 'Similar Games', weight: 2.0, maxPct: 19, Icon: BookOpen, color: 'purple', desc: 'VNs similar to your highly-rated favorites' },
  { name: 'Users Also Read', weight: 2.0, maxPct: 19, Icon: Users, color: 'green', desc: 'VNs that fans of your favorites also enjoyed' },
  { name: 'Quality', weight: 1.5, maxPct: 14, Icon: Star, color: 'yellow', desc: 'VNDB global average rating' },
  { name: 'Developer', weight: 0.6, maxPct: 6, Icon: Building2, color: 'orange', desc: 'Studios/publishers you\'ve enjoyed' },
  { name: 'Staff', weight: 0.5, maxPct: 5, Icon: Pen, color: 'amber', desc: 'Writers, artists, composers you like' },
  { name: 'Traits', weight: 0.5, maxPct: 5, Icon: Heart, color: 'rose', desc: 'Character archetypes you prefer' },
  { name: 'Seiyuu', weight: 0.3, maxPct: 3, Icon: Mic, color: 'pink', desc: 'Voice actors from VNs you rated highly' },
];

const colorClasses: Record<string, string> = {
  blue: 'text-blue-600 dark:text-blue-400',
  purple: 'text-purple-600 dark:text-purple-400',
  green: 'text-green-600 dark:text-green-400',
  yellow: 'text-yellow-600 dark:text-yellow-400',
  orange: 'text-orange-600 dark:text-orange-400',
  amber: 'text-amber-600 dark:text-amber-400',
  rose: 'text-rose-600 dark:text-rose-400',
  pink: 'text-pink-600 dark:text-pink-400',
};

export function HowItWorksAccordion() {
  return (
    <div className="text-sm text-gray-600 dark:text-gray-400 space-y-0">
      {/* Overview Section */}
      <AccordionSection title="Overview" defaultOpen={true}>
        <div className="space-y-3">
          <p>
            The <strong className="text-gray-900 dark:text-white">Match Score (0-100%)</strong> represents
            how well a VN aligns with your preferences based on your VNDB ratings.
          </p>
          <p>
            It combines <strong className="text-gray-900 dark:text-white">8 independent signals</strong> with
            different weights. The maximum possible raw score is 10.4 (sum of all weights).
          </p>
          <p className="font-mono text-xs bg-gray-100 dark:bg-gray-800 p-2 rounded">
            normalized_score = (total_weighted_score / 10.4) × 100
          </p>
        </div>
      </AccordionSection>

      {/* Signal Weights Section */}
      <AccordionSection title="Signal Weights">
        <div className="space-y-2">
          {signals.map((signal) => (
            <div key={signal.name} className="flex items-center gap-3">
              <signal.Icon className={`w-4 h-4 flex-shrink-0 ${colorClasses[signal.color]}`} />
              <span className={`font-medium w-28 ${colorClasses[signal.color]}`}>{signal.name}</span>
              <span className="text-gray-500 dark:text-gray-500 w-16 text-right">
                ×{signal.weight.toFixed(1)}
              </span>
              <div className="flex-1 h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full ${
                    signal.color === 'blue' ? 'bg-blue-500' :
                    signal.color === 'purple' ? 'bg-purple-500' :
                    signal.color === 'green' ? 'bg-green-500' :
                    signal.color === 'yellow' ? 'bg-yellow-500' :
                    signal.color === 'orange' ? 'bg-orange-500' :
                    signal.color === 'amber' ? 'bg-amber-500' :
                    signal.color === 'rose' ? 'bg-rose-500' :
                    'bg-pink-500'
                  }`}
                  style={{ width: `${signal.maxPct * 4}%` }}
                />
              </div>
              <span className="text-gray-500 dark:text-gray-500 w-10 text-right text-xs">
                {signal.maxPct}%
              </span>
            </div>
          ))}
          <p className="text-xs text-gray-500 dark:text-gray-500 mt-3 italic">
            Percentages show maximum possible contribution if all signals score 100%.
            In practice, a signal&apos;s actual % of a VN&apos;s score will be higher when other signals score lower.
          </p>
        </div>
      </AccordionSection>

      {/* How Each Signal Works */}
      <AccordionSection title="How Each Signal Works">
        <div className="space-y-4">
          {/* Tag Matching */}
          <div>
            <h5 className="font-medium text-blue-600 dark:text-blue-400 flex items-center gap-2 mb-1">
              <Tag className="w-4 h-4" /> Tag Matching (×2.5)
            </h5>
            <ul className="list-disc list-inside space-y-1 text-xs ml-1">
              <li><strong>IDF Weighting:</strong> Rare tags worth more than common ones
                <br/><span className="ml-4 text-gray-500">e.g., &quot;Nakige&quot; (368 VNs) → high value, &quot;Romance&quot; (17k VNs) → lower value</span>
              </li>
              <li><strong>Elite Tier Boosting:</strong> Your top tags get extra emphasis
                <br/><span className="ml-4 text-gray-500">Top 5: ×4.0 | Tags 6-10: ×2.5 | Tags 11-20: ×1.6</span>
              </li>
              <li><strong>Formula:</strong> 60% sum-based + 40% best-match on elite tags</li>
              <li><strong>Bonus:</strong> +1% per matching tag (up to +10%)</li>
            </ul>
          </div>

          {/* Similar Games */}
          <div>
            <h5 className="font-medium text-purple-600 dark:text-purple-400 flex items-center gap-2 mb-1">
              <BookOpen className="w-4 h-4" /> Similar Games (×2.0)
            </h5>
            <ul className="list-disc list-inside space-y-1 text-xs ml-1">
              <li>Uses precomputed similarity data (same as &quot;Similar Games&quot; on VN pages)</li>
              <li>Checks your <strong>top 20 highest-rated VNs</strong> for similarity matches</li>
              <li><strong>Formula:</strong> (60% × best_match + 40% × average) × match_bonus</li>
              <li><strong>Match bonus:</strong> +5% per additional matching favorite (up to +30%)</li>
            </ul>
          </div>

          {/* Users Also Read */}
          <div>
            <h5 className="font-medium text-green-600 dark:text-green-400 flex items-center gap-2 mb-1">
              <Users className="w-4 h-4" /> Users Also Read (×2.0)
            </h5>
            <ul className="list-disc list-inside space-y-1 text-xs ml-1">
              <li>Uses co-occurrence data (same as &quot;Users Also Read&quot; on VN pages)</li>
              <li>Shows VNs commonly read alongside your favorites</li>
              <li><strong>Confidence factor:</strong> Scales with evidence (~50 users for full confidence)</li>
              <li><strong>Formula:</strong> (60% × best + 40% × avg) × confidence × match_bonus</li>
            </ul>
          </div>

          {/* Quality */}
          <div>
            <h5 className="font-medium text-yellow-600 dark:text-yellow-400 flex items-center gap-2 mb-1">
              <Star className="w-4 h-4" /> Quality (×1.5)
            </h5>
            <ul className="list-disc list-inside space-y-1 text-xs ml-1">
              <li>Based on VNDB&apos;s <strong>raw average rating</strong> (not Bayesian-adjusted)</li>
              <li><strong>Formula:</strong> (average_rating - 5.0) / 5.0</li>
              <li className="ml-4 text-gray-500">Rating 5.0 → 0% | Rating 7.5 → 50% | Rating 10.0 → 100%</li>
              <li>Penalizes poorly-rated VNs, rewards highly-rated ones</li>
            </ul>
          </div>

          {/* Developer/Staff/Seiyuu */}
          <div>
            <h5 className="font-medium text-orange-600 dark:text-orange-400 flex items-center gap-2 mb-1">
              <Building2 className="w-4 h-4" /> Developer / Staff / Seiyuu (×0.6 / ×0.5 / ×0.3)
            </h5>
            <ul className="list-disc list-inside space-y-1 text-xs ml-1">
              <li>Based on your average rating for VNs with that creator</li>
              <li><strong>Bayesian smoothing:</strong> Prevents overweighting one-off ratings
                <br/><span className="ml-4 text-gray-500 font-mono">(count × your_avg + 3 × overall_avg) / (count + 3)</span>
              </li>
              <li><strong>Confidence penalty:</strong> Creators with &lt;5 VNs in your list are dampened
                <br/><span className="ml-4 text-gray-500">1 VN = 20% confidence | 5+ VNs = 100% confidence</span>
              </li>
            </ul>
          </div>

          {/* Character Traits */}
          <div>
            <h5 className="font-medium text-rose-600 dark:text-rose-400 flex items-center gap-2 mb-1">
              <Heart className="w-4 h-4" /> Character Traits (×0.5)
            </h5>
            <ul className="list-disc list-inside space-y-1 text-xs ml-1">
              <li>Based on your average rating for VNs with that archetype</li>
              <li><strong>Multi-character bonus:</strong> VNs with multiple matching characters score higher
                <br/><span className="ml-4 text-gray-500">1 char: ×1.0 | 2 chars: ×1.3 | 4+ chars: ×2.0 (capped)</span>
              </li>
            </ul>
          </div>
        </div>
      </AccordionSection>

      {/* Behind the Scenes */}
      <AccordionSection title="Behind the Scenes">
        <div className="space-y-4">
          <div>
            <h5 className="font-medium text-gray-900 dark:text-white mb-1">User Profile Building</h5>
            <ul className="list-disc list-inside space-y-1 text-xs ml-1">
              <li><strong>Analyzed from:</strong> All VNs you&apos;ve rated on VNDB</li>
              <li><strong>Highly-rated VNs (≥8.5):</strong> Used for Similar Games and Users Also Read</li>
              <li><strong>Tag preferences:</strong> IDF-weighted analysis with elite tier boosting</li>
              <li><strong>Creator preferences:</strong> Bayesian-weighted average ratings per staff/developer</li>
              <li><strong>Excluded:</strong> VNs you&apos;ve already played or voted on</li>
            </ul>
          </div>

          <div>
            <h5 className="font-medium text-gray-900 dark:text-white mb-1">Candidate Selection</h5>
            <ol className="list-decimal list-inside space-y-1 text-xs ml-1">
              <li>Find VNs similar to your top 20 favorites</li>
              <li>Add VNs with your elite tags (top 5)</li>
              <li>Include 20% random VNs for exploration/diversity</li>
              <li>Apply your filters (rating threshold, length, language)</li>
            </ol>
          </div>

          <div>
            <h5 className="font-medium text-gray-900 dark:text-white mb-1">IDF (Inverse Document Frequency)</h5>
            <p className="text-xs">
              Tags appearing in fewer VNs are considered more distinctive and receive higher weights.
              This makes niche preferences (like &quot;Nakige&quot; or &quot;Chuunige&quot;) more influential than
              generic tags (like &quot;Romance&quot; or &quot;Comedy&quot;).
            </p>
            <p className="font-mono text-xs bg-gray-100 dark:bg-gray-800 p-2 rounded mt-1">
              IDF = log(total_vns / tag_vn_count)
            </p>
          </div>

          <div>
            <h5 className="font-medium text-gray-900 dark:text-white mb-1">Bayesian Smoothing</h5>
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
            Click the <strong className="text-gray-900 dark:text-white">info button</strong> on any
            recommendation to see a full breakdown of why it was recommended.
          </p>
          <ul className="list-disc list-inside space-y-1 text-xs ml-1">
            <li><strong>Weighted score (0-100):</strong> Your affinity for each matched tag/staff/etc,
              relative to your strongest preference in that category</li>
            <li><strong>Count:</strong> How many VNs in your list have that tag/creator</li>
            <li><strong>% of score:</strong> What fraction of THIS recommendation&apos;s total score
              came from each signal category</li>
          </ul>
          <p className="text-xs text-gray-500 italic">
            The percentages shown are relative to the total weighted score for that specific VN,
            so they always sum to 100%.
          </p>
        </div>
      </AccordionSection>
    </div>
  );
}
