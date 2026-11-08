#!/usr/bin/env bash
# Obrenna-Server bootstrap for macOS and Linux.
#
#   curl -fsSL https://<site>/install/server.sh | bash -s -- --site https://<site>
#
# Downloads the server bundle from the site, verifies its SHA-256 checksum,
# unpacks it and runs the platform installer, which installs Python and Ollama
# if needed and starts the gateway (port 8787, LAN) and the control panel
# (port 8788, this computer only). Re-running upgrades in place; the data
# directory (accounts, policy, machine credentials) is kept.
set -euo pipefail

main() {
  local site="${OBRENNA_SITE_URL:-https://obrenna.com}"
  while [ "$#" -gt 0 ]; do
    case "$1" in
      --site) site="${2:?missing site URL}"; shift 2 ;;
      *) echo "Unknown option: $1" >&2; exit 2 ;;
    esac
  done
  site="${site%/}"

  local os
  case "$(uname -s)" in
    Darwin) os=macos ;;
    Linux) os=linux ;;
    *) echo "This installer supports macOS and Linux. On Windows use the PowerShell command from the download page." >&2; exit 1 ;;
  esac

  local root="${OBRENNA_INSTALL_ROOT:-${HOME}/.local/share/obrenna-server}"
  local tmp
  tmp="$(mktemp -d)"
  trap 'rm -rf "$tmp"' EXIT

  echo "Downloading Obrenna-Server from ${site} ..."
  curl -fsSL "${site}/install/obrenna-server.tar.gz" -o "${tmp}/server.tar.gz"
  curl -fsSL "${site}/install/obrenna-server.tar.gz.sha256" -o "${tmp}/server.sha256"

  local expected actual
  expected="$(awk '{print tolower($1)}' "${tmp}/server.sha256" | head -n1)"
  if command -v sha256sum >/dev/null 2>&1; then
    actual="$(sha256sum "${tmp}/server.tar.gz" | awk '{print $1}')"
  else
    actual="$(shasum -a 256 "${tmp}/server.tar.gz" | awk '{print $1}')"
  fi
  if [ -z "$expected" ] || [ "$expected" != "$actual" ]; then
    echo "Checksum mismatch: the downloaded server bundle is corrupt or was modified. Nothing was installed." >&2
    exit 1
  fi

  mkdir -p "$root"
  rm -rf "${root}/source.new"
  mkdir -p "${root}/source.new"
  tar -xzf "${tmp}/server.tar.gz" -C "${root}/source.new"
  rm -rf "${root}/source"
  mv "${root}/source.new" "${root}/source"

  rm -rf "$tmp"
  trap - EXIT
  exec bash "${root}/source/scripts/install-${os}.sh" --source-dir "${root}/source"
}

main "$@"
