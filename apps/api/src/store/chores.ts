import {
  type BoardChore,
  type Chore,
  type ChoreInput,
  type Claim,
  type Extra,
  type ExtraInput,
  type PointEvent,
  type PointsBalance,
  type Recurrence,
  type Redemption,
  type Reward,
  type RewardInput,
  TIMES_OF_DAY,
  type TimeOfDay,
  normalizeRecurrence,
} from '@dashboard/shared';
import { db, fromBool, id, nowIso, toBool } from '../db/index.js';
import { getSettings } from './settings.js';
import { MAX_DAYS_AHEAD, daysAhead, isDue, localDate, periodEnd, periodKey } from './period.js';

// ---------- chores ----------

interface ChoreRow {
  id: string;
  title: string;
  description: string | null;
  instructions: string | null;
  freq: Recurrence['freq'];
  interval_n: number;
  by_day: string;
  by_month_day: number | null;
  by_set_pos: number | null;
  starts_on: string;
  time_of_day: string;
  active: number;
  sort_order: number;
}

/** An unrecognised label would drop a chore out of every section it could sort into. */
const toTimeOfDay = (raw: string | null): TimeOfDay =>
  TIMES_OF_DAY.includes(raw as TimeOfDay) ? (raw as TimeOfDay) : 'any';

/** The recurrence columns, back into the rule the rest of the app speaks. */
function toRecurrence(r: ChoreRow): Recurrence {
  return normalizeRecurrence({
    freq: r.freq,
    interval: r.interval_n,
    byDay: r.by_day ? r.by_day.split(',').map(Number) : [],
    byMonthDay: r.by_month_day,
    bySetPos: r.by_set_pos,
    startsOn: r.starts_on,
  });
}

/** The rule, flattened back into the six columns it is stored as. */
function recurrenceColumns(rec: Recurrence): Record<string, string | number | null> {
  return {
    freq: rec.freq,
    interval_n: rec.interval,
    by_day: rec.byDay.join(','),
    by_month_day: rec.byMonthDay,
    by_set_pos: rec.bySetPos,
    starts_on: rec.startsOn,
  };
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
  recurrence: toRecurrence(r),
  timeOfDay: toTimeOfDay(r.time_of_day),
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
export function listChores(on = new Date()): BoardChore[] {
  const { choreReset } = getSettings();
  const period = periodKey(choreReset, on);
  return db
    .prepare<
      [string],
      ChoreRow & { person_id: string; completed_at: string | null }
    >(
      `SELECT c.*, cp.person_id, cc.completed_at
         FROM chores c
         JOIN chore_people cp ON cp.chore_id = c.id
         LEFT JOIN chore_completions cc
                ON cc.chore_id = c.id AND cc.person_id = cp.person_id AND cc.period = ?
        WHERE c.active = 1
        ORDER BY c.sort_order, c.title`,
    )
    .all(period)
    .filter((r) => isDue(toRecurrence(r), choreReset, on))
    .map((r) => ({
      choreId: r.id,
      personId: r.person_id,
      title: r.title,
      description: r.description,
      instructions: r.instructions,
      recurrence: toRecurrence(r),
      timeOfDay: toTimeOfDay(r.time_of_day),
      sortOrder: r.sort_order,
      done: r.completed_at !== null,
      completedOn: r.completed_at ? localDate(new Date(r.completed_at)) : null,
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
  const rec = recurrenceColumns(normalizeRecurrence(input.recurrence));
  db.prepare(
    `INSERT INTO chores
       (id, title, description, instructions, freq, interval_n, by_day, by_month_day,
        by_set_pos, starts_on, time_of_day, active, sort_order)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    choreId,
    input.title,
    input.description ?? null,
    input.instructions ?? null,
    rec.freq,
    rec.interval_n,
    rec.by_day,
    rec.by_month_day,
    rec.by_set_pos,
    rec.starts_on,
    toTimeOfDay(input.timeOfDay ?? null),
    fromBool(input.active ?? true),
    input.sortOrder ?? 0,
  );
  setChorePeople(choreId, input.personIds);
  // A new chore makes these boards incomplete, which puts any extra-job points
  // already paid out today back into holding.
  for (const personId of input.personIds) releaseClaimPoints(personId);
  return findChore(choreId)!;
});

export const updateChore = db.transaction((choreId: string, patch: Partial<ChoreInput>): Chore | null => {
  // Whoever this chore touches on either side of the edit, since both boards
  // can change completeness — one gains an outstanding chore, one loses it.
  const affected = new Set(peopleByChore([choreId]).get(choreId) ?? []);
  const columns: Record<string, string> = {
    title: 'title',
    description: 'description',
    instructions: 'instructions',
    timeOfDay: 'time_of_day',
    active: 'active',
    sortOrder: 'sort_order',
  };
  const sets: string[] = [];
  const values: unknown[] = [];
  for (const [key, value] of Object.entries(patch)) {
    const column = columns[key];
    if (!column) continue;
    sets.push(`${column} = ?`);
    if (key === 'active') values.push(fromBool(value));
    else if (key === 'timeOfDay') values.push(toTimeOfDay(value as string));
    else values.push(value);
  }
  // The rule is replaced whole rather than field by field: a half-applied
  // change (monthly frequency still carrying last week's day list) would be a
  // rule nobody chose.
  if (patch.recurrence) {
    for (const [column, value] of Object.entries(recurrenceColumns(normalizeRecurrence(patch.recurrence)))) {
      sets.push(`${column} = ?`);
      values.push(value);
    }
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
    for (const personId of patch.personIds) affected.add(personId);
  }
  for (const personId of affected) releaseClaimPoints(personId);
  return findChore(choreId);
});

export const deleteChore = db.transaction((choreId: string): void => {
  // Read the assignees before the cascade takes them away — losing an
  // outstanding chore can be what completes a board.
  const affected = peopleByChore([choreId]).get(choreId) ?? [];
  db.prepare('DELETE FROM chores WHERE id = ?').run(choreId);
  for (const personId of affected) releaseClaimPoints(personId);
});

function findChore(choreId: string): Chore | null {
  const r = db.prepare<[string], ChoreRow>('SELECT * FROM chores WHERE id = ?').get(choreId);
  if (!r) return null;
  return toChore(r, peopleByChore([choreId]).get(choreId) ?? []);
}

/** A tick aimed at a day the board will not accept it for. */
export class CompletionOutOfRange extends Error {}

/**
 * Check one person's copy of a chore off, or undo it. Chores pay no points —
 * they are the baseline expectation, and only extra jobs earn.
 *
 * `on` is the day whose occurrence is being satisfied, which is not necessarily
 * today. A chore due Sunday can be ticked on Friday: the completion files under
 * Sunday's period, so the streak finds it when Sunday comes, while `completed_at`
 * still records the Friday it actually happened.
 *
 * Forward only, and no further than a week. The past stays a record — if
 * yesterday could be edited, a broken streak would always be one tap from being
 * un-broken, and the whole thing would stop meaning anything.
 */
export function setChoreDone(
  choreId: string,
  personId: string,
  done: boolean,
  on = new Date(),
): BoardChore | null {
  const assigned = db
    .prepare<[string, string], { n: number }>(
      'SELECT COUNT(*) AS n FROM chore_people WHERE chore_id = ? AND person_id = ?',
    )
    .get(choreId, personId);
  if (!assigned?.n) return null;

  const r = db.prepare<[string], ChoreRow>('SELECT * FROM chores WHERE id = ?').get(choreId);
  if (!r) return null;
  const rec = toRecurrence(r);
  const { choreReset } = getSettings();

  // The current period is always writable, however the board is reset; beyond
  // it, only the week ahead is.
  if (periodKey(choreReset) !== periodKey(choreReset, on)) {
    const ahead = daysAhead(on);
    if (ahead < 0) {
      throw new CompletionOutOfRange('That day is a record and cannot be changed');
    }
    if (ahead > MAX_DAYS_AHEAD) {
      throw new CompletionOutOfRange(`Chores can only be done up to ${MAX_DAYS_AHEAD} days ahead`);
    }
  }

  // No occurrence on that day means there is nothing there to check off.
  if (!isDue(rec, choreReset, on)) return null;

  const period = periodKey(choreReset, on);
  if (done) {
    // OR IGNORE, so re-ticking something already done keeps the day it was
    // first finished rather than quietly moving it to now.
    db.prepare(
      `INSERT OR IGNORE INTO chore_completions (chore_id, person_id, period, completed_at)
       VALUES (?, ?, ?, ?)`,
    ).run(choreId, personId, period, nowIso());
  } else {
    db.prepare(
      'DELETE FROM chore_completions WHERE chore_id = ? AND person_id = ? AND period = ?',
    ).run(choreId, personId, period);
  }

  // Finishing (or un-finishing) a chore is what opens and closes the gate on
  // any extra jobs already done today.
  releaseClaimPoints(personId);

  const completedAt = db
    .prepare<[string, string, string], { completed_at: string }>(
      'SELECT completed_at FROM chore_completions WHERE chore_id = ? AND person_id = ? AND period = ?',
    )
    .get(choreId, personId, period);

  return {
    choreId: r.id,
    personId,
    title: r.title,
    description: r.description,
    instructions: r.instructions,
    recurrence: rec,
    timeOfDay: toTimeOfDay(r.time_of_day),
    sortOrder: r.sort_order,
    done,
    completedOn: completedAt ? localDate(new Date(completedAt.completed_at)) : null,
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

const toClaim = (r: ClaimRow & { paid?: number }): Claim => ({
  id: r.id,
  extraId: r.extra_id,
  personId: r.person_id,
  title: r.title,
  description: r.description,
  instructions: r.instructions,
  points: r.points,
  done: toBool(r.done),
  paid: toBool(r.paid),
  claimedAt: r.claimed_at,
  completedAt: r.completed_at,
});

/** Open claims, plus anything completed inside the current board period. */
/**
 * Claims for a board period. Today's board also carries anything still open,
 * since an unfinished job stays on the list until it is done or given back; a
 * past board shows only what was actually claimed within it.
 */
export function listClaims(on = new Date()): Claim[] {
  const { choreReset } = getSettings();
  const period = periodKey(choreReset, on);
  const start = period.startsWith('w:') ? period.slice(2) : period;
  const isToday = period === periodKey(choreReset);

  if (isToday) {
    return db
      .prepare<[string], ClaimRow & { paid: number }>(
        `SELECT c.*, (pe.id IS NOT NULL) AS paid
           FROM claims c
           LEFT JOIN point_events pe ON pe.ref_type = 'claim' AND pe.ref_id = c.id
          WHERE c.done = 0 OR c.completed_at >= ?
          ORDER BY c.claimed_at`,
      )
      .all(start)
      .map(toClaim);
  }

  const end = periodEnd(choreReset, on);
  return db
    .prepare<[string, string], ClaimRow & { paid: number }>(
      `SELECT c.*, (pe.id IS NOT NULL) AS paid
         FROM claims c
         LEFT JOIN point_events pe ON pe.ref_type = 'claim' AND pe.ref_id = c.id
        WHERE c.claimed_at >= ? AND c.claimed_at < ?
        ORDER BY c.claimed_at`,
    )
    .all(start, end)
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

/**
 * Whether every chore required of this person today has been checked off.
 *
 * Vacuously true for someone with nothing assigned — a kid with no chores is
 * not being held to a standard they were never given.
 */
export function choresCompleteFor(personId: string, on = new Date()): boolean {
  return listChores(on)
    .filter((c) => c.personId === personId)
    .every((c) => c.done);
}

/**
 * Pays a finished extra job into the ledger.
 *
 * `OR IGNORE` against the unique index on (ref_type, ref_id) is what makes this
 * safe to call as often as we like — a claim can only ever pay out once, so
 * reconciliation never has to work out whether it already ran.
 */
function payClaim(personId: string, claimId: string, points: number, title: string): void {
  db.prepare(
    `INSERT OR IGNORE INTO point_events (id, person_id, delta, reason, ref_type, ref_id, created_at)
     VALUES (?, ?, ?, ?, 'claim', ?, ?)`,
  ).run(id('pt'), personId, points, title, claimId, nowIso());
}

const unpayClaim = (claimId: string): void => {
  db.prepare("DELETE FROM point_events WHERE ref_type = 'claim' AND ref_id = ?").run(claimId);
};

const isPaid = (claimId: string): boolean =>
  Boolean(
    db
      .prepare<[string], { n: number }>(
        "SELECT COUNT(*) AS n FROM point_events WHERE ref_type = 'claim' AND ref_id = ?",
      )
      .get(claimId)?.n,
  );

/**
 * Brings this person's finished extra jobs in line with their chore board.
 *
 * Extra jobs can be picked up and finished at any hour — making dinner should
 * not have to wait on an evening chore. What waits is the payment: the points
 * land once the day's required chores are done, and go back into holding if a
 * chore is unchecked again, so the two can never disagree.
 *
 * Returns whether the points are currently released.
 */
export const releaseClaimPoints = db.transaction((personId: string): boolean => {
  const { choreReset } = getSettings();
  const period = periodKey(choreReset);
  const start = period.startsWith('w:') ? period.slice(2) : period;
  const end = periodEnd(choreReset);
  const unlocked = choresCompleteFor(personId);

  const claims = db
    .prepare<[string, string, string], { id: string; title: string; points: number }>(
      `SELECT id, title, points FROM claims
        WHERE person_id = ? AND done = 1 AND completed_at >= ? AND completed_at < ?`,
    )
    .all(personId, start, end);

  for (const c of claims) {
    if (unlocked) payClaim(personId, c.id, c.points, c.title);
    else unpayClaim(c.id);
  }
  return unlocked;
});

export const setClaimDone = db.transaction((claimId: string, done: boolean): Claim | null => {
  const row = db.prepare<[string], ClaimRow>('SELECT * FROM claims WHERE id = ?').get(claimId);
  if (!row) return null;
  const claim = toClaim(row);
  if (done) {
    db.prepare('UPDATE claims SET done = 1, completed_at = ? WHERE id = ?').run(nowIso(), claimId);
    // Finishing the job is not the same as earning for it. The points only move
    // if the required chores are already behind them.
    if (choresCompleteFor(claim.personId)) payClaim(claim.personId, claimId, claim.points, claim.title);
  } else {
    db.prepare('UPDATE claims SET done = 0, completed_at = NULL WHERE id = ?').run(claimId);
    unpayClaim(claimId);
  }
  return { ...claim, done, paid: done && isPaid(claimId) };
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

/**
 * One person's ledger, newest first — every claim payout, redemption, and
 * manual adjustment that has moved their balance.
 *
 * The ledger is the whole history, so a parent reading it can always account
 * for the number on the board.
 */
export function listPointEvents(personId: string, limit = 100): PointEvent[] {
  return db
    .prepare<
      [string, number],
      {
        id: string;
        person_id: string;
        delta: number;
        reason: string;
        ref_type: PointEvent['refType'];
        ref_id: string | null;
        created_at: string;
      }
    >(
      `SELECT * FROM point_events
        WHERE person_id = ?
        -- rowid breaks the tie by insertion order: two entries can share a
        -- millisecond, and ids carry no sequence to sort on.
        ORDER BY created_at DESC, rowid DESC
        LIMIT ?`,
    )
    .all(personId, limit)
    .map((r) => ({
      id: r.id,
      personId: r.person_id,
      delta: r.delta,
      reason: r.reason,
      refType: r.ref_type,
      refId: r.ref_id,
      createdAt: r.created_at,
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
