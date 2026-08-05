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
}

/**
 * Cached events overlapping [from, to), from enabled calendars whose mapped
 * person is shown on the calendar. Birthdays are layered on top when enabled.
 */
export function listEvents(from: string, to: string): CalendarEvent[] {
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
    .all(to, from);

  const hidden = new Set(listPeople().filter((p) => !p.onCal).map((p) => p.id));

  const events: CalendarEvent[] = rows
    .filter((r) => !(r.person_id && hidden.has(r.person_id)))
    .map((r) => ({
      id: r.id,
      calendarId: r.calendar_id,
      personId: r.person_id,
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

/**
 * Family birthdays as all-day events. They live only in this response — there
 * is no Google event behind them, hence `synthetic`.
 */
function birthdayEvents(from: string, to: string): CalendarEvent[] {
  const start = new Date(from);
  const end = new Date(to);
  const out: CalendarEvent[] = [];

  for (const person of listPeople()) {
    if (!person.bday || !person.onCal) continue;
    const match = /^(\d{1,2})-(\d{1,2})$/.exec(person.bday);
    if (!match) continue;
    const month = Number(match[1]);
    const day = Number(match[2]);

    // The window can straddle a year boundary, so check each year it touches.
    for (let year = start.getFullYear(); year <= end.getFullYear(); year++) {
      const date = new Date(year, month - 1, day);
      if (date < start || date >= end) continue;
      const next = new Date(date);
      next.setDate(next.getDate() + 1);
      const age = person.byear ? year - person.byear : null;
      out.push({
        id: `bday_${person.id}_${year}`,
        calendarId: 'birthdays',
        personId: person.id,
        title: age !== null ? `${person.name} turns ${age}` : `${person.name}'s birthday`,
        location: null,
        description: null,
        start: date.toISOString(),
        end: next.toISOString(),
        allDay: true,
        readOnly: true,
        synthetic: true,
      });
    }
  }
  return out;
}
