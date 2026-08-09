import type { GoogleAccount, SubscribedCalendar } from '@dashboard/shared';
import { db, fromBool, id, nowIso, toBool } from '../db/index.js';

/**
 * Every query touching Google accounts, calendars, and the cached event rows.
 * The Google client and the calendar routes go through here so all SQL stays in
 * the store layer.
 */

// ---------- accounts ----------

export interface AccountCredentials {
  id: string;
  email: string;
  refreshToken: string;
  accessToken: string | null;
  expiry: number | null;
}

export function listAccounts(): GoogleAccount[] {
  return db
    .prepare<[], { id: string; email: string; connected_at: string; last_sync_at: string | null; error: string | null }>(
      'SELECT id, email, connected_at, last_sync_at, error FROM google_accounts ORDER BY connected_at',
    )
    .all()
    .map((r) => ({
      id: r.id,
      email: r.email,
      connectedAt: r.connected_at,
      lastSyncAt: r.last_sync_at,
      error: r.error,
    }));
}

export function accountIds(): string[] {
  return db.prepare<[], { id: string }>('SELECT id FROM google_accounts').all().map((r) => r.id);
}

export function accountCredentials(accountId: string): AccountCredentials | null {
  const row = db
    .prepare<[string], { id: string; email: string; refresh_token: string; access_token: string | null; expiry: number | null }>(
      'SELECT id, email, refresh_token, access_token, expiry FROM google_accounts WHERE id = ?',
    )
    .get(accountId);
  if (!row) return null;
  return {
    id: row.id,
    email: row.email,
    refreshToken: row.refresh_token,
    accessToken: row.access_token,
    expiry: row.expiry,
  };
}

export function accountIdForEmail(email: string): string | null {
  return (
    db.prepare<[string], { id: string }>('SELECT id FROM google_accounts WHERE email = ?').get(email)?.id ?? null
  );
}

/** Stores refreshed access tokens so a restart need not round-trip to Google. */
export function saveAccessToken(accountId: string, accessToken: string | null, expiry: number | null): void {
  db.prepare('UPDATE google_accounts SET access_token = ?, expiry = ?, error = NULL WHERE id = ?').run(
    accessToken,
    expiry,
    accountId,
  );
}

export function upsertAccount(params: {
  accountId: string;
  email: string;
  refreshToken: string;
  accessToken: string | null;
  expiry: number | null;
}): void {
  db.prepare(
    `INSERT INTO google_accounts (id, email, refresh_token, access_token, expiry, connected_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(email) DO UPDATE SET
       refresh_token = excluded.refresh_token,
       access_token = excluded.access_token,
       expiry = excluded.expiry,
       error = NULL`,
  ).run(params.accountId, params.email, params.refreshToken, params.accessToken, params.expiry, nowIso());
}

export function deleteAccount(accountId: string): void {
  db.prepare('DELETE FROM google_accounts WHERE id = ?').run(accountId);
}

export function markAccountSynced(accountId: string, error: string | null): void {
  db.prepare('UPDATE google_accounts SET error = ?, last_sync_at = ? WHERE id = ?').run(
    error,
    nowIso(),
    accountId,
  );
}

// ---------- calendars ----------

export interface CalendarRow {
  id: string;
  accountId: string;
  googleCalendarId: string;
  readOnly: boolean;
  syncToken: string | null;
  /** When the sync window was last established, or null if it never was. */
  windowAnchoredAt: string | null;
}

const toCalendarRow = (r: {
  id: string;
  account_id: string;
  google_calendar_id: string;
  read_only: number;
  sync_token: string | null;
  window_anchored_at: string | null;
}): CalendarRow => ({
  id: r.id,
  accountId: r.account_id,
  googleCalendarId: r.google_calendar_id,
  readOnly: toBool(r.read_only),
  syncToken: r.sync_token,
  windowAnchoredAt: r.window_anchored_at,
});

export function listCalendars(): SubscribedCalendar[] {
  return db
    .prepare<[], {
      id: string;
      account_id: string;
      google_calendar_id: string;
      summary: string;
      description: string | null;
      person_id: string | null;
      enabled: number;
      read_only: number;
      is_primary: number;
    }>('SELECT * FROM calendars ORDER BY is_primary DESC, summary')
    .all()
    .map((r) => ({
      id: r.id,
      accountId: r.account_id,
      googleCalendarId: r.google_calendar_id,
      summary: r.summary,
      description: r.description,
      personId: r.person_id,
      enabled: toBool(r.enabled),
      readOnly: toBool(r.read_only),
      primary: toBool(r.is_primary),
    }));
}

export function getCalendar(calendarRowId: string): CalendarRow | null {
  const row = db
    .prepare<[string], {
      id: string;
      account_id: string;
      google_calendar_id: string;
      read_only: number;
      sync_token: string | null;
      window_anchored_at: string | null;
    }>(
      `SELECT id, account_id, google_calendar_id, read_only, sync_token, window_anchored_at
         FROM calendars WHERE id = ?`,
    )
    .get(calendarRowId);
  return row ? toCalendarRow(row) : null;
}

export function enabledCalendarIds(accountId: string): string[] {
  return db
    .prepare<[string], { id: string }>('SELECT id FROM calendars WHERE account_id = ? AND enabled = 1')
    .all(accountId)
    .map((r) => r.id);
}

export function upsertCalendar(params: {
  accountId: string;
  googleCalendarId: string;
  summary: string;
  description: string | null;
  enabled: boolean;
  readOnly: boolean;
  primary: boolean;
  timeZone: string | null;
}): void {
  db.prepare(
    `INSERT INTO calendars (id, account_id, google_calendar_id, summary, description, enabled, read_only, is_primary, time_zone)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(account_id, google_calendar_id) DO UPDATE SET
       summary = excluded.summary,
       description = excluded.description,
       read_only = excluded.read_only,
       is_primary = excluded.is_primary,
       time_zone = excluded.time_zone`,
  ).run(
    id('cal'),
    params.accountId,
    params.googleCalendarId,
    params.summary,
    params.description,
    fromBool(params.enabled),
    fromBool(params.readOnly),
    fromBool(params.primary),
    params.timeZone,
  );
}

/** Returns false when the patch had nothing to change. */
export function updateCalendar(
  calendarRowId: string,
  patch: { personId?: string | null; enabled?: boolean },
): boolean {
  const sets: string[] = [];
  const values: unknown[] = [];
  if (patch.personId !== undefined) (sets.push('person_id = ?'), values.push(patch.personId));
  if (patch.enabled !== undefined) (sets.push('enabled = ?'), values.push(fromBool(patch.enabled)));
  if (!sets.length) return false;

  db.prepare(`UPDATE calendars SET ${sets.join(', ')} WHERE id = ?`).run(...values, calendarRowId);
  return true;
}

export function saveSyncToken(calendarRowId: string, token: string | null): void {
  db.prepare('UPDATE calendars SET sync_token = ? WHERE id = ?').run(token, calendarRowId);
}

/** Records that this calendar's window was just pulled fresh. */
export function markWindowAnchored(calendarRowId: string, at: string): void {
  db.prepare('UPDATE calendars SET window_anchored_at = ? WHERE id = ?').run(at, calendarRowId);
}

// ---------- cached events ----------

export interface CachedEvent {
  googleId: string;
  calendarRowId: string;
}

export function getCachedEvent(eventId: string): CachedEvent | null {
  const row = db
    .prepare<[string], { google_id: string; calendar_id: string }>(
      'SELECT google_id, calendar_id FROM events WHERE id = ?',
    )
    .get(eventId);
  return row ? { googleId: row.google_id, calendarRowId: row.calendar_id } : null;
}

export function upsertEvent(params: {
  calendarRowId: string;
  googleId: string;
  title: string;
  location: string | null;
  description: string | null;
  start: string;
  end: string;
  allDay: boolean;
  status: string | null;
  updatedAt: string;
}): void {
  db.prepare(
    `INSERT INTO events (id, calendar_id, google_id, title, location, description, start_utc, end_utc, all_day, status, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(calendar_id, google_id) DO UPDATE SET
       title = excluded.title,
       location = excluded.location,
       description = excluded.description,
       start_utc = excluded.start_utc,
       end_utc = excluded.end_utc,
       all_day = excluded.all_day,
       status = excluded.status,
       updated_at = excluded.updated_at`,
  ).run(
    id('ev'),
    params.calendarRowId,
    params.googleId,
    params.title,
    params.location,
    params.description,
    params.start,
    params.end,
    fromBool(params.allDay),
    params.status,
    params.updatedAt,
  );
}

export function deleteEventByGoogleId(calendarRowId: string, googleId: string): void {
  db.prepare('DELETE FROM events WHERE calendar_id = ? AND google_id = ?').run(calendarRowId, googleId);
}

export function deleteEvent(eventId: string): void {
  db.prepare('DELETE FROM events WHERE id = ?').run(eventId);
}

/**
 * Drops every cached event for a calendar that a full-window pull did not
 * return — events deleted in Google, and events that have fallen outside the
 * window. This is how a full pull prunes, rather than by wiping the calendar
 * first: rows that survive keep their `id`, and the dashboard edits events by
 * that id, so churning them would break an editor someone left open.
 *
 * The ids go over as one JSON array rather than thousands of bound parameters,
 * which SQLite would refuse past its variable limit.
 */
export function sweepEvents(calendarRowId: string, keepGoogleIds: string[]): number {
  const res = db
    .prepare('DELETE FROM events WHERE calendar_id = ? AND google_id NOT IN (SELECT value FROM json_each(?))')
    .run(calendarRowId, JSON.stringify(keepGoogleIds));
  return Number(res.changes);
}
