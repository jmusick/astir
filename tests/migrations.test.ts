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

describe('0006_repeating_tasks', () => {
  it('keeps existing records and lets today-only tasks hold schedules and per-day completions', () => {
    const db = new DatabaseSync(':memory:');
    db.exec('PRAGMA foreign_keys = ON');
    for (const file of ['0001_accounts.sql', '0002_sync.sql', '0003_day_settings.sql', '0004_dismissals.sql', '0005_device_tokens.sql']) db.exec(sql(file));
    db.exec(`INSERT INTO users (id, email, password_hash, created_at) VALUES ('u', 'u@example.test', 'x', 1);
      INSERT INTO sync_records (user_id, entity, id, edited_at, deleted, data) VALUES
        ('u', 'item', 't', 5, 0, '{"kind":"today","title":"Call","originalDay":"2026-11-16"}');`);
    const before = db.prepare('SELECT entity, id, edited_at, deleted, data, revision FROM sync_records ORDER BY revision').all();
    const insert = (entity: string, id: string, data: unknown) => db.prepare("INSERT INTO sync_records (user_id, entity, id, edited_at, deleted, data) VALUES ('u', ?, ?, 1, 0, ?)")
      .run(entity, id, JSON.stringify(data));
    expect(() => insert('completion', 't:2026-11-17', { itemId: 't', day: '2026-11-17', completed: true })).toThrow(/Invalid record reference/);

    db.exec(sql('0006_repeating_tasks.sql'));
    expect(db.prepare('SELECT entity, id, edited_at, deleted, data, revision FROM sync_records ORDER BY revision').all()).toEqual(before);
    insert('completion', 't:2026-11-17', { itemId: 't', day: '2026-11-17', completed: true });
    insert('schedule', 't:2026-11-17', { itemId: 't', effectiveDay: '2026-11-17', weekdays: [1] });
    expect(db.prepare('SELECT revision FROM sync_records WHERE id = ? AND entity = ?').get('t:2026-11-17', 'schedule')?.revision).toBe(3);
    // Still refused: days before the task's own day, and missing items.
    expect(() => insert('completion', 't:2026-11-15', { itemId: 't', day: '2026-11-15', completed: true })).toThrow(/Invalid record reference/);
    expect(() => insert('schedule', 'x:2026-11-17', { itemId: 'x', effectiveDay: '2026-11-17', weekdays: [1] })).toThrow(/Invalid record reference/);
    db.close();
  });
});

describe('0007_daily_checklists', () => {
  it('keeps existing records and lets repeating tasks have subtasks', () => {
    const db = new DatabaseSync(':memory:');
    db.exec('PRAGMA foreign_keys = ON');
    for (const file of ['0001_accounts.sql', '0002_sync.sql', '0003_day_settings.sql', '0004_dismissals.sql', '0005_device_tokens.sql', '0006_repeating_tasks.sql']) db.exec(sql(file));
    db.exec(`INSERT INTO users (id, email, password_hash, created_at) VALUES ('u', 'u@example.test', 'x', 1);
      INSERT INTO sync_records (user_id, entity, id, edited_at, deleted, data) VALUES
        ('u', 'item', 'h', 5, 0, '{"kind":"habit","title":"Post","createdDay":"2026-11-16"}');`);
    const before = db.prepare('SELECT entity, id, edited_at, deleted, data, revision FROM sync_records ORDER BY revision').all();
    const sub = () => db.prepare("INSERT INTO sync_records (user_id, entity, id, edited_at, deleted, data) VALUES ('u', 'item', 's', 1, 0, ?)")
      .run(JSON.stringify({ kind: 'habit', title: 'Write it', createdDay: '2026-11-16', parentId: 'h' }));
    expect(sub).toThrow(/Invalid record reference/);

    db.exec(sql('0007_daily_checklists.sql'));
    expect(db.prepare('SELECT entity, id, edited_at, deleted, data, revision FROM sync_records ORDER BY revision').all()).toEqual(before);
    sub();
    db.prepare("INSERT INTO sync_records (user_id, entity, id, edited_at, deleted, data) VALUES ('u', 'completion', 's:2026-11-17', 1, 0, ?)")
      .run(JSON.stringify({ itemId: 's', day: '2026-11-17', completed: true }));
    // A subtask still can't have subtasks, or hang off a parent of another kind.
    expect(() => db.prepare("INSERT INTO sync_records (user_id, entity, id, edited_at, deleted, data) VALUES ('u', 'item', 'x', 1, 0, ?)")
      .run(JSON.stringify({ kind: 'habit', title: 'Deep', createdDay: '2026-11-16', parentId: 's' }))).toThrow(/Invalid record reference/);
    db.close();
  });
});
