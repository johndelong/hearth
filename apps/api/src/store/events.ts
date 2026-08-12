import type { CalendarEvent } from '@dashboard/shared';
import { db, toBool } from '../db/index.js';
import { listPeople } from './people.js';
import { getSettings } from './settings.js';

interface EventRow {
  id: string;
  calendar_id: string;
  google_id: string;
  title: string;
  location: string | null;
  description: string | null;
  start_utc: string;
  end_utc: string;
  all_day: number;
  person_id: string | null;
  read_only: number;
  recurring_event_id: string | null;
  hearth_group: string | null;
}

/**
 * Cached events overlapping [from, to), from enabled calendars whose mapped
 * person is shown on the calendar. Birthdays are layered on top when enabled.
 */
export function listEvents(from: string, to: string): CalendarEvent[] {
  // All-day rows are stored as `YYYY-MM-DD` and timed ones as full instants, so
  // this string comparison is only accurate to the day. Widening it by a day at
  // each end keeps it a cheap prefilter that can never drop an event the client
  // would have shown; the exact overlap test happens there, in the viewer's own
  // timezone, which is the only place that can decide the question correctly.
  const rows = db
    .prepare<[string, string], EventRow>(
      `SELECT e.*, c.person_id, c.read_only
         FROM events e
         JOIN calendars c ON c.id = e.calendar_id
        WHERE c.enabled = 1
          AND e.start_utc < ?
          AND e.end_utc > ?
        ORDER BY e.start_utc`,
    )
    .all(shiftDays(to, 1), shiftDays(from, -1));

  const people = listPeople();
  const hidden = new Set(people.filter((p) => !p.onCal).map((p) => p.id));
  // Faces on a shared event read in the household's own order, not in whatever
  // order the copies happened to come back from SQLite.
  const rank = new Map(people.map((p, i) => [p.id, i]));

  /**
   * The copies of one fanned-out event, collapsed into the single event it
   * always was. Who is going is which calendars hold a copy — nothing is
   * stored, so moving a copy in Google moves the answer here too.
   *
   * The representative copy is the one whose person sorts first, deliberately
   * and not by accident of row order: it is the id every edit is aimed at, and
   * it has to be the same id from one render to the next.
   */
  const collapse = (copies: EventRow[]): CalendarEvent => {
    const ordered = [...copies].sort(
      (a, b) => personRank(a) - personRank(b) || a.google_id.localeCompare(b.google_id),
    );
    const primary = ordered[0]!;
    const attending = ordered
      .map((r) => r.person_id)
      .filter((id): id is string => Boolean(id) && !hidden.has(id!));

    return {
      id: primary.id,
      calendarId: primary.calendar_id,
      personId: primary.person_id,
      // An event on nobody's calendar has nobody going, and says so rather than
      // inventing an owner.
      personIds: [...new Set(attending)],
      title: primary.title,
      location: primary.location,
      description: primary.description,
      start: primary.start_utc,
      end: primary.end_utc,
      allDay: toBool(primary.all_day),
      readOnly: toBool(primary.read_only),
      seriesId: primary.recurring_event_id,
      synthetic: false,
    };
  };

  const personRank = (r: EventRow): number =>
    r.person_id ? (rank.get(r.person_id) ?? Number.MAX_SAFE_INTEGER) : Number.MAX_SAFE_INTEGER;

  // Someone turned off the calendar loses their copy outright, so a shared
  // event stays visible through everyone else and one nobody can see is gone.
  const visible = rows.filter((r) => !(r.person_id && hidden.has(r.person_id)));

  const grouped = new Map<string, EventRow[]>();
  for (const r of visible) {
    // Ungrouped rows are their own group, keyed on something no id can collide
    // with, so one code path builds every event.
    //
    // The start is part of the key because a group id names a shared event, not
    // a single occurrence of one: every expanded instance of a fanned-out series
    // carries the same group, and keying on it alone would pile a whole term of
    // swim practice into one row.
    const key = r.hearth_group ? `${r.hearth_group}@${r.start_utc}` : `row:${r.id}`;
    const bucket = grouped.get(key);
    if (bucket) bucket.push(r);
    else grouped.set(key, [r]);
  }

  const events: CalendarEvent[] = [...grouped.values()].map(collapse);

  if (getSettings().birthdaysOnCal) events.push(...birthdayEvents(from, to));

  return events.sort((a, b) => a.start.localeCompare(b.start));
}

/** Move an ISO instant by whole days, for the coarse window prefilter. */
function shiftDays(iso: string, days: number): string {
  const d = new Date(iso);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString();
}

/**
 * `YYYY-MM-DD` for a calendar date, built in UTC purely so the arithmetic is
 * free of local DST — no instant is implied, and none survives the slice.
 * Impossible dates roll over the way they always did: Feb 29 of a common year
 * becomes Mar 1.
 */
function isoDate(year: number, month: number, day: number): string {
  return new Date(Date.UTC(year, month - 1, day)).toISOString().slice(0, 10);
}

/**
 * Family birthdays as all-day events. They live only in this response — there
 * is no Google event behind them, hence `synthetic`.
 *
 * Like every other all-day event these are plain dates, so a birthday falls on
 * the same square of the calendar no matter where the server is running.
 */
function birthdayEvents(from: string, to: string): CalendarEvent[] {
  // Day-granular bounds, deliberately generous — the client re-filters exactly.
  const fromDate = shiftDays(from, -1).slice(0, 10);
  const toDate = shiftDays(to, 1).slice(0, 10);
  const out: CalendarEvent[] = [];

  for (const person of listPeople()) {
    if (!person.bday || !person.onCal) continue;
    const match = /^(\d{1,2})-(\d{1,2})$/.exec(person.bday);
    if (!match) continue;
    const month = Number(match[1]);
    const day = Number(match[2]);

    // The window can straddle a year boundary, so check each year it touches.
    const firstYear = Number(fromDate.slice(0, 4));
    const lastYear = Number(toDate.slice(0, 4));
    for (let year = firstYear; year <= lastYear; year++) {
      const date = isoDate(year, month, day);
      const next = isoDate(year, month, day + 1);
      if (date > toDate || next < fromDate) continue;
      const age = person.byear ? year - person.byear : null;
      out.push({
        id: `bday_${person.id}_${year}`,
        calendarId: 'birthdays',
        personId: person.id,
        personIds: [person.id],
        title: age !== null ? `${person.name} turns ${age}` : `${person.name}'s birthday`,
        location: null,
        description: null,
        start: date,
        end: next,
        allDay: true,
        readOnly: true,
        seriesId: null,
        synthetic: true,
      });
    }
  }
  return out;
}
