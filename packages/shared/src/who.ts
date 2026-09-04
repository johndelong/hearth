/**
 * Who a plain-text calendar event is for, read out of its own title and
 * description rather than kept in a database — so an event stays honest
 * whether it was last touched in Hearth or in Google Calendar itself.
 *
 * Three tiers, most specific first:
 *  1. An explicit tag in the description — Hearth's own canonical `Who:`
 *     line, or a household member's best attempt at the same thing.
 *  2. A household member named in the first word(s) of the title.
 *  3. Whoever the calendar itself belongs to (resolved elsewhere, from the
 *     calendar's own person/group — this module only covers 1 and 2).
 *
 * A tier that resolves to nobody real (a typo, a coincidental bracket in an
 * unrelated note) is treated as absent rather than as "explicitly nobody",
 * so it falls through to the next tier instead of hiding the event's people.
 */

export interface NamedPerson {
  id: string;
  name: string;
}

/** The canonical line Hearth writes — always this form, however it reads one back. */
export function formatWhoTag(names: string[]): string {
  return `Who: ${names.join(', ')}`;
}

// Recognized labels for a tagged line. "For:" is deliberately not one of
// them — too generic a word to safely repurpose from an ordinary note.
const WHO_LABEL = /^\s*(?:who|kids|parents)\s*:\s*(.+)$/i;
const WHO_LINE = /^\s*(?:who|kids|parents)\s*:.*$|^\s*(?:\[[^\]]+\]\s*)+$/i;

function splitNames(text: string): string[] {
  return text
    .split(/,|&|\band\b/i)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * The names an event's description names, exactly as written — not yet
 * matched against the household. Null when nothing that looks like a tag
 * was found at all.
 */
export function extractWhoNames(description: string | null): string[] | null {
  if (!description) return null;
  for (const line of description.split(/\r?\n/)) {
    const m = WHO_LABEL.exec(line);
    if (m) return splitNames(m[1]!);
  }
  // No labeled line — fall back to bracket groups anywhere in the text, the
  // other style people reach for on their own: `[Everly, Gemma]` or
  // `[Everly][Gemma]` read the same way once each group is comma-split.
  const brackets = [...description.matchAll(/\[([^\]]+)\]/g)].map((m) => m[1]!);
  return brackets.length ? brackets.flatMap(splitNames) : null;
}

/** Case-insensitive, exact first-name match against the household roster. */
export function resolveNames(names: string[], people: readonly NamedPerson[]): string[] {
  const byName = new Map(people.map((p) => [p.name.trim().toLowerCase(), p.id]));
  const ids: string[] = [];
  for (const name of names) {
    const id = byName.get(name.trim().toLowerCase());
    if (id && !ids.includes(id)) ids.push(id);
  }
  return ids;
}

/**
 * Who an event's description explicitly says it is for, resolved to real
 * household members. Empty when there is no tag, or the tag names no one
 * Hearth recognizes — both read the same to the caller: nothing explicit
 * was said, so the next, less specific tier gets to answer instead.
 */
export function whoFromDescription(description: string | null, people: readonly NamedPerson[]): string[] {
  const names = extractWhoNames(description);
  return names ? resolveNames(names, people) : [];
}

/**
 * Who a title names, read only from its leading word(s) — "Everly's
 * Basketball Practice" matches, "Basketball Practice — Everly" does not.
 * A name buried mid-sentence is too easy to confuse with an ordinary word
 * that happens to share it ("Grace period ends today"); restricting the
 * match to where a name naturally introduces an event keeps the guess a
 * reasonable one instead of a coincidence.
 *
 * Stops at the first word that is not a household name and not a connector
 * joining two of them, so "Everly and Gemma's Playdate" matches both and
 * "Everly's Basketball Practice" matches just her.
 */
export function whoFromTitle(title: string, people: readonly NamedPerson[]): string[] {
  const byName = new Map(people.map((p) => [p.name.trim().toLowerCase(), p.id]));
  const words = title.trim().split(/\s+/);
  const ids: string[] = [];
  let expectingName = true;

  for (const word of words) {
    const bare = word.replace(/^[^\w]+|[^\w]+$/g, '').replace(/['’]s$/i, '');
    if (expectingName) {
      const id = byName.get(bare.toLowerCase());
      if (!id) break;
      if (!ids.includes(id)) ids.push(id);
      expectingName = false;
    } else if (/^(and|&)$/i.test(word.replace(/[^\w&]+$/g, ''))) {
      expectingName = true;
    } else {
      break;
    }
  }
  return ids;
}

/**
 * Writes (or clears) the canonical `Who:` line, replacing whatever tag —
 * Hearth's own or someone's best-effort version — was already there, so
 * saving again never piles up a second one.
 */
export function upsertWhoTag(description: string | null, names: string[]): string | null {
  const lines = (description ?? '').split(/\r?\n/).filter((line) => !WHO_LINE.test(line));
  const body = lines.join('\n').trim();
  if (!names.length) return body || null;
  const tag = formatWhoTag(names);
  return body ? `${body}\n\n${tag}` : tag;
}
