#!/bin/sh
set -eu

config_dir=${FIRST30_CONFIG_DIR:-/opt/first30}
release_dir=$(readlink -f "${1:-$config_dir/current}" 2>/dev/null || true)

case "$release_dir" in
  "$config_dir"/releases/*) ;;
  *) echo 'Нет корректного /opt/first30/current.' >&2; exit 2 ;;
esac

require_value() {
  file=$1
  key=$2
  value=$(awk -F= -v key="$key" '$1 == key { sub(/^[^=]*=/, ""); print; exit }' "$file")
  if [ -z "$value" ]; then
    echo "Не задан $key в $file." >&2
    exit 2
  fi
}

for file in "$config_dir/production.env" "$config_dir/runtime.env" "$config_dir/secrets.env"; do
  [ -f "$file" ] || { echo "Отсутствует $file." >&2; exit 2; }
  chmod 600 "$file"
done

require_value "$config_dir/production.env" MAX_BOT_USERNAME
require_value "$config_dir/secrets.env" MAX_BOT_TOKEN
MAX_BOT_USERNAME=$(awk -F= '$1 == "MAX_BOT_USERNAME" { sub(/^[^=]*=/, ""); print; exit }' "$config_dir/production.env")
export MAX_BOT_USERNAME

llm_provider=$(awk -F= '$1 == "LLM_PROVIDER" { sub(/^[^=]*=/, ""); print; exit }' "$config_dir/production.env")
if [ "$llm_provider" = alice ]; then
  require_value "$config_dir/production.env" LLM_PROJECT_ID
  require_value "$config_dir/secrets.env" LLM_API_KEY
fi

cd "$release_dir"
docker compose -f compose.prod.yaml -f compose.host-caddy.yaml config --quiet
docker compose -f compose.prod.yaml -f compose.host-caddy.yaml up -d --build --remove-orphans --wait

for path in /health/live /health/ready /api/legal /; do
  curl --fail --silent --show-error --retry 20 --retry-delay 3 --retry-all-errors \
    "https://student-way.tw1.su$path" >/dev/null
done

if [ "$llm_provider" = alice ]; then
  docker compose -f compose.prod.yaml -f compose.host-caddy.yaml run --rm --no-deps api node dist/llm-smoke.js
fi
docker compose -f compose.prod.yaml -f compose.host-caddy.yaml run --rm --no-deps api node dist/max-subscription.js ensure

# Указатели переключаются только после успешной проверки релиза.
previous=$(readlink -f "$config_dir/current" 2>/dev/null || true)
if [ -n "$previous" ] && [ "$previous" != "$release_dir" ]; then
  ln -sfn "$previous" "$config_dir/previous"
fi
ln -sfn "$release_dir" "$config_dir/current"

echo '«Путь студента» обновлён: https://student-way.tw1.su'
