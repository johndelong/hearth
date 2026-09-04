import { randomBytes } from 'node:crypto';
import { type CalendarGroup, type EventInput, fromRRule, toRRule, upsertWhoTag } from '@dashboard/shared';
import type { FastifyInstance } from 'fastify';
import { type calendar_v3, google } from 'googleapis';
import { requireParent } from '../auth.js';
import { id } from '../db/index.js';
import { SCOPES, calendarApi, googleConfig, oauthClient } from '../google/client.js';
import { applyEvent, refreshCalendarList, syncAll, syncCalendar } from '../google/sync.js';
import {
  accountIdForEmail,
  deleteAccount,
  deleteEvent,
  getCachedEvent,
  getCalendar,
  getEventDetails,
  listAccounts,
  listCalendars,
  updateCalendar,
  upsertAccount,
} from '../store/calendars.js';
import { listEvents } from '../store/events.js';
import { listPeople } from '../store/people.js';
import { eventBody } from '../schemas.js';
import { recordActivity } from '../store/activity.js';

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

    guarded.patch<{
      Params: { id: string };
      Body: { personId?: string | null; group?: CalendarGroup | null; enabled?: boolean };
    }>('/api/calendars/:id', async (request, reply) => {
      const { personId, group, enabled } = request.body ?? {};
      if (personId) {
        const unknown = unknownPeople([personId]);
        if (unknown) return reply.code(400).send({ error: unknown });
      }
      if (!updateCalendar(request.params.id, { personId, group, enabled })) {
        return reply.code(400).send({ error: 'Nothing to update' });
      }

      // Newly enabled calendars have no cached events yet.
      if (enabled) void syncCalendar(request.params.id).catch(() => undefined);

      const updated = listCalendars().find((c) => c.id === request.params.id);
      if (updated) recordActivity('calendar.updated', updated.id, { personId, group, enabled });
      return updated ?? reply.code(404).send({ error: 'Unknown calendar' });
    });

    guarded.delete<{ Params: { id: string } }>('/api/google/accounts/:id', async (request) => {
      deleteAccount(request.params.id);
      recordActivity('calendar-account.disconnected', request.params.id);
      return { ok: true };
    });

    guarded.post<{ Body: EventInput }>('/api/events', { schema: { body: { ...eventBody, required: ['calendarId', 'title', 'start', 'end'] } } }, async (request, reply) => {
      const body = request.body;
      const invalid = validateEvent(body);
      if (invalid) return reply.code(400).send({ error: invalid });
      const cal = getCalendar(body?.calendarId ?? '');
      if (!cal) return reply.code(404).send({ error: 'Unknown calendar' });
      if (cal.readOnly) return reply.code(403).send({ error: 'That calendar is read-only' });

      if (body.personIds?.length) {
        const unknown = unknownPeople(body.personIds);
        if (unknown) return reply.code(400).send({ error: unknown });
      }

      const requestBody: calendar_v3.Schema$Event = {
        ...toGoogleEvent(body),
        ...(body.recurrence ? { recurrence: toRRule(body.recurrence, body.allDay ?? false) } : {}),
      };
      // Who it is for is text on the event itself, not where it is written —
      // tagging someone no longer needs them to have a calendar of their own.
      if (body.personIds?.length) {
        requestBody.description = upsertWhoTag(requestBody.description ?? null, namesFor(body.personIds));
      }

      const res = await calendarApi(cal.accountId).events.insert({ calendarId: cal.googleCalendarId, requestBody });
      if (res.data.id) {
        // Seeded now rather than left to the resync below, which pulls a
        // delta that may not yet reflect a write this same request just made.
        applyEvent(cal.id, res.data);
      }

      await syncCalendar(cal.id);
      recordActivity('event.created', cal.id, { title: body.title });
      return { googleId: res.data.id ?? null };
    });

    guarded.patch<{ Params: { id: string }; Body: Partial<EventInput> }>(
      '/api/events/:id', { schema: { body: eventBody } },
      async (request, reply) => {
        const invalid = validateEvent(request.body, true);
        if (invalid) return reply.code(400).send({ error: invalid });
        const cached = getCachedEvent(request.params.id);
        if (!cached) return reply.code(404).send({ error: 'Unknown event' });
        const cal = getCalendar(cached.calendarRowId);
        if (!cal) return reply.code(404).send({ error: 'Unknown calendar' });
        if (cal.readOnly) return reply.code(403).send({ error: 'That calendar is read-only' });

        if (request.body?.personIds) {
          const unknown = unknownPeople(request.body.personIds);
          if (unknown) return reply.code(400).send({ error: unknown });
        }

        // "All events" edits the master Google keeps behind the expansion; the
        // instance in front of us can only ever speak for its own occurrence.
        const wholeSeries = request.body?.scope === 'all' && cached.recurringEventId;

        const patch = toGoogleEvent(request.body);
        // Moving a whole series by patching the master's start would drag every
        // occurrence to that one day. The rule may change; the day may not.
        if (wholeSeries) {
          delete patch.start;
          delete patch.end;
        }
        if (request.body?.recurrence !== undefined) {
          if (!wholeSeries && cached.recurringEventId) {
            return reply.code(400).send({ error: 'Changing how it repeats has to apply to every event' });
          }
          patch.recurrence = request.body.recurrence
            ? toRRule(request.body.recurrence, request.body.allDay ?? false)
            : null;
        }
        // Changing who it is for rewrites the tag in the description, on top
        // of whatever else this save is changing — starting from the new
        // description if one was sent, else the one already on file, since
        // the tag has to land in the text that actually ships to Google.
        if (request.body?.personIds !== undefined) {
          const base = patch.description !== undefined ? patch.description : (getEventDetails(request.params.id)?.description ?? null);
          patch.description = upsertWhoTag(base ?? null, namesFor(request.body.personIds));
        }

        const res = await calendarApi(cal.accountId).events.patch({
          calendarId: cal.googleCalendarId,
          eventId: wholeSeries && cached.recurringEventId ? cached.recurringEventId : cached.googleId,
          requestBody: patch,
        });
        // A whole-series patch's response describes the master, not this
        // instance's own row — applying it would cache a phantom event under
        // the master's id, one Hearth never otherwise stores.
        if (!wholeSeries) applyEvent(cal.id, res.data);

        await syncCalendar(cal.id);
        recordActivity('event.updated', request.params.id, Object.keys(request.body ?? {}));
        return { ok: true };
      },
    );

    guarded.delete<{ Params: { id: string }; Querystring: { scope?: string } }>(
      '/api/events/:id',
      async (request, reply) => {
        const cached = getCachedEvent(request.params.id);
        if (!cached) return reply.code(404).send({ error: 'Unknown event' });
        const cal = getCalendar(cached.calendarRowId);
        if (!cal) return reply.code(404).send({ error: 'Unknown calendar' });
        if (cal.readOnly) return reply.code(403).send({ error: 'That calendar is read-only' });

        const scope = request.query.scope === 'all' ? 'all' : 'this';
        // Deleting an instance cancels that occurrence and leaves the series;
        // deleting the master takes the whole thing with it.
        await calendarApi(cal.accountId).events.delete({
          calendarId: cal.googleCalendarId,
          eventId: scope === 'all' && cached.recurringEventId ? cached.recurringEventId : cached.googleId,
        });

        // The sync is what removes the rest of a deleted series; this row goes
        // now so the panel does not draw it meanwhile.
        deleteEvent(request.params.id);
        await syncCalendar(cal.id);
        recordActivity('event.deleted', request.params.id, { scope });
        return { ok: true };
      },
    );

    /**
     * How a repeating event repeats.
     *
     * Read from Google rather than cached: `singleEvents: true` means we only
     * ever see expanded instances, and the rule lives on the master. Asking for
     * it on demand is one call in a parent's hands, and it cannot go stale.
     */
    guarded.get<{ Params: { id: string } }>('/api/events/:id/series', async (request, reply) => {
      const cached = getCachedEvent(request.params.id);
      if (!cached) return reply.code(404).send({ error: 'Unknown event' });
      if (!cached.recurringEventId) return { recurrence: null, editable: true };
      const cal = getCalendar(cached.calendarRowId);
      if (!cal) return reply.code(404).send({ error: 'Unknown calendar' });

      const master = await calendarApi(cal.accountId).events.get({
        calendarId: cal.googleCalendarId,
        eventId: cached.recurringEventId,
      });
      const startsOn = (master.data.start?.date ?? master.data.start?.dateTime ?? '').slice(0, 10);
      const recurrence = fromRRule(master.data.recurrence, startsOn);
      // A rule we cannot represent is reported rather than flattened — see
      // fromRRule. The event still opens; the repeat controls stay shut.
      return { recurrence, editable: recurrence !== null };
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

/** The first id that names nobody, as a message. Null when they all resolve. */
function unknownPeople(personIds: string[]): string | null {
  const known = new Set(listPeople().map((p) => p.id));
  const missing = personIds.find((personId) => !known.has(personId));
  return missing ? `Unknown person ${missing}` : null;
}

/** Household names for a set of person ids, in the order given. */
function namesFor(personIds: string[]): string[] {
  const byId = new Map(listPeople().map((p) => [p.id, p.name]));
  return personIds.map((personId) => byId.get(personId)).filter((name): name is string => Boolean(name));
}

function toGoogleEvent(input: Partial<EventInput>): calendar_v3.Schema$Event {
  const body: calendar_v3.Schema$Event = {};
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
  // `personIds`, `recurrence` and `scope` are deliberately absent: the first is
  // Hearth's alone, and the other two are handled by their callers, which know
  // whether they are addressing an instance or the series behind it.
  return body;
}

function validateEvent(input: Partial<EventInput>, partial = false): string | null {
  if (!partial && !input.title?.trim()) return 'title is required';
  if (input.allDay && ((input.start && !/^\d{4}-\d{2}-\d{2}$/.test(input.start)) || (input.end && !/^\d{4}-\d{2}-\d{2}$/.test(input.end)))) {
    return 'all-day boundaries must be YYYY-MM-DD';
  }
  for (const value of [input.start, input.end]) {
    if (value !== undefined && Number.isNaN(Date.parse(value))) return 'event boundaries must be valid dates';
  }
  if (input.start && input.end && Date.parse(input.end) <= Date.parse(input.start)) {
    return 'event end must be after its start';
  }
  return null;
}

function closingPage(message: string): string {
  return `<!doctype html><meta charset="utf-8"><title>Hearth</title>
<body style="font-family:system-ui;display:grid;place-items:center;height:100vh;margin:0;background:#f4f5f8;color:#1e2230">
<div style="text-align:center;max-width:30rem;padding:2rem">
  <p style="font-size:1.1rem">${escapeHtml(message)}</p>
  <button onclick="window.close()" style="margin-top:1rem;padding:.7rem 1.4rem;border:0;border-radius:999px;background:#1e2230;color:#fff;font-size:1rem;cursor:pointer">Close</button>
</div>
<script>setTimeout(function(){window.close()},2500)</script>`;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[char]!);
}
