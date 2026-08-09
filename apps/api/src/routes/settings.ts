import type { Settings } from '@dashboard/shared';
import type { FastifyInstance } from 'fastify';
import { clearPin, endSession, hasSession, pinIsSet, requireParent, setPin, startSession, verifyPin } from '../auth.js';
import { getSettings, updateSettings } from '../store/settings.js';
import { settingsBody } from '../schemas.js';
import { listActivity, recordActivity } from '../store/activity.js';
import { db } from '../db/index.js';
import { readFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

export async function settingsRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/settings', async () => getSettings());

  app.patch<{ Body: Partial<Settings> }>('/api/settings', {
    preHandler: requireParent,
    schema: { body: settingsBody },
    handler: async (request) => {
      const result = updateSettings(request.body ?? {});
      recordActivity('settings.updated', null, Object.keys(request.body ?? {}));
      return result;
    },
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
    recordActivity('pin.changed');
    startSession(reply);
    return { pinSet: true };
  });

  app.delete('/api/settings/pin', {
    preHandler: requireParent,
    handler: async () => {
      clearPin();
      recordActivity('pin.removed');
      return { pinSet: false };
    },
  });

  app.get<{ Querystring: { limit?: string } }>('/api/activity', {
    preHandler: requireParent,
    handler: async (request) => listActivity(Number(request.query.limit) || 50),
  });

  app.get('/api/backup', {
    preHandler: requireParent,
    handler: async (_request, reply) => {
      const path = join(tmpdir(), `hearth-backup-${process.pid}-${Date.now()}.db`);
      const escaped = path.replaceAll("'", "''");
      db.exec(`VACUUM INTO '${escaped}'`);
      try {
        return reply
          .header('content-type', 'application/vnd.sqlite3')
          .header('content-disposition', `attachment; filename="hearth-${new Date().toISOString().slice(0, 10)}.db"`)
          .send(readFileSync(path));
      } finally {
        unlinkSync(path);
      }
    },
  });
}
