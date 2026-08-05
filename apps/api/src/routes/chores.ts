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

export async function choreRoutes(app: FastifyInstance): Promise<void> {
  // One call backs the whole Chores screen, so the boards never render half-updated.
  app.get('/api/chores/board', async () => ({
    chores: listChores(),
    extras: listExtras(),
    claims: listClaims(),
    rewards: listRewards(),
    points: listPoints(),
    redemptions: listRedemptions(8),
  }));

  // --- checking off is deliberately unguarded: it is the kids' interaction ---

  app.post<{ Params: { id: string }; Body: { done?: boolean } }>(
    '/api/chores/:id/done',
    async (request, reply) => {
      const chore = setChoreDone(request.params.id, request.body?.done ?? true);
      if (!chore) return reply.code(404).send({ error: 'Unknown chore' });
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
