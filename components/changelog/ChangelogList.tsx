'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import {
  changelogEntries, PROJECT_META, CHANGELOG_MONTHS, formatChangelogDay,
  type ChangelogEntry, type ChangelogProject,
} from '@/lib/changelog-data';

function monthLabel(key: string): string {
  return `${CHANGELOG_MONTHS[Number(key.slice(5, 7)) - 1]} ${key.slice(0, 4)}`;
}

function groupByMonth(entries: ChangelogEntry[]): Array<{ key: string; entries: ChangelogEntry[] }> {
  const sorted = [...entries].sort((a, b) => b.date.localeCompare(a.date));
  const groups: Array<{ key: string; entries: ChangelogEntry[] }> = [];
  for (const entry of sorted) {
    const key = entry.date.slice(0, 7);
    const last = groups[groups.length - 1];
    if (last && last.key === key) {
      last.entries.push(entry);
    } else {
      groups.push({ key, entries: [entry] });
    }
  }
  return groups;
}

function EntryLink({ label, href }: { label: string; href: string }) {
  const className = 'text-primary-600 dark:text-primary-400 hover:underline';
  if (href.startsWith('/')) {
    return (
      <Link href={href} className={className}>
        {label}
      </Link>
    );
  }
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className={className}>
      {label}
    </a>
  );
}

const ALL_PROJECTS = Object.keys(PROJECT_META) as ChangelogProject[];

type ActiveState = Record<ChangelogProject, boolean>;

// Server render and first client render use this so hydration matches; the URL
// is applied in an effect afterward.
const DEFAULT_ACTIVE: ActiveState = { site: true, hikaru: false, muramasa: false, ichijou: false };

function makeActive(on: ChangelogProject[]): ActiveState {
  return {
    site: on.includes('site'),
    hikaru: on.includes('hikaru'),
    muramasa: on.includes('muramasa'),
    ichijou: on.includes('ichijou'),
  };
}

// Read the active set from a ?show= query string. Returns null when no usable
// param is present, so the caller falls back to the default.
function parseShow(search: string): ActiveState | null {
  const raw = new URLSearchParams(search).get('show');
  if (raw === null) return null;
  if (raw === 'all') return makeActive(ALL_PROJECTS);
  if (raw === 'none') return makeActive([]);
  const valid = raw.split(',').map((t) => t.trim()).filter((t): t is ChangelogProject => (ALL_PROJECTS as string[]).includes(t));
  if (valid.length === 0) return null;
  return makeActive(valid);
}

// Inverse of parseShow. Returns null for the default set (clean URL, no param).
function serializeShow(active: ActiveState): string | null {
  const on = ALL_PROJECTS.filter((p) => active[p]);
  if (on.length === 1 && on[0] === 'site') return null;
  if (on.length === 0) return 'none';
  if (on.length === ALL_PROJECTS.length) return 'all';
  return on.join(',');
}

// All entries render to the DOM regardless of filter (good for SEO and search);
// inactive projects are hidden with CSS so toggling never drops content.
const ALL_GROUPS = groupByMonth(changelogEntries);

export default function ChangelogList() {
  const [active, setActive] = useState<ActiveState>(DEFAULT_ACTIVE);

  // Sync from the URL on mount and on back/forward.
  useEffect(() => {
    const apply = () => setActive(parseShow(window.location.search) ?? DEFAULT_ACTIVE);
    apply();
    window.addEventListener('popstate', apply);
    return () => window.removeEventListener('popstate', apply);
  }, []);

  // The URL write stays outside the setActive updater: updaters must be pure
  // (StrictMode double-invokes them, and concurrent renders may call them
  // without committing). Reading `active` from the closure is safe since
  // toggles only fire from clicks, one per render.
  const toggle = (project: ChangelogProject) => {
    const next = { ...active, [project]: !active[project] };
    const show = serializeShow(next);
    window.history.replaceState(null, '', show ? `${window.location.pathname}?show=${show}` : window.location.pathname);
    setActive(next);
  };

  const anyVisible = changelogEntries.some((entry) => active[entry.project]);

  return (
    <>
      <div className="flex flex-wrap gap-x-5 gap-y-2 text-sm">
        {ALL_PROJECTS.map((project) => (
          <span key={project} className="inline-flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => toggle(project)}
              aria-pressed={active[project]}
              title={active[project] ? 'Click to hide these updates' : 'Click to show these updates'}
              className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium transition-opacity cursor-pointer ${PROJECT_META[project].chip} ${active[project] ? '' : 'opacity-40 grayscale'}`}
            >
              {PROJECT_META[project].label}
            </button>
            <span className="text-gray-500 dark:text-gray-400">{PROJECT_META[project].blurb}</span>
          </span>
        ))}
      </div>

      {!anyVisible && (
        <p className="mt-10 text-sm text-gray-500 dark:text-gray-400">
          No updates to show. Toggle a category above.
        </p>
      )}

      {ALL_GROUPS.map((group) => {
        const visibleInGroup = group.entries.some((entry) => active[entry.project]);
        return (
          <section key={group.key} className={visibleInGroup ? undefined : 'hidden'}>
            <h2 className="mt-10 mb-4 text-lg font-semibold text-gray-900 dark:text-gray-100 border-b border-gray-200 dark:border-gray-800 pb-2">
              {monthLabel(group.key)}
            </h2>
            <ul className="space-y-5">
              {group.entries.map((entry) => (
                <li key={`${entry.date}-${entry.title}`} className={active[entry.project] ? undefined : 'hidden'}>
                  <div className="flex flex-wrap items-baseline gap-2">
                    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${PROJECT_META[entry.project].chip}`}>
                      {PROJECT_META[entry.project].label}
                    </span>
                    <h3 className="font-semibold text-gray-900 dark:text-gray-100">{entry.title}</h3>
                    <time dateTime={entry.date} className="ml-auto text-sm text-gray-500 dark:text-gray-400">
                      {formatChangelogDay(entry.date)}
                    </time>
                  </div>
                  <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">{entry.description}</p>
                  {entry.links && entry.links.length > 0 && (
                    <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-sm">
                      {entry.links.map((link) => (
                        <EntryLink key={link.href} label={link.label} href={link.href} />
                      ))}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </>
  );
}
