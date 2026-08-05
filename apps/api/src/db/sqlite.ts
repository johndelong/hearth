import { DatabaseSync, type SQLInputValue } from 'node:sqlite';

/**
 * A thin typed wrapper over `node:sqlite`.
 *
 * Node ships SQLite in core, so the dashboard needs no native module — that
 * keeps `npm install` working on any Node version and keeps the container image
 * free of a C toolchain. This wrapper adds back the two conveniences we want
 * from better-sqlite3: typed statements and a `transaction()` helper.
 */

export interface Statement<Params extends unknown[], Row> {
  get(...params: Params): Row | undefined;
  all(...params: Params): Row[];
  run(...params: Params): { changes: number | bigint; lastInsertRowid: number | bigint };
}

/** `undefined` is not a bindable SQLite value, but it is how JS spells "unset". */
const bind = (params: unknown[]): SQLInputValue[] =>
  params.map((p) => (p === undefined ? null : (p as SQLInputValue)));

export class Db {
  readonly raw: DatabaseSync;
  private depth = 0;

  constructor(path: string) {
    this.raw = new DatabaseSync(path);
  }

  exec(sql: string): void {
    this.raw.exec(sql);
  }

  pragma(statement: string): void {
    this.raw.exec(`PRAGMA ${statement}`);
  }

  /** Schema version, stored in the database header. See migrate.ts. */
  userVersion(): number {
    const row = this.raw.prepare('PRAGMA user_version').get() as { user_version?: number } | undefined;
    return row?.user_version ?? 0;
  }

  prepare<Params extends unknown[] = unknown[], Row = unknown>(sql: string): Statement<Params, Row> {
    const stmt = this.raw.prepare(sql);
    return {
      get: (...params) => stmt.get(...bind(params)) as Row | undefined,
      all: (...params) => stmt.all(...bind(params)) as Row[],
      run: (...params) => stmt.run(...bind(params)),
    };
  }

  /**
   * Wraps `fn` so every statement inside it commits or rolls back together.
   * Nested calls join the outer transaction rather than starting a second one,
   * which SQLite would reject.
   */
  transaction<Args extends unknown[], Result>(fn: (...args: Args) => Result): (...args: Args) => Result {
    return (...args: Args): Result => {
      if (this.depth > 0) return fn(...args);
      this.depth += 1;
      this.raw.exec('BEGIN');
      try {
        const result = fn(...args);
        this.raw.exec('COMMIT');
        return result;
      } catch (err) {
        this.raw.exec('ROLLBACK');
        throw err;
      } finally {
        this.depth -= 1;
      }
    };
  }
}
