import { db, fromBool } from './index.js';

/**
 * First-boot data. Names and colors come from the approved design so the wall
 * panel looks right immediately; everything here is editable in Settings.
 */
// Birthdays the design prototype carried were placeholders; the kids' real
// dates are below. Robin's and John's are left blank rather than guessed —
// add them in Settings › Family.
const PEOPLE: Array<[string, string, number, 'kid' | 'parent' | 'shared', string | null, number | null, boolean]> = [
  ['parent1', 'Robin', 350, 'parent', null, null, true],
  ['parent2', 'Alex', 258, 'parent', null, null, false],
  ['kid1', 'Maya', 196, 'kid', '4-12', 2015, true],
  ['kid2', 'Nora', 148, 'kid', '9-3', 2018, true],
  ['kid3', 'Iris', 305, 'kid', '1-22', 2021, true],
  ['family', 'Family', -1, 'shared', null, null, false],
];

const CHORES: Array<[string, string, string]> = [
  ['parent1', 'Meal plan + order', 'Weekly'],
  ['parent1', 'Laundry — whites', 'Weekdays'],
  ['parent2', 'Trash & recycling', 'Weekly'],
  ['parent2', 'Mow the yard', 'Weekends'],
  ['parent2', 'Dishwasher — night', 'Daily'],
  ['kid1', 'Feed Biscuit', 'Daily'],
  ['kid1', 'Set the table', 'Daily'],
  ['kid1', 'Clean your room', 'Weekends'],
  ['kid2', 'Water the plants', 'Weekdays'],
  ['kid2', 'Put away shoes', 'Daily'],
  ['kid2', 'Feed Biscuit — dinner', 'Daily'],
  ['kid3', 'Toys in the bin', 'Daily'],
  ['kid3', 'Books on the shelf', 'Daily'],
];

const EXTRAS: Array<[string, number]> = [
  ['Vacuum the stairs', 15],
  ['Fold + put away laundry', 20],
  ['Weed the flower bed', 25],
  ['Clean out the car', 30],
  ['Read 30 minutes', 10],
  ['Help cook dinner', 15],
  ['Wipe the baseboards', 20],
];

// Icons ship with the seed because migrations run before seeding — a backfill
// in a migration only reaches databases that already had rewards.
const REWARDS: Array<[string, number, string]> = [
  ['Ice cream trip', 40, '🍦'],
  ['Sticker book', 60, '📓'],
  ['Movie night pick', 80, '🎬'],
  ['Slime kit', 120, '🧪'],
  ['Roller skates', 200, '🛼'],
];

export function seedIfEmpty(): void {
  const count = db.prepare<[], { n: number }>('SELECT COUNT(*) AS n FROM people').get()?.n ?? 0;
  if (count > 0) return;

  db.transaction(() => {
    const person = db.prepare(
      `INSERT INTO people (id, name, hue, role, bday, byear, on_chores, on_cal, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)`,
    );
    PEOPLE.forEach(([id, name, hue, role, bday, byear, onChores], i) =>
      person.run(id, name, hue, role, bday, byear, fromBool(onChores), i),
    );

    const chore = db.prepare(
      'INSERT INTO chores (id, person_id, title, repeat, sort_order) VALUES (?, ?, ?, ?, ?)',
    );
    CHORES.forEach(([who, title, repeat], i) => chore.run(`ch${i}`, who, title, repeat, i));

    const extra = db.prepare('INSERT INTO extras (id, title, points) VALUES (?, ?, ?)');
    EXTRAS.forEach(([title, points], i) => extra.run(`xj${i}`, title, points));

    const reward = db.prepare('INSERT INTO rewards (id, label, cost, icon) VALUES (?, ?, ?, ?)');
    REWARDS.forEach(([label, cost, icon], i) => reward.run(`rw${i}`, label, cost, icon));
  })();
}
