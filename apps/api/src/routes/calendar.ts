import { randomBytes } from 'node:crypto';
import type { EventInput } from '@dashboard/shared';
import type { FastifyInstance } from 'fastify';
import { google } from 'googleapis';
import { requireParent } from '../auth.js';
import { id } from '../db/index.js';
import { SCOPES, calendarApi, googleConfig, oauthClient } from '../google/client.js';
import { refreshCalendarList, syncAll, syncCalendar } from '../google/sync.js';
import {
  accountIdForEmail,
  deleteAccount,
  deleteEvent,
  getCachedEvent,
  getCalendar,
  listAccounts,
  listCalendars,
  updateCalendar,
  upsertAccount,
} from '../store/calendars.js';
import { listEvents } from '../store/events.js';

/** Pending OAuth states, valid for one round trip. */
const pendingStates = new Map<string, number>();

export async function calendarRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Querystring: { from?: string; to?: string } }>('/api/events', async (request, reply) => {
    const { from, to } = request.query;
    if (!from || !to) return reply.code(400).send({ error: 'from and to (ISO timestamps) are required' });
    return listEvents(from, to);
  });

  app.get('/api/calendars', async () => ({
    accounts: listAccounts(),
    calendars: listCalendars(),
    configured: googleConfig() !== null,
  }));

  app.post('/api/calendars/sync', async () => syncAll());

  app.register(async (guarded) => {
    guarded.addHook('preHandler', requireParent);

    /** Step 1 of OAuth: hand the browser a Google consent URL. */
    guarded.get('/api/google/auth-url', async (_request, reply) => {
      if (!googleConfig()) {
        return reply.code(400).send({ error: 'Google OAuth is not configured on the server' });
      }
      const state = randomBytes(16).toString('hex');
      pendingStates.set(state, Date.now() + 10 * 60_000);
      const url = oauthClient().generateAuthUrl({
        access_type: 'offline',
        prompt: 'consent', // force a refresh token even on re-consent
        scope: SCOPES,
        state,
      });
      return { url };
    });

    guarded.patch<{ Params: { id: string }; Body: { personId?: string | null; enabled?: boolean } }>(
      '/api/calendars/:id',
      async (request, reply) => {
        const { personId, enabled } = request.body ?? {};
        if (!updateCalendar(request.params.id, { personId, enabled })) {
          return reply.code(400).send({ error: 'Nothing to update' });
        }

        // Newly enabled calendars have no cached events yet.
        if (enabled) void syncCalendar(request.params.id).catch(() => undefined);

        const updated = listCalendars().find((c) => c.id === request.params.id);
        return updated ?? reply.code(404).send({ error: 'Unknown calendar' });
      },
    );

    guarded.delete<{ Params: { id: string } }>('/api/google/accounts/:id', async (request) => {
      deleteAccount(request.params.id);
      return { ok: true };
    });

    guarded.post<{ Body: EventInput }>('/api/events', async (request, reply) => {
      const body = request.body;
      const cal = getCalendar(body?.calendarId ?? '');
      if (!cal) return reply.code(404).send({ error: 'Unknown calendar' });
      if (cal.readOnly) return reply.code(403).send({ error: 'That calendar is read-only' });

      const res = await calendarApi(cal.accountId).events.insert({
        calendarId: cal.googleCalendarId,
        requestBody: toGoogleEvent(body),
      });
      await syncCalendar(cal.id);
      return { googleId: res.data.id };
    });

    guarded.patch<{ Params: { id: string }; Body: Partial<EventInput> }>(
      '/api/events/:id',
      async (request, reply) => {
        const cached = getCachedEvent(request.params.id);
        if (!cached) return reply.code(404).send({ error: 'Unknown event' });
        const cal = getCalendar(cached.calendarRowId);
        if (!cal) return reply.code(404).send({ error: 'Unknown calendar' });
        if (cal.readOnly) return reply.code(403).send({ error: 'That calendar is read-only' });

        await calendarApi(cal.accountId).events.patch({
          calendarId: cal.googleCalendarId,
          eventId: cached.googleId,
          requestBody: toGoogleEvent(request.body),
        });
        await syncCalendar(cal.id);
        return { ok: true };
      },
    );

    guarded.delete<{ Params: { id: string } }>('/api/events/:id', async (request, reply) => {
      const cached = getCachedEvent(request.params.id);
      if (!cached) return reply.code(404).send({ error: 'Unknown event' });
      const cal = getCalendar(cached.calendarRowId);
      if (!cal) return reply.code(404).send({ error: 'Unknown calendar' });
      if (cal.readOnly) return reply.code(403).send({ error: 'That calendar is read-only' });

      await calendarApi(cal.accountId).events.delete({
        calendarId: cal.googleCalendarId,
        eventId: cached.googleId,
      });
      deleteEvent(request.params.id);
      return { ok: true };
    });
  });

  /**
   * Step 2 of OAuth. Google redirects the browser here, so it cannot carry the
   * session cookie of the tab that started the flow — the one-shot `state` value
   * is what proves this callback belongs to our request.
   */
  app.get<{ Querystring: { code?: string; state?: string; error?: string } }>(
    '/api/google/callback',
    async (request, reply) => {
      const { code, state, error } = request.query;
      if (error) return reply.type('text/html').send(closingPage(`Google said: ${error}`));
      if (!code || !state || !consumeState(state)) {
        return reply.code(400).type('text/html').send(closingPage('That sign-in link expired. Try again.'));
      }

      const client = oauthClient();
      const { tokens } = await client.getToken(code);
      if (!tokens.refresh_token) {
        return reply
          .type('text/html')
          .send(closingPage('Google did not return a refresh token. Remove the app at myaccount.google.com and retry.'));
      }
      client.setCredentials(tokens);

      const { data } = await google.oauth2({ version: 'v2', auth: client }).userinfo.get();
      const email = data.email ?? 'unknown';

      const accountId = accountIdForEmail(email) ?? id('ga');
      upsertAccount({
        accountId,
        email,
        refreshToken: tokens.refresh_token,
        accessToken: tokens.access_token ?? null,
        expiry: tokens.expiry_date ?? null,
      });

      await refreshCalendarList(accountId);
      void syncAll().catch(() => undefined);

      return reply.type('text/html').send(closingPage(`${email} connected. You can close this window.`));
    },
  );
}

function consumeState(state: string): boolean {
  const expires = pendingStates.get(state);
  pendingStates.delete(state);
  return Boolean(expires && expires > Date.now());
}

function toGoogleEvent(input: Partial<EventInput>) {
  const body: Record<string, unknown> = {};
  if (input.title !== undefined) body.summary = input.title;
  if (input.location !== undefined) body.location = input.location;
  if (input.description !== undefined) body.description = input.description;
  // An all-day boundary is already a `YYYY-MM-DD`, so the slice is a no-op kept
  // only to be strict about what Google accepts. It must not be handed an
  // instant: pulling the date off one would answer "which day?" in this
  // process's timezone rather than the household's.
  if (input.start) {
    body.start = input.allDay ? { date: input.start.slice(0, 10) } : { dateTime: input.start };
  }
  if (input.end) {
    body.end = input.allDay ? { date: input.end.slice(0, 10) } : { dateTime: input.end };
  }
  return body;
}

function closingPage(message: string): string {
  return `<!doctype html><meta charset="utf-8"><title>Hearth</title>
<body style="font-family:system-ui;display:grid;place-items:center;height:100vh;margin:0;background:#f4f5f8;color:#1e2230">
<div style="text-align:center;max-width:30rem;padding:2rem">
  <p style="font-size:1.1rem">${message}</p>
  <button onclick="window.close()" style="margin-top:1rem;padding:.7rem 1.4rem;border:0;border-radius:999px;background:#1e2230;color:#fff;font-size:1rem;cursor:pointer">Close</button>
</div>
<script>setTimeout(function(){window.close()},2500)</script>`;
}
