import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, test } from 'node:test';
import {
  dueOn,
  everyDay,
  extractWhoNames,
  fromRRule,
  normalizeRecurrence,
  resolveNames,
  toRRule,
  upsertWhoTag,
  whoFromDescription,
  whoFromTitle,
} from '@dashboard/shared';
import Fastify from 'fastify';
import cookie from '@fastify/cookie';

process.env.DATABASE_PATH = join(mkdtempSync(join(tmpdir(), 'hearth-core-')), 'test.db');

const { db } = await import('./db/index.js');
const { clearPin, pinIsSet, setPin, verifyPin } = await import('./auth.js');
const { getSettings, setRaw, updateSettings } = await import('./store/settings.js');
const { createPerson } = await import('./store/people.js');
const {
  createChore,
  createExtra,
  createReward,
  redeemReward,
  adjustPoints,
  pointsFor,
  listPointEvents,
  setChoreDone,
  CompletionOutOfRange,
} = await import('./store/chores.js');
const { streakFor } = await import('./store/streaks.js');
const { peopleRoutes } = await import('./routes/people.js');
const { choreRoutes } = await import('./routes/chores.js');
const { settingsRoutes } = await import('./routes/settings.js');

const app = Fastify();
await app.register(cookie, { secret: 'test-secret' });
await app.register(peopleRoutes);
await app.register(choreRoutes);
await app.register(settingsRoutes);
await app.ready();

/** `YYYY-MM-DD` in local time, for a date that must land on a specific day regardless of timezone. */
const ymd = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

beforeEach(() => {
  db.exec(
    'DELETE FROM point_events; DELETE FROM redemptions; DELETE FROM rewards; DELETE FROM extras; DELETE FROM people; ' +
      'DELETE FROM chore_completions; DELETE FROM chore_people; DELETE FROM chores;',
  );
  clearPin();
});

describe('parent PIN persistence', () => {
  test('setting and clearing a PIN keeps session and settings views consistent', () => {
    setPin('567890');
    assert.equal(pinIsSet(), true);
    assert.equal(getSettings().pinSet, true);
    assert.equal(verifyPin('567890'), true);
    assert.equal(verifyPin('5678'), false);

    clearPin();
    assert.equal(pinIsSet(), false);
    assert.equal(getSettings().pinSet, false);
  });

  test('a malformed configured hash fails closed', () => {
    setRaw('_pinHash', 'broken');
    assert.equal(pinIsSet(), true);
    assert.equal(verifyPin('1234'), false);
  });
});

describe('domain constraints and ledger', () => {
  test('invalid point values are rejected below the route layer', () => {
    assert.throws(() => createExtra({ title: 'Bad', points: -1 }));
    assert.throws(() => createReward({ label: 'Bad', cost: 0 }));
  });

  test('redemption is atomic and cannot overdraw a balance', () => {
    const person = createPerson({ name: 'Kid' });
    const reward = createReward({ label: 'Movie', cost: 25 });
    adjustPoints(person.id, 25, 'Starting balance');
    redeemReward(person.id, reward.id);
    assert.equal(pointsFor(person.id), 0);
    assert.throws(() => redeemReward(person.id, reward.id));
  });
});

describe('points ledger', () => {
  test('the ledger explains a balance, newest entry first', () => {
    const person = createPerson({ name: 'Kid' });
    const reward = createReward({ label: 'Movie night', cost: 40 });
    adjustPoints(person.id, 50, 'Laundry bonus');
    redeemReward(person.id, reward.id);
    adjustPoints(person.id, -5, 'Broke a window');

    const events = listPointEvents(person.id);
    assert.deepEqual(
      events.map((e) => [e.refType, e.delta, e.reason]),
      [
        ['manual', -5, 'Broke a window'],
        ['redemption', -40, 'Movie night'],
        ['manual', 50, 'Laundry bonus'],
      ],
    );
    assert.equal(
      events.reduce((sum, e) => sum + e.delta, 0),
      pointsFor(person.id),
    );
    for (const event of events) assert.ok(!Number.isNaN(new Date(event.createdAt).getTime()));
  });

  test('a ledger never carries another person’s entries', () => {
    const a = createPerson({ name: 'A' });
    const b = createPerson({ name: 'B' });
    adjustPoints(a.id, 10, 'A only');
    adjustPoints(b.id, 20, 'B only');
    assert.deepEqual(listPointEvents(a.id).map((e) => e.reason), ['A only']);
    assert.equal(pointsFor(b.id), 20);
  });
});

describe('manual point adjustment over HTTP', () => {
  test('an adjustment lands on the ledger and moves the balance', async () => {
    const person = createPerson({ name: 'Kid' });
    const response = await app.inject({
      method: 'POST',
      url: '/api/points/adjust',
      payload: { personId: person.id, delta: -15, reason: 'Skipped a job' },
    });
    assert.equal(response.statusCode, 200);
    const body = response.json();
    assert.equal(body.points, -15);
    assert.equal(body.events[0].reason, 'Skipped a job');
    assert.equal(body.events[0].refType, 'manual');
    assert.equal(pointsFor(person.id), -15);
  });

  test('rejects a zero, fractional, or oversized adjustment', async () => {
    const person = createPerson({ name: 'Kid' });
    for (const delta of [0, 2.5, 10_000_000]) {
      const response = await app.inject({
        method: 'POST',
        url: '/api/points/adjust',
        payload: { personId: person.id, delta },
      });
      assert.equal(response.statusCode, 400, `delta ${delta} should be refused`);
    }
    assert.equal(listPointEvents(person.id).length, 0);
  });

  test('an unknown person is a 404 rather than a foreign key failure', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/points/adjust',
      payload: { personId: 'pe_nobody', delta: 5 },
    });
    assert.equal(response.statusCode, 404);
  });

  test('history reports the balance alongside the entries', async () => {
    const person = createPerson({ name: 'Kid' });
    adjustPoints(person.id, 30, 'Yard work');
    const response = await app.inject({ method: 'GET', url: `/api/points/${person.id}/history` });
    assert.equal(response.statusCode, 200);
    const body = response.json();
    assert.equal(body.points, 30);
    assert.equal(body.events.length, 1);
    assert.equal((await app.inject({ method: 'GET', url: '/api/points/pe_nobody/history' })).statusCode, 404);
  });
});

describe('completing a chore outside its writable range', () => {
  test('a past day is refused', () => {
    const person = createPerson({ name: 'Kid' });
    // Due every day since well before "yesterday" — otherwise the chore's own
    // start date, not the range check, is what refuses the completion.
    const chore = createChore({ title: 'Sweep', personIds: [person.id], recurrence: everyDay('2020-01-01') });
    const yesterday = new Date(Date.now() - 86_400_000);
    assert.throws(() => setChoreDone(chore.id, person.id, true, yesterday), CompletionOutOfRange);
  });

  test('force bypasses the range check entirely', () => {
    const person = createPerson({ name: 'Kid' });
    // Due every day since well before "yesterday" — otherwise the chore's own
    // start date, not the range check, is what refuses the completion.
    const chore = createChore({ title: 'Sweep', personIds: [person.id], recurrence: everyDay('2020-01-01') });
    const yesterday = new Date(Date.now() - 86_400_000);
    const result = setChoreDone(chore.id, person.id, true, yesterday, { force: true });
    assert.equal(result?.done, true);
  });

  test('the route requires the PIN for a forced completion once one is set', async () => {
    const person = createPerson({ name: 'Kid' });
    // Due every day since well before "yesterday" — otherwise the chore's own
    // start date, not the range check, is what refuses the completion.
    const chore = createChore({ title: 'Sweep', personIds: [person.id], recurrence: everyDay('2020-01-01') });
    setPin('123456');
    const yesterday = ymd(new Date(Date.now() - 86_400_000));

    const response = await app.inject({
      method: 'POST',
      url: `/api/chores/${chore.id}/done`,
      payload: { personId: person.id, done: true, date: yesterday, force: true },
    });
    assert.equal(response.statusCode, 401);
  });

  test('an unlocked session can force it through', async () => {
    const person = createPerson({ name: 'Kid' });
    // Due every day since well before "yesterday" — otherwise the chore's own
    // start date, not the range check, is what refuses the completion.
    const chore = createChore({ title: 'Sweep', personIds: [person.id], recurrence: everyDay('2020-01-01') });
    setPin('123456');
    const login = await app.inject({ method: 'POST', url: '/api/session', payload: { pin: '123456' } });
    const session = login.cookies[0]!;
    const yesterday = ymd(new Date(Date.now() - 86_400_000));

    const response = await app.inject({
      method: 'POST',
      url: `/api/chores/${chore.id}/done`,
      cookies: { [session.name]: session.value },
      payload: { personId: person.id, done: true, date: yesterday, force: true },
    });
    assert.equal(response.statusCode, 200);
    assert.equal(response.json().chore.done, true);
  });

  test('without force, the same day is refused over the route with no PIN involved', async () => {
    const person = createPerson({ name: 'Kid' });
    // Due every day since well before "yesterday" — otherwise the chore's own
    // start date, not the range check, is what refuses the completion.
    const chore = createChore({ title: 'Sweep', personIds: [person.id], recurrence: everyDay('2020-01-01') });
    const yesterday = ymd(new Date(Date.now() - 86_400_000));

    const response = await app.inject({
      method: 'POST',
      url: `/api/chores/${chore.id}/done`,
      payload: { personId: person.id, done: true, date: yesterday },
    });
    assert.equal(response.statusCode, 400);
  });
});

describe('HTTP validation', () => {
  test('rejects malformed people before they reach SQLite', async () => {
    const response = await app.inject({ method: 'POST', url: '/api/people', payload: { name: '', role: 'admin', hue: 900 } });
    assert.equal(response.statusCode, 400);
  });

  test('rejects negative reward costs', async () => {
    const response = await app.inject({ method: 'POST', url: '/api/rewards', payload: { label: 'Exploit', cost: -100 } });
    assert.equal(response.statusCode, 400);
  });
});

describe('avatar selection', () => {
  test('picking a face needs no parent session, unlike every other person edit', async () => {
    const person = createPerson({ name: 'Kid' });
    const response = await app.inject({
      method: 'PATCH',
      url: `/api/people/${person.id}/avatar`,
      payload: { avatarKey: 'panda' },
    });
    assert.equal(response.statusCode, 200);
    assert.equal(response.json().avatarKey, 'panda');

    const cleared = await app.inject({ method: 'PATCH', url: `/api/people/${person.id}/avatar`, payload: { avatarKey: null } });
    assert.equal(cleared.statusCode, 200);
    assert.equal(cleared.json().avatarKey, null);
  });

  test('rejects a face outside the known pack, and cannot touch any other field', async () => {
    const person = createPerson({ name: 'Kid' });
    const badKey = await app.inject({ method: 'PATCH', url: `/api/people/${person.id}/avatar`, payload: { avatarKey: 'dragon' } });
    assert.equal(badKey.statusCode, 400);

    // Fastify's schema validator drops unrecognized fields rather than
    // rejecting the request (`additionalProperties: false` strips, it
    // doesn't 400 by default) — so the real guarantee to check is that a
    // smuggled `role` never reaches the store, not the status code.
    const smuggled = await app.inject({
      method: 'PATCH',
      url: `/api/people/${person.id}/avatar`,
      payload: { avatarKey: 'panda', role: 'parent' },
    });
    assert.equal(smuggled.statusCode, 200);
    assert.equal(smuggled.json().role, 'kid', 'the unguarded route only ever accepts avatarKey');
  });
});

describe('recurrence boundaries', () => {
  test('normalization repairs empty weekly days and a zero interval', () => {
    const rule = normalizeRecurrence({ freq: 'weekly', interval: 0, byDay: [], startsOn: '2026-08-09' });
    assert.equal(rule.interval, 1);
    assert.deepEqual(rule.byDay, [0, 1, 2, 3, 4, 5, 6]);
  });

  test('monthly day 31 skips a month without a 31st', () => {
    const rule = normalizeRecurrence({
      freq: 'monthly', interval: 1, byDay: [], byMonthDay: 31, bySetPos: null, startsOn: '2026-01-31',
    });
    assert.equal(dueOn(rule, new Date('2026-02-28T00:00:00')), false);
    assert.equal(dueOn(rule, new Date('2026-03-31T00:00:00')), true);
  });

  test('an end date is inclusive, and nothing lands after it', () => {
    const rule = normalizeRecurrence({
      freq: 'daily', interval: 1, startsOn: '2026-08-10', until: '2026-08-12',
    });
    assert.equal(dueOn(rule, new Date('2026-08-12T00:00:00')), true);
    assert.equal(dueOn(rule, new Date('2026-08-13T00:00:00')), false);
  });

  test('an end before the start is dropped rather than making a rule that never lands', () => {
    const rule = normalizeRecurrence({ freq: 'daily', interval: 1, startsOn: '2026-08-10', until: '2026-08-01' });
    assert.equal(rule.until, null);
    assert.equal(dueOn(rule, new Date('2026-08-10T00:00:00')), true);
  });

  test('every other day counts from the start, across a DST change', () => {
    // 1 Nov 2026 is the US fall-back. Stepping by fixed 24h intervals across it
    // drifts an hour and lands the rule on the wrong days from there on.
    const rule = normalizeRecurrence({ freq: 'daily', interval: 2, startsOn: '2026-10-30' });
    assert.equal(dueOn(rule, new Date('2026-11-01T00:00:00')), true);
    assert.equal(dueOn(rule, new Date('2026-11-02T00:00:00')), false);
    assert.equal(dueOn(rule, new Date('2026-11-03T00:00:00')), true);
  });

  test('a yearly rule lands on its own day and nothing else', () => {
    const rule = normalizeRecurrence({ freq: 'yearly', interval: 1, startsOn: '2026-08-31' });
    assert.equal(dueOn(rule, new Date('2027-08-31T00:00:00')), true);
    assert.equal(dueOn(rule, new Date('2027-08-30T00:00:00')), false);
    assert.equal(dueOn(rule, new Date('2026-08-31T00:00:00')), true);
  });

  test('daily and yearly carry no day list to contradict the start date', () => {
    const rule = normalizeRecurrence({ freq: 'daily', interval: 1, byDay: [1, 3], startsOn: '2026-08-10' });
    assert.deepEqual(rule.byDay, []);
  });
});

describe('RRULE round trip', () => {
  const roundTrip = (input: Parameters<typeof normalizeRecurrence>[0], allDay = false) => {
    const rule = normalizeRecurrence(input);
    const back = fromRRule(toRRule(rule, allDay), rule.startsOn);
    assert.deepEqual(back, rule);
    return toRRule(rule, allDay)[0];
  };

  test('every weekday survives the trip through Google', () => {
    const line = roundTrip({ freq: 'weekly', interval: 1, byDay: [1, 2, 3, 4, 5], startsOn: '2026-08-10' });
    assert.equal(line, 'RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR');
  });

  test('the monthly "third Monday" reading survives', () => {
    const line = roundTrip({
      freq: 'monthly', interval: 2, byDay: [1], byMonthDay: null, bySetPos: 3, startsOn: '2026-08-17',
    });
    assert.equal(line, 'RRULE:FREQ=MONTHLY;INTERVAL=2;BYDAY=3MO');
  });

  test('an all-day series ends on a bare date, a timed one on an instant', () => {
    const rule = normalizeRecurrence({ freq: 'daily', interval: 1, startsOn: '2026-08-10', until: '2026-08-20' });
    assert.equal(toRRule(rule, true)[0], 'RRULE:FREQ=DAILY;UNTIL=20260820');
    // RFC 5545 ties UNTIL's shape to DTSTART's, and Google refuses a mismatch.
    assert.match(toRRule(rule, false)[0]!, /UNTIL=\d{8}T\d{6}Z$/);
  });

  test('a timed UNTIL covers the whole of its last local day', () => {
    const rule = normalizeRecurrence({ freq: 'weekly', interval: 1, byDay: [1], startsOn: '2026-08-10', until: '2026-08-31' });
    // Whatever the offset, it comes back as the same local day it went in as.
    assert.equal(fromRRule(toRRule(rule, false), rule.startsOn)?.until, '2026-08-31');
  });

  test('a rule the picker cannot represent is refused rather than flattened', () => {
    const startsOn = '2026-08-10';
    // COUNT has no end date to show; rewriting it as one would move the end.
    assert.equal(fromRRule(['RRULE:FREQ=WEEKLY;COUNT=10'], startsOn), null);
    assert.equal(fromRRule(['RRULE:FREQ=MONTHLY;BYSETPOS=2;BYDAY=MO,TU'], startsOn), null);
    assert.equal(fromRRule(['RRULE:FREQ=YEARLY;BYMONTH=3;BYMONTHDAY=1'], startsOn), null);
    assert.equal(fromRRule(['RRULE:FREQ=HOURLY'], startsOn), null);
  });

  test('an event with no rule at all is simply not recurring', () => {
    assert.equal(fromRRule(null, '2026-08-10'), null);
    assert.equal(fromRRule(['EXDATE;VALUE=DATE:20260817'], '2026-08-10'), null);
  });
});

describe('who tagging', () => {
  const roster = [
    { id: 'everly', name: 'Everly' },
    { id: 'gemma', name: 'Gemma' },
    { id: 'amanda', name: 'Amanda' },
  ];

  test('formats and reads back its own canonical line', () => {
    const description = upsertWhoTag('Bring shin guards', ['Everly', 'Gemma']);
    assert.equal(description, 'Bring shin guards\n\nWho: Everly, Gemma');
    assert.deepEqual(extractWhoNames(description), ['Everly', 'Gemma']);
  });

  test('recognizes the label variants, case-insensitively', () => {
    assert.deepEqual(extractWhoNames('who: Everly'), ['Everly']);
    assert.deepEqual(extractWhoNames('Kids: Everly, Gemma'), ['Everly', 'Gemma']);
    assert.deepEqual(extractWhoNames('PARENTS: Amanda'), ['Amanda']);
    assert.equal(extractWhoNames('For: snacks and drinks'), null, '"For:" is too generic a word to repurpose');
  });

  test('splits a name list on commas, "&", and "and"', () => {
    assert.deepEqual(extractWhoNames('Who: Everly, Gemma & Amanda'), ['Everly', 'Gemma', 'Amanda']);
    assert.deepEqual(extractWhoNames('Who: Everly and Gemma'), ['Everly', 'Gemma']);
  });

  test('falls back to bracket groups when there is no labeled line', () => {
    assert.deepEqual(extractWhoNames('[Everly][Gemma]'), ['Everly', 'Gemma']);
    assert.deepEqual(extractWhoNames('[Everly, Gemma]'), ['Everly', 'Gemma']);
    assert.equal(extractWhoNames('No tag here'), null);
  });

  test('a tag naming no one Hearth recognizes reads the same as no tag', () => {
    assert.deepEqual(whoFromDescription('Who: Not A Real Person', roster), []);
    assert.deepEqual(whoFromDescription(null, roster), []);
  });

  test('a name is matched case-insensitively but never partially', () => {
    assert.deepEqual(resolveNames(['everly'], roster), ['everly']);
    assert.deepEqual(resolveNames(['Everlyn'], roster), [], 'a longer name must not match a shorter one inside it');
  });

  test('a title matches only its leading word(s)', () => {
    assert.deepEqual(whoFromTitle('Everly’s Basketball Practice', roster), ['everly']);
    assert.deepEqual(whoFromTitle('Basketball Practice — Everly', roster), [], 'not a name at the end');
    assert.deepEqual(whoFromTitle('Basketball Practice for Everly', roster), [], 'not a name in the middle');
  });

  test('a leading list joined by "and" or "&" matches everyone in it', () => {
    assert.deepEqual(whoFromTitle('Everly and Gemma’s Playdate', roster), ['everly', 'gemma']);
    assert.deepEqual(whoFromTitle('Everly & Gemma Playdate', roster), ['everly', 'gemma']);
  });

  test('a title starting with an unrelated word matches no one', () => {
    assert.deepEqual(whoFromTitle('Dentist for Everly', roster), []);
  });

  test('re-tagging replaces the old line rather than piling up a second one', () => {
    const first = upsertWhoTag('Notes here', ['Everly']);
    const second = upsertWhoTag(first, ['Gemma']);
    assert.equal(second, 'Notes here\n\nWho: Gemma');
  });

  test('clearing the tag removes the line and leaves any real notes behind', () => {
    const tagged = upsertWhoTag('Bring a snack', ['Everly']);
    assert.equal(upsertWhoTag(tagged, []), 'Bring a snack');
    assert.equal(upsertWhoTag('Who: Everly', []), null, 'nothing but a tag leaves nothing at all');
  });
});

describe('streak bonus', () => {
  test('pays once per milestone and never double-pays the same one', () => {
    const person = createPerson({ name: 'Kid' });
    const chore = createChore({ title: 'Dishes', personIds: [person.id], recurrence: everyDay('2020-01-01') });
    updateSettings({ streakBonusEnabled: true, streakBonusPoints: 10, streakBonusDays: 3 });

    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    const twoDaysAgo = new Date(today);
    twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);

    setChoreDone(chore.id, person.id, true, twoDaysAgo, { force: true });
    assert.equal(pointsFor(person.id), 0, 'no bonus until the third day completes the milestone');
    setChoreDone(chore.id, person.id, true, yesterday, { force: true });
    assert.equal(pointsFor(person.id), 0);
    setChoreDone(chore.id, person.id, true, today);

    assert.equal(streakFor(person.id).length, 3);
    assert.equal(pointsFor(person.id), 10);
    assert.deepEqual(
      listPointEvents(person.id).map((e) => [e.refType, e.delta]),
      [['streak', 10]],
    );

    // Un-ticking and re-ticking today recomputes the same milestone, which the
    // ref_id keys against — so it must not pay a second time.
    setChoreDone(chore.id, person.id, false, today);
    setChoreDone(chore.id, person.id, true, today);
    assert.equal(pointsFor(person.id), 10);

    updateSettings({ streakBonusEnabled: false });
  });

  test('no bonus is paid while the setting is off', () => {
    const person = createPerson({ name: 'Kid' });
    const chore = createChore({ title: 'Dishes', personIds: [person.id], recurrence: everyDay('2020-01-01') });
    updateSettings({ streakBonusEnabled: false, streakBonusDays: 1 });
    setChoreDone(chore.id, person.id, true, new Date());
    assert.equal(streakFor(person.id).length, 1);
    assert.equal(pointsFor(person.id), 0);
  });
});
