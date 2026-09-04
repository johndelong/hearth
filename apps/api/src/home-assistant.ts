import type { HomeConnectionState, HomeEntityState } from '@dashboard/shared';
import { protect, unprotect } from './crypto.js';
import { cacheHomeState, cachedHomeStates } from './store/home.js';
import { deleteRaw, getRaw, setRaw } from './store/settings.js';

const URL_KEY = '_homeAssistantUrl';
const TOKEN_KEY = '_homeAssistantToken';
const CONNECT_TIMEOUT = 12_000;

interface HaState {
  entity_id?: unknown;
  state?: unknown;
  attributes?: unknown;
  last_changed?: unknown;
}

interface RegistryEntity {
  entity_id?: string;
  device_id?: string | null;
  area_id?: string | null;
}

interface RegistryDevice {
  id?: string;
  area_id?: string | null;
  name?: string | null;
  name_by_user?: string | null;
  manufacturer?: string | null;
  model?: string | null;
}

interface RegistryArea {
  area_id?: string;
  name?: string;
}

export interface HomeAssistantConfig {
  url: string;
  token: string;
}

export interface HomeAssistantDevice {
  id: string;
  name: string;
  area: string | null;
  manufacturer: string | null;
  model: string | null;
}

export interface HomeAssistantCommandResponse {
  id: number;
  success: boolean;
  result?: unknown;
  error?: string;
}

export function parseHomeAssistantCommandResponse(message: Record<string, unknown>): HomeAssistantCommandResponse | null {
  if (typeof message.id !== 'number') return null;
  if (message.type === 'pong') return { id: message.id, success: true };
  if (message.type !== 'result') return null;
  if (message.success === true) return { id: message.id, success: true, result: message.result };
  return {
    id: message.id,
    success: false,
    error: String((message.error as { message?: unknown } | undefined)?.message ?? 'Home Assistant request failed'),
  };
}

export function isHomeAssistantRegistryEvent(event: Record<string, unknown>): boolean {
  return ['entity_registry_updated', 'device_registry_updated', 'area_registry_updated'].includes(
    typeof event.event_type === 'string' ? event.event_type : '',
  );
}

export function cleanHomeAssistantUrl(value: string): string | null {
  try {
    const url = new URL(value.trim());
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) return null;
    return url.toString().replace(/\/$/, '');
  } catch {
    return null;
  }
}

function socketUrl(base: string): string {
  const url = new URL(base);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  url.pathname = `${url.pathname.replace(/\/$/, '')}/api/websocket`;
  return url.toString();
}

function storedConfig(): HomeAssistantConfig | null {
  const url = getRaw(URL_KEY);
  const token = unprotect(getRaw(TOKEN_KEY));
  return url && token ? { url, token } : null;
}

class HaSocket {
  private socket: WebSocket | null = null;
  private nextId = 1;
  private pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }>();
  onEvent?: (event: Record<string, unknown>) => void;
  onClose?: () => void;

  async open(config: HomeAssistantConfig): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const socket = new WebSocket(socketUrl(config.url));
      this.socket = socket;
      let authenticated = false;
      const timeout = setTimeout(() => {
        socket.close();
        reject(new Error('Home Assistant did not respond'));
      }, CONNECT_TIMEOUT);
      const fail = (message: string) => {
        clearTimeout(timeout);
        reject(new Error(message));
      };
      socket.addEventListener('error', () => fail('Could not reach Home Assistant'), { once: true });
      socket.addEventListener('close', () => {
        clearTimeout(timeout);
        for (const request of this.pending.values()) {
          clearTimeout(request.timer);
          request.reject(new Error('Home Assistant disconnected'));
        }
        this.pending.clear();
        if (!authenticated) fail('Home Assistant closed the connection');
        this.onClose?.();
      });
      socket.addEventListener('message', (raw) => {
        let message: Record<string, unknown>;
        try {
          message = JSON.parse(String(raw.data)) as Record<string, unknown>;
        } catch {
          return;
        }
        if (message.type === 'auth_required') {
          socket.send(JSON.stringify({ type: 'auth', access_token: config.token }));
          return;
        }
        if (message.type === 'auth_invalid') {
          fail('Home Assistant rejected that access token');
          socket.close();
          return;
        }
        if (message.type === 'auth_ok') {
          authenticated = true;
          clearTimeout(timeout);
          resolve();
          return;
        }
        const response = parseHomeAssistantCommandResponse(message);
        if (response) {
          const request = this.pending.get(response.id);
          if (!request) return;
          this.pending.delete(response.id);
          clearTimeout(request.timer);
          if (response.success) request.resolve(response.result);
          else request.reject(new Error(response.error));
          return;
        }
        if (message.type === 'event' && message.event && typeof message.event === 'object') {
          this.onEvent?.(message.event as Record<string, unknown>);
        }
      });
    });
  }

  command(type: string, fields: Record<string, unknown> = {}): Promise<unknown> {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return Promise.reject(new Error('Home Assistant is not connected'));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error('Home Assistant did not respond'));
      }, CONNECT_TIMEOUT);
      timer.unref();
      this.pending.set(id, { resolve, reject, timer });
      this.socket!.send(JSON.stringify({ id, type, ...fields }));
    });
  }

  close(): void {
    this.onClose = undefined;
    this.socket?.close();
    this.socket = null;
  }
}

function stateFrom(raw: HaState, area: string | null = null, deviceId: string | null = null): HomeEntityState | null {
  if (typeof raw.entity_id !== 'string' || typeof raw.state !== 'string') return null;
  const attributes = raw.attributes && typeof raw.attributes === 'object' ? raw.attributes as Record<string, unknown> : {};
  const domain = raw.entity_id.split('.')[0] ?? '';
  const number = (key: string): number | null =>
    typeof attributes[key] === 'number' && Number.isFinite(attributes[key]) ? attributes[key] : null;
  return {
    entityId: raw.entity_id,
    state: raw.state,
    name: typeof attributes.friendly_name === 'string' ? attributes.friendly_name : raw.entity_id,
    domain,
    deviceClass: typeof attributes.device_class === 'string' ? attributes.device_class : null,
    deviceId,
    area,
    unit: typeof attributes.unit_of_measurement === 'string' ? attributes.unit_of_measurement : null,
    lastChanged: typeof raw.last_changed === 'string' ? raw.last_changed : null,
    available: raw.state !== 'unavailable' && raw.state !== 'unknown',
    details: {
      currentTemperature: number('current_temperature'),
      targetTemperature: number('temperature'),
      humidity: number('humidity'),
      brightness: number('brightness'),
      position: number('current_position'),
      batteryLevel: number('battery_level'),
    },
  };
}

export class HomeAssistantConnection {
  private socket: HaSocket | null = null;
  private retry: NodeJS.Timeout | null = null;
  private heartbeat: NodeJS.Timeout | null = null;
  private generation = 0;
  private connectionState: HomeConnectionState = 'disconnected';
  private stateMap = cachedHomeStates();
  private areaByEntity = new Map<string, string>();
  private deviceByEntity = new Map<string, string>();
  private deviceMap = new Map<string, HomeAssistantDevice>();
  private listeners = new Set<(state: HomeEntityState | null) => void>();
  private registryRefresh: Promise<void> | null = null;

  status(): HomeConnectionState {
    return this.connectionState;
  }

  configured(): { configured: boolean; url: string | null; state: HomeConnectionState } {
    const config = storedConfig();
    return { configured: Boolean(config), url: config?.url ?? null, state: this.connectionState };
  }

  states(): Map<string, HomeEntityState> {
    return new Map(this.stateMap);
  }

  devices(): Map<string, HomeAssistantDevice> {
    return new Map(this.deviceMap);
  }

  subscribe(listener: (state: HomeEntityState | null) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async test(config: HomeAssistantConfig): Promise<void> {
    const socket = new HaSocket();
    try {
      await socket.open(config);
      await socket.command('get_config');
    } finally {
      socket.close();
    }
  }

  async save(config: HomeAssistantConfig): Promise<void> {
    await this.test(config);
    setRaw(URL_KEY, config.url);
    setRaw(TOKEN_KEY, protect(config.token)!);
    await this.restart();
  }

  clear(): void {
    deleteRaw(URL_KEY);
    deleteRaw(TOKEN_KEY);
    this.stop();
  }

  start(): void {
    if (storedConfig()) void this.connect(this.generation);
  }

  stop(): void {
    this.generation += 1;
    if (this.retry) clearTimeout(this.retry);
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.retry = null;
    this.heartbeat = null;
    this.socket?.close();
    this.socket = null;
    this.setConnectionState('disconnected');
  }

  async restart(): Promise<void> {
    this.stop();
    await this.connect(this.generation);
  }

  async callService(domain: string, service: string, entityId: string, data: Record<string, unknown> = {}): Promise<void> {
    if (this.connectionState !== 'connected' || !this.socket) throw new Error('Home Assistant is not connected');
    await this.socket.command('call_service', { domain, service, service_data: { entity_id: entityId, ...data } });
  }

  private async connect(generation: number): Promise<void> {
    const config = storedConfig();
    if (!config || generation !== this.generation) return;
    this.setConnectionState('connecting');
    const socket = new HaSocket();
    this.socket = socket;
    socket.onClose = () => {
      if (generation !== this.generation) return;
      if (this.heartbeat) clearInterval(this.heartbeat);
      this.heartbeat = null;
      this.setConnectionState('error');
      this.scheduleReconnect(generation);
    };
    try {
      await socket.open(config);
      const [states, entities, devices, areas] = await Promise.all([
        socket.command('get_states'),
        socket.command('config/entity_registry/list').catch(() => []),
        socket.command('config/device_registry/list').catch(() => []),
        socket.command('config/area_registry/list').catch(() => []),
      ]);
      if (generation !== this.generation) return socket.close();
      this.updateAreas(entities, devices, areas);
      if (Array.isArray(states)) {
        for (const raw of states) this.acceptState(raw as HaState, false);
      }
      socket.onEvent = (event) => {
        if (isHomeAssistantRegistryEvent(event)) {
          void this.refreshRegistry(socket, generation);
          return;
        }
        const data = event.data;
        if (!data || typeof data !== 'object') return;
        const changed = (data as Record<string, unknown>).new_state;
        if (changed && typeof changed === 'object') this.acceptState(changed as HaState);
      };
      await Promise.all([
        socket.command('subscribe_events', { event_type: 'state_changed' }),
        socket.command('subscribe_events', { event_type: 'entity_registry_updated' }),
        socket.command('subscribe_events', { event_type: 'device_registry_updated' }),
        socket.command('subscribe_events', { event_type: 'area_registry_updated' }),
      ]);
      this.setConnectionState('connected');
      this.heartbeat = setInterval(() => {
        void socket.command('ping').catch(() => socket.close());
      }, 30_000);
      this.heartbeat.unref();
    } catch {
      socket.close();
      if (generation !== this.generation) return;
      this.setConnectionState('error');
      this.scheduleReconnect(generation);
    }
  }

  private updateAreas(entitiesRaw: unknown, devicesRaw: unknown, areasRaw: unknown): void {
    const entities = Array.isArray(entitiesRaw) ? entitiesRaw as RegistryEntity[] : [];
    const devices = Array.isArray(devicesRaw) ? devicesRaw as RegistryDevice[] : [];
    const areas = Array.isArray(areasRaw) ? areasRaw as RegistryArea[] : [];
    const areaNames = new Map(areas.flatMap((area) => area.area_id && area.name ? [[area.area_id, area.name] as const] : []));
    const deviceAreas = new Map(devices.flatMap((device) => device.id && device.area_id ? [[device.id, device.area_id] as const] : []));
    this.deviceMap = new Map(devices.flatMap((device) => {
      if (!device.id) return [];
      const name = device.name_by_user ?? device.name;
      if (!name) return [];
      return [[device.id, {
        id: device.id,
        name,
        area: device.area_id ? areaNames.get(device.area_id) ?? null : null,
        manufacturer: device.manufacturer ?? null,
        model: device.model ?? null,
      }] as const];
    }));
    this.areaByEntity = new Map(entities.flatMap((entity) => {
      if (!entity.entity_id) return [];
      const areaId = entity.area_id ?? (entity.device_id ? deviceAreas.get(entity.device_id) : null);
      const name = areaId ? areaNames.get(areaId) : null;
      return name ? [[entity.entity_id, name] as const] : [];
    }));
    this.deviceByEntity = new Map(entities.flatMap((entity) =>
      entity.entity_id && entity.device_id ? [[entity.entity_id, entity.device_id] as const] : [],
    ));
  }

  private acceptState(raw: HaState, notify = true): void {
    const entityId = typeof raw.entity_id === 'string' ? raw.entity_id : '';
    const state = stateFrom(raw, this.areaByEntity.get(entityId) ?? null, this.deviceByEntity.get(entityId) ?? null);
    if (!state) return;
    this.stateMap.set(state.entityId, state);
    cacheHomeState(state);
    if (notify) this.notify(state);
  }

  private refreshRegistry(socket: HaSocket, generation: number): Promise<void> {
    if (this.registryRefresh) return this.registryRefresh;
    const refresh = Promise.all([
      socket.command('get_states'),
      socket.command('config/entity_registry/list'),
      socket.command('config/device_registry/list'),
      socket.command('config/area_registry/list'),
    ]).then(([states, entities, devices, areas]) => {
      if (generation !== this.generation || this.socket !== socket) return;
      this.updateAreas(entities, devices, areas);
      if (Array.isArray(states)) {
        for (const raw of states) this.acceptState(raw as HaState, false);
      }
      this.notify(null);
    }).catch(() => undefined).finally(() => {
      if (this.registryRefresh === refresh) this.registryRefresh = null;
    });
    this.registryRefresh = refresh;
    return refresh;
  }

  private setConnectionState(state: HomeConnectionState): void {
    if (this.connectionState === state) return;
    this.connectionState = state;
    this.notify(null);
  }

  private notify(state: HomeEntityState | null): void {
    for (const listener of this.listeners) listener(state);
  }

  private scheduleReconnect(generation: number): void {
    if (this.retry || generation !== this.generation || !storedConfig()) return;
    this.retry = setTimeout(() => {
      this.retry = null;
      void this.connect(generation);
    }, 10_000);
    this.retry.unref();
  }
}

export const homeAssistant = new HomeAssistantConnection();
