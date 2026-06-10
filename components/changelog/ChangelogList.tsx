'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { changelogEntries, PRODUCT_META, type ChangelogEntry, type ChangelogProduct } from '@/lib/changelog-data';

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

// Dates are sliced as strings: new Date('YYYY-MM-DD') parses as UTC and can
// shift the displayed day depending on the timezone.
function monthLabel(key: string): string {
  return `${MONTH_NAMES[Number(key.slice(5, 7)) - 1]} ${key.slice(0, 4)}`;
}

function dayLabel(date: string): string {
  return `${MONTH_NAMES[Number(date.slice(5, 7)) - 1].slice(0, 3)} ${Number(date.slice(8, 10))}`;
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

const ALL_PRODUCTS = Object.keys(PRODUCT_META) as ChangelogProduct[];

type ActiveState = Record<ChangelogProduct, boolean>;

// Server render and first client render use this so hydration matches; the URL
// is applied in an effect afterward.
const DEFAULT_ACTIVE: ActiveState = { site: true, hikaru: false, muramasa: false, ichijou: false };

function makeActive(on: ChangelogProduct[]): ActiveState {
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
  if (raw === 'all') return makeActive(ALL_PRODUCTS);
  if (raw === 'none') return makeActive([]);
  const valid = raw.split(',').map((t) => t.trim()).filter((t): t is ChangelogProduct => (ALL_PRODUCTS as string[]).includes(t));
  if (valid.length === 0) return null;
  return makeActive(valid);
}

// Inverse of parseShow. Returns null for the default set (clean URL, no param).
function serializeShow(active: ActiveState): string | null {
  const on = ALL_PRODUCTS.filter((p) => active[p]);
  if (on.length === 1 && on[0] === 'site') return null;
  if (on.length === 0) return 'none';
  if (on.length === ALL_PRODUCTS.length) return 'all';
  return on.join(',');
}

// All entries render to the DOM regardless of filter (good for SEO and search);
// inactive products are hidden with CSS so toggling never drops content.
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
  const toggle = (product: ChangelogProduct) => {
    const next = { ...active, [product]: !active[product] };
    const show = serializeShow(next);
    window.history.replaceState(null, '', show ? `${window.location.pathname}?show=${show}` : window.location.pathname);
    setActive(next);
  };

  const anyVisible = changelogEntries.some((entry) => active[entry.product]);

  return (
    <>
      <div className="flex flex-wrap gap-x-5 gap-y-2 text-sm">
        {ALL_PRODUCTS.map((product) => (
          <span key={product} className="inline-flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => toggle(product)}
              aria-pressed={active[product]}
              title={active[product] ? 'Click to hide these updates' : 'Click to show these updates'}
              className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium transition-opacity cursor-pointer ${PRODUCT_META[product].chip} ${active[product] ? '' : 'opacity-40 grayscale'}`}
            >
              {PRODUCT_META[product].label}
            </button>
            <span className="text-gray-500 dark:text-gray-400">{PRODUCT_META[product].blurb}</span>
          </span>
        ))}
      </div>

      {!anyVisible && (
        <p className="mt-10 text-sm text-gray-500 dark:text-gray-400">
          No updates to show. Toggle a category above.
        </p>
      )}

      {ALL_GROUPS.map((group) => {
        const visibleInGroup = group.entries.some((entry) => active[entry.product]);
        return (
          <section key={group.key} className={visibleInGroup ? undefined : 'hidden'}>
            <h2 className="mt-10 mb-4 text-lg font-semibold text-gray-900 dark:text-gray-100 border-b border-gray-200 dark:border-gray-800 pb-2">
              {monthLabel(group.key)}
            </h2>
            <ul className="space-y-5">
              {group.entries.map((entry) => (
                <li key={`${entry.date}-${entry.title}`} className={active[entry.product] ? undefined : 'hidden'}>
                  <div className="flex flex-wrap items-baseline gap-2">
                    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${PRODUCT_META[entry.product].chip}`}>
                      {PRODUCT_META[entry.product].label}
                    </span>
                    <h3 className="font-semibold text-gray-900 dark:text-gray-100">{entry.title}</h3>
                    <time dateTime={entry.date} className="ml-auto text-sm text-gray-500 dark:text-gray-400">
                      {dayLabel(entry.date)}
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
