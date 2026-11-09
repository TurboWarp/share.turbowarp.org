#!/bin/bash

# example periodic pruning script
# you can run add it to crontab or as a systemd timer to make this run often

set -euo pipefail

condition="(complete = 1 AND MAX(created_at, last_visited_at, last_loaded_at, last_started_at) < CAST(strftime('%s', 'now', '-30 days') AS INTEGER))
   OR (complete = 0 AND created_at < CAST(strftime('%s', 'now', '-1 day') AS INTEGER))"

# Reading doesn't block the server, so find everything up front, then delete one project per
# transaction so the server is never locked out for long. The condition is checked again in case
# a project was visited in the meantime.
rowids=$(sqlite3 -cmd ".timeout 10000" unshared.db "SELECT rowid FROM projects WHERE $condition;")

deleted=0
for rowid in $rowids; do
  result=$(sqlite3 -cmd ".timeout 10000" unshared.db "
PRAGMA foreign_keys = ON;
PRAGMA secure_delete = FAST;
BEGIN IMMEDIATE;

DELETE
FROM projects
WHERE rowid = $rowid AND ($condition)
RETURNING project_id, project_title;

COMMIT;
")
  if [ -n "$result" ]; then
    echo "$result"
    deleted=$((deleted + 1))
  fi
done

echo "$deleted project(s) deleted"
