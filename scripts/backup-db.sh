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
# Never prune on a failed run — a broken cron must not eat the good copies.
if ! gzip -cd "$tmp" | head -200 | grep -q "CREATE TABLE"; then
  rm -f "$tmp"
  echo "[backup] dump looks empty or invalid — keeping old backups, aborting" >&2
  exit 1
fi
mv "$tmp" "$out"
echo "[backup] wrote $out ($(du -h "$out" | cut -f1))"

find "$BACKUP_DIR" -name 'karalyr-*.sql.gz' -mtime +"$KEEP_DAYS" -print -delete | sed 's/^/[backup] pruned /'
