import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { migrate } from './migrate.js';
import { Db } from './sqlite.js';

const DB_PATH = process.env.DATABASE_PATH ?? join(process.cwd(), 'data', 'dashboard.db');

mkdirSync(dirname(DB_PATH), { recursive: true });

export const db = new Db(DB_PATH);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

/** Brings the schema up to date before anything else touches the database. */
export const schemaVersion = migrate(db, (message) => console.log(`[db] ${message}`));

export function id(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

export const nowIso = (): string => new Date().toISOString();

/** SQLite has no booleans; these keep the conversions honest at the edges. */
export const toBool = (v: unknown): boolean => v === 1 || v === true;
export const fromBool = (v: unknown): number => (v ? 1 : 0);
