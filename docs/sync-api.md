# Sync API

The server half of #3. The client half is `src/sync/` (#4): `engine.ts` follows this contract, and the web Today view uses it through IndexedDB. Apply migrations with `npm run db:migrate:local` before testing locally. No production migration or deployment is part of this change.

## Authentication

Every endpoint requires the existing, verified browser session cookie and `X-Astir-Client: web`. POST also requires a trusted `Origin`. The server checks the session's expiry, revocation and account token version on every request. Native device tokens are deferred to #11. Ownership comes only from the session; payloads cannot set an owner or read another account's records. Responses have the API's security headers and `Cache-Control: no-store`.

## Push

`POST /api/sync/push`, `Content-Type: application/json`:

```json
{
  "changes": [
    {
      "entity": "list",
      "id": "client-generated-uuid",
      "editedAt": 1794848400000,
      "deleted": false,
      "data": { "title": "Work", "position": 0 }
    }
  ]
}
```

Each change is a **full record**, not a patch. A push may contain multiple entity types, in any order, with each entity/ID at most once. Include parents in the same push or push them first. The server orders lists before items, parents before subtasks, and items before schedules/completions. Missing references reject the whole push; clients retain the changes locally and retry with the dependencies.

The response is `{ "accepted": 1, "serverTime": 1794848400000 }`. `accepted` counts valid submitted records, including stale writes and retries that made no change. Pull afterward to reconcile against authoritative records. A push never advances the client's pull cursor.

### Record envelope and conflicts

- `entity`: `list`, `item`, `schedule`, `completion` or `day`.
- List/item `id`: client-generated, 1–128 ASCII letters, digits, hyphens or underscores. UUIDs work. IDs are scoped to account and entity.
- `editedAt`: nonnegative, safe integer epoch milliseconds, within JavaScript's date range. More than five minutes ahead of server time is clamped to server time. Past timestamps are accepted for long offline gaps.
- `deleted`: required boolean. A delete may omit `data`; its supplied data is ignored. Existing archive data is retained.
- `data`: the fields below; unknown fields are rejected. Defaults are returned in normalized records.

The latest client edit timestamp wins per record. Equal timestamps keep the first accepted value. A delete always wins, even against a newer edit, and tombstones never resurrect. An unseen delete is stored with null data; a later full record may fill that missing archive data without clearing the tombstone. This allows dependent offline history to arrive afterward. Repeated deletes do not change an existing tombstone. Checking/unchecking a task is an edit to its completion record, independent of the item's fields. Use `completed: false` to uncheck; deleting a completion permanently tombstones it.

### Entity data

| Entity | Fields |
| --- | --- |
| `list` | `title` (required), `position` (optional number, default 0) |
| `item` | `kind`: `habit`, `today` or `task`; `title` (required); `notes` (default empty); `position` (default 0); nullable `listId`, `parentId`, `originalDay`, `createdDay`, `dueDay`, `reminder` |
| `schedule` | `itemId`, `effectiveDay`, `weekdays`: distinct integers 0 (Sunday) to 6 (Saturday), at least one; all seven means every day |
| `completion` | `itemId`, nullable `day`, `completed` (required boolean) |
| `day` | `effectiveDay`, `timeZone` (an IANA zone such as `America/New_York`), `startHour` (whole hour, 0–23) |

`position` is finite, with absolute value at most `Number.MAX_SAFE_INTEGER`. Titles must contain non-whitespace text. Text length limits use JavaScript string length (UTF-16 code units). Dates are valid `YYYY-MM-DD` calendar days from year 0001 to 9999.

- A **habit** requires `createdDay`. It has no list, parent, original day or due date. Its reminder is an optional `HH:mm` time.
- A **today-only task** requires `originalDay`. It has no list, creation day or due date. Its reminder is an optional `HH:mm` time on its original day. Clients preserve the original day across rollovers.
- A **named-list task** requires `listId`. It has no creation or original day. Its optional due date is `dueDay`. Its reminder is an optional UTC instant formatted `YYYY-MM-DDTHH:mm:00.000Z`.
- A task's `parentId` may reference a top-level task of the same kind, list and original day. Subtasks cannot have their own subtasks. They have independent completion records; completing all children does not complete the parent.
- Item `kind`, `listId`, `parentId`, `originalDay` and `createdDay` are immutable. This API does not support moving or converting items.
- A schedule references a habit. Its ID is **`itemId:effectiveDay`**. The first version takes effect on the habit's creation day; the client submits later versions effective from the next account reset (D34/D40). History selects the latest version effective on or before the day being viewed. The server stores these versions separately and rejects versions before the creation day; computing the account's current day and next reset belongs to the client (`src/sync/day.ts`).
- A habit completion's ID is **`itemId:YYYY-MM-DD`**, with that day in `data.day`, on or after creation. A task/subtask completion's ID is **`itemId:task`**, with null/omitted `data.day`. These semantic IDs ensure two devices create one record for the same completion.
- **Day settings** are the account's time zone and day-start hour (D6). Each version's ID is its **`effectiveDay`**; it governs from that day until a later version takes over. The client writes the first version as `0001-01-01` and later changes effective from the next account reset (D34), so a day is never split or counted twice.

Deleting a list, item or schedule does not cascade through sync records. Parents retain their archived data so offline dependent records remain valid. Clients must preserve and reconcile children of archived parents; hiding a parent must not silently discard them. Account deletion, by contrast, cascades through all the account's records. Tombstones and completion history are retained without expiry.

## Pull

`GET /api/sync/pull?cursor=0` starts a full download. The response is:

```json
{
  "changes": [],
  "cursor": "0",
  "hasMore": false,
  "serverTime": 1794848400000
}
```

Up to 100 full records are returned per page, including tombstones. Continue with the returned cursor until `hasMore` is false. Apply a page and persist its cursor together in the local store. Keep cursors per account; reset to `0` when initializing a fresh local store. Treat cursors as opaque strings.

The server allocates monotonically increasing revisions transactionally, independently of client clocks. Pull returns the current state of records changed since the cursor, not an audit log of every intermediate edit. Records edited during pagination may appear again at a later revision. A page only advances to its last delivered revision; an empty page keeps the cursor unchanged. Pull after each push, including stale writes and clamped edits, so the client converges on the stored result. Compare `serverTime` with the device clock to detect skew.

## Limits and errors

Approved for D31: 100 active lists, 10,000 open items per account (habits always count; tasks/subtasks count unless their live completion says completed), 100 active subtasks per parent, 1,000 live day-setting versions, 500 title characters, 20,000 note characters, and at most 500 changes / 1 MiB of streamed UTF-8 request bytes per push. Deleted records do not count. Completed tasks and history have no count limit. Quotas are checked against the final batch state, so completing/deleting one item and adding another works at the limit.

Malformed data or references return 400, missing/invalid/revoked sessions 401, client/origin failures 403, count quotas 409, request size/change-count overflow 413, wrong content type 415, and temporary failures 503. All errors have `{ "error": "clear message" }`. A rejected push commits nothing. Clients keep rejected work locally, show the message, and let the user trim or correct it before retrying. SQL, task contents and credentials are not logged by the sync handler.

## Local test

Run `npm run dev`, sign in at `http://localhost:5173`, then open the browser's JavaScript console to exercise the API directly, below the Today view. These requests use the current cookie without exposing it. Paste the following helper and initial changes:

```js
let api = async (path, changes) => {
  let response = await fetch('/api/sync/' + path, {
    method: changes === undefined ? 'GET' : 'POST',
    headers: { 'X-Astir-Client': 'web', 'Content-Type': 'application/json' },
    ...(changes === undefined ? {} : { body: JSON.stringify({ changes }) })
  });
  return { status: response.status, ...await response.json() };
};
let taskId = crypto.randomUUID();
let stamp = Date.now();
let sample = {
  entity: 'item', id: taskId, editedAt: stamp, deleted: false,
  data: { kind: 'today', title: 'Sync test', originalDay: '2026-11-16' }
};
await api('push', [sample]); // 200
let page = await api('pull?cursor=0');
page; // Includes your task (follow page.cursor while page.hasMore is true).
```

Check completion deduplication and stale edits:

```js
let check = {
  entity: 'completion', id: taskId + ':task', editedAt: stamp,
  deleted: false, data: { itemId: taskId, day: null, completed: true }
};
await api('push', [check]);
await api('push', [check]); // Retry: still one completion in a full pull.
await api('push', [{ ...sample, editedAt: stamp - 1, data: { ...sample.data, title: 'Stale' } }]);
await api('pull?cursor=0'); // Title stays "Sync test"; completion stays true.
```

Check deletes and isolation:

```js
await api('push', [{ entity: 'item', id: taskId, editedAt: stamp - 2, deleted: true }]);
await api('push', [{ ...sample, editedAt: Date.now() }]);
await api('pull?cursor=0'); // Task stays deleted with its archived title and completion.
await fetch('/api/sync/pull', { credentials: 'omit', headers: { 'X-Astir-Client': 'web' } }); // 401
```

Optionally sign out and sign in as a different local account: its pull must not contain the first account's records. Sign back in to see the original records. These smoke-test records remain in local D1 only. Automated tests cover pagination, timestamp clamping, quotas, rollback, bad input, account isolation and revoked sessions with the real migration SQL.
