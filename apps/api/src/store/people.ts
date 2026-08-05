import type { Person, PersonInput } from '@dashboard/shared';
import { db, fromBool, id, toBool } from '../db/index.js';

interface Row {
  id: string;
  name: string;
  hue: number;
  role: Person['role'];
  bday: string | null;
  byear: number | null;
  on_chores: number;
  on_cal: number;
  goal_reward_id: string | null;
  avatar_url: string | null;
  sort_order: number;
}

const toPerson = (r: Row): Person => ({
  id: r.id,
  name: r.name,
  hue: r.hue,
  role: r.role,
  bday: r.bday,
  byear: r.byear,
  onChores: toBool(r.on_chores),
  onCal: toBool(r.on_cal),
  goalRewardId: r.goal_reward_id,
  avatarUrl: r.avatar_url,
  sortOrder: r.sort_order,
});

const selectAll = db.prepare<[], Row>('SELECT * FROM people ORDER BY sort_order, name');
const selectOne = db.prepare<[string], Row>('SELECT * FROM people WHERE id = ?');

export function listPeople(): Person[] {
  return selectAll.all().map(toPerson);
}

export function getPerson(personId: string): Person | null {
  const row = selectOne.get(personId);
  return row ? toPerson(row) : null;
}

export function createPerson(input: PersonInput): Person {
  const personId = id('p');
  const maxOrder = db
    .prepare<[], { m: number | null }>('SELECT MAX(sort_order) AS m FROM people')
    .get()?.m;
  db.prepare(
    `INSERT INTO people (id, name, hue, role, bday, byear, on_chores, on_cal, goal_reward_id, avatar_url, sort_order)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    personId,
    input.name,
    input.hue ?? 258,
    input.role ?? 'kid',
    input.bday ?? null,
    input.byear ?? null,
    fromBool(input.onChores ?? true),
    fromBool(input.onCal ?? true),
    input.goalRewardId ?? null,
    input.avatarUrl ?? null,
    input.sortOrder ?? (maxOrder ?? 0) + 1,
  );
  return getPerson(personId)!;
}

const COLUMNS: Record<string, string> = {
  name: 'name',
  hue: 'hue',
  role: 'role',
  bday: 'bday',
  byear: 'byear',
  onChores: 'on_chores',
  onCal: 'on_cal',
  goalRewardId: 'goal_reward_id',
  avatarUrl: 'avatar_url',
  sortOrder: 'sort_order',
};
const BOOL_FIELDS = new Set(['onChores', 'onCal']);

export function updatePerson(personId: string, patch: Partial<PersonInput>): Person | null {
  const sets: string[] = [];
  const values: unknown[] = [];
  for (const [key, value] of Object.entries(patch)) {
    const column = COLUMNS[key];
    if (!column) continue;
    sets.push(`${column} = ?`);
    values.push(BOOL_FIELDS.has(key) ? fromBool(value) : (value ?? null));
  }
  if (sets.length) {
    db.prepare(`UPDATE people SET ${sets.join(', ')} WHERE id = ?`).run(...values, personId);
  }
  return getPerson(personId);
}

export function deletePerson(personId: string): void {
  db.prepare('DELETE FROM people WHERE id = ?').run(personId);
}
