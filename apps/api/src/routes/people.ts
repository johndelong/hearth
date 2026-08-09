import type { FastifyInstance } from 'fastify';
import { requireParent } from '../auth.js';
import { createPerson, deletePerson, listPeople, updatePerson } from '../store/people.js';
import { personBody } from '../schemas.js';
import { recordActivity } from '../store/activity.js';

export async function peopleRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/people', async () => listPeople());

  app.register(async (guarded) => {
    guarded.addHook('preHandler', requireParent);

    guarded.post<{ Body: Parameters<typeof createPerson>[0] }>('/api/people', { schema: { body: { ...personBody, required: ['name'] } } }, async (request, reply) => {
      if (!request.body?.name) return reply.code(400).send({ error: 'name is required' });
      const person = createPerson(request.body);
      recordActivity('person.created', person.id, person.name);
      return person;
    });

    guarded.patch<{ Params: { id: string }; Body: Parameters<typeof updatePerson>[1] }>(
      '/api/people/:id', { schema: { body: personBody } },
      async (request, reply) => {
        const person = updatePerson(request.params.id, request.body ?? {});
        if (person) recordActivity('person.updated', person.id, Object.keys(request.body ?? {}));
        return person ?? reply.code(404).send({ error: 'Unknown person' });
      },
    );

    guarded.delete<{ Params: { id: string } }>('/api/people/:id', async (request) => {
      deletePerson(request.params.id);
      recordActivity('person.deleted', request.params.id);
      return { ok: true };
    });
  });
}
