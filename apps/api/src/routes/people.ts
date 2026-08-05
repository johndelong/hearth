import type { FastifyInstance } from 'fastify';
import { requireParent } from '../auth.js';
import { createPerson, deletePerson, listPeople, updatePerson } from '../store/people.js';

export async function peopleRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/people', async () => listPeople());

  app.register(async (guarded) => {
    guarded.addHook('preHandler', requireParent);

    guarded.post<{ Body: Parameters<typeof createPerson>[0] }>('/api/people', async (request, reply) => {
      if (!request.body?.name) return reply.code(400).send({ error: 'name is required' });
      return createPerson(request.body);
    });

    guarded.patch<{ Params: { id: string }; Body: Parameters<typeof updatePerson>[1] }>(
      '/api/people/:id',
      async (request, reply) => {
        const person = updatePerson(request.params.id, request.body ?? {});
        return person ?? reply.code(404).send({ error: 'Unknown person' });
      },
    );

    guarded.delete<{ Params: { id: string } }>('/api/people/:id', async (request) => {
      deletePerson(request.params.id);
      return { ok: true };
    });
  });
}
