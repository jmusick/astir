-- Adds buckets (D56-D62): `pool` records are a repeating task's pool items, and `pick` records are
-- the items a day picked, keyed itemId:day:poolId so two devices picking different items never
-- overwrite each other. SQLite can't change a CHECK constraint in place, so the table is rebuilt as
-- in 0004: views and triggers are dropped first and recreated after, and the copy runs before any
-- trigger exists, so revisions and data move over unchanged. It also tightens 0007: a habit's
-- subtask must carry its parent's createdDay, and daily checklist steps (habit subtasks) don't count
-- as open items, since they're never checked off for good; 100 subtasks per task still bounds them.
DROP TRIGGER sync_check_quotas;
DROP TRIGGER sync_update;
DROP TRIGGER sync_insert;
DROP TRIGGER sync_identity;
DROP VIEW sync_open_items;
DROP VIEW sync_dismissals;
DROP VIEW sync_days;
DROP VIEW sync_completions;
DROP VIEW sync_schedules;
DROP VIEW sync_items;
DROP VIEW sync_lists;
ALTER TABLE sync_records RENAME TO sync_records_v7;
CREATE TABLE sync_records (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  entity TEXT NOT NULL CHECK (entity IN ('list', 'item', 'schedule', 'completion', 'day', 'dismissal', 'pool', 'pick')),
  id TEXT NOT NULL,
  edited_at INTEGER NOT NULL CHECK (edited_at >= 0),
  deleted INTEGER NOT NULL CHECK (deleted IN (0, 1)),
  data TEXT CHECK (data IS NULL OR json_valid(data)),
  revision INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, entity, id),
  CHECK (deleted = 1 OR data IS NOT NULL)
);
INSERT INTO sync_records (user_id, entity, id, edited_at, deleted, data, revision)
  SELECT user_id, entity, id, edited_at, deleted, data, revision FROM sync_records_v7;
DROP TABLE sync_records_v7;
CREATE INDEX sync_pull ON sync_records(user_id, revision);
CREATE INDEX sync_parent ON sync_records(user_id, json_extract(data, '$.parentId')) WHERE entity = 'item' AND deleted = 0;
CREATE INDEX sync_active ON sync_records(user_id, entity, deleted);

CREATE VIEW sync_lists AS SELECT * FROM sync_records WHERE entity = 'list';
CREATE VIEW sync_items AS SELECT * FROM sync_records WHERE entity = 'item';
CREATE VIEW sync_schedules AS SELECT * FROM sync_records WHERE entity = 'schedule';
CREATE VIEW sync_completions AS SELECT * FROM sync_records WHERE entity = 'completion';
CREATE VIEW sync_days AS SELECT * FROM sync_records WHERE entity = 'day';
CREATE VIEW sync_dismissals AS SELECT * FROM sync_records WHERE entity = 'dismissal';
CREATE VIEW sync_pools AS SELECT * FROM sync_records WHERE entity = 'pool';
CREATE VIEW sync_picks AS SELECT * FROM sync_records WHERE entity = 'pick';
CREATE VIEW sync_open_items AS
  SELECT i.* FROM sync_items i WHERE i.deleted = 0 AND (
    (json_extract(i.data, '$.kind') = 'habit' AND json_extract(i.data, '$.parentId') IS NULL)
    OR (json_extract(i.data, '$.kind') != 'habit' AND NOT EXISTS (
      SELECT 1 FROM sync_completions c WHERE c.user_id = i.user_id AND c.id = i.id || ':task'
        AND c.deleted = 0 AND json_extract(c.data, '$.completed') = 1
    ))
  );

-- Structure is immutable: moving a parent cannot strand children or rewrite history.
CREATE TRIGGER sync_identity BEFORE UPDATE OF data ON sync_records
WHEN OLD.entity = 'item' AND OLD.data IS NOT NULL AND NEW.deleted = 0
BEGIN
  SELECT RAISE(ABORT, 'Item identity cannot change.') WHERE
    json_extract(OLD.data, '$.kind') IS NOT json_extract(NEW.data, '$.kind')
    OR json_extract(OLD.data, '$.parentId') IS NOT json_extract(NEW.data, '$.parentId')
    OR json_extract(OLD.data, '$.listId') IS NOT json_extract(NEW.data, '$.listId')
    OR json_extract(OLD.data, '$.originalDay') IS NOT json_extract(NEW.data, '$.originalDay')
    OR json_extract(OLD.data, '$.createdDay') IS NOT json_extract(NEW.data, '$.createdDay');
END;

-- AFTER triggers run only for winning writes, including inserts; failures roll back the push.
CREATE TRIGGER sync_insert AFTER INSERT ON sync_records
BEGIN

  -- Deleted parents keep their data; late offline children, completions and dismissals remain recoverable.
  SELECT RAISE(ABORT, 'Invalid record reference.')
    WHERE NEW.deleted = 0 AND NEW.entity = 'item' AND (
      (json_extract(NEW.data, '$.listId') IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM sync_records p WHERE p.user_id = NEW.user_id AND p.entity = 'list'
          AND p.id = json_extract(NEW.data, '$.listId') AND p.data IS NOT NULL))
      OR (json_extract(NEW.data, '$.parentId') IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM sync_records p WHERE p.user_id = NEW.user_id AND p.entity = 'item'
          AND p.id = json_extract(NEW.data, '$.parentId') AND p.id != NEW.id
          AND json_extract(p.data, '$.parentId') IS NULL
          AND json_extract(p.data, '$.kind') = json_extract(NEW.data, '$.kind')
          AND json_extract(p.data, '$.listId') IS json_extract(NEW.data, '$.listId')
          AND json_extract(p.data, '$.originalDay') IS json_extract(NEW.data, '$.originalDay')
          AND json_extract(p.data, '$.createdDay') IS json_extract(NEW.data, '$.createdDay')))
    );
  SELECT RAISE(ABORT, 'Invalid record reference.')
    WHERE NEW.deleted = 0 AND NEW.entity IN ('schedule', 'completion', 'dismissal') AND NOT EXISTS (
      SELECT 1 FROM sync_records p WHERE p.user_id = NEW.user_id AND p.entity = 'item'
        AND p.id = json_extract(NEW.data, '$.itemId')
        AND CASE WHEN NEW.entity = 'schedule' THEN
          (json_extract(p.data, '$.kind') = 'habit'
            AND json_extract(NEW.data, '$.effectiveDay') >= json_extract(p.data, '$.createdDay'))
          OR (json_extract(p.data, '$.kind') = 'today' AND json_extract(p.data, '$.parentId') IS NULL
            AND json_extract(NEW.data, '$.effectiveDay') >= json_extract(p.data, '$.originalDay'))
        ELSE
          (json_extract(p.data, '$.kind') = 'habit' AND json_extract(NEW.data, '$.day') >= json_extract(p.data, '$.createdDay'))
          OR (json_extract(p.data, '$.kind') IN ('today', 'task') AND json_extract(NEW.data, '$.day') IS NULL)
          OR (json_extract(p.data, '$.kind') = 'today' AND json_extract(NEW.data, '$.day') >= json_extract(p.data, '$.originalDay'))
        END
    );
  -- A bucket's pool items belong to a top-level daily task; a pick names a pool item of that task (D56, D61).
  SELECT RAISE(ABORT, 'Invalid record reference.')
    WHERE NEW.deleted = 0 AND NEW.entity = 'pool' AND NOT EXISTS (
      SELECT 1 FROM sync_records p WHERE p.user_id = NEW.user_id AND p.entity = 'item'
        AND p.id = json_extract(NEW.data, '$.itemId') AND p.data IS NOT NULL
        AND json_extract(p.data, '$.kind') IN ('habit', 'today') AND json_extract(p.data, '$.parentId') IS NULL);
  SELECT RAISE(ABORT, 'Invalid record reference.')
    WHERE NEW.deleted = 0 AND NEW.entity = 'pick' AND NOT EXISTS (
      SELECT 1 FROM sync_records p WHERE p.user_id = NEW.user_id AND p.entity = 'pool'
        AND p.id = json_extract(NEW.data, '$.poolId') AND p.data IS NOT NULL
        AND json_extract(p.data, '$.itemId') = json_extract(NEW.data, '$.itemId'));
  UPDATE sync_clock SET revision = revision + 1 WHERE id = 1;
  UPDATE sync_records SET revision = (SELECT revision FROM sync_clock WHERE id = 1)
    WHERE user_id = NEW.user_id AND entity = NEW.entity AND id = NEW.id;
END;

-- AFTER triggers run only for winning writes, including inserts; failures roll back the push.
CREATE TRIGGER sync_update AFTER UPDATE OF data, edited_at, deleted ON sync_records
BEGIN

  -- Deleted parents keep their data; late offline children, completions and dismissals remain recoverable.
  SELECT RAISE(ABORT, 'Invalid record reference.')
    WHERE NEW.deleted = 0 AND NEW.entity = 'item' AND (
      (json_extract(NEW.data, '$.listId') IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM sync_records p WHERE p.user_id = NEW.user_id AND p.entity = 'list'
          AND p.id = json_extract(NEW.data, '$.listId') AND p.data IS NOT NULL))
      OR (json_extract(NEW.data, '$.parentId') IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM sync_records p WHERE p.user_id = NEW.user_id AND p.entity = 'item'
          AND p.id = json_extract(NEW.data, '$.parentId') AND p.id != NEW.id
          AND json_extract(p.data, '$.parentId') IS NULL
          AND json_extract(p.data, '$.kind') = json_extract(NEW.data, '$.kind')
          AND json_extract(p.data, '$.listId') IS json_extract(NEW.data, '$.listId')
          AND json_extract(p.data, '$.originalDay') IS json_extract(NEW.data, '$.originalDay')
          AND json_extract(p.data, '$.createdDay') IS json_extract(NEW.data, '$.createdDay')))
    );
  SELECT RAISE(ABORT, 'Invalid record reference.')
    WHERE NEW.deleted = 0 AND NEW.entity IN ('schedule', 'completion', 'dismissal') AND NOT EXISTS (
      SELECT 1 FROM sync_records p WHERE p.user_id = NEW.user_id AND p.entity = 'item'
        AND p.id = json_extract(NEW.data, '$.itemId')
        AND CASE WHEN NEW.entity = 'schedule' THEN
          (json_extract(p.data, '$.kind') = 'habit'
            AND json_extract(NEW.data, '$.effectiveDay') >= json_extract(p.data, '$.createdDay'))
          OR (json_extract(p.data, '$.kind') = 'today' AND json_extract(p.data, '$.parentId') IS NULL
            AND json_extract(NEW.data, '$.effectiveDay') >= json_extract(p.data, '$.originalDay'))
        ELSE
          (json_extract(p.data, '$.kind') = 'habit' AND json_extract(NEW.data, '$.day') >= json_extract(p.data, '$.createdDay'))
          OR (json_extract(p.data, '$.kind') IN ('today', 'task') AND json_extract(NEW.data, '$.day') IS NULL)
          OR (json_extract(p.data, '$.kind') = 'today' AND json_extract(NEW.data, '$.day') >= json_extract(p.data, '$.originalDay'))
        END
    );
  -- A bucket's pool items belong to a top-level daily task; a pick names a pool item of that task (D56, D61).
  SELECT RAISE(ABORT, 'Invalid record reference.')
    WHERE NEW.deleted = 0 AND NEW.entity = 'pool' AND NOT EXISTS (
      SELECT 1 FROM sync_records p WHERE p.user_id = NEW.user_id AND p.entity = 'item'
        AND p.id = json_extract(NEW.data, '$.itemId') AND p.data IS NOT NULL
        AND json_extract(p.data, '$.kind') IN ('habit', 'today') AND json_extract(p.data, '$.parentId') IS NULL);
  SELECT RAISE(ABORT, 'Invalid record reference.')
    WHERE NEW.deleted = 0 AND NEW.entity = 'pick' AND NOT EXISTS (
      SELECT 1 FROM sync_records p WHERE p.user_id = NEW.user_id AND p.entity = 'pool'
        AND p.id = json_extract(NEW.data, '$.poolId') AND p.data IS NOT NULL
        AND json_extract(p.data, '$.itemId') = json_extract(NEW.data, '$.itemId'));
  UPDATE sync_clock SET revision = revision + 1 WHERE id = 1;
  UPDATE sync_records SET revision = (SELECT revision FROM sync_clock WHERE id = 1)
    WHERE user_id = NEW.user_id AND entity = NEW.entity AND id = NEW.id;
END;

CREATE TRIGGER sync_check_quotas BEFORE INSERT ON sync_quota_checks
BEGIN
  SELECT RAISE(ABORT, 'You have reached 100 lists.')
    WHERE (SELECT COUNT(*) FROM sync_records WHERE user_id = NEW.user_id AND entity = 'list' AND deleted = 0) > 100;
  SELECT RAISE(ABORT, 'You have reached 100 subtasks per task.')
    WHERE EXISTS (SELECT 1 FROM sync_records WHERE user_id = NEW.user_id AND entity = 'item' AND deleted = 0
      AND json_extract(data, '$.parentId') IS NOT NULL GROUP BY json_extract(data, '$.parentId') HAVING COUNT(*) > 100);
  SELECT RAISE(ABORT, 'You have reached 10000 open items.')
    WHERE (SELECT COUNT(*) FROM sync_open_items WHERE user_id = NEW.user_id) > 10000;
  SELECT RAISE(ABORT, 'You have reached 100 items in a bucket.')
    WHERE EXISTS (SELECT 1 FROM sync_records WHERE user_id = NEW.user_id AND entity = 'pool' AND deleted = 0
      GROUP BY json_extract(data, '$.itemId') HAVING COUNT(*) > 100);
  SELECT RAISE(ABORT, 'You have reached 1000 day-setting changes.')
    WHERE (SELECT COUNT(*) FROM sync_records WHERE user_id = NEW.user_id AND entity = 'day' AND deleted = 0) > 1000;
END;

