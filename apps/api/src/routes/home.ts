import {
  defaultHomeFrameAlert,
  homeAlertActive,
  homeCategoryFor,
  type HomeCandidate,
  type HomeDashboard,
  type HomeDashboardItem,
  type HomeDashboardSelection,
  type HomeDeviceCandidate,
  type HomeEntityState,
} from '@dashboard/shared';
import type { FastifyInstance } from 'fastify';
import { requireParent } from '../auth.js';
import { cleanHomeAssistantUrl, homeAssistant } from '../home-assistant.js';
import { listHomeSelection, replaceHomeSelection } from '../store/home.js';
import { recordActivity } from '../store/activity.js';

const actionMap: Record<string, Record<string, string>> = {
  light: { turn_on: 'turn_on', turn_off: 'turn_off', toggle: 'toggle', set_brightness: 'turn_on' },
  switch: { turn_on: 'turn_on', turn_off: 'turn_off', toggle: 'toggle' },
  input_boolean: { turn_on: 'turn_on', turn_off: 'turn_off', toggle: 'toggle' },
  fan: { turn_on: 'turn_on', turn_off: 'turn_off', toggle: 'toggle' },
  lock: { lock: 'lock', unlock: 'unlock' },
  cover: { open: 'open_cover', close: 'close_cover', stop: 'stop_cover' },
  alarm_control_panel: { arm_away: 'alarm_arm_away', disarm: 'alarm_disarm' },
  button: { press: 'press' },
  scene: { turn_on: 'turn_on' },
  script: { turn_on: 'turn_on' },
  climate: { turn_on: 'turn_on', turn_off: 'turn_off', set_temperature: 'set_temperature' },
};

function dashboard(): HomeDashboard {
  const states = homeAssistant.states();
  const items: HomeDashboardItem[] = listHomeSelection().map((selected) => {
    const state = states.get(selected.entityId) ?? {
      entityId: selected.entityId,
      state: 'unknown',
      name: selected.entityId,
      domain: selected.entityId.split('.')[0] ?? '',
      deviceClass: null,
      deviceId: null,
      area: null,
      unit: null,
      lastChanged: null,
      available: false,
      details: { currentTemperature: null, targetTemperature: null, humidity: null, brightness: null, position: null, batteryLevel: null },
    };
    const related = selected.deviceId
      ? [...states.values()].filter((candidate) => candidate.deviceId === selected.deviceId && candidate.entityId !== state.entityId && usefulCompanion(candidate))
      : [];
    const activeAlert = [state, ...related].find((candidate) => homeAlertActive(candidate));
    const homeAssistantName = selected.deviceId
      ? homeAssistant.devices().get(selected.deviceId)?.name ?? state.name
      : state.name;
    return {
      ...state,
      displayName: homeAssistantName,
      sortOrder: selected.sortOrder,
      frameAlert: selected.frameAlert,
      alertActive: selected.frameAlert && Boolean(activeAlert),
      alertLabel: selected.frameAlert && activeAlert ? alertLabel(activeAlert) : null,
      related,
    };
  });
  const connection = homeAssistant.status();
  return { connection, stale: connection !== 'connected', items };
}

function usefulCompanion(entity: HomeEntityState): boolean {
  if (entity.domain === 'sensor') return ['battery', 'temperature', 'humidity'].includes(entity.deviceClass ?? '') || /battery|temperature|humidity/i.test(entity.name);
  if (entity.domain === 'binary_sensor') return ['battery', 'door', 'window', 'opening', 'garage_door', 'problem', 'tamper', 'safety', 'smoke', 'gas', 'carbon_monoxide', 'moisture'].includes(entity.deviceClass ?? '') || /battery low|low battery|jammed/i.test(entity.name);
  return false;
}

function alertLabel(entity: HomeEntityState): string {
  if (homeCategoryFor(entity) === 'batteries') {
    const level = Number.parseFloat(entity.state);
    return Number.isFinite(level) ? `Battery ${level}${entity.unit ?? '%'}` : 'Low battery';
  }
  if (entity.domain === 'lock') return entity.state === 'jammed' ? 'Lock jammed' : 'Unlocked';
  if (entity.domain === 'alarm_control_panel') return entity.state === 'triggered' ? 'Alarm sounding' : 'Alarm pending';
  if (['door', 'window', 'opening', 'garage_door'].includes(entity.deviceClass ?? '')) return 'Open';
  if (entity.deviceClass === 'moisture') return 'Water detected';
  return entity.state.replaceAll('_', ' ');
}

function primaryRank(entity: HomeEntityState): number {
  const rank: Record<string, number> = {
    lock: 1, alarm_control_panel: 2, cover: 3, climate: 4, light: 5,
    camera: 5, media_player: 6, switch: 7, fan: 8, button: 12,
  };
  const known = rank[entity.domain];
  if (known !== undefined) return known;
  if (entity.domain === 'binary_sensor' && ['door', 'window', 'opening', 'garage_door', 'smoke', 'gas', 'carbon_monoxide', 'moisture'].includes(entity.deviceClass ?? '')) return 10;
  if (entity.domain === 'sensor' && ['temperature', 'humidity', 'battery'].includes(entity.deviceClass ?? '')) return 11;
  return 100;
}

function deviceCandidates(): HomeDeviceCandidate[] {
  const states = [...homeAssistant.states().values()];
  const selected = listHomeSelection();
  const groups = new Map<string, HomeEntityState[]>();
  for (const state of states) {
    if (!state.deviceId) continue;
    const group = groups.get(state.deviceId) ?? [];
    group.push(state);
    groups.set(state.deviceId, group);
  }
  return [...groups].flatMap(([deviceId, entities]): HomeDeviceCandidate[] => {
    const primary = [...entities].sort((a, b) => primaryRank(a) - primaryRank(b) || Number(b.available) - Number(a.available) || a.name.localeCompare(b.name))[0];
    if (!primary || primaryRank(primary) >= 100) return [];
    // Phones and wall tablets expose their own battery as a sensor, but they
    // are dashboard clients rather than household devices someone expects to
    // add beside a lock or thermostat.
    if (homeCategoryFor(primary) === 'batteries' && entities.some((entity) => entity.domain === 'device_tracker')) return [];
    const metadata = homeAssistant.devices().get(deviceId);
    const chosen = selected.find((item) => item.deviceId === deviceId || (!item.deviceId && item.entityId === primary.entityId));
    const candidates = entities.map((entity) => ({
      ...entity,
      selected: selected.some((item) => item.entityId === entity.entityId),
      displayName: selected.find((item) => item.entityId === entity.entityId)?.displayName ?? entity.name,
      frameAlert: selected.find((item) => item.entityId === entity.entityId)?.frameAlert ?? defaultHomeFrameAlert(entity),
    }));
    return [{
      deviceId,
      name: metadata?.name ?? primary.name,
      area: metadata?.area ?? primary.area,
      manufacturer: metadata?.manufacturer ?? null,
      model: metadata?.model ?? null,
      primaryEntityId: primary.entityId,
      category: homeCategoryFor(primary),
      frameAlert: entities.some(defaultHomeFrameAlert),
      selected: Boolean(chosen),
      entities: candidates.filter((entity) => entity.entityId === primary.entityId || usefulCompanion(entity)),
    }];
  }).sort((a, b) => (a.area ?? '').localeCompare(b.area ?? '') || a.name.localeCompare(b.name));
}

export async function homeRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/home', async () => dashboard());

  app.get('/api/home/events', (request, reply) => {
    reply.hijack();
    const response = reply.raw;
    response.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
    });

    const sendDashboard = () => {
      if (!response.destroyed) response.write(`data: ${JSON.stringify(dashboard())}\n\n`);
    };
    sendDashboard();
    const unsubscribe = homeAssistant.subscribe((state) => {
      if (!state || homeStateAffectsSelection(state, listHomeSelection())) sendDashboard();
    });
    const keepAlive = setInterval(() => {
      if (!response.destroyed) response.write(': keep-alive\n\n');
    }, 25_000);
    keepAlive.unref();
    response.once('close', () => {
      clearInterval(keepAlive);
      unsubscribe();
    });
  });

  app.get('/api/home/config', { preHandler: requireParent }, async () => homeAssistant.configured());

  app.put<{ Body: { url?: string; token?: string } }>('/api/home/config', {
    preHandler: requireParent,
    schema: {
      body: {
        type: 'object', additionalProperties: false, required: ['url', 'token'],
        properties: {
          url: { type: 'string', minLength: 1, maxLength: 2048 },
          token: { type: 'string', minLength: 20, maxLength: 2048 },
        },
      },
    },
  }, async (request, reply) => {
    const url = cleanHomeAssistantUrl(request.body?.url ?? '');
    const token = request.body?.token?.trim() ?? '';
    if (!url || token.length < 20 || token.length > 2048) return reply.code(400).send({ error: 'Enter a valid Home Assistant URL and access token' });
    try {
      await homeAssistant.save({ url, token });
      recordActivity('home.connected');
      return homeAssistant.configured();
    } catch (err) {
      return reply.code(502).send({ error: err instanceof Error ? err.message : 'Could not connect to Home Assistant' });
    }
  });

  app.delete('/api/home/config', { preHandler: requireParent }, async () => {
    homeAssistant.clear();
    recordActivity('home.disconnected');
    return { ok: true };
  });

  app.get('/api/home/entities', { preHandler: requireParent }, async (): Promise<HomeCandidate[]> => {
    const selected = new Map(listHomeSelection().map((item) => [item.entityId, item]));
    return [...homeAssistant.states().values()]
      .map((state) => {
        const item = selected.get(state.entityId);
        return {
          ...state,
          selected: Boolean(item),
          displayName: item?.displayName ?? state.name,
          frameAlert: item?.frameAlert ?? defaultHomeFrameAlert(state),
        };
      })
      .sort((a, b) => (a.area ?? '').localeCompare(b.area ?? '') || a.name.localeCompare(b.name));
  });

  app.get('/api/home/devices', { preHandler: requireParent }, async (): Promise<HomeDeviceCandidate[]> => deviceCandidates());

  app.put<{ Body: { items?: HomeDashboardSelection[] } }>('/api/home/dashboard', {
    preHandler: requireParent,
    schema: {
      body: {
        type: 'object', additionalProperties: false, required: ['items'],
        properties: {
          items: {
            type: 'array', maxItems: 100, uniqueItems: true,
            items: {
              type: 'object', additionalProperties: false, required: ['entityId', 'displayName', 'frameAlert'],
              properties: {
                entityId: { type: 'string', pattern: '^[a-z0-9_]+\\.[a-z0-9_]+$' },
                deviceId: { anyOf: [{ type: 'string', minLength: 1, maxLength: 128 }, { type: 'null' }] },
                displayName: { anyOf: [{ type: 'string', minLength: 1, maxLength: 100 }, { type: 'null' }] },
                frameAlert: { type: 'boolean' },
              },
            },
          },
        },
      },
    },
    handler: async (request, reply) => {
      try {
        // Home Assistant owns naming. Keeping the stored field null prevents a
        // second name from drifting when an entity or device is renamed there.
        replaceHomeSelection((request.body.items ?? []).map((item) => ({ ...item, displayName: null })));
        recordActivity('home.dashboard.updated', null, (request.body.items ?? []).map((item) => item.entityId));
        return dashboard();
      } catch (err) {
        return reply.code(400).send({ error: err instanceof Error ? err.message : 'Invalid Home dashboard' });
      }
    },
  });

  app.post<{ Params: { entityId: string }; Body: { action?: string; value?: number } }>('/api/home/entities/:entityId/action', {
    schema: {
      params: {
        type: 'object', additionalProperties: false, required: ['entityId'],
        properties: { entityId: { type: 'string', pattern: '^[a-z0-9_]+\\.[a-z0-9_]+$' } },
      },
      body: {
        type: 'object', additionalProperties: false, required: ['action'],
        properties: {
          action: { enum: ['turn_on', 'turn_off', 'toggle', 'lock', 'unlock', 'open', 'close', 'stop', 'arm_away', 'disarm', 'press', 'set_temperature', 'set_brightness'] },
          value: { type: 'number', minimum: -50, maximum: 150 },
        },
      },
    },
  }, async (request, reply) => {
    const entityId = request.params.entityId;
    const selected = listHomeSelection().some((item) => item.entityId === entityId);
    if (!selected) return reply.code(404).send({ error: 'That entity is not on the Home dashboard' });
    const domain = entityId.split('.')[0] ?? '';
    const action = request.body?.action ?? '';
    const service = actionMap[domain]?.[action];
    if (!service) return reply.code(400).send({ error: 'That action is not supported for this entity' });
    if (['set_temperature', 'set_brightness'].includes(action) && typeof request.body.value !== 'number') return reply.code(400).send({ error: 'Choose a value' });
    if (action === 'set_brightness' && (request.body.value! < 0 || request.body.value! > 100)) return reply.code(400).send({ error: 'Brightness must be between 0 and 100' });
    try {
      const data = action === 'set_temperature'
        ? { temperature: request.body.value }
        : action === 'set_brightness'
          ? { brightness_pct: Math.round(request.body.value!) }
          : {};
      await homeAssistant.callService(domain, service, entityId, data);
      return { ok: true };
    } catch (err) {
      return reply.code(502).send({ error: err instanceof Error ? err.message : 'Home Assistant action failed' });
    }
  });
}

export function homeStateAffectsSelection(state: HomeEntityState, selection: HomeDashboardSelection[]): boolean {
  return selection.some((item) =>
    item.entityId === state.entityId || Boolean(item.deviceId && item.deviceId === state.deviceId),
  );
}
