/// <reference types="node" />
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { URL as NodeURL } from 'node:url';
import { describe, expect, it } from 'vitest';

const sql = (file: string) => readFileSync(new NodeURL(`../migrations/${file}`, import.meta.url), 'utf8');

describe('0003_day_settings', () => {
  it('keeps existing records, revisions, references and quotas while adding day records', () => {
    const db = new DatabaseSync(':memory:');
    db.exec('PRAGMA foreign_keys = ON');
    db.exec(sql('0001_accounts.sql')); db.exec(sql('0002_sync.sql'));
    db.exec(`INSERT INTO users (id, email, password_hash, created_at) VALUES ('u', 'u@example.test', 'x', 1);
      INSERT INTO sync_records (user_id, entity, id, edited_at, deleted, data) VALUES
        ('u', 'item', 'h', 5, 0, '{"kind":"habit","title":"Walk","createdDay":"2026-11-16"}'),
        ('u', 'completion', 'h:2026-11-16', 6, 0, '{"itemId":"h","day":"2026-11-16","completed":true}');`);
    const before = db.prepare('SELECT entity, id, edited_at, deleted, data, revision FROM sync_records ORDER BY revision').all();
    expect(() => db.prepare("INSERT INTO sync_records (user_id, entity, id, edited_at, deleted, data) VALUES ('u', 'day', '0001-01-01', 1, 0, '{}')").run()).toThrow();

    db.exec(sql('0003_day_settings.sql'));
    expect(db.prepare('SELECT entity, id, edited_at, deleted, data, revision FROM sync_records ORDER BY revision').all()).toEqual(before);
    db.prepare("INSERT INTO sync_records (user_id, entity, id, edited_at, deleted, data) VALUES ('u', 'day', '0001-01-01', 1, 0, '{}')").run();
    expect(db.prepare('SELECT revision FROM sync_records WHERE entity = ?').get('day')?.revision).toBe(3);
    expect(db.prepare('SELECT COUNT(*) AS n FROM sync_days').get()?.n).toBe(1);
    // The reference trigger is back: a completion for a missing item is still refused.
    expect(() => db.prepare("INSERT INTO sync_records (user_id, entity, id, edited_at, deleted, data) VALUES ('u', 'completion', 'x:task', 1, 0, '{\"itemId\":\"x\",\"day\":null,\"completed\":true}')").run()).toThrow(/Invalid record reference/);
    expect(db.prepare("SELECT name FROM sqlite_master WHERE name LIKE '%_v2'").all()).toEqual([]);
    db.close();
  });
});

describe('0004_dismissals', () => {
  it('keeps existing records and revisions while adding reference-checked dismissals', () => {
    const db = new DatabaseSync(':memory:');
    db.exec('PRAGMA foreign_keys = ON');
    for (const file of ['0001_accounts.sql', '0002_sync.sql', '0003_day_settings.sql']) db.exec(sql(file));
    db.exec(`INSERT INTO users (id, email, password_hash, created_at) VALUES ('u', 'u@example.test', 'x', 1);
      INSERT INTO sync_records (user_id, entity, id, edited_at, deleted, data) VALUES
        ('u', 'item', 'h', 5, 0, '{"kind":"habit","title":"Walk","createdDay":"2026-11-16","reminder":"17:30"}'),
        ('u', 'day', '0001-01-01', 6, 0, '{"effectiveDay":"0001-01-01","timeZone":"UTC","startHour":0}');`);
    const before = db.prepare('SELECT entity, id, edited_at, deleted, data, revision FROM sync_records ORDER BY revision').all();
    const dismiss = (itemId: string, day: string) => db.prepare("INSERT INTO sync_records (user_id, entity, id, edited_at, deleted, data) VALUES ('u', 'dismissal', ?, 1, 0, ?)")
      .run(`${itemId}:${day}`, JSON.stringify({ itemId, day, reminder: '17:30' }));
    expect(() => dismiss('h', '2026-11-16')).toThrow();

    db.exec(sql('0004_dismissals.sql'));
    expect(db.prepare('SELECT entity, id, edited_at, deleted, data, revision FROM sync_records ORDER BY revision').all()).toEqual(before);
    dismiss('h', '2026-11-16');
    expect(db.prepare('SELECT revision FROM sync_records WHERE entity = ?').get('dismissal')?.revision).toBe(3);
    expect(db.prepare('SELECT COUNT(*) AS n FROM sync_dismissals').get()?.n).toBe(1);
    expect(db.prepare('SELECT COUNT(*) AS n FROM sync_days').get()?.n).toBe(1);
    // Dismissals follow completions' references: an existing habit, on or after its creation day.
    expect(() => dismiss('x', '2026-11-16')).toThrow(/Invalid record reference/);
    expect(() => dismiss('h', '2026-11-15')).toThrow(/Invalid record reference/);
    expect(db.prepare("SELECT name FROM sqlite_master WHERE name LIKE '%_v3'").all()).toEqual([]);
    db.close();
  });
});
