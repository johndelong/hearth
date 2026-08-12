import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, test } from 'node:test';
import { dueOn, fromRRule, normalizeRecurrence, toRRule } from '@dashboard/shared';
import Fastify from 'fastify';

process.env.DATABASE_PATH = join(mkdtempSync(join(tmpdir(), 'hearth-core-')), 'test.db');

const { db } = await import('./db/index.js');
const { clearPin, pinIsSet, setPin, verifyPin } = await import('./auth.js');
const { getSettings, setRaw } = await import('./store/settings.js');
const { createPerson } = await import('./store/people.js');
const { createExtra, createReward, redeemReward, adjustPoints, pointsFor, listPointEvents } = await import(
  './store/chores.js'
);
const { peopleRoutes } = await import('./routes/people.js');
const { choreRoutes } = await import('./routes/chores.js');

const app = Fastify();
await app.register(peopleRoutes);
await app.register(choreRoutes);
await app.ready();

beforeEach(() => {
  db.exec('DELETE FROM point_events; DELETE FROM redemptions; DELETE FROM rewards; DELETE FROM extras; DELETE FROM people;');
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
