(
  set -eu
  version='@VERSION@'
  github="https://github.com/WilliamLambertCN/open-kimi-web/releases/download/v$version/okw-install-$version.tar.gz"
  default_proxy='https://ghfast.top'
  proxy=${OPEN_KIMI_WEB_GITHUB_PROXY:-$default_proxy}
  digest='@INSTALLER_SHA256@'
  case "$proxy" in
    0) proxy='' ;;
    "$default_proxy"|"$default_proxy/") ;;
    *) printf '%s\n' "OPEN_KIMI_WEB_GITHUB_PROXY must be $default_proxy or 0 (disable)." >&2; exit 1 ;;
  esac
  export OPEN_KIMI_WEB_INSTALL_SHA256='@PACKAGE_SHA256@'
  stage=$(mktemp -d "${TMPDIR:-/tmp}/okw-install-XXXXXXXX")
  trap 'rm -rf "$stage"' EXIT
  trap 'exit 1' HUP INT TERM
  file=$stage/installer.tar.gz
  verify() {
    if command -v sha256sum >/dev/null 2>&1; then
      hash=$(sha256sum "$file") || return 1
    else
      hash=$(shasum -a 256 "$file") || return 1
    fi
    [ "${hash%% *}" = "$digest" ]
  }
  download() {
    url=$1 seconds=$2
    shift 2
    rm -f "$file" || return 1
    status=$(curl -qfsS --proto '=https' --tlsv1.2 --max-time "$seconds" --max-filesize 2097152 \
      --output "$file" --write-out '%{http_code}' "$@" "$url" 2>/dev/null) && [ "$status" = 200 ] && verify
  }
  from_github() {
    download "$github" "$1" --location --proto-redir '=https' --max-redirs 4
  }
  if [ -z "$proxy" ]; then
    from_github 45 || { printf '%s\n' 'Could not download a verified installer from GitHub.' >&2; exit 1; }
  elif ! from_github 2; then
    if download "${proxy%/}/$github" 45; then
      printf '%s\n' 'Installer: verified the archive downloaded via the GitHub download proxy.'
    elif ! from_github 45; then
      printf '%s\n' 'Could not download a verified installer from GitHub or its download proxy.' >&2
      exit 1
    fi
  fi
  tar -xzf "$file" -C "$stage"
  sh "$stage/scripts/install.sh" --version "$version"
)
