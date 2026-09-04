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
  getCalendar,
  listCalendars,
  markWindowAnchored,
  saveSyncToken,
  updateCalendar,
  upsertAccount,
  upsertCalendar,
} = await import('../store/calendars.js');
const { createPerson, updatePerson } = await import('../store/people.js');
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

describe('calendar assignment', () => {
  test('assigning a group clears any person, even when the patch sends personId: null explicitly', () => {
    const calendarId = makeCalendar();
    const person = createPerson({ name: 'Amanda' });
    updateCalendar(calendarId, { personId: person.id });

    // The exact shape the Settings screen sends when someone picks a group
    // option: both fields present, personId explicitly null rather than
    // omitted — which a naive `!== undefined` check on personId alone would
    // wrongly treat as "assign no one" and silently drop the group too.
    updateCalendar(calendarId, { personId: null, group: 'parent' });

    const cal = listCalendars().find((c) => c.id === calendarId);
    assert.equal(cal?.group, 'parent');
    assert.equal(cal?.personId, null);
  });

  test('assigning a person clears any group, sent the same explicit way', () => {
    const calendarId = makeCalendar();
    const person = createPerson({ name: 'Amanda' });
    updateCalendar(calendarId, { group: 'parent' });

    updateCalendar(calendarId, { personId: person.id, group: null });

    const cal = listCalendars().find((c) => c.id === calendarId);
    assert.equal(cal?.personId, person.id);
    assert.equal(cal?.group, null);
  });

  test('unassigning sends both fields null and clears both columns', () => {
    const calendarId = makeCalendar();
    const person = createPerson({ name: 'Amanda' });
    updateCalendar(calendarId, { personId: person.id });

    updateCalendar(calendarId, { personId: null, group: null });

    const cal = listCalendars().find((c) => c.id === calendarId);
    assert.equal(cal?.personId, null);
    assert.equal(cal?.group, null);
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
  const window = () =>
    [new Date(Date.now() - 400 * DAY_MS).toISOString(), new Date(Date.now() + 400 * DAY_MS).toISOString()] as const;

  const soon = () => new Date(Date.now() + DAY_MS).toISOString();

  const shown = () => listEvents(...window()).filter((e) => !e.synthetic);

  /** A second calendar on the same account, mapped to its own person. */
  function addCalendar(summary: string, personId: string): string {
    upsertCalendar({
      accountId: 'acct_1',
      googleCalendarId: `${summary}@example.com`,
      summary,
      description: null,
      enabled: true,
      readOnly: false,
      primary: false,
      timeZone: 'America/New_York',
    });
    const cal = listCalendars().find((c) => c.summary === summary)!;
    updateCalendar(cal.id, { personId });
    return cal.id;
  }

  /** A cached event with an optional description, as Google hands it back. */
  const withDescription = (
    googleId: string,
    title: string,
    startIso: string,
    description?: string,
  ): calendar_v3.Schema$Event => ({
    ...timedEvent(googleId, title, startIso),
    ...(description !== undefined ? { description } : {}),
  });

  beforeEach(() => {
    db.exec('DELETE FROM people');
  });

  test("an event on one calendar belongs to that calendar's person", async () => {
    const calendarId = makeCalendar();
    const kid = createPerson({ name: 'Everly' });
    updateCalendar(calendarId, { personId: kid.id });

    await syncCalendar(calendarId, fakeGoogle([{ items: [timedEvent('g1', 'Dentist', soon())], nextSyncToken: 't' }]).list);

    assert.deepEqual(shown().map((e) => e.personIds), [[kid.id]]);
  });

  test('a "Who:" tag in the description overrides the calendar\'s own person', async () => {
    const calendarId = makeCalendar();
    const owner = createPerson({ name: 'Amanda' });
    const kid = createPerson({ name: 'Everly' });
    updateCalendar(calendarId, { personId: owner.id });

    await syncCalendar(
      calendarId,
      fakeGoogle([{ items: [withDescription('g1', 'Basketball', soon(), 'Who: Everly')], nextSyncToken: 't' }]).list,
    );

    assert.deepEqual(shown()[0]?.personIds, [kid.id]);
  });

  test('a tag names more than one person, split on commas', async () => {
    const calendarId = makeCalendar();
    const a = createPerson({ name: 'Everly' });
    const b = createPerson({ name: 'Gemma' });
    updateCalendar(calendarId, { personId: a.id });

    await syncCalendar(
      calendarId,
      fakeGoogle([{ items: [withDescription('g1', 'Playdate', soon(), 'Who: Everly, Gemma')], nextSyncToken: 't' }]).list,
    );

    assert.deepEqual(shown()[0]?.personIds, [a.id, b.id]);
  });

  test('a bracket list is read the same way when there is no labeled line', async () => {
    const calendarId = makeCalendar();
    const a = createPerson({ name: 'Everly' });
    const b = createPerson({ name: 'Gemma' });
    updateCalendar(calendarId, { personId: a.id });

    await syncCalendar(
      calendarId,
      fakeGoogle([{ items: [withDescription('g1', 'Playdate', soon(), '[Everly][Gemma]')], nextSyncToken: 't' }]).list,
    );

    assert.deepEqual(shown()[0]?.personIds, [a.id, b.id]);
  });

  test('a name leading the title is used when there is no tag', async () => {
    const calendarId = makeCalendar();
    const owner = createPerson({ name: 'Amanda' });
    const kid = createPerson({ name: 'Everly' });
    updateCalendar(calendarId, { personId: owner.id });

    await syncCalendar(
      calendarId,
      fakeGoogle([{ items: [timedEvent('g1', "Everly's Basketball Practice", soon())], nextSyncToken: 't' }]).list,
    );

    assert.deepEqual(shown()[0]?.personIds, [kid.id]);
  });

  test('a name in the middle or end of the title is not auto-detected', async () => {
    const calendarId = makeCalendar();
    const owner = createPerson({ name: 'Amanda' });
    createPerson({ name: 'Everly' });
    updateCalendar(calendarId, { personId: owner.id });

    await syncCalendar(
      calendarId,
      fakeGoogle([{ items: [timedEvent('g1', 'Basketball Practice \u2014 Everly', soon())], nextSyncToken: 't' }]).list,
    );

    assert.deepEqual(shown()[0]?.personIds, [owner.id], "falls back to the calendar's own person");
  });

  test('an explicit tag beats a name in the title', async () => {
    const calendarId = makeCalendar();
    const owner = createPerson({ name: 'Amanda' });
    const titled = createPerson({ name: 'Everly' });
    const tagged = createPerson({ name: 'Gemma' });
    updateCalendar(calendarId, { personId: owner.id });

    await syncCalendar(
      calendarId,
      fakeGoogle([
        { items: [withDescription('g1', "Everly's Basketball Practice", soon(), 'Who: Gemma')], nextSyncToken: 't' },
      ]).list,
    );

    assert.deepEqual(shown()[0]?.personIds, [tagged.id]);
    assert.ok(!shown()[0]?.personIds.includes(titled.id));
  });

  test("the faces read in the household's own order, not the tag's", async () => {
    const calendarId = makeCalendar();
    const owner = createPerson({ name: 'Amanda' });
    // Created second, so it sorts second wherever people are ordered.
    const first = createPerson({ name: 'Everly' });
    const second = createPerson({ name: 'Gemma' });
    updateCalendar(calendarId, { personId: owner.id });

    await syncCalendar(
      calendarId,
      fakeGoogle([{ items: [withDescription('g1', 'Playdate', soon(), 'Who: Gemma, Everly')], nextSyncToken: 't' }]).list,
    );

    assert.deepEqual(shown()[0]?.personIds, [first.id, second.id]);
  });

  test('someone hidden drops off a tagged event without hiding it from everyone else', async () => {
    const calendarId = makeCalendar();
    const owner = createPerson({ name: 'Amanda' });
    const a = createPerson({ name: 'Everly' });
    const b = createPerson({ name: 'Gemma' });
    updateCalendar(calendarId, { personId: owner.id });

    await syncCalendar(
      calendarId,
      fakeGoogle([{ items: [withDescription('g1', 'Playdate', soon(), 'Who: Everly, Gemma')], nextSyncToken: 't' }]).list,
    );
    updatePerson(b.id, { onCal: false });

    const events = shown();
    assert.equal(events.length, 1);
    assert.deepEqual(events[0]?.personIds, [a.id]);
  });

  test('an event tagged only to people who are all hidden disappears entirely', async () => {
    const calendarId = makeCalendar();
    const owner = createPerson({ name: 'Amanda' });
    const kid = createPerson({ name: 'Everly' });
    updateCalendar(calendarId, { personId: owner.id });

    await syncCalendar(
      calendarId,
      fakeGoogle([{ items: [withDescription('g1', 'Basketball', soon(), 'Who: Everly')], nextSyncToken: 't' }]).list,
    );
    updatePerson(kid.id, { onCal: false });

    assert.equal(shown().length, 0);
  });

  test('an event on a calendar assigned to a group belongs to everyone with that role, with no tagging at all', async () => {
    const calendarId = makeCalendar();
    const parent1 = createPerson({ name: 'Amanda', role: 'parent' });
    const parent2 = createPerson({ name: 'John', role: 'parent' });
    const kid = createPerson({ name: 'Everly', role: 'kid' });
    updateCalendar(calendarId, { group: 'parent' });

    await syncCalendar(
      calendarId,
      fakeGoogle([{ items: [timedEvent('g1', 'Date night', soon())], nextSyncToken: 't' }]).list,
    );

    const events = shown();
    assert.equal(events.length, 1);
    assert.deepEqual(events[0]?.personIds, [parent1.id, parent2.id]);
    assert.ok(!events[0]?.personIds.includes(kid.id), 'a calendar assigned to Parents excludes the kids');
  });

  test('a group calendar re-resolves against the roster on every read, rather than remembering who it once meant', async () => {
    const calendarId = makeCalendar();
    const first = createPerson({ name: 'Everly', role: 'kid' });
    updateCalendar(calendarId, { group: 'kid' });
    await syncCalendar(
      calendarId,
      fakeGoogle([{ items: [timedEvent('g1', 'Field trip', soon())], nextSyncToken: 't' }]).list,
    );
    assert.deepEqual(shown()[0]?.personIds, [first.id]);

    // A second kid joins the household after the calendar was assigned — no
    // one touched this calendar, yet the next read already includes her.
    const second = createPerson({ name: 'Gemma', role: 'kid' });
    assert.deepEqual(shown()[0]?.personIds, [first.id, second.id]);
  });

  test('a person on two group calendars is attributed once, not once per calendar', async () => {
    const calendarId = makeCalendar();
    const parent1 = createPerson({ name: 'Amanda', role: 'parent' });
    createPerson({ name: 'John', role: 'parent' });
    updateCalendar(calendarId, { group: 'parent' });

    await syncCalendar(
      calendarId,
      fakeGoogle([{ items: [timedEvent('g1', 'Date night', soon())], nextSyncToken: 't' }]).list,
    );

    assert.ok(shown()[0]?.personIds.includes(parent1.id));
    assert.equal(shown()[0]?.personIds.filter((id) => id === parent1.id).length, 1);
  });
});
