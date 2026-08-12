import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, test } from 'node:test';
import type { calendar_v3 } from 'googleapis';

/**
 * The sync process, exercised against a real SQLite file.
 *
 * `db/index.ts` opens its database at import time from DATABASE_PATH, so the
 * temp path has to be set before these modules load — hence the dynamic imports.
 * The database is real rather than mocked on purpose: the things worth proving
 * here are what survives a commit, which a fake store could not tell us.
 */
process.env.DATABASE_PATH = join(mkdtempSync(join(tmpdir(), 'hearth-sync-')), 'test.db');

const { db } = await import('../db/index.js');
const {
  eventKey,
  getCalendar,
  listCalendars,
  markWindowAnchored,
  peopleByEventKey,
  saveSyncToken,
  setEventPeople,
  upsertAccount,
  upsertCalendar,
} = await import('../store/calendars.js');
const { createPerson } = await import('../store/people.js');
const { updateCalendar } = await import('../store/calendars.js');
const { listEvents } = await import('../store/events.js');
const { needsAnchor, syncCalendar, windowBounds } = await import('./sync.js');

const DAY_MS = 24 * 60 * 60_000;

/** Puts a calendar back to "never pulled", so the next sync is a full window. */
function forceFullWindow(calendarRowId: string): void {
  saveSyncToken(calendarRowId, null);
  db.prepare('UPDATE calendars SET window_anchored_at = NULL WHERE id = ?').run(calendarRowId);
}

/** A fresh account and calendar, returning the calendar's row id. */
function makeCalendar(): string {
  db.exec('DELETE FROM events');
  db.exec('DELETE FROM calendars');
  db.exec('DELETE FROM google_accounts');

  upsertAccount({
    accountId: 'acct_1',
    email: 'test@example.com',
    refreshToken: 'refresh',
    accessToken: null,
    expiry: null,
  });
  upsertCalendar({
    accountId: 'acct_1',
    googleCalendarId: 'primary@example.com',
    summary: 'Test',
    description: null,
    enabled: true,
    readOnly: false,
    primary: true,
    timeZone: 'America/New_York',
  });

  const cal = listCalendars()[0];
  assert.ok(cal, 'expected the calendar to be created');
  return cal.id;
}

const timedEvent = (id: string, summary: string, startIso: string): calendar_v3.Schema$Event => ({
  id,
  summary,
  status: 'confirmed',
  start: { dateTime: startIso },
  end: { dateTime: new Date(Date.parse(startIso) + 60 * 60_000).toISOString() },
  updated: '2026-01-01T00:00:00.000Z',
});

/**
 * A stand-in for Google that answers with whatever the test set up and records
 * the parameters it was asked with, so assertions can check the request as well
 * as the result.
 */
function fakeGoogle(pages: calendar_v3.Schema$Events[]) {
  const calls: calendar_v3.Params$Resource$Events$List[] = [];
  let next = 0;
  const list = async (params: calendar_v3.Params$Resource$Events$List) => {
    calls.push(params);
    const page = pages[Math.min(next, pages.length - 1)];
    next += 1;
    if (!page) throw new Error('fakeGoogle ran out of pages');
    return page;
  };
  return { list, calls };
}

/** An error shaped the way googleapis reports an expired sync token. */
const gone = () => Object.assign(new Error('Sync token is no longer valid'), { code: 410 });

/** Cached event titles in the window, which is what the dashboard would render. */
const cachedTitles = (): string[] => {
  const from = new Date(Date.now() - 400 * DAY_MS).toISOString();
  const to = new Date(Date.now() + 400 * DAY_MS).toISOString();
  return listEvents(from, to)
    .filter((e) => !e.synthetic)
    .map((e) => e.title)
    .sort();
};

describe('needsAnchor', () => {
  const now = new Date('2026-08-09T12:00:00.000Z');

  test('a calendar with no sync token needs a full window', () => {
    assert.equal(needsAnchor({ syncToken: null, windowAnchoredAt: null }, now), true);
  });

  test('a token with no recorded anchor needs one — we cannot tell how far it has drifted', () => {
    assert.equal(needsAnchor({ syncToken: 'tok', windowAnchoredAt: null }, now), true);
  });

  test('a recently anchored token syncs incrementally', () => {
    const anchored = new Date(now.getTime() - 2 * DAY_MS).toISOString();
    assert.equal(needsAnchor({ syncToken: 'tok', windowAnchoredAt: anchored }, now), false);
  });

  test('a window older than a week is re-anchored', () => {
    const anchored = new Date(now.getTime() - 8 * DAY_MS).toISOString();
    assert.equal(needsAnchor({ syncToken: 'tok', windowAnchoredAt: anchored }, now), true);
  });

  test('an unreadable anchor timestamp re-anchors rather than drifting on', () => {
    assert.equal(needsAnchor({ syncToken: 'tok', windowAnchoredAt: 'not a date' }, now), true);
  });
});

describe('windowBounds', () => {
  test('brackets the given moment, so a later sync asks for a later window', () => {
    const june = windowBounds(new Date('2026-06-01T00:00:00.000Z'));
    const july = windowBounds(new Date('2026-07-01T00:00:00.000Z'));
    assert.ok(Date.parse(june.timeMin) < Date.parse(june.timeMax));
    assert.ok(
      Date.parse(july.timeMax) > Date.parse(june.timeMax),
      'a window anchored later must reach further forward',
    );
  });
});

describe('syncCalendar', () => {
  let calendarId: string;
  beforeEach(() => {
    calendarId = makeCalendar();
  });

  test('the first sync pulls a full window and stores its events', async () => {
    const google = fakeGoogle([
      { items: [timedEvent('g1', 'Soccer', '2026-08-10T22:00:00.000Z')], nextSyncToken: 'tok-1' },
    ]);

    const changed = await syncCalendar(calendarId, google.list);

    assert.equal(changed, 1);
    assert.deepEqual(cachedTitles(), ['Soccer']);
    assert.equal(getCalendar(calendarId)?.syncToken, 'tok-1');
    assert.ok(getCalendar(calendarId)?.windowAnchoredAt, 'the window should be recorded as anchored');
  });

  test('a full window asks for bounds; an incremental sync asks with the token', async () => {
    const first = fakeGoogle([{ items: [], nextSyncToken: 'tok-1' }]);
    await syncCalendar(calendarId, first.list);
    assert.ok(first.calls[0]?.timeMin, 'the anchoring pull must send a window');
    assert.equal(first.calls[0]?.syncToken, undefined);

    const second = fakeGoogle([{ items: [], nextSyncToken: 'tok-2' }]);
    await syncCalendar(calendarId, second.list);
    assert.equal(second.calls[0]?.syncToken, 'tok-1', 'the second sync should be incremental');
    assert.equal(second.calls[0]?.timeMin, undefined, 'Google rejects bounds alongside a sync token');
  });

  test('re-syncing keeps event row ids stable, so an open editor stays valid', async () => {
    const google = fakeGoogle([
      { items: [timedEvent('g1', 'Soccer', '2026-08-10T22:00:00.000Z')], nextSyncToken: 'tok-1' },
    ]);
    await syncCalendar(calendarId, google.list);
    const before = db.prepare<[], { id: string }>('SELECT id FROM events').all();

    // Force the next sync down the anchored path, which is the one that sweeps.
    saveSyncToken(calendarId, null);
    const again = fakeGoogle([
      { items: [timedEvent('g1', 'Soccer practice', '2026-08-10T22:00:00.000Z')], nextSyncToken: 'tok-2' },
    ]);
    await syncCalendar(calendarId, again.list);

    const after = db.prepare<[], { id: string }>('SELECT id FROM events').all();
    assert.deepEqual(after, before, 'the surviving event kept its row id');
    assert.deepEqual(cachedTitles(), ['Soccer practice'], 'and picked up its new title');
  });

  test('a full window sweeps away events Google no longer returns', async () => {
    const google = fakeGoogle([
      {
        items: [
          timedEvent('g1', 'Soccer', '2026-08-10T22:00:00.000Z'),
          timedEvent('g2', 'Dentist', '2026-08-11T14:00:00.000Z'),
        ],
        nextSyncToken: 'tok-1',
      },
    ]);
    await syncCalendar(calendarId, google.list);
    assert.deepEqual(cachedTitles(), ['Dentist', 'Soccer']);

    // A week later the window has drifted, so this sync re-anchors — and the
    // dentist appointment has aged out of the new window.
    markWindowAnchored(calendarId, new Date(Date.now() - 8 * DAY_MS).toISOString());
    const later = fakeGoogle([
      { items: [timedEvent('g1', 'Soccer', '2026-08-10T22:00:00.000Z')], nextSyncToken: 'tok-2' },
    ]);
    await syncCalendar(calendarId, later.list);

    assert.deepEqual(cachedTitles(), ['Soccer'], 'the event outside the new window was pruned');
  });

  test('an incremental sync never sweeps — a delta is not the whole truth', async () => {
    const first = fakeGoogle([
      {
        items: [
          timedEvent('g1', 'Soccer', '2026-08-10T22:00:00.000Z'),
          timedEvent('g2', 'Dentist', '2026-08-11T14:00:00.000Z'),
        ],
        nextSyncToken: 'tok-1',
      },
    ]);
    await syncCalendar(calendarId, first.list);

    const delta = fakeGoogle([
      { items: [timedEvent('g3', 'Piano', '2026-08-12T20:00:00.000Z')], nextSyncToken: 'tok-2' },
    ]);
    await syncCalendar(calendarId, delta.list);

    assert.deepEqual(cachedTitles(), ['Dentist', 'Piano', 'Soccer']);
  });

  test('a cancelled event in a delta deletes the cached row', async () => {
    const first = fakeGoogle([
      { items: [timedEvent('g1', 'Soccer', '2026-08-10T22:00:00.000Z')], nextSyncToken: 'tok-1' },
    ]);
    await syncCalendar(calendarId, first.list);

    const delta = fakeGoogle([{ items: [{ id: 'g1', status: 'cancelled' }], nextSyncToken: 'tok-2' }]);
    await syncCalendar(calendarId, delta.list);

    assert.deepEqual(cachedTitles(), []);
  });

  test('an expired token falls back to a full window instead of failing', async () => {
    const first = fakeGoogle([
      { items: [timedEvent('g1', 'Soccer', '2026-08-10T22:00:00.000Z')], nextSyncToken: 'tok-1' },
    ]);
    await syncCalendar(calendarId, first.list);

    let asked = 0;
    const expired = async (params: calendar_v3.Params$Resource$Events$List) => {
      asked += 1;
      if (params.syncToken) throw gone();
      return { items: [timedEvent('g1', 'Soccer', '2026-08-10T22:00:00.000Z')], nextSyncToken: 'tok-2' };
    };

    await syncCalendar(calendarId, expired);

    assert.equal(asked, 2, 'the 410 should be followed by a windowed pull');
    assert.deepEqual(cachedTitles(), ['Soccer'], 'the calendar is never left empty');
    assert.equal(getCalendar(calendarId)?.syncToken, 'tok-2');
  });

  test('an error that is not a 410 is not swallowed', async () => {
    const first = fakeGoogle([{ items: [], nextSyncToken: 'tok-1' }]);
    await syncCalendar(calendarId, first.list);

    const boom = async () => {
      throw Object.assign(new Error('Backend error'), { code: 500 });
    };
    await assert.rejects(() => syncCalendar(calendarId, boom), /Backend error/);
    assert.equal(getCalendar(calendarId)?.syncToken, 'tok-1', 'the token survives a failed sync');
  });

  test('every page is fetched before anything is written', async () => {
    const google = fakeGoogle([
      { items: [timedEvent('g1', 'Soccer', '2026-08-10T22:00:00.000Z')], nextPageToken: 'page-2' },
      { items: [timedEvent('g2', 'Dentist', '2026-08-11T14:00:00.000Z')], nextSyncToken: 'tok-1' },
    ]);

    const changed = await syncCalendar(calendarId, google.list);

    assert.equal(google.calls.length, 2);
    assert.equal(changed, 2);
    assert.deepEqual(cachedTitles(), ['Dentist', 'Soccer']);
    assert.equal(getCalendar(calendarId)?.syncToken, 'tok-1');
  });

  test('an all-day date is stored verbatim, never converted to an instant', async () => {
    const google = fakeGoogle([
      {
        items: [
          {
            id: 'g1',
            summary: 'Birthday',
            status: 'confirmed',
            start: { date: '2026-08-10' },
            end: { date: '2026-08-11' },
            updated: '2026-01-01T00:00:00.000Z',
          },
        ],
        nextSyncToken: 'tok-1',
      },
    ]);

    await syncCalendar(calendarId, google.list);

    const row = db
      .prepare<[], { start_utc: string; end_utc: string; all_day: number }>(
        'SELECT start_utc, end_utc, all_day FROM events',
      )
      .get();
    assert.equal(row?.start_utc, '2026-08-10');
    assert.equal(row?.end_utc, '2026-08-11');
    assert.equal(row?.all_day, 1);
  });
});

describe('who is going to an event', () => {
  const window = () => [
    new Date(Date.now() - 400 * DAY_MS).toISOString(),
    new Date(Date.now() + 400 * DAY_MS).toISOString(),
  ] as const;

  const soon = () => new Date(Date.now() + DAY_MS).toISOString();

  beforeEach(() => {
    db.exec('DELETE FROM event_people; DELETE FROM people;');
  });

  test('an untagged event still belongs to whoever the calendar does', async () => {
    const calendarId = makeCalendar();
    const kid = createPerson({ name: 'Everly' });
    updateCalendar(calendarId, { personId: kid.id });

    const google = fakeGoogle([
      { items: [timedEvent('g1', 'Dentist', soon())], nextSyncToken: 'tok-1' },
    ]);
    await syncCalendar(calendarId, google.list);

    const [event] = listEvents(...window()).filter((e) => !e.synthetic);
    assert.deepEqual(event?.personIds, [kid.id]);
  });

  test('tagging replaces the calendar owner rather than adding to them', async () => {
    const calendarId = makeCalendar();
    const mum = createPerson({ name: 'Amanda', role: 'parent' });
    const a = createPerson({ name: 'Everly' });
    const b = createPerson({ name: 'Gemma' });
    updateCalendar(calendarId, { personId: mum.id });

    const google = fakeGoogle([
      { items: [timedEvent('g1', 'Swim meet', soon())], nextSyncToken: 'tok-1' },
    ]);
    await syncCalendar(calendarId, google.list);

    setEventPeople(calendarId, 'g1', [a.id, b.id]);

    const [event] = listEvents(...window()).filter((e) => !e.synthetic);
    assert.deepEqual(event?.personIds, [a.id, b.id]);
    // The calendar mapping is untouched — it is still Mum's calendar.
    assert.equal(event?.personId, mum.id);
  });

  /**
   * The reason tags are keyed on the Google id and not on events.id: a full
   * window pull sweeps rows that fall outside it and re-inserts them under a
   * new row id if they come back. Keyed on the row, everyone would silently
   * fall off the event.
   */
  test('tags survive an event being swept and returning', async () => {
    const calendarId = makeCalendar();
    const kid = createPerson({ name: 'Everly' });

    const first = fakeGoogle([
      { items: [timedEvent('g1', 'Swim meet', soon())], nextSyncToken: 'tok-1' },
    ]);
    await syncCalendar(calendarId, first.list);
    setEventPeople(calendarId, 'g1', [kid.id]);
    const before = listEvents(...window()).find((e) => !e.synthetic)?.id;

    // A full window that no longer mentions the event: it is swept away.
    forceFullWindow(calendarId);
    const swept = fakeGoogle([{ items: [], nextSyncToken: 'tok-2' }]);
    await syncCalendar(calendarId, swept.list);
    assert.equal(listEvents(...window()).filter((e) => !e.synthetic).length, 0);

    // And now it comes back.
    forceFullWindow(calendarId);
    const again = fakeGoogle([
      { items: [timedEvent('g1', 'Swim meet', soon())], nextSyncToken: 'tok-3' },
    ]);
    await syncCalendar(calendarId, again.list);

    const [event] = listEvents(...window()).filter((e) => !e.synthetic);
    assert.notEqual(event?.id, before, 'expected a new row id after the sweep');
    assert.deepEqual(event?.personIds, [kid.id], 'tags should outlive the row');
  });

  /**
   * Google expands a series into one instance per occurrence, each with its own
   * id. Tagging has to file under the series or "who goes to swim practice"
   * would have to be answered again every Tuesday.
   */
  test('one tag covers every occurrence of a series', async () => {
    const calendarId = makeCalendar();
    const kid = createPerson({ name: 'Everly' });

    const instance = (suffix: string, offsetDays: number): calendar_v3.Schema$Event => ({
      ...timedEvent(`series_${suffix}`, 'Swim practice', new Date(Date.now() + offsetDays * DAY_MS).toISOString()),
      recurringEventId: 'series',
    });

    const google = fakeGoogle([
      { items: [instance('a', 1), instance('b', 8), instance('c', 15)], nextSyncToken: 'tok-1' },
    ]);
    await syncCalendar(calendarId, google.list);

    setEventPeople(calendarId, 'series', [kid.id]);

    const events = listEvents(...window()).filter((e) => !e.synthetic);
    assert.equal(events.length, 3);
    for (const event of events) {
      assert.deepEqual(event.personIds, [kid.id], 'every occurrence should carry the tag');
    }
  });

  test('the key is the series when there is one, and the event itself otherwise', () => {
    assert.equal(eventKey({ googleId: 'g1', recurringEventId: null }), 'g1');
    assert.equal(eventKey({ googleId: 'series_20260812', recurringEventId: 'series' }), 'series');
  });

  test('someone hidden from the calendar drops off a shared event', async () => {
    const calendarId = makeCalendar();
    const a = createPerson({ name: 'Everly' });
    const b = createPerson({ name: 'Gemma' });

    const google = fakeGoogle([
      { items: [timedEvent('g1', 'Swim meet', soon())], nextSyncToken: 'tok-1' },
    ]);
    await syncCalendar(calendarId, google.list);
    setEventPeople(calendarId, 'g1', [a.id, b.id]);

    const { updatePerson } = await import('../store/people.js');
    updatePerson(b.id, { onCal: false });

    const [event] = listEvents(...window()).filter((e) => !e.synthetic);
    assert.deepEqual(event?.personIds, [a.id]);
  });

  test('deleting a person takes them off every event they were on', async () => {
    const calendarId = makeCalendar();
    const a = createPerson({ name: 'Everly' });
    const b = createPerson({ name: 'Gemma' });

    const google = fakeGoogle([
      { items: [timedEvent('g1', 'Swim meet', soon())], nextSyncToken: 'tok-1' },
    ]);
    await syncCalendar(calendarId, google.list);
    setEventPeople(calendarId, 'g1', [a.id, b.id]);

    const { deletePerson } = await import('../store/people.js');
    deletePerson(b.id);

    assert.deepEqual(peopleByEventKey(calendarId, ['g1']).get('g1'), [a.id]);
  });
});
