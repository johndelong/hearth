import type { ChoreReset, Repeat, Streak } from '@dashboard/shared';
import { db, id, toBool } from '../db/index.js';
import { isDue, localDate, periodEnd, periodKey, previousPeriod } from './period.js';
import { getSettings } from './settings.js';

/**
 * Streaks are derived from completion history, never stored.
 *
 * A stored counter would need a nightly job to tick it, and a dashboard that
 * spends the night asleep would miss it. Walking the history backwards is
 * cheap at this scale and is always right, including after a chore is added,
 * reassigned, or deleted.
 *
 * The rules, as settled with the household:
 *   - A period counts when every required chore assigned to that person was
 *     completed in it. Extra jobs are optional and never part of it.
 *   - A period with nothing required is skipped: it neither grows nor breaks
 *     the streak. Nothing to do cannot be failed.
 *   - A paused period is skipped the same way.
 *   - Today is never a failure until it is over — an unfinished board simply
 *     doesn't count yet.
 */

/** How far back to walk before giving up. Two years of daily periods. */
const MAX_LOOKBACK = 730;

interface PauseRow {
  started_on: string;
  ended_on: string | null;
}

function pausesFor(personId: string): PauseRow[] {
  return db
    .prepare<[string], PauseRow>(
      'SELECT started_on, ended_on FROM streak_pauses WHERE person_id = ? ORDER BY started_on DESC',
    )
    .all(personId);
}

/** Whether a pause covers any part of the period beginning on `start`. */
function pausedDuring(pauses: PauseRow[], start: string, end: string): boolean {
  return pauses.some((p) => p.started_on < end && (p.ended_on === null || p.ended_on >= start));
}

export function isPaused(personId: string): boolean {
  const row = db
    .prepare<[string], { n: number }>(
      'SELECT COUNT(*) AS n FROM streak_pauses WHERE person_id = ? AND ended_on IS NULL',
    )
    .get(personId);
  return Boolean(row?.n);
}

export function pauseStreak(personId: string): void {
  if (isPaused(personId)) return;
  db.prepare('INSERT INTO streak_pauses (id, person_id, started_on, ended_on) VALUES (?, ?, ?, NULL)').run(
    id('sp'),
    personId,
    localDate(),
  );
}

export function resumeStreak(personId: string): void {
  db.prepare('UPDATE streak_pauses SET ended_on = ? WHERE person_id = ? AND ended_on IS NULL').run(
    localDate(),
    personId,
  );
}

interface DueRow {
  repeat: Repeat;
  done: number;
}

/** Whether this person has any active chore at all, due today or not. */
function hasAnyChore(personId: string): boolean {
  const row = db
    .prepare<[string], { n: number }>(
      `SELECT COUNT(*) AS n
         FROM chore_people cp
         JOIN chores c ON c.id = cp.chore_id AND c.active = 1
        WHERE cp.person_id = ?`,
    )
    .get(personId);
  return Boolean(row?.n);
}

/**
 * The required chores assigned to one person in a period, and whether each was
 * completed. Extra jobs live in another table entirely, so they cannot leak in.
 */
function requiredIn(personId: string, period: string, reset: ChoreReset, on: Date): DueRow[] {
  return db
    .prepare<[string, string], DueRow>(
      `SELECT c.repeat, (cc.chore_id IS NOT NULL) AS done
         FROM chores c
         JOIN chore_people cp ON cp.chore_id = c.id AND cp.person_id = ?
         LEFT JOIN chore_completions cc
                ON cc.chore_id = c.id AND cc.person_id = cp.person_id AND cc.period = ?
        WHERE c.active = 1`,
    )
    .all(personId, period)
    .filter((r) => isDue(r.repeat, reset, on));
}

/**
 * Consecutive skipped periods before we stop walking. Someone with only Weekly
 * chores legitimately skips six periods at a time; a long silent run means the
 * history has simply run out.
 */
const MAX_SKIP_RUN = 30;

export function streakFor(personId: string): Streak {
  const { choreReset } = getSettings();
  const pauses = pausesFor(personId);
  const paused = pauses.some((p) => p.ended_on === null);

  // Nothing assigned means nothing to walk — and without this, a brand-new
  // person would skip their way through the entire lookback window.
  if (!hasAnyChore(personId)) return { personId, length: 0, paused, since: null };

  const today = periodKey(choreReset);
  let cursor = new Date();
  let length = 0;
  // Walking backwards, so the last period counted is the oldest one.
  let since: string | null = null;
  let skipRun = 0;

  for (let step = 0; step < MAX_LOOKBACK; step++) {
    const period = periodKey(choreReset, cursor);
    const start = period.startsWith('w:') ? period.slice(2) : period;
    const end = periodEnd(choreReset, cursor);

    let counted = false;
    const required = requiredIn(personId, period, choreReset, cursor);

    if (required.length > 0) {
      if (required.every((r) => toBool(r.done))) {
        // Completed counts even while paused. A pause protects a streak from
        // days that were missed; it should never erase a day that was done —
        // which is what pausing on an afternoon you'd already finished did.
        length++;
        since = start;
        counted = true;
      } else if (pausedDuring(pauses, start, end)) {
        // Paused and unfinished: skipped, so it neither grows nor breaks.
      } else if (period !== today) {
        break;
      }
      // Today unfinished is not a failure — it just hasn't counted yet.
    }

    skipRun = counted ? 0 : skipRun + 1;
    if (skipRun >= MAX_SKIP_RUN) break;

    cursor = previousPeriod(choreReset, cursor);
  }

  return { personId, length, paused, since };
}

/** Everyone's streak in one pass, for the board payload. */
export function listStreaks(personIds: string[]): Streak[] {
  return personIds.map(streakFor);
}
