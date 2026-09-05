import type { HomeDashboardSelection, HomeEntityDetails, HomeEntityState } from '@dashboard/shared';
import { db, nowIso } from '../db/index.js';

interface DashboardRow {
  entity_id: string;
  device_id: string | null;
  display_name: string | null;
  sort_order: number;
}

interface StateRow {
  entity_id: string;
  state: string;
  name: string;
  domain: string;
  device_class: string | null;
  device_id: string | null;
  area: string | null;
  unit: string | null;
  last_changed: string | null;
  details_json: string;
}

const entityIdPattern = /^[a-z0-9_]+\.[a-z0-9_]+$/;
const dashboardRows = db.prepare<[], DashboardRow>(
  'SELECT entity_id, device_id, display_name, sort_order FROM home_dashboard ORDER BY sort_order, entity_id',
);
const cachedRows = db.prepare<[], StateRow>(
  'SELECT entity_id, state, name, domain, device_class, device_id, area, unit, last_changed, details_json FROM home_state_cache',
);
const putState = db.prepare(
  `INSERT INTO home_state_cache
    (entity_id, state, name, domain, device_class, device_id, area, unit, last_changed, observed_at, details_json)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
   ON CONFLICT(entity_id) DO UPDATE SET
    state=excluded.state, name=excluded.name, domain=excluded.domain,
    device_class=excluded.device_class, device_id=excluded.device_id, area=excluded.area, unit=excluded.unit,
    last_changed=excluded.last_changed, observed_at=excluded.observed_at, details_json=excluded.details_json`,
);

export interface StoredHomeSelection {
  entityId: string;
  deviceId: string | null;
  displayName: string | null;
  sortOrder: number;
}

export function listHomeSelection(): StoredHomeSelection[] {
  return dashboardRows.all().map((row) => ({
    entityId: row.entity_id,
    deviceId: row.device_id,
    displayName: row.display_name,
    sortOrder: row.sort_order,
  }));
}

export function replaceHomeSelection(items: HomeDashboardSelection[]): StoredHomeSelection[] {
  if (items.length > 100) throw new Error('Choose no more than 100 Home Assistant entities');
  const seen = new Set<string>();
  for (const item of items) {
    if (!entityIdPattern.test(item.entityId) || seen.has(item.entityId)) throw new Error('Invalid Home Assistant entity selection');
    if (item.displayName !== null && (item.displayName.trim().length === 0 || item.displayName.length > 100)) {
      throw new Error('Device names must be 1–100 characters');
    }
    if (item.deviceId !== undefined && item.deviceId !== null && !/^[a-zA-Z0-9_-]{1,128}$/.test(item.deviceId)) {
      throw new Error('Invalid Home Assistant device');
    }
    seen.add(item.entityId);
  }
  db.transaction(() => {
    db.exec('DELETE FROM home_dashboard');
    const insert = db.prepare('INSERT INTO home_dashboard (entity_id, device_id, display_name, sort_order) VALUES (?, ?, ?, ?)');
    items.forEach((item, index) => insert.run(item.entityId, item.deviceId ?? null, item.displayName?.trim() ?? null, index));
  })();
  return listHomeSelection();
}

export function cacheHomeState(state: HomeEntityState): void {
  putState.run(
    state.entityId, state.state, state.name, state.domain, state.deviceClass,
    state.deviceId, state.area, state.unit, state.lastChanged, nowIso(), JSON.stringify(state.details),
  );
}

export function pruneHomeStatesNotIn(entityIds: Iterable<string>): void {
  const keep = new Set(entityIds);
  const stale = cachedRows.all().map((row) => row.entity_id).filter((id) => !keep.has(id));
  if (stale.length === 0) return;
  const remove = db.prepare('DELETE FROM home_state_cache WHERE entity_id = ?');
  db.transaction(() => { for (const id of stale) remove.run(id); })();
}

export function cachedHomeStates(): Map<string, HomeEntityState> {
  return new Map(cachedRows.all().map((row) => [row.entity_id, {
    entityId: row.entity_id,
    state: row.state,
    name: row.name,
    domain: row.domain,
    deviceClass: row.device_class,
    deviceId: row.device_id,
    area: row.area,
    unit: row.unit,
    lastChanged: row.last_changed,
    available: row.state !== 'unavailable' && row.state !== 'unknown',
    details: parseDetails(row.details_json),
  }]));
}

const emptyDetails = (): HomeEntityDetails => ({
  currentTemperature: null, targetTemperature: null, humidity: null,
  brightness: null, position: null, batteryLevel: null,
});

function parseDetails(value: string) {
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    const details = emptyDetails();
    for (const key of Object.keys(details) as Array<keyof typeof details>) {
      if (typeof parsed[key] === 'number' && Number.isFinite(parsed[key])) details[key] = parsed[key];
    }
    return details;
  } catch {
    return emptyDetails();
  }
}
