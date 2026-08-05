import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Db } from './sqlite.js';

const here = dirname(fileURLToPath(import.meta.url));

/**
 * Forward-only migrations tracked by SQLite's own `user_version` pragma.
 *
 * Files are named `NNN_description.sql`; the leading number is the version the
 * database is at once that file has run. On boot every file numbered above the
 * current `user_version` is applied in order, each inside a transaction, so a
 * failure part-way leaves the database on the last version that fully applied.
 *
 * `user_version` is stored in the database header, which means the schema
 * version travels with the file itself — copy the .db somewhere else and it
 * still knows what it is.
 */
export function migrate(db: Db, log?: (message: string) => void): number {
  const dir = join(here, 'migrations');
  const files = readdirSync(dir)
    .filter((name) => name.endsWith('.sql'))
    .sort(); // zero-padded prefixes make lexical order the right order

  const current = db.userVersion();
  let applied = current;

  for (const file of files) {
    const version = Number(file.slice(0, file.indexOf('_')));
    if (!Number.isInteger(version) || version <= 0) {
      throw new Error(`Migration ${file} must start with a positive number, e.g. 002_add_column.sql`);
    }
    if (version <= current) continue;
    if (version !== applied + 1) {
      throw new Error(`Migration ${file} is out of sequence — expected version ${applied + 1}`);
    }

    const sql = readFileSync(join(dir, file), 'utf8');
    // PRAGMA user_version cannot be parameterised, but `version` is a validated
    // integer parsed from a filename on disk, never from user input.
    db.transaction(() => {
      db.exec(sql);
      db.exec(`PRAGMA user_version = ${version}`);
    })();

    applied = version;
    log?.(`Applied migration ${file}`);
  }

  return applied;
}
