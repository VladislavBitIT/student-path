#!/bin/sh
set -eu

current=$(readlink -f /opt/first30/current 2>/dev/null || true)
previous=$(readlink -f /opt/first30/previous 2>/dev/null || true)
case "$previous" in
  /opt/first30/releases/*) ;;
  *) echo 'Нет корректного previous release.' >&2; exit 2 ;;
esac

cd "$previous"
MAX_BOT_USERNAME=$(awk -F= '$1 == "MAX_BOT_USERNAME" { sub(/^[^=]*=/, ""); print; exit }' /opt/first30/production.env)
export MAX_BOT_USERNAME
# Сохраняем существующий системный Caddy и loopback-порты этого сервера.
if [ -f /etc/caddy/sites-enabled/studyway.caddy ]; then
  docker compose -f compose.prod.yaml -f compose.host-caddy.yaml up -d --build --remove-orphans --wait
else
  docker compose -f compose.prod.yaml up -d --build --remove-orphans --wait
fi
curl --fail --silent --show-error --retry 20 --retry-delay 3 --retry-all-errors https://student-way.tw1.su/health/ready >/dev/null
ln -sfn "$previous" /opt/first30/current
if [ -n "$current" ] && [ "$current" != "$previous" ]; then
  ln -sfn "$current" /opt/first30/previous
fi
echo "Rollback completed: $(basename "$previous")"
