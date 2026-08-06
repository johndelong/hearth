import type { FastifyInstance } from 'fastify';
import { requireParent } from '../auth.js';
import {
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
  listPoints,
  listRedemptions,
  listRewards,
  redeemReward,
  setChoreDone,
  setClaimDone,
  updateChore,
  updateExtra,
  updateReward,
} from '../store/chores.js';
import { listPeople } from '../store/people.js';
import { localDate, periodKey } from '../store/period.js';
import { getSettings } from '../store/settings.js';
import { listStreaks, pauseStreak, resumeStreak } from '../store/streaks.js';

export async function choreRoutes(app: FastifyInstance): Promise<void> {
  // One call backs the whole Chores screen, so the boards never render half-updated.
  //
  // `?date=YYYY-MM-DD` looks at another day's board. Anything but today comes
  // back `readOnly` — history is a record, and the future hasn't happened.
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

    return {
      date: localDate(on),
      today,
      readOnly: !today,
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
  app.post<{ Params: { id: string }; Body: { personId?: string; done?: boolean } }>(
    '/api/chores/:id/done',
    async (request, reply) => {
      const personId = request.body?.personId;
      if (!personId) return reply.code(400).send({ error: 'personId is required' });
      const chore = setChoreDone(request.params.id, personId, request.body?.done ?? true);
      if (!chore) return reply.code(404).send({ error: 'Unknown chore for that person' });
      return { chore, points: listPoints() };
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

    guarded.post<{ Body: Parameters<typeof createChore>[0] }>('/api/chores', async (request) =>
      createChore(request.body),
    );
    guarded.patch<{ Params: { id: string }; Body: Parameters<typeof updateChore>[1] }>(
      '/api/chores/:id',
      async (request, reply) => {
        const chore = updateChore(request.params.id, request.body ?? {});
        return chore ?? reply.code(404).send({ error: 'Unknown chore' });
      },
    );
    guarded.delete<{ Params: { id: string } }>('/api/chores/:id', async (request) => {
      deleteChore(request.params.id);
      return { ok: true };
    });

    guarded.post<{ Body: Parameters<typeof createExtra>[0] }>('/api/extras', async (request) =>
      createExtra(request.body),
    );
    guarded.patch<{ Params: { id: string }; Body: Parameters<typeof updateExtra>[1] }>(
      '/api/extras/:id',
      async (request, reply) => {
        const extra = updateExtra(request.params.id, request.body ?? {});
        return extra ?? reply.code(404).send({ error: 'Unknown extra job' });
      },
    );
    guarded.delete<{ Params: { id: string } }>('/api/extras/:id', async (request) => {
      deleteExtra(request.params.id);
      return { ok: true };
    });

    guarded.post<{ Body: Parameters<typeof createReward>[0] }>('/api/rewards', async (request) =>
      createReward(request.body),
    );
    guarded.patch<{ Params: { id: string }; Body: Parameters<typeof updateReward>[1] }>(
      '/api/rewards/:id',
      async (request, reply) => {
        const reward = updateReward(request.params.id, request.body ?? {});
        return reward ?? reply.code(404).send({ error: 'Unknown reward' });
      },
    );
    guarded.delete<{ Params: { id: string } }>('/api/rewards/:id', async (request) => {
      deleteReward(request.params.id);
      return { ok: true };
    });

    // Pausing a streak is a parent's call — "she's at Grandma's this week".
    guarded.post<{ Params: { id: string }; Body: { paused?: boolean } }>(
      '/api/people/:id/streak-pause',
      async (request) => {
        if (request.body?.paused === false) resumeStreak(request.params.id);
        else pauseStreak(request.params.id);
        return listStreaks([request.params.id])[0];
      },
    );

    guarded.post<{ Body: { personId: string; delta: number; reason?: string } }>(
      '/api/points/adjust',
      async (request, reply) => {
        const { personId, delta, reason } = request.body ?? {};
        if (!personId || typeof delta !== 'number') {
          return reply.code(400).send({ error: 'personId and numeric delta are required' });
        }
        return { personId, points: adjustPoints(personId, delta, reason ?? 'Adjustment') };
      },
    );
  });
}
