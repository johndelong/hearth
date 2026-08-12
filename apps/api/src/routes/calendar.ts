import { randomBytes } from 'node:crypto';
import { type EventInput, fromRRule, toRRule } from '@dashboard/shared';
import type { FastifyInstance } from 'fastify';
import { type calendar_v3, google } from 'googleapis';
import { requireParent } from '../auth.js';
import { id } from '../db/index.js';
import { SCOPES, calendarApi, googleConfig, oauthClient } from '../google/client.js';
import { refreshCalendarList, syncAll, syncCalendar } from '../google/sync.js';
import type { CachedEvent } from '../store/calendars.js';
import {
  accountIdForEmail,
  deleteAccount,
  deleteEvent,
  eventGroupCopies,
  getCachedEvent,
  getCalendar,
  getEventDetails,
  listAccounts,
  listCalendars,
  updateCalendar,
  writableCalendarByPerson,
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
        if (updated) recordActivity('calendar.updated', updated.id, { personId, enabled });
        return updated ?? reply.code(404).send({ error: 'Unknown calendar' });
      },
    );

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

      // Who is going decides where it is written. Everyone named gets a real
      // copy on their own calendar, so Google is as truthful as the panel.
      let targets = [cal];
      if (body.personIds?.length) {
        const unknown = unknownPeople(body.personIds);
        if (unknown) return reply.code(400).send({ error: unknown });
        const resolved = calendarsForPeople(body.personIds);
        if ('error' in resolved) return reply.code(400).send({ error: resolved.error });
        targets = resolved.calendars;
      }

      // A shared repeating event would be one series per calendar, each with
      // its own master, and an "all events" edit that can half-succeed. Refused
      // until the single-series path has earned its keep.
      if (body.recurrence && targets.length > 1) {
        return reply.code(400).send({
          error: 'A repeating event can only be on one calendar for now — pick one person, or turn off Repeats',
        });
      }

      const group = id('grp');
      const created: string[] = [];
      for (const target of targets) {
        const res = await calendarApi(target.accountId).events.insert({
          calendarId: target.googleCalendarId,
          requestBody: {
            ...toGoogleEvent(body),
            ...(body.recurrence ? { recurrence: toRRule(body.recurrence, body.allDay ?? false) } : {}),
            // Invisible in every Google UI, and what ties the copies back
            // together — matching titles and times would merge two people's
            // separate three o'clock appointments into one.
            extendedProperties: { private: { hearthGroup: group } },
          },
        });
        if (res.data.id) created.push(res.data.id);
      }

      for (const target of targets) await syncCalendar(target.id);
      recordActivity('event.created', cal.id, { title: body.title, copies: created.length });
      return { googleId: created[0] ?? null, copies: created.length };
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

        // "All events" edits the master Google keeps behind the expansion; the
        // instance in front of us can only ever speak for its own occurrence.
        const wholeSeries = request.body?.scope === 'all' && cached.recurringEventId;
        const targetId = wholeSeries ? cached.recurringEventId! : cached.googleId;

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

        // Every copy of a shared event is the same event, so an edit lands on
        // all of them. The one in hand is the only copy when there is no group.
        const copies = cached.hearthGroup ? eventGroupCopies(cached.hearthGroup) : [cached];
        const touched = new Set<string>();

        for (const copy of copies) {
          const copyCal = getCalendar(copy.calendarRowId);
          if (!copyCal || copyCal.readOnly) continue;
          await calendarApi(copyCal.accountId).events.patch({
            calendarId: copyCal.googleCalendarId,
            eventId: wholeSeries && copy.recurringEventId ? copy.recurringEventId : copy.googleId,
            requestBody: patch,
          });
          touched.add(copyCal.id);
        }

        // Changing who is going is a change of where the event lives: someone
        // added needs a copy made, someone dropped needs theirs removed.
        if (request.body?.personIds && cached.hearthGroup) {
          const moved = await reshareEvent(request.params.id, cached.hearthGroup, copies, request.body);
          if ('error' in moved) return reply.code(400).send({ error: moved.error });
          for (const calendarRowId of moved.touched) touched.add(calendarRowId);
        }

        for (const calendarRowId of touched) await syncCalendar(calendarRowId);
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
        const copies = cached.hearthGroup ? eventGroupCopies(cached.hearthGroup) : [cached];

        for (const copy of copies) {
          const copyCal = getCalendar(copy.calendarRowId);
          if (!copyCal || copyCal.readOnly) continue;
          // Deleting an instance cancels that occurrence and leaves the series;
          // deleting the master takes the whole thing with it.
          await calendarApi(copyCal.accountId).events.delete({
            calendarId: copyCal.googleCalendarId,
            eventId: scope === 'all' && copy.recurringEventId ? copy.recurringEventId : copy.googleId,
          });
        }

        // The sync is what removes the rest of a deleted series and the other
        // copies; this row goes now so the panel does not draw it meanwhile.
        deleteEvent(request.params.id);
        for (const copy of copies) await syncCalendar(copy.calendarRowId);
        recordActivity('event.deleted', request.params.id, { scope, copies: copies.length });
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

/**
 * Brings a shared event's copies in line with who is going now: a copy made on
 * each newly named person's calendar, and the copy removed from anyone dropped.
 *
 * Deliberately not a delete-and-recreate of the whole set. Rewriting every copy
 * would give the untouched people a brand new event — losing anything they had
 * changed on their own copy, and making it reappear as new on their phone.
 */
async function reshareEvent(
  eventId: string,
  group: string,
  copies: CachedEvent[],
  body: Partial<EventInput>,
): Promise<{ touched: string[] } | { error: string }> {
  const resolved = calendarsForPeople(body.personIds ?? []);
  if ('error' in resolved) return resolved;

  const wanted = new Map(resolved.calendars.map((c) => [c.id, c]));
  const held = new Map(copies.map((c) => [c.calendarRowId, c]));
  const touched: string[] = [];

  // A new copy is a whole event, not the edit that prompted it: the patch may
  // say nothing but "Gemma is coming too", and a copy built from that alone
  // would be a blank entry on her calendar.
  const details = getEventDetails(eventId);

  for (const [calendarRowId, cal] of wanted) {
    if (held.has(calendarRowId)) continue;
    if (!details) return { error: 'That event is no longer cached — sync and try again' };
    await calendarApi(cal.accountId).events.insert({
      calendarId: cal.googleCalendarId,
      requestBody: {
        ...toGoogleEvent({ ...details, ...body }),
        extendedProperties: { private: { hearthGroup: group } },
      },
    });
    touched.push(cal.id);
  }

  for (const [calendarRowId, copy] of held) {
    if (wanted.has(calendarRowId)) continue;
    const cal = getCalendar(calendarRowId);
    if (!cal || cal.readOnly) continue;
    await calendarApi(cal.accountId).events.delete({
      calendarId: cal.googleCalendarId,
      eventId: copy.googleId,
    });
    touched.push(cal.id);
  }

  return { touched };
}

/**
 * The calendars a set of people's copies belong on.
 *
 * Someone with no writable calendar cannot be given one, which is why the
 * editor does not offer them — but the check lives here too, because the API is
 * not the editor's to trust.
 */
function calendarsForPeople(
  personIds: string[],
): { calendars: NonNullable<ReturnType<typeof getCalendar>>[] } | { error: string } {
  const byPerson = writableCalendarByPerson();
  const calendars = [];
  const seen = new Set<string>();
  for (const personId of personIds) {
    const calendarRowId = byPerson.get(personId);
    if (!calendarRowId) {
      const person = listPeople().find((p) => p.id === personId);
      return { error: `${person?.name ?? 'That person'} has no calendar to add this to` };
    }
    // Two people sharing a calendar get one copy, not two identical ones.
    if (seen.has(calendarRowId)) continue;
    seen.add(calendarRowId);
    const cal = getCalendar(calendarRowId);
    if (cal) (calendars.push(cal), undefined);
  }
  return { calendars };
}

/** The first id that names nobody, as a message. Null when they all resolve. */
function unknownPeople(personIds: string[]): string | null {
  const known = new Set(listPeople().map((p) => p.id));
  const missing = personIds.find((personId) => !known.has(personId));
  return missing ? `Unknown person ${missing}` : null;
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
