#!/bin/sh
set -eu

project_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd -P)
temporary_root=$(mktemp -d /tmp/pervye30-compose.XXXXXX)
temporary_docker_config=$(mktemp -d /tmp/pervye30-docker-config.XXXXXX)

cleanup() {
  rm -rf -- "$temporary_root" "$temporary_docker_config"
}
trap cleanup EXIT INT TERM

rsync -a \
  --exclude .git \
  --exclude node_modules \
  --exclude dist \
  --exclude apps/miniapp/dist \
  "$project_root/" "$temporary_root/"

plugin_directory=${DOCKER_CLI_PLUGIN_DIR:-"${HOME}/.docker/cli-plugins"}
printf '{"auths":{},"cliPluginsExtraDirs":["%s"]}\n' "$plugin_directory" > "$temporary_docker_config/config.json"

cd "$temporary_root"
COMPOSE_PROJECT_NAME=pervye-30 DOCKER_CONFIG="$temporary_docker_config" docker compose "$@"
