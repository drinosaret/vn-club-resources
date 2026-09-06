import Link from 'next/link';
import type { VNCharacter, VNCredits } from '@/lib/vndb-stats-api';
import { EntityName } from '@/components/EntityName';

// Role codes as the dump carries them, in the order they are credited, with the label
// each one is shown under. A role the dump adds later still renders, under its own code.
const ROLE_LABELS: Array<[string, string]> = [
  ['scenario', 'Scenario'],
  ['director', 'Director'],
  ['chardesign', 'Character design'],
  ['art', 'Art'],
  ['music', 'Music'],
  ['songs', 'Songs'],
  ['editor', 'Editor'],
  ['qa', 'QA'],
  ['staff', 'Other staff'],
  ['translator', 'Translation'],
];

// The cast list is a fixed part of the page rather than something a reader opts into, so
// it carries only characters the source marks as free of plot information.
const CAST_ROLES = new Set(['main', 'primary']);
const CAST_LIMIT = 12;

interface PersonName {
  name: string;
  original?: string | null;
}

/**
 * One person, in the script the reader chose.
 *
 * A name is shown once. Printing both scripts on every row doubled the length of each
 * line and made a long credit list wrap mid-name; the other script is on the person's
 * own page, and the site-wide switch is how a reader says which they want here.
 */
function PersonLink({ href, person }: { href: string; person: PersonName }) {
  return (
    <Link
      href={href}
      className="text-[color:var(--ai)] hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus)] rounded-xs"
    >
      <EntityName name={person.name} original={person.original} />
    </Link>
  );
}

/**
 * A run of names with a quiet mark between them. A list rather than joined text, so each
 * name is announced as its own item and the marks between them are not read out.
 */
function NameRun({ items }: { items: Array<{ key: string; href: string; person: PersonName }> }) {
  return (
    <ul className="inline">
      {items.map((item, index) => (
        <li key={item.key} className="inline-block">
          {index > 0 && <span className="text-[color:var(--nezu)] mx-1.5" aria-hidden>·</span>}
          <PersonLink href={item.href} person={item.person} />
        </li>
      ))}
    </ul>
  );
}

interface VNCreditsSectionProps {
  vnTitle: string;
  characters: VNCharacter[] | null;
  credits: VNCredits | null;
}

export function VNCreditsSection({ vnTitle, characters, credits }: VNCreditsSectionProps) {
  const cast = (characters || [])
    .filter((c) => CAST_ROLES.has(c.role) && c.spoiler === 0)
    .slice(0, CAST_LIMIT);

  const staff = credits?.staff || [];
  const seiyuu = credits?.seiyuu || [];

  if (cast.length === 0 && staff.length === 0) return null;

  // A voice actor is reached through the character they play, so the cast row is where
  // their link belongs.
  const seiyuuByCharacter = new Map<string, typeof seiyuu>();
  for (const person of seiyuu) {
    for (const character of person.characters) {
      const existing = seiyuuByCharacter.get(character.id);
      if (existing) existing.push(person);
      else seiyuuByCharacter.set(character.id, [person]);
    }
  }
  const anyVoiced = cast.some((character) => seiyuuByCharacter.has(character.id));

  const byRole = new Map<string, typeof staff>();
  for (const person of staff) {
    for (const role of person.roles) {
      // "staff" is the catch-all the source uses when no specific role applies, so a
      // person who also holds one is named under that instead of in both places.
      if (role === 'staff' && person.roles.length > 1) continue;
      const existing = byRole.get(role);
      if (existing) existing.push(person);
      else byRole.set(role, [person]);
    }
  }
  const knownRoles = ROLE_LABELS.filter(([role]) => byRole.has(role));
  const labelled = new Set(ROLE_LABELS.map(([role]) => role));
  const extraRoles: Array<[string, string]> = [...byRole.keys()]
    .filter((role) => !labelled.has(role))
    .map((role) => [role, role]);
  const roleGroups = [...knownRoles, ...extraRoles];

  // The tab panel this renders into supplies the page container and its bottom padding, so the
  // section carries only its own offset from the tab strip.
  return (
    <section
      aria-labelledby="vn-credits-heading"
      className="mt-2"
    >
      <div className="vn-sec p-4 sm:p-5">
        <h2 id="vn-credits-heading" className="vn-sec-title">
          Cast and credits
        </h2>
        <p className="mt-1 text-sm text-[color:var(--nezu)]">
          The people behind {vnTitle}, each linking to what else they have worked on.
        </p>

        <div className="mt-5 grid grid-cols-1 lg:grid-cols-2 gap-x-10 gap-y-8">
          {cast.length > 0 && (
            <div>
              {/* Two aligned columns rather than a sentence per character: a row is read
                  across, and a character with two voices no longer wraps into the next. */}
              <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)] gap-x-4 border-b border-[color:var(--rule)] pb-1.5">
                <h3 className="fig-label">Main cast</h3>
                {anyVoiced && <span className="fig-label">Voiced by</span>}
              </div>
              <ul className="mt-1 text-sm">
                {cast.map((character) => {
                  const voices = seiyuuByCharacter.get(character.id) || [];
                  return (
                    <li
                      key={character.id}
                      className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)] gap-x-4 py-1.5 border-b border-[color:var(--border-subtle)] last:border-b-0 text-[color:var(--text-secondary)]"
                    >
                      <span className="min-w-0">
                        <PersonLink href={`/character/${character.id}/`} person={character} />
                      </span>
                      <span className="min-w-0">
                        {voices.length > 0 ? (
                          <NameRun
                            items={voices.map((person) => ({
                              key: person.id,
                              href: `/stats/seiyuu/${person.id}/`,
                              person,
                            }))}
                          />
                        ) : (
                          <span className="text-[color:var(--text-faint)]">Unvoiced</span>
                        )}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          {roleGroups.length > 0 && (
            <div>
              <div className="border-b border-[color:var(--rule)] pb-1.5">
                <h3 className="fig-label">Staff</h3>
              </div>
              {/* Each role is one row, the names running on as a marked list. A role with
                  a dozen names wraps into a block that still reads as one credit. The label
                  track is fixed only from the width where it stops taking half the row; below
                  that the label sits above the names and they get the full column. */}
              <dl className="mt-1 text-sm">
                {roleGroups.map(([role, label]) => (
                  <div
                    key={role}
                    className="grid grid-cols-1 sm:grid-cols-[8.5rem_minmax(0,1fr)] gap-x-4 py-1.5 border-b border-[color:var(--border-subtle)] last:border-b-0"
                  >
                    <dt className="text-[color:var(--nezu)]">{label}</dt>
                    <dd className="min-w-0 text-[color:var(--text-secondary)]">
                      <NameRun
                        items={(byRole.get(role) || []).map((person) => ({
                          key: person.id,
                          href: `/stats/staff/${person.id}/`,
                          person,
                        }))}
                      />
                    </dd>
                  </div>
                ))}
              </dl>
              {credits && credits.staff_total > staff.length && (
                <p className="vn-num mt-2 text-xs text-[color:var(--text-faint)]">
                  {staff.length} of {credits.staff_total} credited people.
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

export default VNCreditsSection;
