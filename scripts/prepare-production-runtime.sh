#!/bin/sh
set -eu

target='/opt/first30/runtime.env'
umask 077
mkdir -p /opt/first30
if [ -f "$target" ]; then
  chmod 600 "$target"
  exit 0
fi

postgres_password=$(openssl rand -hex 32)
session_secret=$(openssl rand -hex 48)
webhook_secret=$(openssl rand -hex 32)
temporary=$(mktemp /opt/first30/runtime.env.XXXXXX)
cleanup() { rm -f "$temporary"; }
trap cleanup EXIT INT TERM
{
  printf 'POSTGRES_PASSWORD=%s\n' "$postgres_password"
  printf 'DATABASE_URL=postgresql://pervye30:%s@postgres:5432/pervye30\n' "$postgres_password"
  printf 'SESSION_SECRET=%s\n' "$session_secret"
  printf 'MAX_WEBHOOK_SECRET=%s\n' "$webhook_secret"
} >"$temporary"
chmod 600 "$temporary"
mv -f "$temporary" "$target"
trap - EXIT INT TERM
echo 'Серверные runtime-секреты подготовлены.'
