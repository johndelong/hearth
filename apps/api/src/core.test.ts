import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, test } from 'node:test';
import { dueOn, normalizeRecurrence } from '@dashboard/shared';
import Fastify from 'fastify';

process.env.DATABASE_PATH = join(mkdtempSync(join(tmpdir(), 'hearth-core-')), 'test.db');

const { db } = await import('./db/index.js');
const { clearPin, pinIsSet, setPin, verifyPin } = await import('./auth.js');
const { getSettings, setRaw } = await import('./store/settings.js');
const { createPerson } = await import('./store/people.js');
const { createExtra, createReward, redeemReward, adjustPoints, pointsFor } = await import('./store/chores.js');
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
});
