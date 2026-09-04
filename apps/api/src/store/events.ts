import type { CalendarEvent } from '@dashboard/shared';
import { whoFromDescription, whoFromTitle } from '@dashboard/shared';
import { db, toBool } from '../db/index.js';
import { calendarPeopleMap } from './calendars.js';
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
  read_only: number;
  recurring_event_id: string | null;
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
      `SELECT e.*, c.read_only
         FROM events e
         JOIN calendars c ON c.id = e.calendar_id
        WHERE c.enabled = 1
          AND e.start_utc < ?
          AND e.end_utc > ?
        ORDER BY e.start_utc`,
    )
    .all(shiftDays(to, 1), shiftDays(from, -1));

  // A calendar's people, fetched once rather than once per row — a calendar
  // assigned to a group resolves to more than one, which is who an event on
  // it belongs to when nothing on the event itself says otherwise.
  const calendarPeople = calendarPeopleMap();
  const people = listPeople();
  const hidden = new Set(people.filter((p) => !p.onCal).map((p) => p.id));
  const rank = new Map(people.map((p, i) => [p.id, i]));

  /**
   * Who an event belongs to, most specific first: a tag in its own
   * description, else a name in the title's leading words, else whoever the
   * calendar itself is assigned to. Nothing is stored — an edit made straight
   * in Google, to the text or by moving the event to another calendar, is the
   * answer the very next time this runs.
   */
  const attributedTo = (r: EventRow): string[] => {
    const tagged = whoFromDescription(r.description, people);
    if (tagged.length) return tagged;
    const titled = whoFromTitle(r.title, people);
    if (titled.length) return titled;
    return calendarPeople.get(r.calendar_id) ?? [];
  };

  const events: CalendarEvent[] = rows
    .map((r): CalendarEvent | null => {
      const attributed = attributedTo(r);
      // Someone turned off their calendar loses events that were only ever
      // attributed to people like them; nobody attributed at all (an
      // unassigned calendar, no tag, no name in the title) is untouched by
      // this and stays visible with no one going.
      if (attributed.length > 0 && attributed.every((id) => hidden.has(id))) return null;
      // Faces read in the household's own order, not the order attribution
      // happened to produce them in.
      const attending = attributed
        .filter((id) => !hidden.has(id))
        .sort((a, b) => (rank.get(a) ?? Number.MAX_SAFE_INTEGER) - (rank.get(b) ?? Number.MAX_SAFE_INTEGER));

      return {
        id: r.id,
        calendarId: r.calendar_id,
        personId: attending[0] ?? null,
        personIds: attending,
        title: r.title,
        location: r.location,
        description: r.description,
        start: r.start_utc,
        end: r.end_utc,
        allDay: toBool(r.all_day),
        readOnly: toBool(r.read_only),
        seriesId: r.recurring_event_id,
        synthetic: false,
      };
    })
    .filter((e): e is CalendarEvent => e !== null);

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
