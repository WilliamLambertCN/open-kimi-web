#!/bin/sh
set -eu

okw_fail() {
    printf '%s\n' "$1" >&2
    exit 1
}

okw_platform() {
    case "$(uname -s)" in
        Darwin) os=darwin ;;
        Linux)
            os=linux
            if ! getconf GNU_LIBC_VERSION >/dev/null 2>&1; then
                okw_fail 'Unsupported Linux libc; the official Node runtime requires glibc.'
            fi
            ;;
        *) okw_fail 'Unsupported operating system; use install.ps1 on Windows.' ;;
    esac
    case "$(uname -m)" in
        x86_64|amd64) arch=x64 ;;
        aarch64|arm64) arch=arm64 ;;
        *) okw_fail 'Unsupported architecture; x64 or arm64 is required.' ;;
    esac
    printf '%s-%s\n' "$os" "$arch"
}

okw_safe_directory() (
    path=$1
    case "$path" in /*) ;; *) okw_fail 'Installation directory must be absolute.' ;; esac
    while [ "$path" != / ]; do
        if [ -L "$path" ] || { [ -e "$path" ] && [ ! -d "$path" ]; }; then
            okw_fail 'Installation directory must not contain links or non-directory ancestors.'
        fi
        path=$(dirname "$path")
    done
)

okw_probe() (
    node=$1
    shift
    output=$(mktemp "${TMPDIR:-/tmp}/open-kimi-web-probe.XXXXXXXX") || exit 1
    trap 'rm -f "$output"' EXIT
    "$node" "$@" >"$output" 2>/dev/null &
    pid=$!
    remaining=15
    while kill -0 "$pid" 2>/dev/null; do
        if [ "$remaining" -eq 0 ]; then
            kill -KILL "$pid" 2>/dev/null || :
            wait "$pid" 2>/dev/null || :
            exit 1
        fi
        sleep 1
        remaining=$((remaining - 1))
    done
    status=0
    wait "$pid" || status=$?
    [ "$status" -eq 0 ] || exit 1
    cat "$output"
)

okw_node() (
    node=$1
    expected=${2:-}
    [ -f "$node" ] && [ -x "$node" ] || exit 1
    version=$(okw_probe "$node" -p 'process.version') || exit 1
    case "$version" in v*) ;; *) exit 1 ;; esac
    numbers=${version#v}
    major=${numbers%%.*}
    remainder=${numbers#*.}
    minor=${remainder%%.*}
    patch=${remainder#*.}
    [ "$numbers" != "$remainder" ] && [ "$patch" != "$remainder" ] || exit 1
    for part in "$major" "$minor" "$patch"; do
        case "$part" in *[!0-9]*|'') exit 1 ;; esac
    done
    [ "$major" -gt 22 ] || { [ "$major" -eq 22 ] && [ "$minor" -ge 19 ]; } || exit 1
    [ -z "$expected" ] || [ "$version" = "$expected" ] || exit 1
    actual=$(okw_probe "$node" -p 'process.execPath') || exit 1
    [ -x "$actual" ] || exit 1
    directory=$(dirname "$actual")
    npm=$directory/../lib/node_modules/npm/bin/npm-cli.js
    [ -f "$npm" ] || exit 1
    npm_version=$(okw_probe "$actual" "$npm" --version) || exit 1
    case "$npm_version" in [0-9]*.[0-9]*.[0-9]*) ;; *) exit 1 ;; esac
    printf '%s\n' "$actual"
)

okw_download() {
    case "$1" in
        https://nodejs.org/dist/*|https://api.github.com/repos/WilliamLambertCN/open-kimi-web/*|\
        https://codeload.github.com/WilliamLambertCN/open-kimi-web/*) ;;
        *) okw_fail 'Download URL is not an approved HTTPS origin.' ;;
    esac
    curl --fail --silent --show-error --proto '=https' --tlsv1.2 --connect-timeout 15 --max-time 180 \
        --header 'User-Agent: open-kimi-web-installer' --output "$2" "$1" ||
        okw_fail 'Download failed; check HTTPS connectivity and retry. No installation was replaced.'
}

okw_digest() {
    if command -v sha256sum >/dev/null 2>&1; then
        sha256sum "$1" | cut -d ' ' -f 1
    elif command -v shasum >/dev/null 2>&1; then
        shasum -a 256 "$1" | cut -d ' ' -f 1
    else
        okw_fail 'SHA256 verification requires sha256sum or shasum.'
    fi
}

okw_archive_layout() (
    archive=$1
    name=$2
    listing=$3
    tar -tzf "$archive" >"$listing" || okw_fail 'Unable to inspect downloaded archive.'
    [ -s "$listing" ] || okw_fail 'Downloaded archive is empty.'
    while IFS= read -r entry; do
        case "$entry" in "$name"|"$name/"|"$name/"*) ;; *) okw_fail 'Archive has an unexpected top-level layout.' ;; esac
        case "/$entry/" in */../*|*/./*) okw_fail 'Archive contains an unsafe path.' ;; esac
    done <"$listing"
)

okw_private_node() (
    home=$1
    platform=$2
    version=v22.23.3
    case "$platform" in
        darwin-x64) digest=8a677b0219178efd6eb0e475457c4afb452b521a92f6e67845a73bd85727f2a8 ;;
        darwin-arm64) digest=23b25245dcfb9af7262f8ff142e9e2e0af025368117329e7a7458a51e5922f53 ;;
        linux-x64) digest=1084aa36196bba4c3a5e69a1ee388a6e4ff729dad09445fbcd434b28fe3c24af ;;
        linux-arm64) digest=5ced2d48d1d7198739b7f86804de0171aefb6823b684b12341d3321afc3cb0b2 ;;
        *) okw_fail 'Unsupported Node platform.' ;;
    esac
    runtime=$home/runtime
    okw_safe_directory "$runtime"
    mkdir -p "$runtime"
    name=node-$version-$platform
    destination=$runtime/$name
    lock=$runtime/$name.lock
    mkdir "$lock" 2>/dev/null || okw_fail 'Private Node runtime is locked; retry after the other installer finishes.'
    stage=''
    trap '[ -z "$stage" ] || rm -rf "$stage"; rmdir "$lock"' EXIT
    trap 'exit 1' HUP INT TERM
    okw_safe_directory "$destination"
    if [ -e "$destination" ]; then
        okw_node "$destination/bin/node" "$version" ||
            okw_fail 'Existing private Node directory is unrecognized; it was not overwritten.'
        exit 0
    fi
    stage=$(mktemp -d "$runtime/.stage-XXXXXXXX")
    archive=$stage/node.tar.gz
    okw_download "https://nodejs.org/dist/$version/$name.tar.gz" "$archive"
    [ "$(okw_digest "$archive")" = "$digest" ] || okw_fail 'Node archive SHA256 mismatch; nothing was extracted.'
    okw_archive_layout "$archive" "$name" "$stage/listing"
    mkdir "$stage/unpacked"
    tar -xzf "$archive" -C "$stage/unpacked" || okw_fail 'Unable to extract Node archive.'
    okw_safe_directory "$stage/unpacked/$name"
    okw_node "$stage/unpacked/$name/bin/node" "$version" >/dev/null ||
        okw_fail 'Extracted Node version or adjacent npm CLI is invalid.'
    [ ! -e "$destination" ] && [ ! -L "$destination" ] || okw_fail 'Private Node destination appeared during installation.'
    mv "$stage/unpacked/$name" "$destination"
    okw_node "$destination/bin/node" "$version"
)

okw_coordinator() (
    directory=$1
    revision=$2
    temporary=$3
    if [ -n "$revision" ]; then
        case "$revision" in *[!0-9a-fA-F]*) okw_fail 'Revision must be a full 40-digit commit SHA.' ;; esac
        [ "${#revision}" -eq 40 ] || okw_fail 'Revision must be a full 40-digit commit SHA.'
    elif [ -f "$directory/install.mjs" ]; then
        printf '%s\n' "$directory/install.mjs"
        exit 0
    else
        okw_download 'https://api.github.com/repos/WilliamLambertCN/open-kimi-web/commits/main' "$temporary/commit.json"
        revision=$(sed -n 's/^[[:space:]]*"sha":[[:space:]]*"\([0-9a-fA-F]*\)".*/\1/p' "$temporary/commit.json" | head -n 1)
        case "$revision" in *[!0-9a-fA-F]*) okw_fail 'GitHub returned an invalid commit SHA.' ;; esac
        [ "${#revision}" -eq 40 ] || okw_fail 'GitHub returned an invalid commit SHA.'
    fi
    revision=$(printf '%s' "$revision" | tr 'A-F' 'a-f')
    archive=$temporary/source.tar.gz
    printf '%s\n' "Installer source: downloading coordinator/helpers at $revision; not the Official Kimi CLI." >&2
    okw_download "https://codeload.github.com/WilliamLambertCN/open-kimi-web/tar.gz/$revision" "$archive"
    name=open-kimi-web-$revision
    okw_archive_layout "$archive" "$name" "$temporary/listing"
    mkdir "$temporary/source"
    tar -xzf "$archive" -C "$temporary/source" || okw_fail 'Unable to extract repository archive.'
    coordinator=$temporary/source/$name/scripts/install.mjs
    [ -f "$coordinator" ] || okw_fail 'Selected revision has no install coordinator.'
    printf '%s\n' "$coordinator"
)

okw_argument_error() {
    printf '%s\n' "$1" >&2
    exit 2
}

okw_version() (
    version=${1#v}
    case "$version" in
        *-r*) revision=${version##*-r}; version=${version%-r*}
            case "$revision" in ''|0*|*[!0-9]*) exit 1 ;; esac ;;
    esac
    major=${version%%.*}
    remainder=${version#*.}
    minor=${remainder%%.*}
    patch=${remainder#*.}
    [ "$version" != "$remainder" ] && [ "$patch" != "$remainder" ] || exit 1
    for part in "$major" "$minor" "$patch"; do
        case "$part" in ''|*[!0-9]*) exit 1 ;; 0) ;; 0*) exit 1 ;; esac
    done
)

okw_validate_arguments() (
    if [ "$#" -eq 1 ] && { [ "$1" = --help ] || [ "$1" = -h ]; }; then exit 0; fi
    seen=' '
    while [ "$#" -gt 0 ]; do
        argument=$1
        shift
        case "$seen" in *" $argument "*) okw_argument_error 'duplicate installation option' ;; esac
        case "$argument" in
            --version)
                [ "$#" -gt 0 ] && okw_version "$1" ||
                    okw_argument_error '--version requires a formal version, e.g. 2.3.1-r1'
                shift ;;
            --no-integrate|--switch-installation) ;;
            *) okw_argument_error 'unknown installation option; use --help' ;;
        esac
        seen="$seen$argument "
    done
)

okw_main() (
    revision=''
    count=$#
    while [ "$count" -gt 0 ]; do
        argument=$1
        shift
        count=$((count - 1))
        if [ "$argument" = --revision ]; then
            [ -z "$revision" ] && [ "$count" -gt 0 ] || okw_argument_error '--revision requires one full commit SHA.'
            revision=$1
            shift
            count=$((count - 1))
            case "$revision" in *[!0-9a-fA-F]*) okw_argument_error 'Revision must be a full 40-digit commit SHA.' ;; esac
            [ "${#revision}" -eq 40 ] || okw_argument_error 'Revision must be a full 40-digit commit SHA.'
        else
            set -- "$@" "$argument"
        fi
    done
    okw_validate_arguments "$@"
    if [ "$#" -eq 1 ] && { [ "$1" = --help ] || [ "$1" = -h ]; }; then
        printf '%s\n' 'Usage: install.sh [--version <formal version>] [--switch-installation] [--no-integrate]'
        printf '%s\n' '       [--revision <40-digit commit SHA>]'
        exit 0
    fi
    if [ -z "${OPEN_KIMI_REAL_KIMI:-}" ]; then
        command_path=$(command -v kimi || :)
        case "$command_path" in
            '') ;;
            /*) OPEN_KIMI_INSTALL_COMMAND=$command_path; export OPEN_KIMI_INSTALL_COMMAND ;;
            *) okw_fail 'Unsupported kimi shell command; set OPEN_KIMI_REAL_KIMI to its absolute executable.' ;;
        esac
    fi
    platform=$(okw_platform)
    home=${OPEN_KIMI_WEB_HOME:-$HOME/.open-kimi-web}
    okw_safe_directory "$home"
    node=''
    candidate=$(command -v node || :)
    if [ -n "$candidate" ]; then node=$(okw_node "$candidate" || :); fi
    if [ -z "$node" ]; then
        printf '%s\n' 'Node runtime: downloading verified private Node; this is not the Official Kimi CLI.' >&2
        command -v curl >/dev/null 2>&1 || okw_fail 'curl is required to download the private Node runtime.'
        command -v tar >/dev/null 2>&1 || okw_fail 'tar is required to extract the private Node runtime.'
        node=$(okw_private_node "$home" "$platform")
    fi
    printf '%s\n' "Node runtime: using $node; no system Node installation was changed." >&2
    temporary=$(mktemp -d "${TMPDIR:-/tmp}/open-kimi-web-install-XXXXXXXX")
    trap 'rm -rf "$temporary"' EXIT
    trap 'exit 1' HUP INT TERM
    directory=$(CDPATH='' cd -- "$(dirname "$0")" && pwd)
    coordinator=$(okw_coordinator "$directory" "$revision" "$temporary")
    "$node" "$coordinator" "$@"
)

okw_main "$@"
