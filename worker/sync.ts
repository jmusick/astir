import { currentSession, isAppRequest, signedOut } from './auth';
import { isAllowedOrigin } from './headers';

export const SYNC_LIMITS = { lists: 100, openItems: 10_000, subtasks: 100, daySettings: 1_000, title: 500, notes: 20_000, changes: 500, bytes: 1_048_576 } as const;
const FUTURE_MS = 5 * 60_000;
type Entity = 'list' | 'item' | 'schedule' | 'completion' | 'day' | 'dismissal';
const ENTITIES: string[] = ['list', 'item', 'schedule', 'completion', 'day', 'dismissal'];
type Data = Record<string, string | number | boolean | null | number[]>;
type Change = { entity: Entity; id: string; editedAt: number; deleted: boolean; data: Data | null };
type Row = { entity: Entity; id: string; edited_at: number; deleted: number; data: string | null; revision: number };
class SyncError extends Error {
  constructor(message: string, readonly status = 400) { super(message); }
}
const json = (body: unknown, status = 200) => Response.json(body, { status });
const object = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new SyncError('Send a JSON object.');
  return value as Record<string, unknown>;
};
const id = (value: unknown): string => {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(value)) throw new SyncError('IDs must contain 1–128 letters, digits, underscores or hyphens.');
  return value;
};
const text = (value: unknown, name: string, max: number, required = false): string => {
  if (typeof value !== 'string' || value.length > max || (required && !value.trim())) throw new SyncError(`${name} must be ${required ? 'nonempty and ' : ''}at most ${max} characters.`);
  return value;
};
const day = (value: unknown): string => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value < '0001-01-01'
    || !Number.isFinite(Date.parse(`${value}T00:00:00Z`))
    || new Date(`${value}T00:00:00Z`).toISOString() !== `${value}T00:00:00.000Z`) throw new SyncError('Use a valid YYYY-MM-DD day.');
  return value;
};
const time = (value: unknown): string => {
  if (typeof value !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) throw new SyncError('Use an HH:mm reminder time.');
  return value;
};
const timeZone = (value: unknown): string => {
  let valid = typeof value === 'string' && /^[A-Za-z0-9_+\-/]{1,64}$/.test(value);
  if (valid) { try { new Intl.DateTimeFormat('en-US', { timeZone: value as string }); } catch { valid = false; } }
  if (!valid) throw new SyncError('Use an IANA time zone such as America/New_York.');
  return value as string;
};
function fields(value: Record<string, unknown>, allowed: string[]) {
  if (Object.keys(value).some((key) => !allowed.includes(key))) throw new SyncError('Unknown field in sync data.');
}
function dataOf(entity: Entity, value: unknown): Data {
  const d = object(value);
  if (entity === 'list') {
    fields(d, ['title', 'position']);
    return { title: text(d.title, 'Title', SYNC_LIMITS.title, true), position: position(d.position) };
  }
  if (entity === 'schedule') {
    fields(d, ['itemId', 'effectiveDay', 'weekdays']);
    if (!Array.isArray(d.weekdays) || !d.weekdays.length || d.weekdays.length > 7
      || d.weekdays.some((v) => !Number.isInteger(v) || v < 0 || v > 6) || new Set(d.weekdays).size !== d.weekdays.length) {
      throw new SyncError('Choose distinct weekdays from 0 (Sunday) to 6 (Saturday).');
    }
    return { itemId: id(d.itemId), effectiveDay: day(d.effectiveDay), weekdays: [...d.weekdays].sort() };
  }
  if (entity === 'day') {
    fields(d, ['effectiveDay', 'timeZone', 'startHour']);
    if (!Number.isInteger(d.startHour) || (d.startHour as number) < 0 || (d.startHour as number) > 23) throw new SyncError('startHour must be a whole hour from 0 to 23.');
    return { effectiveDay: day(d.effectiveDay), timeZone: timeZone(d.timeZone), startHour: d.startHour as number };
  }
  if (entity === 'completion') {
    fields(d, ['itemId', 'day', 'completed']);
    if (typeof d.completed !== 'boolean') throw new SyncError('completed must be true or false.');
    return { itemId: id(d.itemId), day: d.day == null ? null : day(d.day), completed: d.completed };
  }
  if (entity === 'dismissal') {
    fields(d, ['itemId', 'day', 'reminder']);
    return { itemId: id(d.itemId), day: d.day == null ? null : day(d.day), reminder: reminderOf(d.reminder) };
  }
  fields(d, ['kind', 'title', 'notes', 'listId', 'parentId', 'originalDay', 'createdDay', 'dueDay', 'reminder', 'position', 'todayPosition', 'carryPosition', 'carryDay']);
  if (typeof d.kind !== 'string' || !['habit', 'today', 'task'].includes(d.kind)) throw new SyncError('Item kind must be habit, today or task.');
  const kind = d.kind;
  const listId = d.listId == null ? null : id(d.listId);
  const parentId = d.parentId == null ? null : id(d.parentId);
  if ((kind === 'task') !== (listId !== null) || (kind === 'habit' && parentId !== null)) throw new SyncError('Only list tasks have listId; habits cannot have subtasks.');
  if ((kind !== 'today' && d.originalDay != null) || (kind !== 'habit' && d.createdDay != null) || (kind !== 'task' && d.dueDay != null)) throw new SyncError('Dates do not match the item kind.');
  let reminder: string | null = null;
  if (d.reminder != null) {
    if (kind === 'task') {
      if (typeof d.reminder !== 'string' || !INSTANT.test(d.reminder)) throw new SyncError('List reminders must be UTC instants (YYYY-MM-DDTHH:mm:00.000Z).');
      reminder = reminderOf(d.reminder);
    } else reminder = time(d.reminder);
  }
  return { kind, title: text(d.title, 'Title', SYNC_LIMITS.title, true), notes: text(d.notes ?? '', 'Notes', SYNC_LIMITS.notes),
    listId, parentId, originalDay: kind === 'today' ? day(d.originalDay) : null,
    createdDay: kind === 'habit' ? day(d.createdDay) : null, dueDay: d.dueDay == null ? null : day(d.dueDay), reminder, position: position(d.position),
    // Places on Today (D47, D54, D65). Optional, so clients that predate them keep working (D72).
    todayPosition: d.todayPosition == null ? null : position(d.todayPosition),
    carryPosition: d.carryPosition == null ? null : position(d.carryPosition), carryDay: d.carryDay == null ? null : day(d.carryDay) };
}
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00\.000Z$/;
/** An HH:mm time, or a list task's UTC instant (YYYY-MM-DDTHH:mm:00.000Z). */
function reminderOf(value: unknown): string {
  if (typeof value === 'string' && INSTANT.test(value)) { day(value.slice(0, 10)); time(value.slice(11, 16)); return value; }
  return time(value);
}
function position(value: unknown): number {
  if (value === undefined) return 0;
  if (typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > Number.MAX_SAFE_INTEGER) throw new SyncError('position must be a finite safe number.');
  return value;
}
function changeOf(value: unknown, now: number): Change {
  const c = object(value);
  fields(c, ['entity', 'id', 'editedAt', 'deleted', 'data']);
  if (typeof c.entity !== 'string' || !ENTITIES.includes(c.entity)) throw new SyncError('Unknown entity.');
  if (typeof c.editedAt !== 'number' || !Number.isSafeInteger(c.editedAt) || c.editedAt < 0 || c.editedAt > 8_640_000_000_000_000) throw new SyncError('editedAt must be a nonnegative epoch millisecond timestamp.');
  if (typeof c.deleted !== 'boolean') throw new SyncError('deleted must be true or false.');
  const entity = c.entity as Entity;
  const data = c.deleted ? null : dataOf(entity, c.data);
  let key: string;
  if (entity === 'schedule' || entity === 'completion' || entity === 'dismissal') {
    // Semantic, client-generated IDs make retries and simultaneous checks idempotent.
    if (data) key = `${data.itemId}:${entity === 'schedule' ? data.effectiveDay : data.day ?? 'task'}`;
    else {
      if (typeof c.id !== 'string' || !/^[a-zA-Z0-9_-]{1,128}:(?:\d{4}-\d{2}-\d{2}|task)$/.test(c.id)) throw new SyncError('Invalid semantic record ID.');
      const [item, suffix] = c.id.split(':'); id(item);
      if (suffix === 'task' && entity === 'schedule') throw new SyncError('Schedules require an effective day.');
      if (suffix !== 'task') day(suffix);
      key = c.id;
    }
    if (c.id !== key) throw new SyncError('Use itemId:effectiveDay for schedules and itemId:day (or itemId:task) for completions and dismissals.');
  } else if (entity === 'day') {
    // Day settings are versioned by the day they take effect (D34), one record per day.
    key = data ? data.effectiveDay as string : day(c.id);
    if (c.id !== key) throw new SyncError('Use the effective day as the ID of day settings.');
  } else key = id(c.id);
  return { entity, id: key, editedAt: c.editedAt > now + FUTURE_MS ? now : c.editedAt, deleted: c.deleted, data };
}
async function bodyOf(request: Request): Promise<Record<string, unknown>> {
  if (request.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase() !== 'application/json') throw new SyncError('Send JSON.', 415);
  const reader = request.body?.getReader();
  if (!reader) throw new SyncError('Send a JSON object.');
  const chunks: Uint8Array[] = []; let size = 0;
  while (true) {
    const { done, value } = await reader.read(); if (done) break;
    size += value.byteLength;
    if (size > SYNC_LIMITS.bytes) { await reader.cancel(); throw new SyncError('Sync requests may be at most 1 MiB.', 413); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  let value: unknown;
  try { value = JSON.parse(new TextDecoder().decode(bytes)); } catch { throw new SyncError('Send valid JSON.'); }
  return object(value);
}

export async function handleSync(request: Request, env: Env): Promise<Response> {
  try {
    // Native apps authenticate with a bearer device token, which browsers never attach on their own.
    if (!isAppRequest(request)) {
      if (request.headers.get('X-Astir-Client') !== 'web') throw new SyncError('Use the Astir web client.', 403);
      if (request.method !== 'GET' && !isAllowedOrigin(request.headers.get('Origin'), request, env)) throw new SyncError('Untrusted request origin.', 403);
    }
    const session = await currentSession(request, env);
    if (!session) return json(await signedOut(request, env), 401);
    const url = new URL(request.url);
    if (request.method === 'POST' && url.pathname === '/api/sync/push') {
      const body = await bodyOf(request); fields(body, ['changes']);
      if (!Array.isArray(body.changes)) throw new SyncError('changes must be an array.');
      if (body.changes.length > SYNC_LIMITS.changes) throw new SyncError('Push at most 500 changes at once.', 413);
      const now = Date.now();
      const changes = body.changes.map((c) => changeOf(c, now));
      const keys = changes.map((c) => `${c.entity}/${c.id}`);
      if (new Set(keys).size !== keys.length) throw new SyncError('Send each record only once per push.');
      // Parents before children; dependents may arrive in any order on the wire.
      const rank = (c: Change) => c.entity === 'list' ? 0 : c.entity === 'item' ? (c.data?.parentId ? 2 : 1) : 3;
      changes.sort((a, b) => rank(a) - rank(b));
      // D1 batches are transactions, including quota/reference triggers and revision allocation.
      // json_each avoids hundreds of roundtrips, bind parameters or the per-invocation query cap.
      await env.DB.batch([env.DB.prepare(`INSERT INTO sync_records (user_id, entity, id, edited_at, deleted, data)
        SELECT ?, json_extract(value, '$.entity'), json_extract(value, '$.id'), json_extract(value, '$.editedAt'),
          json_extract(value, '$.deleted'), json_extract(value, '$.data') FROM json_each(?) WHERE 1 ORDER BY CAST(key AS INTEGER)
        ON CONFLICT(user_id, entity, id) DO UPDATE SET
          edited_at = MAX(sync_records.edited_at, excluded.edited_at), deleted = MAX(sync_records.deleted, excluded.deleted),
          data = CASE WHEN sync_records.data IS NULL THEN excluded.data WHEN excluded.deleted = 1 THEN sync_records.data ELSE excluded.data END
        WHERE (sync_records.deleted = 0 AND (excluded.deleted = 1 OR excluded.edited_at > sync_records.edited_at))
          OR (sync_records.deleted = 1 AND sync_records.data IS NULL AND excluded.data IS NOT NULL)`)
        .bind(session.id, JSON.stringify(changes)),
        env.DB.prepare('INSERT INTO sync_quota_checks (user_id) VALUES (?) ON CONFLICT(user_id) DO NOTHING').bind(session.id),
      ]);
      // A push never advances a client's pull cursor: concurrent changes must still be pulled.
      return json({ accepted: changes.length, serverTime: now });
    }
    if (request.method === 'GET' && url.pathname === '/api/sync/pull') {
      const raw = url.searchParams.get('cursor') ?? '0';
      if (!/^\d{1,16}$/.test(raw) || !Number.isSafeInteger(Number(raw))) throw new SyncError('Invalid sync cursor.');
      const cursor = Number(raw);
      const rows = await env.DB.prepare(`SELECT entity, id, edited_at, deleted, data, revision FROM sync_records
        WHERE user_id = ? AND revision > ? ORDER BY revision LIMIT 101`).bind(session.id, cursor).all<Row>();
      const page = rows.results.slice(0, 100);
      return json({ changes: page.map((r) => ({ entity: r.entity, id: r.id, editedAt: r.edited_at, deleted: Boolean(r.deleted), data: r.data ? JSON.parse(r.data) : null })),
        cursor: String(page.at(-1)?.revision ?? cursor), hasMore: rows.results.length > 100, serverTime: Date.now() });
    }
    return json({ error: 'Route not found' }, 404);
  } catch (error) {
    if (error instanceof SyncError) return json({ error: error.message }, error.status);
    const message = error instanceof Error ? error.message : '';
    // Only our fixed trigger messages may leave the server. Never expose SQL or task contents.
    const known = ['You have reached 100 lists.', 'You have reached 10000 open items.', 'You have reached 100 subtasks per task.',
      'You have reached 1000 day-setting changes.', 'Invalid record reference.', 'Item identity cannot change.'];
    const safe = known.find((value) => message.includes(value));
    if (safe) return json({ error: safe }, safe.startsWith('You have reached') ? 409 : 400);
    console.warn('[sync] request failed');
    return json({ error: 'Sync is temporarily unavailable. Keep your changes locally and retry.' }, 503);
  }
}
