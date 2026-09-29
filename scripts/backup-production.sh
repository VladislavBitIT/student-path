#!/bin/sh
set -eu

cd /opt/first30/current
set -a
. /opt/first30/production.env
set +a
umask 077
backup_dir='/opt/first30/backups'
mkdir -p "$backup_dir"
timestamp=$(date -u '+%Y%m%dT%H%M%SZ')
temporary="$backup_dir/postgres-$timestamp.dump.tmp"
target="$backup_dir/postgres-$timestamp.dump"
cleanup() { rm -f "$temporary"; }
trap cleanup EXIT INT TERM
docker compose -f compose.prod.yaml exec -T postgres pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc >"$temporary"
chmod 600 "$temporary"
mv "$temporary" "$target"
trap - EXIT INT TERM
echo "Backup created: $target"
