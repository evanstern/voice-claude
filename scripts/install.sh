#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
PROJECT_ROOT=$(cd -- "${SCRIPT_DIR}/.." && pwd)

NODE_VERSION=22
PNPM_VERSION=9.15.0
DEFAULT_PIPER_MODEL=en_US-lessac-medium.onnx
DEFAULT_PIPER_MODELS_DIR="${PROJECT_ROOT}/models/piper"
DEFAULT_PIPER_BASE_URL="https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0/en/en_US/lessac/medium"

WITH_PIPER=false
if [[ "${INSTALL_PIPER:-false}" == "true" ]]; then
  WITH_PIPER=true
fi

while [[ $# -gt 0 ]]; do
  case "$1" in
    --with-piper)
      WITH_PIPER=true
      ;;
    --without-piper)
      WITH_PIPER=false
      ;;
    *)
      printf 'Unknown argument: %s\n' "$1" >&2
      exit 1
      ;;
  esac
  shift
done

if [[ ${EUID} -eq 0 ]]; then
  SUDO=()
elif command -v sudo >/dev/null 2>&1; then
  SUDO=(sudo)
else
  printf 'This script needs root privileges for package installation. Run as root or install sudo.\n' >&2
  exit 1
fi

log() {
  printf '[install] %s\n' "$*"
}

fail() {
  printf '[install] ERROR: %s\n' "$*" >&2
  exit 1
}

require_apt() {
  if ! command -v apt-get >/dev/null 2>&1; then
    fail 'apt-get is required. This installer currently supports Debian/Ubuntu only.'
  fi
}

install_apt_packages() {
  local packages=()
  for package in "$@"; do
    if ! dpkg -s "$package" >/dev/null 2>&1; then
      packages+=("$package")
    fi
  done

  if [[ ${#packages[@]} -eq 0 ]]; then
    return
  fi

  require_apt
  log "Installing apt packages: ${packages[*]}"
  "${SUDO[@]}" apt-get update
  "${SUDO[@]}" apt-get install -y --no-install-recommends "${packages[@]}"
}

ensure_node() {
  local need_node=false

  if ! command -v node >/dev/null 2>&1; then
    need_node=true
  else
    local node_major
    node_major=$(node -p "process.versions.node.split('.')[0]")
    if (( node_major < NODE_VERSION )); then
      need_node=true
    fi
  fi

  if [[ ${need_node} == false ]]; then
    return
  fi

  require_apt
  install_apt_packages ca-certificates curl gnupg

  log "Installing Node.js ${NODE_VERSION}.x"
  "${SUDO[@]}" install -d -m 0755 /etc/apt/keyrings
  curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | "${SUDO[@]}" gpg --yes --dearmor -o /etc/apt/keyrings/nodesource.gpg
  printf 'deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_%s.x nodistro main\n' "${NODE_VERSION}" | "${SUDO[@]}" tee /etc/apt/sources.list.d/nodesource.list >/dev/null
  "${SUDO[@]}" apt-get update
  "${SUDO[@]}" apt-get install -y nodejs
}

ensure_pnpm() {
  if ! command -v corepack >/dev/null 2>&1; then
    fail 'corepack is required after installing Node.js, but was not found.'
  fi

  corepack enable
  corepack prepare "pnpm@${PNPM_VERSION}" --activate
}

ensure_env_file() {
  if [[ -f "${PROJECT_ROOT}/.env" ]]; then
    return
  fi

  log 'Creating .env from .env.example'
  cp "${PROJECT_ROOT}/.env.example" "${PROJECT_ROOT}/.env"
}

load_env() {
  set -a
  source "${PROJECT_ROOT}/.env"
  set +a
}

download_piper_model() {
  local model_name models_dir model_path metadata_path model_url metadata_url
  model_name=${PIPER_MODEL_NAME:-$DEFAULT_PIPER_MODEL}
  models_dir=${PIPER_MODELS_DIR:-$DEFAULT_PIPER_MODELS_DIR}
  model_path="${models_dir}/${model_name}"
  metadata_path="${model_path}.json"
  model_url="${DEFAULT_PIPER_BASE_URL}/${model_name}"
  metadata_url="${model_url}.json"

  mkdir -p "${models_dir}"

  if [[ -f "${model_path}" && -f "${metadata_path}" ]]; then
    log "Piper model already present: ${model_name}"
    return
  fi

  if [[ ! -f "${model_path}" ]]; then
    log "Downloading Piper model: ${model_name}"
    wget -q -O "${model_path}.tmp" "${model_url}"
    mv "${model_path}.tmp" "${model_path}"
  fi

  if [[ ! -f "${metadata_path}" ]]; then
    log "Downloading Piper model metadata: ${model_name}.json"
    wget -q -O "${metadata_path}.tmp" "${metadata_url}"
    mv "${metadata_path}.tmp" "${metadata_path}"
  fi
}

setup_piper() {
  install_apt_packages python3-venv

  local venv_dir="${PROJECT_ROOT}/.venv/piper"
  if [[ ! -d "${venv_dir}" ]]; then
    log 'Creating Piper virtualenv'
    python3 -m venv "${venv_dir}"
  fi

  log 'Installing piper-tts into virtualenv'
  "${venv_dir}/bin/pip" install --upgrade pip
  "${venv_dir}/bin/pip" install --upgrade piper-tts

  download_piper_model
}

main() {
  cd "${PROJECT_ROOT}"

  ensure_node
  install_apt_packages git curl jq less make python3 ripgrep tree wget
  ensure_pnpm
  ensure_env_file
  load_env

  log 'Installing pnpm dependencies'
  pnpm install

  log 'Building workspace'
  pnpm build

  if [[ ${WITH_PIPER} == true || "${TTS_PROVIDER:-}" == 'piper' ]]; then
    setup_piper
  else
    log 'Skipping Piper setup'
  fi

  log 'Install complete'
}

main "$@"
