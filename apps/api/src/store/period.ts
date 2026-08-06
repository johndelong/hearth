import type { ChoreReset, Repeat } from '@dashboard/shared';

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

/** Whether a chore with this repeat rule belongs on today's board. */
export function isDue(repeat: Repeat, reset: ChoreReset, d = new Date()): boolean {
  // A weekly board shows everything assigned for that week at once.
  if (reset !== 'Every night') return true;
  const dow = d.getDay();
  switch (repeat) {
    case 'Daily':
      return true;
    case 'Weekdays':
      return dow >= 1 && dow <= 5;
    case 'Weekends':
      return dow === 0 || dow === 6;
    case 'Weekly':
      return dow === 0;
  }
}
