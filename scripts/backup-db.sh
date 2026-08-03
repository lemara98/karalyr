#!/usr/bin/env bash
# Daily production backup: SQL-dump the Turso database into a dated, gzipped
# file and prune old ones. Requires an authenticated `turso` CLI (the same
# one DEPLOY.md uses). Schedule it with worker/karalyr-backup.timer, or run
# it by hand:
#
#   scripts/backup-db.sh
#
# Defaults (override via environment):
#   KARALYR_DB=karalyr                       Turso database name
#   KARALYR_BACKUP_DIR=~/karalyr-backups     where dumps land
#   KARALYR_BACKUP_KEEP_DAYS=30              retention
#
# Restore into a fresh database with:
#   turso db create karalyr-restored
#   gzip -cd karalyr-<stamp>.sql.gz | turso db shell karalyr-restored
set -euo pipefail

# systemd user units get a minimal PATH; the turso installer puts the CLI here.
export PATH="$HOME/.turso:$PATH"

DB_NAME="${KARALYR_DB:-karalyr}"
BACKUP_DIR="${KARALYR_BACKUP_DIR:-$HOME/karalyr-backups}"
KEEP_DAYS="${KARALYR_BACKUP_KEEP_DAYS:-30}"

mkdir -p "$BACKUP_DIR"
stamp="$(date +%Y%m%d-%H%M%S)"
out="$BACKUP_DIR/karalyr-$stamp.sql.gz"
tmp="$out.partial"

echo "[backup] dumping Turso db '$DB_NAME'..."
turso db shell "$DB_NAME" .dump | gzip >"$tmp"

# A real dump contains the schema; an auth failure or truncation does not.
# Never prune on a failed run - a broken cron must not eat the good copies.
#
# The head/grep runs inside a command substitution with `|| true` on purpose:
# `head` closes the pipe as soon as it has its 200 lines, gzip then dies of
# SIGPIPE, and under `pipefail` that is indistinguishable from a broken dump.
# Reading it as one is exactly what happened - every backup from the day the
# dump outgrew 200 lines (2026-07-26) until 2026-08-03 aborted on a dump that
# was perfectly good.
# The same trap sits on the grep side: `grep -q` exits at the first match, so
# feeding it through a pipe would SIGPIPE the writer and trip pipefail again.
# A here-string has no pipeline to fail.
head_of_dump="$(gzip -cd "$tmp" | head -200 || true)"
if ! grep -q "CREATE TABLE" <<<"$head_of_dump"; then
  rm -f "$tmp"
  echo "[backup] dump looks empty or invalid - keeping old backups, aborting" >&2
  exit 1
fi
mv "$tmp" "$out"
echo "[backup] wrote $out ($(du -h "$out" | cut -f1))"

find "$BACKUP_DIR" -name 'karalyr-*.sql.gz' -mtime +"$KEEP_DAYS" -print -delete | sed 's/^/[backup] pruned /'
