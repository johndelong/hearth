#!/usr/bin/env node
/**
 * Fills a local database with calendar events to develop against.
 *
 * Connecting a real Google account to a laptop is awkward — the OAuth redirect
 * has to land on localhost, and test-user refresh tokens expire in a week — so
 * without this there is nothing on the calendar to look at and layout changes
 * have to be verified by reading the code. The events below are chosen to put
 * pressure on the day view: exact overlaps, partial ones, a three-deep pile, a
 * fifteen-minute sliver, a lone event with nothing beside it, and all-day rows
 * both single and spanning.
 *
 * Everything it writes is prefixed `dev_` and deleted on the next run, so it is
 * safe to run repeatedly and never touches rows that came from Google.
 *
 *   npm run seed:dev
 *
 * The fake account carries no usable refresh token, so the five-minute sync
 * loop will record a connection error against it in Settings › Calendar. That
 * is expected here and does not affect the seeded events.
 */

import { DatabaseSync } from 'node:sqlite';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dbPath = process.env.DATABASE_PATH ?? join(root, 'apps/api/data/dashboard.db');

const db = new DatabaseSync(dbPath);
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');

/** Local wall-clock time on a day offset from today, as an instant. */
const at = (dayOffset, hour, minute = 0) => {
  const d = new Date();
  d.setDate(d.getDate() + dayOffset);
  d.setHours(hour, minute, 0, 0);
  return d.toISOString();
};

/** A plain calendar date, the shape all-day events keep end to end. */
const on = (dayOffset) => {
  const d = new Date();
  d.setDate(d.getDate() + dayOffset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const people = db.prepare('SELECT id, name FROM people ORDER BY sort_order, name').all();
if (people.length === 0) {
  console.error('No people yet — add a few in Settings › People first, so events have someone to belong to.');
  process.exit(1);
}
const who = (i) => people[i % people.length].id;

// [title, start, end, allDay, person index]
const EVENTS = [
  // Three-deep pile: the long one holds the leftmost lane, two exact overlaps stack beside it.
  ['Rae — piano recital', at(0, 9), at(0, 13), 0, 0],
  ['Test A', at(0, 9), at(0, 10), 0, 1],
  ['Test B', at(0, 9), at(0, 10), 0, 2],

  // Partial overlap: starts inside the first, ends after it.
  ['Dentist', at(0, 10, 30), at(0, 11, 30), 0, 3],
  ['Overlaps the dentist', at(0, 11), at(0, 12), 0, 4],

  // A sliver, to check the minimum block height stays readable.
  ['Quick call', at(0, 12, 15), at(0, 12, 30), 0, 1],

  // Alone in its hours — this is the one that shows how wide a lone block gets.
  ['Solo afternoon block', at(0, 14), at(0, 15), 0, 0],

  // The long evening event that started all this, with something across it.
  ['Church youth night', at(0, 17), at(0, 23), 0, 2],
  ['Dinner with Amanda', at(0, 17, 30), at(0, 19), 0, 3],

  // All-day, single and spanning.
  ['Shopping with Everly', on(0), on(1), 1, 1],
  ['Camping trip', on(1), on(4), 1, 0],

  // Neighbouring days, so week and month views have something in them.
  ['Volleyball practice', at(1, 19, 15), at(1, 20, 45), 0, 2],
  ['First day of school', at(2, 9), at(2, 10), 0, 1],
  ['Blood work', at(-1, 8, 30), at(-1, 9), 0, 3],
];

db.exec('BEGIN');
try {
  // Clear the previous run. Events go with the calendars by cascade.
  db.prepare("DELETE FROM google_accounts WHERE id LIKE 'dev_%'").run();

  db.prepare(
    `INSERT INTO google_accounts (id, email, refresh_token, connected_at)
     VALUES ('dev_account', 'dev@localhost', 'not-a-real-token', ?)`,
  ).run(new Date().toISOString());

  const addCalendar = db.prepare(
    `INSERT INTO calendars (id, account_id, google_calendar_id, summary, person_id, enabled, read_only, is_primary)
     VALUES (?, 'dev_account', ?, ?, ?, 1, 0, ?)`,
  );
  for (const [i, person] of people.entries()) {
    addCalendar.run(`dev_cal_${person.id}`, `dev-${person.id}@group.calendar.google.com`, person.name, person.id, i === 0 ? 1 : 0);
  }

  const addEvent = db.prepare(
    `INSERT INTO events (id, calendar_id, google_id, title, start_utc, end_utc, all_day, status, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'confirmed', ?)`,
  );
  EVENTS.forEach(([title, start, end, allDay, personIndex], i) => {
    addEvent.run(
      `dev_ev_${i}`,
      `dev_cal_${who(personIndex)}`,
      `dev-google-${i}`,
      title,
      start,
      end,
      allDay,
      new Date().toISOString(),
    );
  });

  db.exec('COMMIT');
} catch (err) {
  db.exec('ROLLBACK');
  throw err;
}

console.log(`Seeded ${EVENTS.length} events across ${people.length} calendars into ${dbPath}`);
console.log('Today has a three-deep overlap at 9am, a 15-minute sliver at 12:15, and 5pm–11pm in the evening.');
