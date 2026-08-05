import type {
  BoardChore,
  Chore,
  ChoreInput,
  Claim,
  Extra,
  ExtraInput,
  PointsBalance,
  Redemption,
  Reward,
  RewardInput,
} from '@dashboard/shared';
import { db, fromBool, id, nowIso, toBool } from '../db/index.js';
import { getSettings } from './settings.js';
import { isDue, periodKey } from './period.js';

// ---------- chores ----------

interface ChoreRow {
  id: string;
  title: string;
  description: string | null;
  instructions: string | null;
  repeat: Chore['repeat'];
  active: number;
  sort_order: number;
}

/** Assignees for a set of chores, in one query rather than one per chore. */
function peopleByChore(choreIds: string[]): Map<string, string[]> {
  const byChore = new Map<string, string[]>();
  if (choreIds.length === 0) return byChore;
  const holes = choreIds.map(() => '?').join(', ');
  const rows = db
    .prepare<string[], { chore_id: string; person_id: string }>(
      `SELECT cp.chore_id, cp.person_id
         FROM chore_people cp
         JOIN people p ON p.id = cp.person_id
        WHERE cp.chore_id IN (${holes})
        ORDER BY p.sort_order`,
    )
    .all(...choreIds);
  for (const r of rows) {
    const list = byChore.get(r.chore_id);
    if (list) list.push(r.person_id);
    else byChore.set(r.chore_id, [r.person_id]);
  }
  return byChore;
}

const toChore = (r: ChoreRow, personIds: string[]): Chore => ({
  id: r.id,
  personIds,
  title: r.title,
  description: r.description,
  instructions: r.instructions,
  repeat: r.repeat,
  active: toBool(r.active),
  sortOrder: r.sort_order,
});

/**
 * Today's boards, one row per person per chore.
 *
 * A chore assigned to three kids becomes three rows here, each carrying its own
 * completion for the current period — so one kid checking off "Make the bed"
 * says nothing about the other two.
 */
export function listChores(): BoardChore[] {
  const { choreReset } = getSettings();
  const period = periodKey(choreReset);
  return db
    .prepare<
      [string],
      ChoreRow & { person_id: string; done: number }
    >(
      `SELECT c.*, cp.person_id, (cc.chore_id IS NOT NULL) AS done
         FROM chores c
         JOIN chore_people cp ON cp.chore_id = c.id
         LEFT JOIN chore_completions cc
                ON cc.chore_id = c.id AND cc.person_id = cp.person_id AND cc.period = ?
        WHERE c.active = 1
        ORDER BY c.sort_order, c.title`,
    )
    .all(period)
    .filter((r) => isDue(r.repeat, choreReset))
    .map((r) => ({
      choreId: r.id,
      personId: r.person_id,
      title: r.title,
      description: r.description,
      instructions: r.instructions,
      repeat: r.repeat,
      sortOrder: r.sort_order,
      done: toBool(r.done),
    }));
}

/**
 * Every chore on the books, due today or not.
 *
 * The board deliberately hides a Weekly chore on the six days it isn't due, but
 * the parent managing the list has to see the whole thing — otherwise a chore
 * becomes uneditable on every day it doesn't happen to fall.
 */
export function listAllChores(): Chore[] {
  const rows = db
    .prepare<[], ChoreRow>('SELECT * FROM chores WHERE active = 1 ORDER BY sort_order, title')
    .all();
  const assignees = peopleByChore(rows.map((r) => r.id));
  return rows.map((r) => toChore(r, assignees.get(r.id) ?? []));
}

/** Replaces a chore's assignees wholesale. Callers always send the full set. */
function setChorePeople(choreId: string, personIds: string[]): void {
  db.prepare('DELETE FROM chore_people WHERE chore_id = ?').run(choreId);
  const link = db.prepare('INSERT OR IGNORE INTO chore_people (chore_id, person_id) VALUES (?, ?)');
  for (const personId of personIds) link.run(choreId, personId);
}

export const createChore = db.transaction((input: ChoreInput): Chore => {
  const choreId = id('ch');
  db.prepare(
    `INSERT INTO chores (id, title, description, instructions, repeat, active, sort_order)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    choreId,
    input.title,
    input.description ?? null,
    input.instructions ?? null,
    input.repeat ?? 'Daily',
    fromBool(input.active ?? true),
    input.sortOrder ?? 0,
  );
  setChorePeople(choreId, input.personIds);
  return findChore(choreId)!;
});

export const updateChore = db.transaction((choreId: string, patch: Partial<ChoreInput>): Chore | null => {
  const columns: Record<string, string> = {
    title: 'title',
    description: 'description',
    instructions: 'instructions',
    repeat: 'repeat',
    active: 'active',
    sortOrder: 'sort_order',
  };
  const sets: string[] = [];
  const values: unknown[] = [];
  for (const [key, value] of Object.entries(patch)) {
    const column = columns[key];
    if (!column) continue;
    sets.push(`${column} = ?`);
    values.push(key === 'active' ? fromBool(value) : value);
  }
  if (sets.length) {
    db.prepare(`UPDATE chores SET ${sets.join(', ')} WHERE id = ?`).run(...values, choreId);
  }
  if (patch.personIds) {
    setChorePeople(choreId, patch.personIds);
    // Dropping someone from a chore drops what they had done with it, so the
    // row cannot come back checked if they are added again next week.
    const holes = patch.personIds.map(() => '?').join(', ');
    db.prepare(
      `DELETE FROM chore_completions
        WHERE chore_id = ?${patch.personIds.length ? ` AND person_id NOT IN (${holes})` : ''}`,
    ).run(choreId, ...patch.personIds);
  }
  return findChore(choreId);
});

export function deleteChore(choreId: string): void {
  db.prepare('DELETE FROM chores WHERE id = ?').run(choreId);
}

function findChore(choreId: string): Chore | null {
  const r = db.prepare<[string], ChoreRow>('SELECT * FROM chores WHERE id = ?').get(choreId);
  if (!r) return null;
  return toChore(r, peopleByChore([choreId]).get(choreId) ?? []);
}

/**
 * Check one person's copy of a chore off, or undo it. Chores pay no points —
 * they are the baseline expectation, and only extra jobs earn.
 */
export function setChoreDone(choreId: string, personId: string, done: boolean): BoardChore | null {
  const assigned = db
    .prepare<[string, string], { n: number }>(
      'SELECT COUNT(*) AS n FROM chore_people WHERE chore_id = ? AND person_id = ?',
    )
    .get(choreId, personId);
  if (!assigned?.n) return null;

  const period = periodKey(getSettings().choreReset);
  if (done) {
    db.prepare(
      `INSERT OR IGNORE INTO chore_completions (chore_id, person_id, period, completed_at)
       VALUES (?, ?, ?, ?)`,
    ).run(choreId, personId, period, nowIso());
  } else {
    db.prepare(
      'DELETE FROM chore_completions WHERE chore_id = ? AND person_id = ? AND period = ?',
    ).run(choreId, personId, period);
  }

  const r = db.prepare<[string], ChoreRow>('SELECT * FROM chores WHERE id = ?').get(choreId);
  if (!r) return null;
  return {
    choreId: r.id,
    personId,
    title: r.title,
    description: r.description,
    instructions: r.instructions,
    repeat: r.repeat,
    sortOrder: r.sort_order,
    done,
  };
}

// ---------- extras and claims ----------

export function listExtras(): Extra[] {
  return db
    .prepare<
      [],
      {
        id: string;
        title: string;
        description: string | null;
        instructions: string | null;
        points: number;
        active: number;
      }
    >(
      'SELECT * FROM extras WHERE active = 1 ORDER BY points, title',
    )
    .all()
    .map((r) => ({
      id: r.id,
      title: r.title,
      description: r.description,
      instructions: r.instructions,
      points: r.points,
      active: toBool(r.active),
    }));
}

export function createExtra(input: ExtraInput): Extra {
  const extraId = id('xj');
  db.prepare(
    'INSERT INTO extras (id, title, description, instructions, points, active) VALUES (?, ?, ?, ?, ?, ?)',
  ).run(
    extraId,
    input.title,
    input.description ?? null,
    input.instructions ?? null,
    input.points ?? 10,
    fromBool(input.active ?? true),
  );
  return listExtras().find((e) => e.id === extraId)!;
}

export function updateExtra(extraId: string, patch: Partial<ExtraInput>): Extra | null {
  const sets: string[] = [];
  const values: unknown[] = [];
  if (patch.title !== undefined) (sets.push('title = ?'), values.push(patch.title));
  if (patch.description !== undefined) (sets.push('description = ?'), values.push(patch.description));
  if (patch.instructions !== undefined)
    (sets.push('instructions = ?'), values.push(patch.instructions));
  if (patch.points !== undefined) (sets.push('points = ?'), values.push(patch.points));
  if (patch.active !== undefined) (sets.push('active = ?'), values.push(fromBool(patch.active)));
  if (sets.length) db.prepare(`UPDATE extras SET ${sets.join(', ')} WHERE id = ?`).run(...values, extraId);
  return listExtras().find((e) => e.id === extraId) ?? null;
}

export function deleteExtra(extraId: string): void {
  db.prepare('DELETE FROM extras WHERE id = ?').run(extraId);
}

interface ClaimRow {
  id: string;
  extra_id: string;
  person_id: string;
  title: string;
  description: string | null;
  instructions: string | null;
  points: number;
  done: number;
  claimed_at: string;
  completed_at: string | null;
}

const toClaim = (r: ClaimRow): Claim => ({
  id: r.id,
  extraId: r.extra_id,
  personId: r.person_id,
  title: r.title,
  description: r.description,
  instructions: r.instructions,
  points: r.points,
  done: toBool(r.done),
  claimedAt: r.claimed_at,
  completedAt: r.completed_at,
});

/** Open claims, plus anything completed inside the current board period. */
export function listClaims(): Claim[] {
  const period = periodKey(getSettings().choreReset);
  const since = period.startsWith('w:') ? period.slice(2) : period;
  return db
    .prepare<[string], ClaimRow>(
      'SELECT * FROM claims WHERE done = 0 OR completed_at >= ? ORDER BY claimed_at',
    )
    .all(since)
    .map(toClaim);
}

export function createClaim(extraId: string, personId: string): Claim | null {
  const extra = db
    .prepare<
      [string],
      { id: string; title: string; description: string | null; instructions: string | null; points: number }
    >('SELECT * FROM extras WHERE id = ?')
    .get(extraId);
  if (!extra) return null;
  const claimId = id('cl');
  db.prepare(
    `INSERT INTO claims (id, extra_id, person_id, title, description, instructions, points, done, claimed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)`,
  ).run(
    claimId,
    extraId,
    personId,
    extra.title,
    extra.description,
    extra.instructions,
    extra.points,
    nowIso(),
  );
  return listClaims().find((c) => c.id === claimId)!;
}

export const setClaimDone = db.transaction((claimId: string, done: boolean): Claim | null => {
  const row = db.prepare<[string], ClaimRow>('SELECT * FROM claims WHERE id = ?').get(claimId);
  if (!row) return null;
  const claim = toClaim(row);
  if (done) {
    db.prepare('UPDATE claims SET done = 1, completed_at = ? WHERE id = ?').run(nowIso(), claimId);
    db.prepare(
      `INSERT OR IGNORE INTO point_events (id, person_id, delta, reason, ref_type, ref_id, created_at)
       VALUES (?, ?, ?, ?, 'claim', ?, ?)`,
    ).run(id('pt'), claim.personId, claim.points, claim.title, claimId, nowIso());
  } else {
    db.prepare('UPDATE claims SET done = 0, completed_at = NULL WHERE id = ?').run(claimId);
    db.prepare("DELETE FROM point_events WHERE ref_type = 'claim' AND ref_id = ?").run(claimId);
  }
  return { ...claim, done };
});

export function deleteClaim(claimId: string): void {
  db.transaction(() => {
    db.prepare("DELETE FROM point_events WHERE ref_type = 'claim' AND ref_id = ?").run(claimId);
    db.prepare('DELETE FROM claims WHERE id = ?').run(claimId);
  })();
}

// ---------- rewards, redemptions, points ----------

export function listRewards(): Reward[] {
  return db
    .prepare<[], { id: string; label: string; cost: number; active: number; image_url: string | null; icon: string | null }>(
      'SELECT * FROM rewards WHERE active = 1 ORDER BY cost',
    )
    .all()
    .map((r) => ({
      id: r.id,
      label: r.label,
      cost: r.cost,
      active: toBool(r.active),
      imageUrl: r.image_url,
      icon: r.icon,
    }));
}

export function createReward(input: RewardInput): Reward {
  const rewardId = id('rw');
  db.prepare(
    'INSERT INTO rewards (id, label, cost, active, image_url, icon) VALUES (?, ?, ?, ?, ?, ?)',
  ).run(
    rewardId,
    input.label,
    input.cost ?? 50,
    fromBool(input.active ?? true),
    input.imageUrl ?? null,
    input.icon ?? null,
  );
  return listRewards().find((r) => r.id === rewardId)!;
}

export function updateReward(rewardId: string, patch: Partial<RewardInput>): Reward | null {
  const sets: string[] = [];
  const values: unknown[] = [];
  if (patch.label !== undefined) (sets.push('label = ?'), values.push(patch.label));
  if (patch.cost !== undefined) (sets.push('cost = ?'), values.push(patch.cost));
  if (patch.active !== undefined) (sets.push('active = ?'), values.push(fromBool(patch.active)));
  if (patch.imageUrl !== undefined) (sets.push('image_url = ?'), values.push(patch.imageUrl));
  if (patch.icon !== undefined) (sets.push('icon = ?'), values.push(patch.icon));
  if (sets.length) db.prepare(`UPDATE rewards SET ${sets.join(', ')} WHERE id = ?`).run(...values, rewardId);
  return listRewards().find((r) => r.id === rewardId) ?? null;
}

export function deleteReward(rewardId: string): void {
  db.prepare('DELETE FROM rewards WHERE id = ?').run(rewardId);
}

export function listPoints(): PointsBalance[] {
  return db
    .prepare<[], { person_id: string; points: number }>(
      'SELECT person_id, COALESCE(SUM(delta), 0) AS points FROM point_events GROUP BY person_id',
    )
    .all()
    .map((r) => ({ personId: r.person_id, points: r.points }));
}

export function pointsFor(personId: string): number {
  return (
    db
      .prepare<[string], { points: number }>(
        'SELECT COALESCE(SUM(delta), 0) AS points FROM point_events WHERE person_id = ?',
      )
      .get(personId)?.points ?? 0
  );
}

export function listRedemptions(limit = 20): Redemption[] {
  return db
    .prepare<[number], { id: string; person_id: string; reward_id: string | null; label: string; cost: number; redeemed_at: string }>(
      'SELECT * FROM redemptions ORDER BY redeemed_at DESC LIMIT ?',
    )
    .all(limit)
    .map((r) => ({
      id: r.id,
      personId: r.person_id,
      rewardId: r.reward_id,
      label: r.label,
      cost: r.cost,
      redeemedAt: r.redeemed_at,
    }));
}

export class InsufficientPoints extends Error {
  constructor(readonly have: number, readonly need: number) {
    super(`Not enough points: has ${have}, needs ${need}`);
  }
}

export const redeemReward = db.transaction((personId: string, rewardId: string): Redemption => {
  const reward = db
    .prepare<[string], { id: string; label: string; cost: number }>('SELECT * FROM rewards WHERE id = ?')
    .get(rewardId);
  if (!reward) throw new Error('Unknown reward');
  const balance = pointsFor(personId);
  if (balance < reward.cost) throw new InsufficientPoints(balance, reward.cost);

  const redemptionId = id('rd');
  const at = nowIso();
  db.prepare(
    'INSERT INTO redemptions (id, person_id, reward_id, label, cost, redeemed_at) VALUES (?, ?, ?, ?, ?, ?)',
  ).run(redemptionId, personId, rewardId, reward.label, reward.cost, at);
  db.prepare(
    `INSERT INTO point_events (id, person_id, delta, reason, ref_type, ref_id, created_at)
     VALUES (?, ?, ?, ?, 'redemption', ?, ?)`,
  ).run(id('pt'), personId, -reward.cost, reward.label, redemptionId, at);

  return { id: redemptionId, personId, rewardId, label: reward.label, cost: reward.cost, redeemedAt: at };
});

/** Manual parent adjustment, for the cases a board cannot express. */
export function adjustPoints(personId: string, delta: number, reason: string): number {
  db.prepare(
    `INSERT INTO point_events (id, person_id, delta, reason, ref_type, ref_id, created_at)
     VALUES (?, ?, ?, ?, 'manual', NULL, ?)`,
  ).run(id('pt'), personId, delta, reason, nowIso());
  return pointsFor(personId);
}
