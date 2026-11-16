/// <reference types="node" />
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { URL as NodeURL } from 'node:url';

// Run the real migration and SQL, with D1's transactional batch semantics.
export function testDatabase() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys = ON');
  sqlite.exec(readFileSync(new NodeURL('../../migrations/0001_accounts.sql', import.meta.url), 'utf8'));
  class Statement {
    values: (string | number | null)[] = [];
    constructor(readonly sql: string) {}
    bind(...values: (string | number | null)[]) { this.values = values; return this; }
    async first() { return sqlite.prepare(this.sql).get(...this.values) || null; }
    execute() {
      const result = sqlite.prepare(this.sql).run(...this.values);
      return { success: true, results: [], meta: { changes: Number(result.changes), last_row_id: Number(result.lastInsertRowid) } };
    }
    async run() { return this.execute(); }
    async all() { return { success: true, results: sqlite.prepare(this.sql).all(...this.values) }; }
  }
  const db = {
    prepare: (sql: string) => new Statement(sql),
    batch: async (statements: Statement[]) => {
      sqlite.exec('BEGIN');
      try {
        const results = statements.map((statement) => statement.execute());
        sqlite.exec('COMMIT');
        return results;
      } catch (error) { sqlite.exec('ROLLBACK'); throw error; }
    },
  } as unknown as D1Database;
  return { db, sqlite };
}
