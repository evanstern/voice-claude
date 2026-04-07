#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
PROJECT_ROOT=$(cd -- "${SCRIPT_DIR}/.." && pwd)

NODE_VERSION=22
PNPM_VERSION=9.15.0
DEFAULT_PIPER_MODEL=en_US-lessac-medium.onnx
DEFAULT_PIPER_MODELS_DIR="${PROJECT_ROOT}/models/piper"
PIPER_TTS_VERSION=1.4.2
DEFAULT_PIPER_BASE_URL="https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0/en/en_US/lessac/medium"

if [[ ${EUID} -eq 0 && -n "${SUDO_USER:-}" ]]; then
  INSTALL_USER=${SUDO_USER}
else
  INSTALL_USER=$(id -un)
fi

INSTALL_GROUP=$(id -gn "${INSTALL_USER}")
INSTALL_HOME=$(getent passwd "${INSTALL_USER}" | cut -d: -f6 || true)
CONFIG_HOME=${INSTALL_HOME}/.config
CONFIG_DIR="${CONFIG_HOME}/voice-claude"
CONFIG_FILE="${CONFIG_DIR}/config.env"

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

if [[ -z "${INSTALL_HOME}" ]]; then
  fail "Could not determine home directory for install user '${INSTALL_USER}'."
fi

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

  "${SUDO[@]}" corepack enable
  "${SUDO[@]}" corepack prepare "pnpm@${PNPM_VERSION}" --activate
}

write_config_file() {
  local source_file=$1

  if [[ ${EUID} -eq 0 ]]; then
    install -d -m 0755 -o "${INSTALL_USER}" -g "${INSTALL_GROUP}" "${CONFIG_DIR}"
    install -m 0600 -o "${INSTALL_USER}" -g "${INSTALL_GROUP}" "${source_file}" "${CONFIG_FILE}"
  else
    mkdir -p "${CONFIG_DIR}"
    install -m 0600 "${source_file}" "${CONFIG_FILE}"
  fi
}

ensure_config_file() {
  if [[ -f "${CONFIG_FILE}" ]]; then
    :
  elif [[ -f "${PROJECT_ROOT}/.env" ]]; then
    log "Migrating existing repo config to ${CONFIG_FILE}"
    write_config_file "${PROJECT_ROOT}/.env"
  else
    log "Creating installed config at ${CONFIG_FILE} from .env.example"
    write_config_file "${PROJECT_ROOT}/.env.example"
  fi

  local current_work_dir
  current_work_dir=$(grep -E '^WORK_DIR=' "${CONFIG_FILE}" | cut -d= -f2- || true)

  if [[ -z "${current_work_dir}" ]]; then
    log "Setting WORK_DIR=${INSTALL_HOME} in ${CONFIG_FILE}"
    if grep -qE '^#?\s*WORK_DIR=' "${CONFIG_FILE}"; then
      sed -i "s|^#\?\s*WORK_DIR=.*|WORK_DIR=${INSTALL_HOME}|" "${CONFIG_FILE}"
    else
      printf '\nWORK_DIR=%s\n' "${INSTALL_HOME}" >> "${CONFIG_FILE}"
    fi
  fi
}

load_env() {
  set -a
  source "${CONFIG_FILE}"
  set +a
}

download_piper_model() {
  local model_name models_dir model_path metadata_path model_url metadata_url
  model_name=${PIPER_MODEL_NAME:-$DEFAULT_PIPER_MODEL}
  models_dir=${PIPER_MODELS_DIR:-$DEFAULT_PIPER_MODELS_DIR}
  model_path="${models_dir}/${model_name}"
  metadata_path="${model_path}.json"
  local base_url=${PIPER_MODEL_BASE_URL:-$DEFAULT_PIPER_BASE_URL}
  model_url="${base_url}/${model_name}"
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

  log "Installing piper-tts==${PIPER_TTS_VERSION} into virtualenv"
  "${venv_dir}/bin/pip" install --upgrade pip
  "${venv_dir}/bin/pip" install "piper-tts==${PIPER_TTS_VERSION}"

  download_piper_model
}

ensure_claude_code() {
  local ai_provider
  ai_provider=$(grep -E '^AI_PROVIDER=' "${CONFIG_FILE}" | cut -d= -f2- || true)

  if [[ "${ai_provider}" != "claude-code" ]]; then
    return
  fi

  if command -v claude >/dev/null 2>&1; then
    log "Claude Code CLI already installed: $(claude --version 2>&1 | head -1)"
    return
  fi

  log 'Installing Claude Code CLI (npm install -g @anthropic-ai/claude-code)'
  "${SUDO[@]}" npm install -g @anthropic-ai/claude-code

  if ! command -v claude >/dev/null 2>&1; then
    fail 'Claude Code CLI installed but not found in PATH. Try running: sudo npm install -g @anthropic-ai/claude-code'
  fi

  log "Claude Code CLI installed: $(claude --version 2>&1 | head -1)"
  log 'NOTE: You must authenticate the CLI before voice-claude can use it.'
  log '      Run: claude login'
}

setup_systemd_service() {
  local service_file="/etc/systemd/system/voice-claude.service"
  local run_user run_user_home
  run_user=${INSTALL_USER}
  run_user_home=${INSTALL_HOME}

  log "Setting up systemd service (user=${run_user})"

  "${SUDO[@]}" tee "${service_file}" >/dev/null <<EOF
[Unit]
Description=voice-claude — hands-free voice interface for Claude
After=network.target

[Service]
Type=simple
User=${run_user}
Environment=PATH=${run_user_home}/.local/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
Environment=VOICE_CLAUDE_CONFIG=${CONFIG_FILE}
WorkingDirectory=${PROJECT_ROOT}
ExecStart=${PROJECT_ROOT}/scripts/start.sh
EnvironmentFile=${CONFIG_FILE}
Restart=on-failure
RestartSec=5
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
EOF

  "${SUDO[@]}" systemctl daemon-reload
  "${SUDO[@]}" systemctl enable voice-claude
  "${SUDO[@]}" systemctl restart voice-claude
}

install_cli() {
  local cli_src="${SCRIPT_DIR}/voice-claude"
  local cli_dest="/usr/local/bin/voice-claude"

  if [[ ! -f "${cli_src}" ]]; then
    fail "CLI script not found at ${cli_src}"
  fi

  # Bake in the project root so the CLI works from anywhere
  "${SUDO[@]}" cp "${cli_src}" "${cli_dest}"
  "${SUDO[@]}" sed -i "s|__PROJECT_ROOT__|${PROJECT_ROOT}|g" "${cli_dest}"
  "${SUDO[@]}" sed -i "s|__CONFIG_FILE__|${CONFIG_FILE}|g" "${cli_dest}"
  "${SUDO[@]}" chmod +x "${cli_dest}"

  log "Installed CLI to ${cli_dest}"
  log "Installed config lives at ${CONFIG_FILE}"
}

main() {
  cd "${PROJECT_ROOT}"

  ensure_node
  install_apt_packages git curl jq less make python3 ripgrep tree wget
  ensure_pnpm
  ensure_config_file
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

  ensure_claude_code
  setup_systemd_service
  install_cli

  log 'Install complete'
  log 'The voice-claude service is now running.'
  log 'Use "voice-claude status" to check, "voice-claude logs -f" to follow logs.'
}

main "$@"
