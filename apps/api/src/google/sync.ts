import type { calendar_v3 } from 'googleapis';
import { db, nowIso } from '../db/index.js';
import {
  accountIds,
  clearCalendarEvents,
  deleteEventByGoogleId,
  enabledCalendarIds,
  getCalendar,
  saveSyncToken,
  upsertCalendar,
  upsertEvent,
} from '../store/calendars.js';
import { calendarApi, markAccountError } from './client.js';

/**
 * Sync horizon. Wide enough for the month view plus a look ahead, narrow enough
 * that the cache stays small on a wall panel.
 */
const WINDOW_BACK_DAYS = 45;
const WINDOW_FORWARD_DAYS = 180;

const windowBounds = () => {
  const min = new Date();
  min.setDate(min.getDate() - WINDOW_BACK_DAYS);
  const max = new Date();
  max.setDate(max.getDate() + WINDOW_FORWARD_DAYS);
  return { timeMin: min.toISOString(), timeMax: max.toISOString() };
};

/** Pull the account's calendar list into the `calendars` table. */
export async function refreshCalendarList(accountId: string): Promise<void> {
  const api = calendarApi(accountId);
  const res = await api.calendarList.list({ maxResults: 250, showHidden: false });

  db.transaction(() => {
    for (const item of res.data.items ?? []) {
      if (!item.id) continue;
      const writable = item.accessRole === 'owner' || item.accessRole === 'writer';
      upsertCalendar({
        accountId,
        googleCalendarId: item.id,
        summary: item.summaryOverride ?? item.summary ?? item.id,
        description: item.description ?? null,
        enabled: item.selected ?? item.primary ?? false,
        readOnly: !writable,
        primary: item.primary ?? false,
        timeZone: item.timeZone ?? null,
      });
    }
  })();
}

/**
 * Incremental sync for one calendar. Google's syncToken gives us only what
 * changed; a 410 means the token expired and we fall back to a full window pull.
 */
export async function syncCalendar(calendarRowId: string): Promise<number> {
  const cal = getCalendar(calendarRowId);
  if (!cal) return 0;

  const api = calendarApi(cal.accountId);
  let token = cal.syncToken;
  let changed = 0;

  const run = async (useToken: string | null): Promise<string | null | undefined> => {
    let pageToken: string | undefined;
    let nextSyncToken: string | null | undefined;
    do {
      const params: calendar_v3.Params$Resource$Events$List = {
        calendarId: cal.googleCalendarId,
        singleEvents: true, // expand recurrence into concrete instances
        maxResults: 2500,
        pageToken,
      };
      if (useToken) params.syncToken = useToken;
      else Object.assign(params, windowBounds(), { orderBy: 'startTime' });

      const res = await api.events.list(params);
      for (const ev of res.data.items ?? []) {
        changed += applyEvent(cal.id, ev);
      }
      pageToken = res.data.nextPageToken ?? undefined;
      nextSyncToken = res.data.nextSyncToken;
    } while (pageToken);
    return nextSyncToken;
  };

  try {
    const next = await run(token);
    token = next ?? null;
  } catch (err) {
    const status = (err as { code?: number; status?: number }).code ?? (err as { status?: number }).status;
    if (status === 410) {
      clearCalendarEvents(cal.id);
      token = (await run(null)) ?? null;
    } else {
      throw err;
    }
  }

  saveSyncToken(cal.id, token);
  return changed;
}

/**
 * Writes one Google event into the cache. Cancellations delete the row.
 *
 * Both forms Google sends are stored exactly as they arrive: `dateTime` is an
 * instant with an offset, and `date` is a bare `YYYY-MM-DD` that stays a date.
 * Converting an all-day date to an instant here would stamp it with whatever
 * timezone this process happens to run in — which for a container is UTC — and
 * that stamp would then decide which day the panel drew it on. The viewer
 * resolves it instead; see `resolveBoundary` in @dashboard/shared.
 */
function applyEvent(calendarRowId: string, ev: calendar_v3.Schema$Event): number {
  if (!ev.id) return 0;

  if (ev.status === 'cancelled') {
    deleteEventByGoogleId(calendarRowId, ev.id);
    return 1;
  }

  const allDay = Boolean(ev.start?.date);
  const start = ev.start?.dateTime ?? ev.start?.date;
  const end = ev.end?.dateTime ?? ev.end?.date;
  if (!start || !end) return 0;

  upsertEvent({
    calendarRowId,
    googleId: ev.id,
    title: ev.summary ?? '(no title)',
    location: ev.location ?? null,
    description: ev.description ?? null,
    start,
    end,
    allDay,
    status: ev.status ?? null,
    updatedAt: ev.updated ?? nowIso(),
  });
  return 1;
}

/** Sync every enabled calendar on every connected account. */
export async function syncAll(): Promise<{ calendars: number; changed: number }> {
  let calendars = 0;
  let changed = 0;

  for (const accountId of accountIds()) {
    try {
      await refreshCalendarList(accountId);
      for (const calendarRowId of enabledCalendarIds(accountId)) {
        changed += await syncCalendar(calendarRowId);
        calendars += 1;
      }
      markAccountError(accountId, null);
    } catch (err) {
      // One broken account must not stop the others from syncing.
      markAccountError(accountId, err instanceof Error ? err.message : String(err));
    }
  }
  return { calendars, changed };
}

let timer: NodeJS.Timeout | null = null;

export function startSyncLoop(intervalMs = 5 * 60_000): void {
  if (timer) return;
  const tick = () => {
    void syncAll().catch(() => {
      /* errors are recorded per-account in syncAll */
    });
  };
  tick();
  timer = setInterval(tick, intervalMs);
  timer.unref?.();
}
