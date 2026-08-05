import type { Settings } from '@dashboard/shared';
import type { FastifyInstance } from 'fastify';
import { clearPin, endSession, hasSession, pinIsSet, requireParent, setPin, startSession, verifyPin } from '../auth.js';
import { getSettings, updateSettings } from '../store/settings.js';

export async function settingsRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/settings', async () => getSettings());

  app.patch<{ Body: Partial<Settings> }>('/api/settings', {
    preHandler: requireParent,
    handler: async (request) => updateSettings(request.body ?? {}),
  });

  /** Whether the current client may open Settings without entering the PIN. */
  app.get('/api/session', async (request) => ({
    unlocked: hasSession(request),
    pinSet: pinIsSet(),
  }));

  app.post<{ Body: { pin: string } }>('/api/session', async (request, reply) => {
    const pin = request.body?.pin ?? '';
    if (!verifyPin(pin)) {
      // A wall panel is physically accessible; slow brute force down a little.
      await new Promise((resolve) => setTimeout(resolve, 400));
      return reply.code(401).send({ error: 'That PIN did not match' });
    }
    startSession(reply);
    return { unlocked: true };
  });

  app.delete('/api/session', async (request, reply) => {
    endSession(request, reply);
    return { unlocked: false };
  });

  app.post<{ Body: { pin: string; currentPin?: string } }>('/api/settings/pin', async (request, reply) => {
    const { pin, currentPin } = request.body ?? {};
    // Changing an existing PIN requires either the old PIN or an unlocked session.
    if (pinIsSet() && !hasSession(request) && !verifyPin(currentPin ?? '')) {
      return reply.code(401).send({ error: 'Current PIN required' });
    }
    if (!pin || !/^\d{4,8}$/.test(pin)) {
      return reply.code(400).send({ error: 'PIN must be 4–8 digits' });
    }
    setPin(pin);
    startSession(reply);
    return { pinSet: true };
  });

  app.delete('/api/settings/pin', {
    preHandler: requireParent,
    handler: async () => {
      clearPin();
      return { pinSet: false };
    },
  });
}
