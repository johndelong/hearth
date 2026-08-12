/**
 * The bridge between Hearth's `Recurrence` and the iCalendar RRULE that Google
 * Calendar stores on a repeating event.
 *
 * Only the subset `Recurrence` can express is produced. Reading is deliberately
 * more forgiving than writing: an event authored in Google can carry parts we
 * have no control for (BYMONTH, BYSETPOS lists, COUNT), and the honest answer
 * there is "this is not a rule we can edit" rather than a rule that silently
 * drops half of what it said.
 */

import { type Freq, type Recurrence, fromYmd, normalizeRecurrence, toYmd } from './recurrence.js';

/** RRULE weekday codes, indexed the same way `byDay` is: 0 is Sunday. */
const DAY_CODES = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'] as const;

const FREQ_TO_RRULE: Record<Freq, string> = {
  daily: 'DAILY',
  weekly: 'WEEKLY',
  monthly: 'MONTHLY',
  yearly: 'YEARLY',
};

const RRULE_TO_FREQ: Record<string, Freq> = {
  DAILY: 'daily',
  WEEKLY: 'weekly',
  MONTHLY: 'monthly',
  YEARLY: 'yearly',
};

/**
 * The rule as Google's `recurrence` array wants it.
 *
 * `allDay` decides the shape of UNTIL, which RFC 5545 ties to the shape of
 * DTSTART: a date-valued start takes a bare date, a timed one takes a UTC
 * instant. Google rejects the mismatch, so this is not cosmetic.
 *
 * The UNTIL instant is the end of the local day, converted to UTC — "until
 * June 30th" has to include everything that happens on the 30th, and an event
 * at 7pm New York time on the 30th is already July 1st in UTC.
 */
export function toRRule(rec: Recurrence, allDay: boolean): string[] {
  const parts = [`FREQ=${FREQ_TO_RRULE[rec.freq]}`];
  if (rec.interval > 1) parts.push(`INTERVAL=${rec.interval}`);

  if (rec.freq === 'weekly' && rec.byDay.length) {
    parts.push(`BYDAY=${[...rec.byDay].sort((a, b) => a - b).map((d) => DAY_CODES[d]).join(',')}`);
  }

  if (rec.freq === 'monthly') {
    if (rec.byMonthDay !== null) parts.push(`BYMONTHDAY=${rec.byMonthDay}`);
    else if (rec.bySetPos !== null) parts.push(`BYDAY=${rec.bySetPos}${DAY_CODES[rec.byDay[0] ?? 0]}`);
  }

  if (rec.until) {
    const last = fromYmd(rec.until);
    if (allDay) {
      // A date-valued UNTIL is exclusive of nothing — it names the last day.
      parts.push(`UNTIL=${rec.until.replaceAll('-', '')}`);
    } else {
      last.setHours(23, 59, 59, 0);
      parts.push(`UNTIL=${last.toISOString().replaceAll(/[-:]/g, '').replace(/\.\d{3}/, '')}`);
    }
  }

  return [`RRULE:${parts.join(';')}`];
}

/**
 * Google's `recurrence` array, back into a rule the picker can show — or null
 * when it says something we cannot represent, so the caller can refuse to edit
 * it rather than rewrite it into something narrower.
 *
 * `startsOn` comes from the event's own start, since RRULE has no start of its
 * own: DTSTART carries it, and that is the event.
 */
export function fromRRule(recurrence: string[] | null | undefined, startsOn: string): Recurrence | null {
  const line = recurrence?.find((r) => r.toUpperCase().startsWith('RRULE:'));
  if (!line) return null;

  const parts = new Map<string, string>();
  for (const chunk of line.slice(line.indexOf(':') + 1).split(';')) {
    const [key, value] = chunk.split('=');
    if (key && value) parts.set(key.toUpperCase(), value);
  }

  const freq = RRULE_TO_FREQ[(parts.get('FREQ') ?? '').toUpperCase()];
  if (!freq) return null;
  // A count-limited series has no end date to show, and rewriting it as one
  // would move the end. Better to say we cannot edit it.
  if (parts.has('COUNT')) return null;
  // Anything narrowing which months or which occurrences is beyond the picker.
  if (parts.has('BYMONTH') || parts.has('BYSETPOS') || parts.has('BYYEARDAY') || parts.has('BYWEEKNO')) {
    return null;
  }

  const byDayRaw = parts.get('BYDAY');
  let byDay: number[] = [];
  let bySetPos: number | null = null;

  if (byDayRaw) {
    const entries = byDayRaw.split(',');
    // "3MO" — the monthly "on the third Monday" form. Only meaningful alone.
    const ordinal = /^(-?\d)([A-Z]{2})$/.exec(entries[0] ?? '');
    if (ordinal && entries.length === 1) {
      const index = DAY_CODES.indexOf(ordinal[2] as (typeof DAY_CODES)[number]);
      if (index < 0) return null;
      bySetPos = Number(ordinal[1]);
      byDay = [index];
    } else {
      for (const entry of entries) {
        const index = DAY_CODES.indexOf(entry as (typeof DAY_CODES)[number]);
        if (index < 0) return null;
        byDay.push(index);
      }
    }
  }

  const byMonthDayRaw = parts.get('BYMONTHDAY');
  if (byMonthDayRaw && byMonthDayRaw.includes(',')) return null;

  return normalizeRecurrence({
    freq,
    interval: Number(parts.get('INTERVAL') ?? 1),
    byDay,
    byMonthDay: byMonthDayRaw ? Number(byMonthDayRaw) : null,
    bySetPos,
    startsOn,
    until: untilToYmd(parts.get('UNTIL')),
  });
}

/**
 * UNTIL back to a local `YYYY-MM-DD`. A UTC instant is converted to the local
 * day it falls on, which is the inverse of how `toRRule` built it.
 */
function untilToYmd(raw: string | undefined): string | null {
  if (!raw) return null;
  const date = /^(\d{4})(\d{2})(\d{2})$/.exec(raw);
  if (date) return `${date[1]}-${date[2]}-${date[3]}`;

  const stamp = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(raw);
  if (!stamp) return null;
  const [, y, m, d, hh, mm, ss] = stamp;
  return toYmd(new Date(Date.UTC(+y!, +m! - 1, +d!, +hh!, +mm!, +ss!)));
}
