#!/usr/bin/env bash
set -euo pipefail

target='/opt/first30/secrets.env'

validate_file() {
  [[ -f "$target" ]] || return 1
  [[ "$(stat -c '%a' "$target")" == '600' ]] || return 1
  awk -F= '
    /^[[:space:]]*$/ { next }
    $1 == "MAX_BOT_TOKEN" && length(substr($0, index($0, "=") + 1)) > 0 && !max_seen { max_seen = 1; next }
    $1 == "LLM_API_KEY" && length(substr($0, index($0, "=") + 1)) > 0 && !llm_seen { llm_seen = 1; next }
    $1 == "MAX_INTRO_VIDEO_RU_TOKEN" && length(substr($0, index($0, "=") + 1)) > 0 && !ru_seen { ru_seen = 1; next }
    $1 == "MAX_INTRO_VIDEO_EN_TOKEN" && length(substr($0, index($0, "=") + 1)) > 0 && !en_seen { en_seen = 1; next }
    { invalid = 1 }
    END { exit !(max_seen && llm_seen && !invalid) }
  ' "$target"
}

if [[ "${1:-}" == '--check' ]]; then
  validate_file
  exit
fi

umask 077
mkdir -p /opt/first30
read -rsp 'MAX_BOT_TOKEN: ' max_bot_token
printf '\n' >&2
read -rsp 'LLM_API_KEY: ' llm_api_key
printf '\n' >&2
if [[ -z "$max_bot_token" || -z "$llm_api_key" ]]; then
  echo 'Оба секрета обязательны; файл не изменён.' >&2
  exit 1
fi

temporary=$(mktemp /opt/first30/secrets.env.XXXXXX)
cleanup() { rm -f "$temporary"; }
trap cleanup EXIT INT TERM
{
  printf 'MAX_BOT_TOKEN=%s\nLLM_API_KEY=%s\n' "$max_bot_token" "$llm_api_key"
  if [[ -f "$target" ]]; then
    awk -F= '$1 == "MAX_INTRO_VIDEO_RU_TOKEN" || $1 == "MAX_INTRO_VIDEO_EN_TOKEN" { print }' "$target"
  fi
} >"$temporary"
chmod 600 "$temporary"
mv -f "$temporary" "$target"
trap - EXIT INT TERM
validate_file
echo 'Секреты сохранены с правами 600.'
