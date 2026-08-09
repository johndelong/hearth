import { db, id, nowIso } from '../db/index.js';

export interface ActivityEntry {
  id: string;
  action: string;
  subject: string | null;
  detail: string | null;
  createdAt: string;
}

export function recordActivity(action: string, subject?: string | null, detail?: unknown): void {
  db.prepare('INSERT INTO activity_log (id, action, subject, detail, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(id('au'), action, subject ?? null, detail === undefined ? null : JSON.stringify(detail), nowIso());
}

export function listActivity(limit = 50): ActivityEntry[] {
  return db.prepare<[number], { id: string; action: string; subject: string | null; detail: string | null; created_at: string }>(
    'SELECT * FROM activity_log ORDER BY created_at DESC LIMIT ?',
  ).all(Math.min(200, Math.max(1, limit))).map((row) => ({
    id: row.id, action: row.action, subject: row.subject, detail: row.detail, createdAt: row.created_at,
  }));
}
