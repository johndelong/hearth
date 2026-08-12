import type { calendar_v3 } from 'googleapis';
import { db, nowIso } from '../db/index.js';
import type { CalendarRow } from '../store/calendars.js';
import {
  accountIds,
  deleteEventByGoogleId,
  enabledCalendarIds,
  getCalendar,
  markWindowAnchored,
  saveSyncToken,
  sweepEvents,
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

export const windowBounds = (now: Date = new Date()) => {
  const min = new Date(now);
  min.setDate(min.getDate() - WINDOW_BACK_DAYS);
  const max = new Date(now);
  max.setDate(max.getDate() + WINDOW_FORWARD_DAYS);
  return { timeMin: min.toISOString(), timeMax: max.toISOString() };
};

/**
 * How long we let a window drift before pulling a fresh one.
 *
 * A sync token carries the timeMin/timeMax of the request that created it, and
 * Google will not let an incremental sync change them. So the window does not
 * follow the calendar forward: it stays where it was born and the usable horizon
 * shrinks a day per day. A week of drift costs seven days off a 180-day horizon,
 * which nobody can see, and re-anchoring weekly costs one full pull per calendar
 * per week — the bandwidth argument for incremental sync survives intact.
 */
const MAX_ANCHOR_AGE_MS = 7 * 24 * 60 * 60_000;

/**
 * Whether this calendar needs a full-window pull rather than an incremental one.
 *
 * An unparseable timestamp answers true through the negated comparison, because
 * NaN fails every test: not knowing when the window was anchored is a reason to
 * anchor it, never a reason to keep drifting.
 */
export function needsAnchor(
  cal: Pick<CalendarRow, 'syncToken' | 'windowAnchoredAt'>,
  now: Date = new Date(),
): boolean {
  if (!cal.syncToken || !cal.windowAnchoredAt) return true;
  return !(now.getTime() - Date.parse(cal.windowAnchoredAt) < MAX_ANCHOR_AGE_MS);
}

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

/** The one call this module makes against Google, injectable so it can be tested. */
export type ListEvents = (
  params: calendar_v3.Params$Resource$Events$List,
) => Promise<calendar_v3.Schema$Events>;

const googleList =
  (accountId: string): ListEvents =>
  (params) =>
    calendarApi(accountId).events.list(params).then((res) => res.data);

/**
 * Sync one calendar, incrementally when we can and from a fresh window when we
 * must. Returns how many cached rows the sync touched.
 *
 * Three paths reach the same place. An incremental sync asks Google for what
 * changed since the sync token. An anchored sync pulls the whole window and
 * sweeps away anything it did not return, which is what re-establishes the
 * horizon and prunes events that have aged out of it. A 410 — the token expired
 * before we used it — falls back to the anchored path.
 *
 * Fetching and writing are kept strictly apart. `node:sqlite` is synchronous, so
 * every write holds the one thread Fastify answers requests on — writing each
 * event as it arrives meant a full pull was thousands of separate commits, each
 * with its own fsync, and the dashboard could not be served for the duration.
 * Collecting the pages first and committing them once turns that into a single
 * fsync the panel never notices, and it means the sweep and the refill share a
 * transaction so a reader can never catch the calendar mid-rebuild.
 */
export async function syncCalendar(calendarRowId: string, list?: ListEvents): Promise<number> {
  const cal = getCalendar(calendarRowId);
  if (!cal) return 0;

  const listEvents = list ?? googleList(cal.accountId);
  const startedAt = new Date();

  /** Every page Google has for us, read before a single row is written. */
  const fetchAll = async (
    useToken: string | null,
  ): Promise<{ items: calendar_v3.Schema$Event[]; nextSyncToken: string | null | undefined }> => {
    const items: calendar_v3.Schema$Event[] = [];
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
      else Object.assign(params, windowBounds(startedAt), { orderBy: 'startTime' });

      const data = await listEvents(params);
      items.push(...(data.items ?? []));
      pageToken = data.nextPageToken ?? undefined;
      nextSyncToken = data.nextSyncToken;
    } while (pageToken);
    return { items, nextSyncToken };
  };

  /** A delta: apply what arrived and touch nothing else. */
  const commitDelta = db.transaction((items: calendar_v3.Schema$Event[]): number => {
    let changed = 0;
    for (const ev of items) changed += applyEvent(cal.id, ev);
    return changed;
  });

  /**
   * A full window: apply everything, then sweep whatever Google did not mention.
   * Upsert-then-sweep rather than wipe-then-fill, so surviving events keep the
   * row ids the dashboard edits them by.
   */
  const commitWindow = db.transaction((items: calendar_v3.Schema$Event[]): number => {
    const keep: string[] = [];
    let changed = 0;
    for (const ev of items) {
      changed += applyEvent(cal.id, ev);
      if (ev.id && ev.status !== 'cancelled') keep.push(ev.id);
    }
    return changed + sweepEvents(cal.id, keep);
  });

  const anchoredSync = async () => {
    const pulled = await fetchAll(null);
    const changed = commitWindow(pulled.items);
    markWindowAnchored(cal.id, startedAt.toISOString());
    return { pulled, changed };
  };

  let result: { pulled: { nextSyncToken: string | null | undefined }; changed: number };

  if (needsAnchor(cal, startedAt)) {
    result = await anchoredSync();
  } else {
    try {
      const pulled = await fetchAll(cal.syncToken);
      result = { pulled, changed: commitDelta(pulled.items) };
    } catch (err) {
      const status = (err as { code?: number; status?: number }).code ?? (err as { status?: number }).status;
      if (status !== 410) throw err;
      result = await anchoredSync();
    }
  }

  saveSyncToken(cal.id, result.pulled.nextSyncToken ?? null);
  return result.changed;
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
    // Present only on an instance Google expanded out of a series.
    recurringEventId: ev.recurringEventId ?? null,
    // Written by Hearth when it fanned this event out across calendars; absent
    // on everything else, which is then simply its own event.
    hearthGroup: ev.extendedProperties?.private?.hearthGroup ?? null,
  });
  return 1;
}

export interface SyncResult { calendars: number; changed: number }

let syncInFlight: Promise<SyncResult> | null = null;
let lastSync: { at: number; result: SyncResult } | null = null;
const SYNC_COOLDOWN_MS = 15_000;

/**
 * Sync every enabled calendar. All callers share one in-flight operation, and
 * wake/reconnect bursts reuse a very recent result instead of hitting Google
 * once per panel.
 */
export function syncAll(): Promise<SyncResult> {
  if (syncInFlight) return syncInFlight;
  if (lastSync && Date.now() - lastSync.at < SYNC_COOLDOWN_MS) return Promise.resolve(lastSync.result);
  syncInFlight = runSyncAll().then((result) => {
    lastSync = { at: Date.now(), result };
    return result;
  }).finally(() => {
    syncInFlight = null;
  });
  return syncInFlight;
}

async function runSyncAll(): Promise<SyncResult> {
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
