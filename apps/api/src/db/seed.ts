import { getRaw, setRaw } from '../store/settings.js';
import { db } from './index.js';

/**
 * First-boot content.
 *
 * Deliberately impersonal: no people and no chores, because those are specific
 * to a household and belong to whoever installs this — add them in Settings.
 * What is seeded is the generic starting material that saves everyone the same
 * typing: a handful of extra jobs and a reward catalog.
 */

const EXTRAS: Array<[string, number]> = [
  ['Vacuum the stairs', 15],
  ['Fold and put away laundry', 20],
  ['Weed the flower bed', 25],
  ['Clean out the car', 30],
  ['Read for 30 minutes', 10],
  ['Help cook dinner', 15],
  ['Wipe the baseboards', 20],
];

const REWARDS: Array<[string, number, string]> = [
  ['Ice cream trip', 40, '🍦'],
  ['Sticker book', 60, '📓'],
  ['Movie night pick', 80, '🎬'],
  ['Slime kit', 120, '🧪'],
  ['Roller skates', 200, '🛼'],
];

/**
 * Runs once, tracked by a marker rather than by "is the people table empty".
 * Counting people would re-seed on every boot now that none are created — and
 * would resurrect extras and rewards somebody had deliberately deleted.
 */
export function seedIfEmpty(): void {
  if (getRaw('_seeded')) return;

  db.transaction(() => {
    // OR IGNORE, because a database seeded before the marker existed still
    // holds these rows: without it, every boot after the upgrade dies on a
    // UNIQUE violation before the server ever listens.
    const extra = db.prepare('INSERT OR IGNORE INTO extras (id, title, points) VALUES (?, ?, ?)');
    EXTRAS.forEach(([title, points], i) => extra.run(`xj${i}`, title, points));

    const reward = db.prepare(
      'INSERT OR IGNORE INTO rewards (id, label, cost, icon) VALUES (?, ?, ?, ?)',
    );
    REWARDS.forEach(([label, cost, icon], i) => reward.run(`rw${i}`, label, cost, icon));

    // Inside the transaction: a marker written separately can be lost to a
    // crash in between, which is exactly how the seed came to run twice.
    setRaw('_seeded', new Date().toISOString());
  })();
}
