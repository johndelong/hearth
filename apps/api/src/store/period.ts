import { type ChoreReset, type Recurrence, dueOn, dueWithin } from '@dashboard/shared';

/** Local `YYYY-MM-DD` for a date, using the server's configured TZ. */
export function localDate(d = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * The key a chore's completion is filed under. When this value changes, every
 * board appears empty again — that is the whole reset mechanism, and it means
 * no scheduled job is needed and a reboot can never miss one.
 */
export function periodKey(reset: ChoreReset, d = new Date()): string {
  if (reset === 'Every night') return localDate(d);
  const anchor = reset === 'Monday' ? 1 : 0;
  const start = new Date(d);
  start.setHours(0, 0, 0, 0);
  const diff = (start.getDay() - anchor + 7) % 7;
  start.setDate(start.getDate() - diff);
  return `w:${localDate(start)}`;
}

/**
 * The day after a period ends, as `YYYY-MM-DD` — an exclusive upper bound.
 *
 * Anchored to the period's own start, so a weekly board asked about a Wednesday
 * ends the following Sunday rather than the Wednesday after.
 */
export function periodEnd(reset: ChoreReset, d = new Date()): string {
  const key = periodKey(reset, d);
  const start = new Date(`${key.startsWith('w:') ? key.slice(2) : key}T00:00:00`);
  start.setDate(start.getDate() + (reset === 'Every night' ? 1 : 7));
  return localDate(start);
}

/** Steps a date back by one board period. */
export function previousPeriod(reset: ChoreReset, d: Date): Date {
  const prev = new Date(d);
  prev.setDate(prev.getDate() - (reset === 'Every night' ? 1 : 7));
  return prev;
}

/** How many days ahead a chore may be checked off. */
export const MAX_DAYS_AHEAD = 7;

/** Whole days from today to `on`. Negative for the past, 0 for today. */
export function daysAhead(on: Date, from = new Date()): number {
  const a = new Date(from);
  const b = new Date(on);
  a.setHours(0, 0, 0, 0);
  b.setHours(0, 0, 0, 0);
  return Math.round((b.getTime() - a.getTime()) / 86400000);
}

/** Whether a chore with this recurrence rule belongs on a given board. */
export function isDue(rec: Recurrence, reset: ChoreReset, d = new Date()): boolean {
  if (reset === 'Every night') return dueOn(rec, d);
  // A weekly board shows everything assigned for that week at once, so a chore
  // earns its place by landing on any day in the period — not on the day the
  // board happens to be looked at.
  const start = new Date(`${periodKey(reset, d).slice(2)}T00:00:00`);
  return dueWithin(rec, start, 7);
}
