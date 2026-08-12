import type { CalendarEvent } from '@dashboard/shared';
import { db, toBool } from '../db/index.js';
import { eventKey, peopleByEventKey } from './calendars.js';
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

  const hidden = new Set(listPeople().filter((p) => !p.onCal).map((p) => p.id));

  // Tags are keyed per calendar, so they are read one calendar at a time.
  const tagsByCalendar = new Map<string, Map<string, string[]>>();
  for (const calendarRowId of new Set(rows.map((r) => r.calendar_id))) {
    const keys = rows.filter((r) => r.calendar_id === calendarRowId).map(eventRowKey);
    tagsByCalendar.set(calendarRowId, peopleByEventKey(calendarRowId, keys));
  }

  const events: CalendarEvent[] = rows
    .filter((r) => !(r.person_id && hidden.has(r.person_id)))
    .map((r) => ({
      id: r.id,
      calendarId: r.calendar_id,
      personId: r.person_id,
      // Whoever was tagged; failing that, whoever the calendar belongs to. A
      // hidden person is dropped here too, so turning someone off the calendar
      // takes their face off a shared event as well as their own.
      personIds: (tagsByCalendar.get(r.calendar_id)?.get(eventRowKey(r)) ?? (r.person_id ? [r.person_id] : []))
        .filter((personId) => !hidden.has(personId)),
      title: r.title,
      location: r.location,
      description: r.description,
      start: r.start_utc,
      end: r.end_utc,
      allDay: toBool(r.all_day),
      readOnly: toBool(r.read_only),
      synthetic: false,
    }));

  if (getSettings().birthdaysOnCal) events.push(...birthdayEvents(from, to));

  return events.sort((a, b) => a.start.localeCompare(b.start));
}

const eventRowKey = (r: EventRow): string =>
  eventKey({ googleId: r.google_id, recurringEventId: r.recurring_event_id });

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
        synthetic: true,
      });
    }
  }
  return out;
}
