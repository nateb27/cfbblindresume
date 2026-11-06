/**
 * A D1 database for tests: node:sqlite in memory with every migration in migrations/ applied, behind
 * the slice of the D1 API the Functions use (prepare/bind/first/all/run/batch, ?N parameters).
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import type { D1Database, D1PreparedStatement, D1Result } from '../../functions/_lib/cf';

const root = fileURLToPath(new URL('../..', import.meta.url));

class Stmt implements D1PreparedStatement {
  constructor(
    private readonly db: DatabaseSync,
    readonly sql: string,
    private readonly params: unknown[] = [],
  ) {}

  bind(...values: unknown[]): D1PreparedStatement {
    return new Stmt(this.db, this.sql, values);
  }

  private exec<T>(): T[] {
    const s = this.db.prepare(this.sql);
    const args = this.params as (string | number | null)[];
    return (/^\s*(select|with)|returning/i.test(this.sql) ? s.all(...args) : (s.run(...args), [])) as T[];
  }

  async first<T>(column?: string): Promise<T | null> {
    const row = this.exec<Record<string, unknown>>()[0];
    if (!row) return null;
    return (column ? row[column] : { ...row }) as T;
  }

  async all<T>(): Promise<D1Result<T>> {
    return { results: this.exec<Record<string, unknown>>().map((r) => ({ ...r }) as T), success: true };
  }

  async run<T>(): Promise<D1Result<T>> {
    return this.all<T>();
  }
}

export class SqliteD1 implements D1Database {
  readonly db: DatabaseSync;
  /** Statements executed (for assertions). */
  readonly log: string[] = [];

  constructor() {
    this.db = new DatabaseSync(':memory:');
    const dir = join(root, 'migrations');
    for (const f of readdirSync(dir).filter((x) => x.endsWith('.sql')).sort()) this.db.exec(readFileSync(join(dir, f), 'utf8'));
  }

  prepare(query: string): D1PreparedStatement {
    this.log.push(query);
    return new Stmt(this.db, query);
  }

  async batch<T>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]> {
    this.db.exec('BEGIN');
    try {
      const out: D1Result<T>[] = [];
      for (const s of statements) out.push(await s.all<T>());
      this.db.exec('COMMIT');
      return out;
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
  }

  rows<T = Record<string, unknown>>(sql: string, ...params: (string | number)[]): T[] {
    return this.db.prepare(sql).all(...params).map((r) => ({ ...r }) as T);
  }
}

