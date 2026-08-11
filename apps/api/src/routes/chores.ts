import type { FastifyInstance } from 'fastify';
import { requireParent } from '../auth.js';
import {
  CompletionOutOfRange,
  InsufficientPoints,
  adjustPoints,
  createChore,
  createClaim,
  createExtra,
  createReward,
  deleteChore,
  deleteClaim,
  deleteExtra,
  deleteReward,
  listAllChores,
  listChores,
  listClaims,
  listExtras,
  listPointEvents,
  listPoints,
  listRedemptions,
  listRewards,
  pointsFor,
  redeemReward,
  setChoreDone,
  setClaimDone,
  updateChore,
  updateExtra,
  updateReward,
} from '../store/chores.js';
import { getPerson, listPeople } from '../store/people.js';
import { MAX_DAYS_AHEAD, daysAhead, localDate, periodKey } from '../store/period.js';
import { getSettings } from '../store/settings.js';
import { listStreaks, pauseStreak, resumeStreak } from '../store/streaks.js';
import { choreBody, extraBody, pointAdjustBody, rewardBody } from '../schemas.js';
import { recordActivity } from '../store/activity.js';

export async function choreRoutes(app: FastifyInstance): Promise<void> {
  // One call backs the whole Chores screen, so the boards never render half-updated.
  //
  // `?date=YYYY-MM-DD` looks at another day's board. The past comes back
  // `readOnly` — history is a record. The week ahead does not, so a chore can
  // be ticked off before the day it is due.
  app.get<{ Querystring: { date?: string } }>('/api/chores/board', async (request, reply) => {
    const raw = request.query.date;
    if (raw !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
      return reply.code(400).send({ error: 'date must be YYYY-MM-DD' });
    }
    // Parsed as local midnight; `new Date('2026-08-05')` would be UTC and can
    // land on the previous day for anyone west of Greenwich.
    const on = raw ? new Date(`${raw}T00:00:00`) : new Date();
    if (Number.isNaN(on.getTime())) return reply.code(400).send({ error: 'Unparseable date' });

    const { choreReset } = getSettings();
    const today = periodKey(choreReset) === periodKey(choreReset, on);
    const ahead = daysAhead(on);

    return {
      date: localDate(on),
      today,
      // The past is a record. The week ahead is not: a chore can be done early,
      // so those boards stay writable even though they are not today.
      readOnly: !today && (ahead < 0 || ahead > MAX_DAYS_AHEAD),
      daysAhead: ahead,
      chores: listChores(on),
      extras: listExtras(),
      claims: listClaims(on),
      rewards: listRewards(),
      points: listPoints(),
      redemptions: listRedemptions(8),
      streaks: listStreaks(listPeople().map((p) => p.id)),
    };
  });

  // --- checking off is deliberately unguarded: it is the kids' interaction ---

  // A chore can be assigned to several people, so checking off names which one.
  //
  // `date` names the occurrence being satisfied rather than the day of the tap,
  // which is how a chore gets done ahead of time. The store decides how far
  // ahead is allowed.
  app.post<{ Params: { id: string }; Body: { personId?: string; done?: boolean; date?: string } }>(
    '/api/chores/:id/done',
    async (request, reply) => {
      const personId = request.body?.personId;
      if (!personId) return reply.code(400).send({ error: 'personId is required' });

      const raw = request.body?.date;
      if (raw !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
        return reply.code(400).send({ error: 'date must be YYYY-MM-DD' });
      }
      const on = raw ? new Date(`${raw}T00:00:00`) : new Date();
      if (Number.isNaN(on.getTime())) return reply.code(400).send({ error: 'Unparseable date' });

      try {
        const chore = setChoreDone(request.params.id, personId, request.body?.done ?? true, on);
        if (!chore) return reply.code(404).send({ error: 'Unknown chore for that person that day' });
        return { chore, points: listPoints() };
      } catch (err) {
        if (err instanceof CompletionOutOfRange) return reply.code(400).send({ error: err.message });
        throw err;
      }
    },
  );

  app.post<{ Body: { extraId: string; personId: string } }>('/api/claims', async (request, reply) => {
    const { extraId, personId } = request.body ?? {};
    if (!extraId || !personId) return reply.code(400).send({ error: 'extraId and personId are required' });
    const claim = createClaim(extraId, personId);
    if (!claim) return reply.code(404).send({ error: 'Unknown extra job' });
    return claim;
  });

  app.post<{ Params: { id: string }; Body: { done?: boolean } }>(
    '/api/claims/:id/done',
    async (request, reply) => {
      const claim = setClaimDone(request.params.id, request.body?.done ?? true);
      if (!claim) return reply.code(404).send({ error: 'Unknown claim' });
      return { claim, points: listPoints() };
    },
  );

  app.delete<{ Params: { id: string } }>('/api/claims/:id', async (request) => {
    deleteClaim(request.params.id);
    return { ok: true };
  });

  app.post<{ Body: { personId: string; rewardId: string } }>('/api/redemptions', async (request, reply) => {
    const { personId, rewardId } = request.body ?? {};
    if (!personId || !rewardId) return reply.code(400).send({ error: 'personId and rewardId are required' });
    try {
      return { redemption: redeemReward(personId, rewardId), points: listPoints() };
    } catch (err) {
      if (err instanceof InsufficientPoints) {
        return reply.code(409).send({ error: err.message, have: err.have, need: err.need });
      }
      throw err;
    }
  });

  // --- everything below changes the rules, so it sits behind the PIN ---

  app.register(async (guarded) => {
    guarded.addHook('preHandler', requireParent);

    // The management list, behind the PIN with the rest of the rule-changing.
    guarded.get('/api/chores', async () => listAllChores());

    guarded.post<{ Body: Parameters<typeof createChore>[0] }>('/api/chores', { schema: { body: { ...choreBody, required: ['title', 'personIds'] } } }, async (request) => {
      const chore = createChore(request.body); recordActivity('chore.created', chore.id, chore.title); return chore;
    });
    guarded.patch<{ Params: { id: string }; Body: Parameters<typeof updateChore>[1] }>(
      '/api/chores/:id', { schema: { body: choreBody } },
      async (request, reply) => {
        const chore = updateChore(request.params.id, request.body ?? {});
        if (chore) recordActivity('chore.updated', chore.id, Object.keys(request.body ?? {}));
        return chore ?? reply.code(404).send({ error: 'Unknown chore' });
      },
    );
    guarded.delete<{ Params: { id: string } }>('/api/chores/:id', async (request) => {
      deleteChore(request.params.id);
      recordActivity('chore.deleted', request.params.id);
      return { ok: true };
    });

    guarded.post<{ Body: Parameters<typeof createExtra>[0] }>('/api/extras', { schema: { body: { ...extraBody, required: ['title'] } } }, async (request) => {
      const extra = createExtra(request.body); recordActivity('extra.created', extra.id, extra.title); return extra;
    });
    guarded.patch<{ Params: { id: string }; Body: Parameters<typeof updateExtra>[1] }>(
      '/api/extras/:id', { schema: { body: extraBody } },
      async (request, reply) => {
        const extra = updateExtra(request.params.id, request.body ?? {});
        if (extra) recordActivity('extra.updated', extra.id, Object.keys(request.body ?? {}));
        return extra ?? reply.code(404).send({ error: 'Unknown extra job' });
      },
    );
    guarded.delete<{ Params: { id: string } }>('/api/extras/:id', async (request) => {
      deleteExtra(request.params.id);
      recordActivity('extra.deleted', request.params.id);
      return { ok: true };
    });

    guarded.post<{ Body: Parameters<typeof createReward>[0] }>('/api/rewards', { schema: { body: { ...rewardBody, required: ['label'] } } }, async (request) => {
      const reward = createReward(request.body); recordActivity('reward.created', reward.id, reward.label); return reward;
    });
    guarded.patch<{ Params: { id: string }; Body: Parameters<typeof updateReward>[1] }>(
      '/api/rewards/:id', { schema: { body: rewardBody } },
      async (request, reply) => {
        const reward = updateReward(request.params.id, request.body ?? {});
        if (reward) recordActivity('reward.updated', reward.id, Object.keys(request.body ?? {}));
        return reward ?? reply.code(404).send({ error: 'Unknown reward' });
      },
    );
    guarded.delete<{ Params: { id: string } }>('/api/rewards/:id', async (request) => {
      deleteReward(request.params.id);
      recordActivity('reward.deleted', request.params.id);
      return { ok: true };
    });

    // Pausing a streak is a parent's call — "she's at Grandma's this week".
    guarded.post<{ Params: { id: string }; Body: { paused?: boolean } }>(
      '/api/people/:id/streak-pause',
      async (request) => {
        if (request.body?.paused === false) resumeStreak(request.params.id);
        else pauseStreak(request.params.id);
        recordActivity(request.body?.paused === false ? 'streak.resumed' : 'streak.paused', request.params.id);
        return listStreaks([request.params.id])[0];
      },
    );

    // One person's ledger, so a parent can account for the number on the board.
    guarded.get<{ Params: { id: string }; Querystring: { limit?: string } }>(
      '/api/points/:id/history',
      async (request, reply) => {
        if (!getPerson(request.params.id)) return reply.code(404).send({ error: 'Unknown person' });
        const asked = Number(request.query.limit ?? 100);
        const limit = Number.isFinite(asked) ? Math.min(Math.max(Math.trunc(asked), 1), 500) : 100;
        return {
          personId: request.params.id,
          points: pointsFor(request.params.id),
          events: listPointEvents(request.params.id, limit),
        };
      },
    );

    guarded.post<{ Body: { personId: string; delta: number; reason?: string } }>(
      '/api/points/adjust',
      { schema: { body: pointAdjustBody } },
      async (request, reply) => {
        const { personId, delta } = request.body;
        const reason = request.body.reason?.trim() || 'Adjustment';
        // Checked here rather than left to the foreign key, so an unknown
        // person is a 404 instead of a 500.
        if (!getPerson(personId)) return reply.code(404).send({ error: 'Unknown person' });
        const points = adjustPoints(personId, delta, reason);
        recordActivity('points.adjusted', personId, { delta, reason });
        return { personId, points, events: listPointEvents(personId) };
      },
    );
  });
}
