#!/bin/bash

# example periodic pruning script
# you can run add it to crontab or as a systemd timer to make this run often

set -euxo pipefail

sqlite3 unshared.db "
PRAGMA foreign_keys = ON;
PRAGMA secure_delete = FAST;
BEGIN TRANSACTION;

DELETE
FROM projects
WHERE (complete = 1 AND MAX(created_at, last_visited_at, last_loaded_at, last_started_at) < CAST(strftime('%s', 'now', '-30 days') AS INTEGER))
   OR (complete = 0 AND created_at < CAST(strftime('%s', 'now', '-1 day') AS INTEGER))
RETURNING project_id, project_title;

SELECT changes() || ' project(s) deleted' AS result;

COMMIT;
"
