import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, test } from 'node:test';
import cookie from '@fastify/cookie';
import Fastify from 'fastify';
import { defaultHomeFrameAlert, homeAlertActive, homeDashboardAlertActive } from '@dashboard/shared';

process.env.DATABASE_PATH = join(mkdtempSync(join(tmpdir(), 'hearth-home-')), 'test.db');

const { schemaVersion } = await import('../db/index.js');
const { clearPin, setPin } = await import('../auth.js');
const { homeRoutes, homeStateAffectsSelection } = await import('./home.js');
const { settingsRoutes } = await import('./settings.js');
const { replaceHomeSelection } = await import('../store/home.js');
const { deleteRaw, getRaw, setRaw } = await import('../store/settings.js');
const { protect } = await import('../crypto.js');
const { isHomeAssistantRegistryEvent, parseHomeAssistantCommandResponse } = await import('../home-assistant.js');

const app = Fastify();
await app.register(cookie, { secret: 'test-secret' });
await app.register(homeRoutes);
await app.register(settingsRoutes);
await app.ready();

beforeEach(() => {
  clearPin();
  replaceHomeSelection([]);
  deleteRaw('_homeAssistantUrl');
  deleteRaw('_homeAssistantToken');
  deleteRaw('interfaceSize');
});

test('the fresh database includes the Home Assistant tables', () => {
  assert.equal(schemaVersion, 26);
});

test('frame alerts default to safety entities and understand numeric batteries', () => {
  assert.equal(defaultHomeFrameAlert({ domain: 'binary_sensor', deviceClass: 'door', name: 'Side door' }), true);
  assert.equal(defaultHomeFrameAlert({ domain: 'cover', deviceClass: 'shade', name: 'Living room shade' }), false);
  assert.equal(defaultHomeFrameAlert({ domain: 'sensor', deviceClass: 'battery', name: 'Lock battery' }), true);
  assert.equal(homeAlertActive({ domain: 'sensor', deviceClass: 'battery', name: 'Lock battery', state: '18', available: true }), true);
  assert.equal(homeAlertActive({ domain: 'sensor', deviceClass: 'battery', name: 'Lock battery', state: '82', available: true }), false);
  assert.equal(homeDashboardAlertActive({ frameAlert: true, alertActive: true }), true);
  assert.equal(homeDashboardAlertActive({ frameAlert: false, alertActive: true }), false);
});

test('Home Assistant pong messages complete heartbeat commands', () => {
  assert.deepEqual(parseHomeAssistantCommandResponse({ id: 19, type: 'pong' }), {
    id: 19,
    success: true,
  });
  assert.equal(parseHomeAssistantCommandResponse({ id: 19, type: 'event' }), null);
});

test('Home Assistant registry changes are recognized as live metadata updates', () => {
  assert.equal(isHomeAssistantRegistryEvent({ event_type: 'entity_registry_updated' }), true);
  assert.equal(isHomeAssistantRegistryEvent({ event_type: 'device_registry_updated' }), true);
  assert.equal(isHomeAssistantRegistryEvent({ event_type: 'area_registry_updated' }), true);
  assert.equal(isHomeAssistantRegistryEvent({ event_type: 'state_changed' }), false);
});

test('Home updates include selected entities and companion states from their device', () => {
  const selection = [{ entityId: 'switch.office', deviceId: 'device-1', displayName: null, frameAlert: false, sortOrder: 0 }];
  const state = (entityId: string, deviceId: string | null) => ({ entityId, deviceId } as Parameters<typeof homeStateAffectsSelection>[0]);
  assert.equal(homeStateAffectsSelection(state('switch.office', 'device-1'), selection), true);
  assert.equal(homeStateAffectsSelection(state('sensor.office_battery', 'device-1'), selection), true);
  assert.equal(homeStateAffectsSelection(state('sensor.kitchen_temperature', 'device-2'), selection), false);
});

test('editing the Home dashboard requires a parent session while reading it does not', async () => {
  setPin('123456');
  const item = { entityId: 'light.kitchen', displayName: 'Kitchen', frameAlert: false };
  const locked = await app.inject({ method: 'PUT', url: '/api/home/dashboard', payload: { items: [item] } });
  assert.equal(locked.statusCode, 401);

  const login = await app.inject({ method: 'POST', url: '/api/session', payload: { pin: '123456' } });
  assert.equal(login.statusCode, 200);
  const session = login.cookies[0]!;
  const saved = await app.inject({
    method: 'PUT', url: '/api/home/dashboard', payload: { items: [item] },
    cookies: { [session.name]: session.value },
  });
  assert.equal(saved.statusCode, 200, saved.body);
  const publicView = await app.inject({ method: 'GET', url: '/api/home' });
  assert.equal(publicView.statusCode, 200);
  assert.equal(publicView.json().items[0].displayName, 'light.kitchen');
});

test('published controls are public but arbitrary or unpublished actions are refused', async () => {
  replaceHomeSelection([{ entityId: 'light.kitchen', displayName: 'Kitchen', frameAlert: false }]);
  const published = await app.inject({ method: 'POST', url: '/api/home/entities/light.kitchen/action', payload: { action: 'turn_on' } });
  assert.equal(published.statusCode, 502); // Reached the connector; this test has no Home Assistant server.

  const arbitrary = await app.inject({ method: 'POST', url: '/api/home/entities/light.kitchen/action', payload: { action: 'delete_everything' } });
  assert.equal(arbitrary.statusCode, 400);
  const invalidBrightness = await app.inject({ method: 'POST', url: '/api/home/entities/light.kitchen/action', payload: { action: 'set_brightness', value: 101 } });
  assert.equal(invalidBrightness.statusCode, 400);
  const hidden = await app.inject({ method: 'POST', url: '/api/home/entities/light.bedroom/action', payload: { action: 'turn_on' } });
  assert.equal(hidden.statusCode, 404);
});

test('the configured token remains encrypted and is never returned', async () => {
  setRaw('_homeAssistantUrl', 'http://homeassistant.local:8123');
  setRaw('_homeAssistantToken', protect('a-secret-token-that-must-stay-server-side')!);
  assert.match(getRaw('_homeAssistantToken') ?? '', /^enc:v1:/);

  const response = await app.inject({ method: 'GET', url: '/api/home/config' });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), {
    configured: true,
    url: 'http://homeassistant.local:8123',
    state: 'disconnected',
  });
  assert.doesNotMatch(response.body, /secret-token/);
});

test('interface size is persisted and validated at the settings boundary', async () => {
  const saved = await app.inject({ method: 'PATCH', url: '/api/settings', payload: { interfaceSize: 'Compact' } });
  assert.equal(saved.statusCode, 200, saved.body);
  assert.equal(saved.json().interfaceSize, 'Compact');

  const invalid = await app.inject({ method: 'PATCH', url: '/api/settings', payload: { interfaceSize: 'Tiny' } });
  assert.equal(invalid.statusCode, 400);
});
