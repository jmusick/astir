-- Lets any daily task repeat (D51): a today-only task may now have schedule versions, effective on
-- or after its original day, and per-day completions and dismissals (itemId:day) for the days it
-- repeats on, alongside the itemId:task record of its first day. Only the reference triggers change,
-- so they're dropped and recreated; no table rebuild is needed.
DROP TRIGGER sync_update;
DROP TRIGGER sync_insert;

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
          AND json_extract(p.data, '$.kind') != 'habit'
          AND json_extract(p.data, '$.listId') IS json_extract(NEW.data, '$.listId')
          AND json_extract(p.data, '$.originalDay') IS json_extract(NEW.data, '$.originalDay')))
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
          AND json_extract(p.data, '$.kind') != 'habit'
          AND json_extract(p.data, '$.listId') IS json_extract(NEW.data, '$.listId')
          AND json_extract(p.data, '$.originalDay') IS json_extract(NEW.data, '$.originalDay')))
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
  UPDATE sync_clock SET revision = revision + 1 WHERE id = 1;
  UPDATE sync_records SET revision = (SELECT revision FROM sync_clock WHERE id = 1)
    WHERE user_id = NEW.user_id AND entity = NEW.entity AND id = NEW.id;
END;
