#!/usr/bin/env bash
set -Eeuo pipefail

domain='student-way.tw1.su'
server_ip='200.165.228.170'
target="root@$server_ip"
config_file='deploy/production.env'

[[ -f "$config_file" ]] || {
  echo 'Нет deploy/production.env: скопируйте deploy/production.env.example и заполните его.' >&2
  exit 2
}
# The research package is local input, not part of the release archive.
untracked_for_deploy=$(git ls-files --others --exclude-standard | grep -Ev '^(research/|PROJECT_SNAPSHOT\.md$|PROJECT_REVIEW_PACKAGE\.zip$)' || true)
if ! git diff --quiet || ! git diff --cached --quiet || [[ -n "$untracked_for_deploy" ]]; then
  echo 'Перед deploy нужен чистый Git worktree.' >&2
  exit 2
fi
pnpm validate:i18n
if grep -Eq '^(MAX_BOT_TOKEN|LLM_API_KEY|MAX_INTRO_VIDEO_RU_TOKEN|MAX_INTRO_VIDEO_EN_TOKEN)=' "$config_file"; then
  echo 'Секреты запрещены в deploy/production.env.' >&2
  exit 2
fi
read_value() { awk -F= -v key="$1" '$1 == key { sub(/^[^=]*=/, ""); value = $0 } END { print value }' "$config_file"; }
for variable in MAX_BOT_USERNAME; do
  [[ -n "$(read_value "$variable")" ]] || {
    echo "Не задан $variable в deploy/production.env." >&2
    exit 2
  }
done
max_bot_username=$(read_value MAX_BOT_USERNAME)
[[ "$max_bot_username" =~ ^[A-Za-z0-9_.-]{1,100}$ ]] || {
  echo 'MAX_BOT_USERNAME содержит недопустимые символы.' >&2
  exit 2
}
if [[ "$(read_value LLM_PROVIDER)" == alice && -z "$(read_value LLM_PROJECT_ID)" ]]; then
  echo 'Не задан LLM_PROJECT_ID в deploy/production.env для LLM_PROVIDER=alice.' >&2
  exit 2
fi

resolved=$(python3 -c 'import socket,sys; print("\n".join(sorted(set(socket.gethostbyname_ex(sys.argv[1])[2]))))' "$domain" 2>/dev/null || true)
if [[ -z "$resolved" ]] && command -v dig >/dev/null 2>&1; then
  resolved=$(dig +short A "$domain" 2>/dev/null || true)
fi
if [[ -n "$resolved" ]] && ! grep -Fxq "$server_ip" <<<"$resolved"; then
  echo "DNS $domain ещё не указывает на $server_ip; deploy остановлен." >&2
  exit 2
fi

release_id=$(git rev-parse --short=12 HEAD)
release_dir="/opt/first30/releases/$release_id"
control_dir=$(mktemp -d "${TMPDIR:-/tmp}/first30-ssh.XXXXXX")
control_socket="$control_dir/control"
master_started=false
ssh_identity_options=(-o StrictHostKeyChecking=accept-new)
if [[ -n "${DEPLOY_SSH_IDENTITY:-}" ]]; then
  [[ -r "$DEPLOY_SSH_IDENTITY" ]] || {
    echo 'Указанный SSH-ключ недоступен для чтения.' >&2
    exit 2
  }
  ssh_identity_options=(-i "$DEPLOY_SSH_IDENTITY" -o IdentitiesOnly=yes)
fi
cleanup() {
  if [[ "$master_started" == true ]]; then
    ssh -S "$control_socket" -O exit "$target" >/dev/null 2>&1 || true
  fi
  rm -rf "$control_dir"
}
trap cleanup EXIT INT TERM

echo 'Подключение к production-серверу…'
ssh "${ssh_identity_options[@]}" -M -S "$control_socket" -o ControlPersist=600 -o StrictHostKeyChecking=accept-new -fN "$target"
master_started=true
remote() { ssh -S "$control_socket" "$target" "$@"; }
copy_to_server() { scp -q -o ControlPath="$control_socket" "$1" "$target:$2"; }

if [[ -z "$resolved" ]]; then
  resolved=$(remote "getent ahostsv4 '$domain' | awk '{print \$1}' | sort -u")
  if ! grep -Fxq "$server_ip" <<<"$resolved"; then
    echo "DNS $domain ещё не указывает на $server_ip; deploy остановлен." >&2
    exit 2
  fi
fi

remote "install -d -m 700 /opt/first30 /opt/first30/releases '$release_dir'"
copy_to_server scripts/setup-production-secrets.sh /opt/first30/setup-production-secrets.sh
copy_to_server scripts/prepare-production-runtime.sh /opt/first30/prepare-production-runtime.sh
remote 'chmod 700 /opt/first30/setup-production-secrets.sh /opt/first30/prepare-production-runtime.sh'
if ! remote '/opt/first30/setup-production-secrets.sh --check'; then
  ssh -tt -S "$control_socket" "$target" '/opt/first30/setup-production-secrets.sh' </dev/tty >/dev/tty
fi
remote '/opt/first30/setup-production-secrets.sh --check'

copy_to_server "$config_file" /opt/first30/production.env.new
remote 'chmod 600 /opt/first30/production.env.new && mv -f /opt/first30/production.env.new /opt/first30/production.env'
remote '/opt/first30/prepare-production-runtime.sh'

git archive --format=tar.gz HEAD | ssh -S "$control_socket" "$target" "tar -xzf - -C '$release_dir'"

compose_files='-f compose.prod.yaml'
if remote 'systemctl is-active --quiet caddy'; then
  compose_files="$compose_files -f compose.host-caddy.yaml"
fi
remote "cd '$release_dir' && docker compose $compose_files config --quiet"
remote "cd '$release_dir' && MAX_BOT_USERNAME='$max_bot_username' docker compose $compose_files up -d --build --remove-orphans --wait"

for path in /health/live /health/ready /api/legal /; do
  curl --fail --silent --show-error --retry 20 --retry-delay 3 --retry-all-errors \
    --resolve "$domain:443:$server_ip" "https://$domain$path" >/dev/null
done

if [[ "$(read_value LLM_PROVIDER)" == alice ]]; then
  remote "cd '$release_dir' && docker compose $compose_files run --rm --no-deps api node dist/llm-smoke.js"
fi
remote "cd '$release_dir' && docker compose $compose_files run --rm --no-deps api node dist/max-subscription.js ensure"
remote "cd '$release_dir' && docker compose $compose_files run --rm --no-deps api node dist/knowledge-release-smoke.js"

remote "previous=\$(readlink -f /opt/first30/current 2>/dev/null || true); if [ -n \"\$previous\" ] && [ \"\$previous\" != '$release_dir' ]; then ln -sfn \"\$previous\" /opt/first30/previous; fi; ln -sfn '$release_dir' /opt/first30/current"
echo "Deploy $release_id завершён: https://$domain"
