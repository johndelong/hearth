import type {
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
  person_id: string;
  title: string;
  repeat: Chore['repeat'];
  active: number;
  sort_order: number;
  done: number;
}

/**
 * Today's boards. Only chores whose repeat rule lands on the current period are
 * returned, each joined against its completion row for that same period.
 */
export function listChores(): Chore[] {
  const { choreReset } = getSettings();
  const period = periodKey(choreReset);
  const rows = db
    .prepare<[string], ChoreRow>(
      `SELECT c.*, (cc.chore_id IS NOT NULL) AS done
         FROM chores c
         LEFT JOIN chore_completions cc ON cc.chore_id = c.id AND cc.period = ?
        WHERE c.active = 1
        ORDER BY c.sort_order, c.title`,
    )
    .all(period);
  return rows
    .filter((r) => isDue(r.repeat, choreReset))
    .map((r) => ({
      id: r.id,
      personId: r.person_id,
      title: r.title,
      repeat: r.repeat,
      active: toBool(r.active),
      sortOrder: r.sort_order,
      done: toBool(r.done),
    }));
}

export function createChore(input: ChoreInput): Chore {
  const choreId = id('ch');
  db.prepare(
    'INSERT INTO chores (id, person_id, title, repeat, active, sort_order) VALUES (?, ?, ?, ?, ?, ?)',
  ).run(
    choreId,
    input.personId,
    input.title,
    input.repeat ?? 'Daily',
    fromBool(input.active ?? true),
    input.sortOrder ?? 0,
  );
  return findChore(choreId)!;
}

export function updateChore(choreId: string, patch: Partial<ChoreInput>): Chore | null {
  const columns: Record<string, string> = {
    personId: 'person_id',
    title: 'title',
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
  return findChore(choreId);
}

export function deleteChore(choreId: string): void {
  db.prepare('DELETE FROM chores WHERE id = ?').run(choreId);
}

function findChore(choreId: string): Chore | null {
  return listChores().find((c) => c.id === choreId) ?? rawChore(choreId);
}

/** Falls back to the stored row for chores not due in the current period. */
function rawChore(choreId: string): Chore | null {
  const r = db.prepare<[string], ChoreRow>('SELECT *, 0 AS done FROM chores WHERE id = ?').get(choreId);
  if (!r) return null;
  return {
    id: r.id,
    personId: r.person_id,
    title: r.title,
    repeat: r.repeat,
    active: toBool(r.active),
    sortOrder: r.sort_order,
    done: false,
  };
}

/**
 * Check a chore off, or undo it. Chores pay no points — they are the baseline
 * expectation, and only extra jobs earn.
 */
export function setChoreDone(choreId: string, done: boolean): Chore | null {
  const chore = rawChore(choreId);
  if (!chore) return null;
  const period = periodKey(getSettings().choreReset);

  if (done) {
    db.prepare(
      'INSERT OR IGNORE INTO chore_completions (chore_id, period, completed_at) VALUES (?, ?, ?)',
    ).run(choreId, period, nowIso());
  } else {
    db.prepare('DELETE FROM chore_completions WHERE chore_id = ? AND period = ?').run(choreId, period);
  }
  return { ...chore, done };
}

// ---------- extras and claims ----------

export function listExtras(): Extra[] {
  return db
    .prepare<[], { id: string; title: string; points: number; active: number }>(
      'SELECT * FROM extras WHERE active = 1 ORDER BY points, title',
    )
    .all()
    .map((r) => ({ id: r.id, title: r.title, points: r.points, active: toBool(r.active) }));
}

export function createExtra(input: ExtraInput): Extra {
  const extraId = id('xj');
  db.prepare('INSERT INTO extras (id, title, points, active) VALUES (?, ?, ?, ?)').run(
    extraId,
    input.title,
    input.points ?? 10,
    fromBool(input.active ?? true),
  );
  return listExtras().find((e) => e.id === extraId)!;
}

export function updateExtra(extraId: string, patch: Partial<ExtraInput>): Extra | null {
  const sets: string[] = [];
  const values: unknown[] = [];
  if (patch.title !== undefined) (sets.push('title = ?'), values.push(patch.title));
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
    .prepare<[string], { id: string; title: string; points: number }>('SELECT * FROM extras WHERE id = ?')
    .get(extraId);
  if (!extra) return null;
  const claimId = id('cl');
  db.prepare(
    'INSERT INTO claims (id, extra_id, person_id, title, points, done, claimed_at) VALUES (?, ?, ?, ?, ?, 0, ?)',
  ).run(claimId, extraId, personId, extra.title, extra.points, nowIso());
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
