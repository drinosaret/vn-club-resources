import type { Locale } from "@/lib/i18n/types";
import { ns } from "@/lib/i18n/translations/news";
import { SECTIONS, fetchSources, type NewsSourceEntry } from "@/lib/news";

// The address the site's footer already publishes for anything about the site.
const CONTACT = "contact@vnclub.org";

const KIND_KEYS = {
  feed: "sources.kind.feed",
  site: "sources.kind.site",
  youtube: "sources.kind.youtube",
  bluesky: "sources.kind.bluesky",
  x: "sources.kind.x",
  board: "sources.kind.board",
  store: "sources.kind.store",
  api: "sources.kind.api",
} as const;

function kindLabel(locale: Locale, kind: string): string {
  const key = KIND_KEYS[kind as keyof typeof KIND_KEYS];
  return key ? ns(locale, key) : kind;
}

/**
 * Everything the page reads, behind one control at the foot of every news page. The list
 * comes from the aggregator's own registry, so it is the list of what is actually polled,
 * grouped by the tab its rows land in and named the way the rows' plates name it.
 */
export async function SourceList({ locale }: { locale: Locale }) {
  const sources = await fetchSources();
  if (sources.length === 0) return null;
  const groups = SECTIONS.map((section) => ({
    section,
    items: sources.filter((s) => s.section === section.slug),
  })).filter((g) => g.items.length > 0);

  return (
    <div className="nw-sources-foot">
      <p className="nw-sources-disclaimer">
        {ns(locale, "sources.disclaimer")}{" "}
        <a href={`mailto:${CONTACT}`}>{CONTACT}</a>.
      </p>
      <details className="nw-sources">
        <summary className="nw-sources-summary">
          <span className="nw-archive-label">
            {ns(locale, "sources.label")}
          </span>
          <span className="nw-sources-count">
            {ns(locale, "sources.count", { n: sources.length })}
          </span>
        </summary>
        <p className="nw-sources-note">{ns(locale, "sources.note")}</p>
        {groups.map(({ section, items }) => (
          <section key={section.slug} className="nw-sources-group">
            <h3 className="nw-sources-title">
              {ns(locale, `tab.${section.slug}` as "tab.headlines")}
              <span className="nw-sources-n">{items.length}</span>
            </h3>
            <ul className="nw-sources-list">
              {items.map((item: NewsSourceEntry) => (
                <li key={`${item.kind}:${item.name}`}>
                  <a
                    href={item.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="nw-sources-link"
                  >
                    {item.name}
                  </a>
                  <span className="nw-sources-kind">
                    {kindLabel(locale, item.kind)}
                  </span>
                  {item.lang && (
                    <span className="nw-sources-lang">
                      {item.lang === "ja" ? "日本語" : "English"}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </section>
        ))}
      </details>
    </div>
  );
}
