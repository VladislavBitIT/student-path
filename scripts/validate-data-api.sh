#!/bin/sh
set -eu

repository='https://gitverse.ru/stasnorman/example-data-api.git'
revision='8504a6d9b39e6f652bce689d96e88538d7541c6b'
validator_sha256='3ff02f389820fd829d7769a50a9c158384fad54520889acb5da297b4678569cd'
schema_sha256='f9c7a9ff6ba5bdba7c27079ef5a5568218110dd5a5aba99e2312ef2e210adee3'
workspace=$(mktemp -d "${TMPDIR:-/tmp}/first30-data-api.XXXXXX")
cleanup() { rm -rf "$workspace"; }
trap cleanup EXIT INT TERM

source_dir=${DATA_API_VALIDATOR_DIR:-$workspace/example-data-api}
if [ -z "${DATA_API_VALIDATOR_DIR:-}" ]; then
  git clone --quiet "$repository" "$source_dir"
fi

actual_revision=$(git -C "$source_dir" rev-parse HEAD)
if [ "$actual_revision" != "$revision" ]; then
  if [ -n "${DATA_API_VALIDATOR_DIR:-}" ]; then
    echo "DATA_API_VALIDATOR_DIR must point to official revision $revision" >&2
    exit 2
  fi
  git -C "$source_dir" checkout --quiet "$revision"
fi

validator="$source_dir/validate_data_api.py"
schema="$source_dir/Example/DATA-API.schema.json"
hash_file() {
  python3 -c 'import hashlib, sys; print(hashlib.sha256(open(sys.argv[1], "rb").read()).hexdigest())' "$1"
}
if [ "$(hash_file "$validator")" != "$validator_sha256" ] || [ "$(hash_file "$schema")" != "$schema_sha256" ]; then
  echo 'Official DATA-API validator checksum mismatch' >&2
  exit 2
fi

python3 -m venv "$workspace/venv"
"$workspace/venv/bin/python" -m pip install --quiet --disable-pip-version-check --no-cache-dir -r "$source_dir/requirements.txt"
"$workspace/venv/bin/python" "$validator" DATA-API.yaml --schema "$schema" --openapi ./openapi.json
