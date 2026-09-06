import Link from '@/components/Link';
import { changelogEntries, formatChangelogDay, PROJECT_META } from '@/lib/changelog-data';
import { EntryLink } from '@/components/changelog/EntryLink';

// Server component: renders the latest changelog entries statically. Covers every
// project, not just the site, so each entry carries the badge that says which one
// it belongs to (same chip as /changelog).
export function WhatsNewSection() {
  const latest = [...changelogEntries]
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 3);

  return (
    <section aria-labelledby="whats-new" className="band band--quiet">
      <div className="container mx-auto px-4 max-w-6xl">
        <div className="sec-head">
          <div>
            <h2 id="whats-new" className="sec-title">
              What&apos;s new
            </h2>
            <p className="sec-sub">
              The latest updates across the site and the club bots.
            </p>
          </div>
          <Link href="/changelog/" className="sec-more">
            View all updates
            <span aria-hidden>&rarr;</span>
          </Link>
        </div>
        <div className="panel divide-y divide-[color:var(--border-subtle)]">
          {latest.map((entry) => (
            <div key={`${entry.date}-${entry.title}`} className="p-4">
              <div className="flex flex-wrap items-baseline gap-2">
                <span className={PROJECT_META[entry.project].chip}>
                  {PROJECT_META[entry.project].label}
                </span>
                <h3 className="font-semibold text-[color:var(--ink)]">{entry.title}</h3>
                <time dateTime={entry.date} className="ml-auto font-mono text-xs tabular-nums text-[color:var(--nezu)]">
                  {formatChangelogDay(entry.date)}
                </time>
              </div>
              <p className="mt-1 text-sm text-[color:var(--text-secondary)]">{entry.description}</p>
              {entry.links && entry.links.length > 0 && (
                <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-sm">
                  {entry.links.map((link) => (
                    <EntryLink key={link.href} label={link.label} href={link.href} />
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
