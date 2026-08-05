import { DEFAULT_SETTINGS, type Settings } from '@dashboard/shared';
import { db } from '../db/index.js';

const getRow = db.prepare<[string], { value: string }>('SELECT value FROM settings WHERE key = ?');
const putRow = db.prepare(
  'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
);
const allRows = db.prepare<[], { key: string; value: string }>('SELECT key, value FROM settings');

/** Raw single-key access, used for secrets that never reach the client. */
export function getRaw(key: string): string | null {
  return getRow.get(key)?.value ?? null;
}

export function setRaw(key: string, value: string): void {
  putRow.run(key, value);
}

export function getSettings(): Settings {
  const stored: Record<string, unknown> = {};
  for (const { key, value } of allRows.all()) {
    if (key.startsWith('_')) continue; // `_`-prefixed keys are server-only secrets
    try {
      stored[key] = JSON.parse(value);
    } catch {
      stored[key] = value;
    }
  }
  return {
    ...DEFAULT_SETTINGS,
    ...stored,
    pinSet: getRaw('_pinHash') !== null,
  } as Settings;
}

export function updateSettings(patch: Partial<Settings>): Settings {
  const write = db.transaction((entries: [string, unknown][]) => {
    for (const [key, value] of entries) {
      if (key === 'pinSet' || key.startsWith('_')) continue; // derived / protected
      putRow.run(key, JSON.stringify(value));
    }
  });
  write(Object.entries(patch));
  return getSettings();
}
