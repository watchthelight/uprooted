#!/bin/bash
# Uprooted Linux Installer v0.4.2
# Standalone bash installer for systems without the GUI installer.
#
# Usage: ./install-uprooted-linux.sh [--root-path /path/to/Root.AppImage]
#        ./install-uprooted-linux.sh --prebuilt [--root-path /path/to/Root.AppImage]
#        ./install-uprooted-linux.sh --auto-deps  (auto-install missing build deps)
#        ./install-uprooted-linux.sh --uninstall
#        ./install-uprooted-linux.sh --repair [--prebuilt]
#        ./install-uprooted-linux.sh --diagnose
#        ./install-uprooted-linux.sh --desktop   (also create a .desktop file)
#
# This script:
# 1. Finds Root.AppImage (or uses --root-path)
# 2. Builds (or downloads) profiler + hook artifacts
# 3. Deploys to ~/.local/share/uprooted/
# 4. Creates a wrapper script with CLR profiler env vars
# 5. Patches HTML files in Root's profile directory
# 6. Adds env vars to ~/.profile as fallback for non-systemd sessions

set -euo pipefail

INSTALL_DIR="$HOME/.local/share/uprooted"
PROFILE_DIR="$HOME/.local/share/Root Communications/Root/profile/default"
PROFILER_GUID="{D1A6F5A0-1234-4567-89AB-CDEF01234567}"
VERSION="0.5.1-dev2"
AUTO_DEPS=false
ROOT_EXEC=""        # actual binary/AppRun to exec (may differ from ROOT_PATH)
SQUASHFS_ROOT=""    # set when using an extracted AppImage

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BOLD='\033[1m'
NC='\033[0m' # No Color

log()   { echo -e "${GREEN}[+]${NC} $1"; }
warn()  { echo -e "${YELLOW}[!]${NC} $1"; }
error() { echo -e "${RED}[-]${NC} $1"; }
die()   { error "$1"; exit 1; }

# ── Resolve latest release version from GitHub API ──

resolve_latest_version() {
    if ! command -v curl &>/dev/null; then
        warn "curl not found, using bundled version v$VERSION"
        return
    fi

    local api_url="https://api.github.com/repos/The-Uprooted-Project/uprooted/releases/latest"
    local response
    response=$(curl -sL --max-time 10 "$api_url" 2>/dev/null) || {
        warn "Could not reach GitHub API, using bundled version v$VERSION"
        return
    }

    local tag
    tag=$(echo "$response" | grep -o '"tag_name"[[:space:]]*:[[:space:]]*"[^"]*"' | grep -o '"v[^"]*"' | tr -d '"')

    if [[ -z "$tag" ]]; then
        warn "Could not parse latest version from GitHub API, using bundled v$VERSION"
        return
    fi

    local latest="${tag#v}"
    if [[ "$latest" != "$VERSION" ]]; then
        log "Latest release: v$latest (script bundled: v$VERSION)"
        VERSION="$latest"
    fi
}

# ── Diagnose function ──

run_diagnose() {
    echo ""
    echo "  Uprooted Diagnostics v$VERSION"
    echo "  ─────────────────────────────"
    echo ""

    # 1. Check env vars in current shell
    log "Checking environment variables in current session..."
    local env_ok=true
    if [[ "${DOTNET_ENABLE_PROFILING:-}" == "1" ]]; then
        log "  DOTNET_ENABLE_PROFILING=1"
    else
        error "  DOTNET_ENABLE_PROFILING is not set (or not '1')"
        env_ok=false
    fi
    if [[ -n "${DOTNET_PROFILER:-}" ]]; then
        log "  DOTNET_PROFILER=$DOTNET_PROFILER"
    else
        error "  DOTNET_PROFILER is not set"
        env_ok=false
    fi
    if [[ -n "${DOTNET_PROFILER_PATH:-}" ]]; then
        if [[ -f "$DOTNET_PROFILER_PATH" ]]; then
            log "  DOTNET_PROFILER_PATH=$DOTNET_PROFILER_PATH (exists)"
        else
            warn "  DOTNET_PROFILER_PATH=$DOTNET_PROFILER_PATH (FILE NOT FOUND)"
            env_ok=false
        fi
    else
        error "  DOTNET_PROFILER_PATH is not set"
        env_ok=false
    fi
    if [[ "${DOTNET_ReadyToRun:-}" == "0" ]]; then
        log "  DOTNET_ReadyToRun=0"
    else
        warn "  DOTNET_ReadyToRun is not set to '0' (optional but recommended)"
    fi
    # Legacy check (CORECLR_ prefix for .NET 8/9)
    if [[ "${CORECLR_ENABLE_PROFILING:-}" == "1" ]]; then
        log "  CORECLR_ENABLE_PROFILING=1 (legacy)"
    else
        warn "  CORECLR_ENABLE_PROFILING not set (legacy, optional for .NET 10+)"
    fi

    if [[ "$env_ok" == "false" ]]; then
        echo ""
        warn "Env vars are NOT active in this shell session."
        warn "Root launched from this session will NOT load Uprooted."
        warn "Fix: log out and back in, or use the wrapper script:"
        warn "  $INSTALL_DIR/launch-root.sh"
    else
        echo ""
        log "Env vars are active in this session."
    fi

    # 2. Check config files
    echo ""
    log "Checking configuration files..."
    local env_conf="$HOME/.config/environment.d/uprooted.conf"
    if [[ -f "$env_conf" ]]; then
        log "  environment.d/uprooted.conf: exists"
    else
        warn "  environment.d/uprooted.conf: missing"
    fi

    local wrapper="$INSTALL_DIR/launch-root.sh"
    if [[ -f "$wrapper" ]]; then
        log "  launch-root.sh: exists"
    else
        warn "  launch-root.sh: missing"
    fi

    local desktop="$HOME/.local/share/applications/root-uprooted.desktop"
    if [[ -f "$desktop" ]]; then
        log "  root-uprooted.desktop: exists"
        local exec_line
        exec_line=$(grep "^Exec=" "$desktop" 2>/dev/null || true)
        if [[ -n "$exec_line" ]]; then
            log "    $exec_line"
        fi
    else
        warn "  root-uprooted.desktop: missing (create with --desktop flag)"
    fi

    local plasma_env="$HOME/.config/plasma-workspace/env/uprooted.sh"
    if [[ -f "$plasma_env" ]]; then
        log "  plasma-workspace/env/uprooted.sh: exists (KDE Plasma)"
    elif is_kde; then
        warn "  plasma-workspace/env/uprooted.sh: missing (KDE detected — run repair)"
    fi

    if grep -q "DOTNET_ENABLE_PROFILING" "$HOME/.profile" 2>/dev/null; then
        log "  ~/.profile: contains Uprooted env vars"
    else
        warn "  ~/.profile: does not contain Uprooted env vars"
    fi

    # 3. Check deployed files
    echo ""
    log "Checking deployed files..."
    local files=("libuprooted_profiler.so" "UprootedHook.dll" "UprootedHook.deps.json" "uprooted-preload.js" "uprooted.css")
    for f in "${files[@]}"; do
        if [[ -f "$INSTALL_DIR/$f" ]]; then
            log "  $f: exists"
        else
            error "  $f: MISSING"
        fi
    done

    # 4. Check for running Root process
    echo ""
    log "Checking for running Root process..."
    local root_pids
    root_pids=$(pgrep -a "Root" 2>/dev/null || true)
    if [[ -n "$root_pids" ]]; then
        log "  Root is running:"
        echo "$root_pids" | while IFS= read -r line; do
            log "    PID $line"
        done

        # Check /proc/PID/exe for each Root process
        for pid in $(pgrep "Root" 2>/dev/null || true); do
            local exe_path
            exe_path=$(readlink "/proc/$pid/exe" 2>/dev/null || echo "(unreadable)")
            log "    /proc/$pid/exe -> $exe_path"

            # Check if DOTNET_ENABLE_PROFILING is set in the process
            if [[ -r "/proc/$pid/environ" ]]; then
                local proc_env
                proc_env=$(tr '\0' '\n' < "/proc/$pid/environ")
                if echo "$proc_env" | grep -q "DOTNET_ENABLE_PROFILING=1"; then
                    log "    Process has DOTNET_ENABLE_PROFILING=1"
                else
                    warn "    Process does NOT have DOTNET_ENABLE_PROFILING set"
                fi
                if echo "$proc_env" | grep -q "CORECLR_ENABLE_PROFILING=1"; then
                    log "    Process has CORECLR_ENABLE_PROFILING=1 (legacy)"
                else
                    warn "    Process does NOT have CORECLR_ENABLE_PROFILING set (legacy, optional)"
                fi
            else
                warn "    Cannot read /proc/$pid/environ (permission denied)"
            fi
        done
    else
        warn "  Root is not currently running"
    fi

    # 5. Check logs
    echo ""
    log "Checking log files..."
    local profiler_log="$INSTALL_DIR/profiler.log"
    if [[ -f "$profiler_log" ]]; then
        log "  profiler.log exists ($(wc -l < "$profiler_log") lines)"
        log "  Last 10 lines:"
        tail -10 "$profiler_log" | while IFS= read -r line; do
            echo "    $line"
        done
    else
        warn "  profiler.log: not found (profiler has never loaded)"
    fi

    local hook_log="$INSTALL_DIR/uprooted-hook.log"
    if [[ -f "$hook_log" ]]; then
        log "  uprooted-hook.log exists ($(wc -l < "$hook_log") lines)"
        log "  Last 10 lines:"
        tail -10 "$hook_log" | while IFS= read -r line; do
            echo "    $line"
        done
    else
        warn "  uprooted-hook.log: not found (hook has never loaded)"
    fi

    # 6. Check HTML patches
    echo ""
    log "Checking HTML patches..."
    if [[ -d "$PROFILE_DIR" ]]; then
        local html_files=()
        if [[ -f "$PROFILE_DIR/WebRtcBundle/index.html" ]]; then
            html_files+=("$PROFILE_DIR/WebRtcBundle/index.html")
        fi
        for app_dir in "$PROFILE_DIR/RootApps"/*/; do
            if [[ -f "${app_dir}index.html" ]]; then
                html_files+=("${app_dir}index.html")
            fi
        done

        if [[ ${#html_files[@]} -eq 0 ]]; then
            warn "  No HTML files found in profile directory"
        else
            for html in "${html_files[@]}"; do
                local name
                name="$(basename "$(dirname "$html")")/index.html"
                if grep -qE "(uprooted:start|uprooted-preload|<!-- uprooted -->)" "$html" 2>/dev/null; then
                    log "  $name: patched"
                else
                    error "  $name: NOT patched"
                fi
            done
        fi
    else
        warn "  Profile directory not found: $PROFILE_DIR"
        warn "  Launch Root once to generate it."
    fi

    echo ""
    log "Diagnostics complete."
    echo ""
}

# ── Uninstall function ──

run_uninstall() {
    echo ""
    echo "  Uprooted Uninstaller v$VERSION"
    echo "  ──────────────────────────────"
    echo ""

    # 1. Strip HTML patches
    log "Removing HTML patches..."
    if [[ -d "$PROFILE_DIR" ]]; then
        local html_files=()
        if [[ -f "$PROFILE_DIR/WebRtcBundle/index.html" ]]; then
            html_files+=("$PROFILE_DIR/WebRtcBundle/index.html")
        fi
        for app_dir in "$PROFILE_DIR/RootApps"/*/; do
            if [[ -f "${app_dir}index.html" ]]; then
                html_files+=("${app_dir}index.html")
            fi
        done

        local stripped=0
        for html in "${html_files[@]}"; do
            if grep -qE "(uprooted:start|uprooted-preload|<!-- uprooted -->|__UPROOTED_SETTINGS__)" "$html" 2>/dev/null; then
                # Strip injection lines (markers, legacy markers, bare tags)
                local tmp="${html}.tmp"
                local inside_block=false
                while IFS= read -r line; do
                    if [[ "$line" == *"<!-- uprooted:start -->"* ]]; then
                        inside_block=true
                        continue
                    fi
                    if [[ "$line" == *"<!-- uprooted:end -->"* ]]; then
                        inside_block=false
                        continue
                    fi
                    if [[ "$inside_block" == true ]]; then
                        continue
                    fi
                    # Legacy marker
                    if [[ "$line" == *"<!-- uprooted -->"* ]]; then
                        continue
                    fi
                    # Bare uprooted tags (bash installer without markers)
                    if [[ "$line" == *"uprooted-preload"* ]] && [[ "$line" == *"<script"* || "$line" == *"</script"* ]]; then
                        continue
                    fi
                    if [[ "$line" == *"uprooted.css"* ]] && [[ "$line" == *"<link"* ]]; then
                        continue
                    fi
                    if [[ "$line" == *"__UPROOTED_SETTINGS__"* ]] && [[ "$line" == *"<script"* ]]; then
                        continue
                    fi
                    echo "$line"
                done < "$html" > "$tmp"
                mv "$tmp" "$html"

                # Remove backup if it exists
                rm -f "${html}.uprooted.bak"
                stripped=$((stripped + 1))
                log "  Stripped: $(basename "$(dirname "$html")")/index.html"
            fi
        done
        log "$stripped HTML file(s) cleaned"
    else
        warn "Profile directory not found, skipping HTML cleanup"
    fi

    # 2. Remove environment.d config
    local env_conf="$HOME/.config/environment.d/uprooted.conf"
    if [[ -f "$env_conf" ]]; then
        rm -f "$env_conf"
        log "Removed $env_conf"
    fi

    # 3. Remove KDE Plasma env script
    local plasma_env="$HOME/.config/plasma-workspace/env/uprooted.sh"
    if [[ -f "$plasma_env" ]]; then
        rm -f "$plasma_env"
        log "Removed $plasma_env"
    fi

    # 4. Clean env vars from ~/.profile
    if grep -qE "(DOTNET_ENABLE_PROFILING|CORECLR_ENABLE_PROFILING)" "$HOME/.profile" 2>/dev/null; then
        # Remove the Uprooted block from .profile
        local tmp="$HOME/.profile.tmp"
        local skip_block=false
        while IFS= read -r line; do
            if [[ "$line" == "# Uprooted"* ]] && [[ "$line" != *"preload"* ]]; then
                skip_block=true
                continue
            fi
            if [[ "$skip_block" == true ]]; then
                # Skip export lines that are part of the block
                if [[ "$line" == export\ DOTNET_* || "$line" == export\ CORECLR_* || -z "$line" ]]; then
                    continue
                fi
                skip_block=false
            fi
            echo "$line"
        done < "$HOME/.profile" > "$tmp"
        mv "$tmp" "$HOME/.profile"
        log "Cleaned Uprooted env vars from ~/.profile"
    fi

    # 5. Remove .desktop file (backwards compat -- clean up even if we no longer create by default)
    local desktop="$HOME/.local/share/applications/root-uprooted.desktop"
    if [[ -f "$desktop" ]]; then
        rm -f "$desktop"
        log "Removed .desktop file"
    fi

    # 6. Remove installed files
    if [[ -d "$INSTALL_DIR" ]]; then
        rm -rf "$INSTALL_DIR"
        log "Removed $INSTALL_DIR"
    fi

    echo ""
    log "Uninstall complete."
    log "Log out and back in to clear env vars from your session."
    echo ""
}

# ── Parse arguments ──

ROOT_PATH=""
MODE="install"
USE_PREBUILT=false
CREATE_DESKTOP=false
while [[ $# -gt 0 ]]; do
    case "$1" in
        --root-path) ROOT_PATH="$2"; shift 2 ;;
        --diagnose)
            MODE="diagnose"
            shift
            ;;
        --uninstall)
            MODE="uninstall"
            shift
            ;;
        --repair)
            MODE="repair"
            shift
            ;;
        --prebuilt)
            USE_PREBUILT=true
            shift
            ;;
        --auto-deps)
            AUTO_DEPS=true
            shift
            ;;
        --desktop)
            CREATE_DESKTOP=true
            shift
            ;;
        --help|-h)
            echo "Usage: $0 [--root-path /path/to/Root.AppImage] [--prebuilt] [--desktop]"
            echo "       $0 --uninstall"
            echo "       $0 --repair [--prebuilt]"
            echo "       $0 --diagnose"
            echo ""
            echo "Installs Uprooted client mod framework for Root Communications."
            echo ""
            echo "Options:"
            echo "  --root-path    Path to Root.AppImage (auto-detected if not given)"
            echo "  --prebuilt     Download pre-built artifacts instead of building from source"
            echo "  --auto-deps    Auto-install missing build dependencies without prompting"
            echo "  --desktop      Create a .desktop file for launching Root with Uprooted"
            echo "  --uninstall    Remove Uprooted completely (patches, env vars, files)"
            echo "  --repair       Re-deploy artifacts and re-patch HTML files"
            echo "  --diagnose     Check installation health and runtime state"
            echo "  --help         Show this help"
            exit 0
            ;;
        *) die "Unknown option: $1" ;;
    esac
done

# ── Find Root ──

find_root() {
    if [[ -n "$ROOT_PATH" ]]; then
        if [[ -f "$ROOT_PATH" ]]; then
            log "Using Root at: $ROOT_PATH"
            return 0
        else
            die "Root not found at: $ROOT_PATH"
        fi
    fi

    # 1. Exact well-known paths (fastest check)
    local candidates=(
        "$HOME/Applications/Root.AppImage"
        "$HOME/Downloads/Root.AppImage"
        "$HOME/.local/bin/Root.AppImage"
        "/opt/Root.AppImage"
        "/usr/bin/Root.AppImage"
        "$HOME/.local/bin/Root"
    )

    for c in "${candidates[@]}"; do
        if [[ -f "$c" ]]; then
            ROOT_PATH="$c"
            log "Found Root at: $ROOT_PATH"
            return 0
        fi
    done

    # 2. Glob for variant filenames (versioned, renamed, etc.) in common directories
    local search_dirs=(
        "$HOME/Applications"
        "$HOME/Downloads"
        "$HOME/.local/bin"
        "$HOME/Desktop"
        "$HOME"
        "/opt"
        "/usr/bin"
        "/usr/local/bin"
    )
    for dir in "${search_dirs[@]}"; do
        [[ -d "$dir" ]] || continue
        for f in "$dir"/Root*.AppImage "$dir"/root*.AppImage "$dir"/Root*.appimage; do
            if [[ -f "$f" ]]; then
                ROOT_PATH="$f"
                log "Found Root at: $ROOT_PATH"
                return 0
            fi
        done
    done

    # 3. Search .desktop files for Root's Exec= path
    local desktop_dirs=(
        "$HOME/.local/share/applications"
        "/usr/share/applications"
        "/usr/local/share/applications"
        "/var/lib/flatpak/exports/share/applications"
        "$HOME/.local/share/flatpak/exports/share/applications"
    )
    for dir in "${desktop_dirs[@]}"; do
        [[ -d "$dir" ]] || continue
        for desktop_file in "$dir"/*.desktop; do
            [[ -f "$desktop_file" ]] || continue
            # Only consider desktop files that mention Root in Name or filename
            if ! grep -qiE '^Name=.*Root' "$desktop_file" 2>/dev/null \
               && [[ "$(basename "$desktop_file")" != *[Rr]oot* ]]; then
                continue
            fi
            local exec_path
            exec_path=$(grep -m1 '^Exec=' "$desktop_file" 2>/dev/null | sed 's/^Exec=//;s/ %[fFuUdDnNickvm]//g;s/ *$//')
            if [[ -n "$exec_path" && -f "$exec_path" ]]; then
                ROOT_PATH="$exec_path"
                log "Found Root via .desktop file: $ROOT_PATH"
                return 0
            fi
        done
    done

    # 4. Check running Root processes via /proc
    for pid_dir in /proc/[0-9]*/; do
        local exe
        exe=$(readlink "${pid_dir}exe" 2>/dev/null) || continue
        case "$exe" in
            *Root*.AppImage|*Root*.appimage|*/Root)
                if [[ -f "$exe" ]]; then
                    ROOT_PATH="$exe"
                    log "Found Root via running process: $ROOT_PATH"
                    return 0
                fi
                ;;
        esac
    done

    # 5. Try PATH lookup
    if command -v Root &>/dev/null; then
        ROOT_PATH="$(command -v Root)"
        log "Found Root in PATH: $ROOT_PATH"
        return 0
    fi

    # 6. Try locate (fast indexed search)
    if command -v locate &>/dev/null; then
        local located
        located=$(locate -i -l 1 "Root.AppImage" 2>/dev/null || true)
        if [[ -n "$located" && -f "$located" ]]; then
            ROOT_PATH="$located"
            log "Found Root via locate: $ROOT_PATH"
            return 0
        fi
        located=$(locate -i -l 1 --regexp '[Rr]oot.*\.[Aa]pp[Ii]mage$' 2>/dev/null || true)
        if [[ -n "$located" && -f "$located" ]]; then
            ROOT_PATH="$located"
            log "Found Root via locate: $ROOT_PATH"
            return 0
        fi
    fi

    # 7. Shallow find in $HOME (depth-limited to stay fast)
    if command -v find &>/dev/null; then
        local found
        found=$(find "$HOME" -maxdepth 4 -iname "Root*.AppImage" -type f -print -quit 2>/dev/null)
        if [[ -n "$found" && -f "$found" ]]; then
            ROOT_PATH="$found"
            log "Found Root at: $ROOT_PATH"
            return 0
        fi
    fi

    # Nothing found
    echo ""
    error "Could not find Root.AppImage."
    echo ""
    echo "  Searched:"
    echo "    - Common locations (~/Applications, ~/Downloads, ~/.local/bin, /opt)"
    echo "    - Glob patterns for Root*.AppImage in common directories"
    echo "    - .desktop files in application directories"
    echo "    - Running Root processes (/proc)"
    echo "    - PATH, locate database"
    echo "    - find in \$HOME (depth 4)"
    echo ""
    echo "  Tip: locate it manually with:"
    echo "    find / -iname 'Root*.AppImage' 2>/dev/null"
    echo ""
    echo "  Then re-run with: $0 --root-path /path/to/Root.AppImage"
    exit 1
}

# ── Resolve what we actually exec (handles extracted AppImages) ──
#
# On systems without FUSE, AppImages can't run directly.
# Users extract them with: ./Root.AppImage --appimage-extract
# This produces squashfs-root/ next to the .AppImage file.
# We detect that and run the extracted binary with proper LD_LIBRARY_PATH.

resolve_root_exec() {
    # Not an AppImage — exec directly, no lib setup needed
    if [[ "$ROOT_PATH" != *.AppImage && "$ROOT_PATH" != *.appimage ]]; then
        ROOT_EXEC="$ROOT_PATH"
        return 0
    fi

    # Look for an extracted AppImage adjacent to the .AppImage file
    local appimage_dir
    appimage_dir="$(dirname "$(realpath "$ROOT_PATH")")"

    local squash_candidates=(
        "$appimage_dir/squashfs-root"
        "$HOME/Downloads/squashfs-root"
    )

    for squash in "${squash_candidates[@]}"; do
        if [[ -f "$squash/usr/bin/Root" ]]; then
            SQUASHFS_ROOT="$squash"
            ROOT_EXEC="$squash/usr/bin/Root"
            log "Extracted AppImage found — using: $squash"
            return 0
        fi
    done

    # No extracted version found — check FUSE availability
    if [[ -c /dev/fuse ]]; then
        # FUSE present: AppImage should run directly
        ROOT_EXEC="$ROOT_PATH"
        return 0
    fi

    # No FUSE, no extracted version — warn and suggest
    echo ""
    warn "AppImages cannot run on this system (no FUSE support)."
    warn "Extract the AppImage first, then re-run the installer:"
    warn "  cd $(dirname "$ROOT_PATH")"
    warn "  chmod +x $(basename "$ROOT_PATH")"
    warn "  ./$(basename "$ROOT_PATH") --appimage-extract"
    warn "This creates squashfs-root/ in the same directory."
    echo ""
    # Fall back to the AppImage path anyway — let the user's system sort it
    ROOT_EXEC="$ROOT_PATH"
}

# ── Dependency management (build from source) ──

detect_pkg_manager() {
    if command -v apt-get &>/dev/null; then echo "apt"
    elif command -v dnf &>/dev/null; then echo "dnf"
    elif command -v pacman &>/dev/null; then echo "pacman"
    elif command -v zypper &>/dev/null; then echo "zypper"
    else echo "unknown"
    fi
}

# Install .NET 10 SDK via Microsoft's official install script (no apt feed config needed)
install_dotnet() {
    log "Installing .NET 10 SDK via Microsoft's dotnet-install.sh..."
    local tmp_script
    tmp_script=$(mktemp --suffix=.sh)

    if command -v curl &>/dev/null; then
        curl -sSL "https://dot.net/v1/dotnet-install.sh" -o "$tmp_script" || {
            error "Failed to download dotnet-install.sh"
            return 1
        }
    elif command -v wget &>/dev/null; then
        wget -qO "$tmp_script" "https://dot.net/v1/dotnet-install.sh" || {
            error "Failed to download dotnet-install.sh"
            return 1
        }
    else
        error "curl or wget is required to install .NET automatically."
        return 1
    fi

    chmod +x "$tmp_script"
    if ! bash "$tmp_script" --channel 10.0 --install-dir "$HOME/.dotnet"; then
        rm -f "$tmp_script"
        error ".NET install script failed."
        return 1
    fi
    rm -f "$tmp_script"

    export DOTNET_ROOT="$HOME/.dotnet"
    export PATH="$HOME/.dotnet:$PATH"
    log ".NET 10 SDK installed to ~/.dotnet"
    warn "Add to your shell profile to make permanent:"
    warn "  export DOTNET_ROOT=\$HOME/.dotnet"
    warn "  export PATH=\$HOME/.dotnet:\$PATH"
}

install_sys_pkgs() {
    local pkg_mgr="$1"
    shift
    local pkgs=("$@")
    case "$pkg_mgr" in
        apt)     sudo apt-get install -y "${pkgs[@]}" ;;
        dnf)     sudo dnf install -y "${pkgs[@]}" ;;
        pacman)  sudo pacman -S --noconfirm "${pkgs[@]}" ;;
        zypper)  sudo zypper install -y "${pkgs[@]}" ;;
        *)
            error "Unknown package manager. Install manually: ${pkgs[*]}"
            return 1
            ;;
    esac
}

# Maps abstract dep names to distro-specific package names
pkg_name_for() {
    local dep="$1"
    local mgr="$2"
    case "$dep:$mgr" in
        gcc:*)     echo "gcc" ;;
        nodejs:apt) echo "nodejs" ;;
        nodejs:dnf) echo "nodejs" ;;
        nodejs:pacman) echo "nodejs" ;;
        nodejs:zypper) echo "nodejs" ;;
        # npm is separate from nodejs on Ubuntu/Debian (and sometimes dnf)
        npm:apt)   echo "npm" ;;
        npm:dnf)   echo "npm" ;;
        npm:pacman) echo "npm" ;;  # pacman nodejs usually includes npm
        npm:zypper) echo "npm" ;;
        *)         echo "$dep" ;;
    esac
}

# ── Check prerequisites (build from source) ──

check_prereqs() {
    local need_gcc=false need_dotnet=false need_node=false need_npm=false need_pnpm=false

    command -v gcc    &>/dev/null || need_gcc=true
    command -v dotnet &>/dev/null || need_dotnet=true
    command -v node   &>/dev/null || need_node=true
    # npm is often a separate package from nodejs — check it explicitly
    command -v npm    &>/dev/null || need_npm=true
    command -v pnpm   &>/dev/null || need_pnpm=true

    # All present — nothing to do
    if ! $need_gcc && ! $need_dotnet && ! $need_node && ! $need_npm && ! $need_pnpm; then
        return 0
    fi

    echo ""
    warn "Missing build dependencies:"
    $need_gcc    && warn "  - gcc    (compiles the CLR profiler shared library)"
    $need_dotnet && warn "  - dotnet (builds the C# hook — Root itself is a .NET 10 app)"
    $need_node   && warn "  - nodejs (bundles the TypeScript plugin layer)"
    $need_npm    && warn "  - npm    (needed to install pnpm — often separate from nodejs)"
    $need_pnpm   && warn "  - pnpm   (TypeScript package manager)"
    echo ""

    local choice="1"
    if [[ "$AUTO_DEPS" != "true" ]]; then
        echo "  What do you want to do?"
        echo "    [1] Auto-install missing dependencies (may require sudo)"
        echo "    [2] Use pre-built artifacts instead  (RECOMMENDED — no build tools needed)"
        echo "    [3] Exit and install manually"
        echo ""
        printf "  Choice [1/2/3]: "
        read -r choice
    fi

    case "$choice" in
        2)
            log "Using pre-built artifacts."
            USE_PREBUILT=true
            return 0
            ;;
        3|q|Q|"")
            echo ""
            echo "  Install manually, then re-run — or use: $0 --prebuilt"
            exit 1
            ;;
    esac

    # --- Auto-install ---
    local pkg_mgr
    pkg_mgr=$(detect_pkg_manager)
    log "Detected package manager: ${pkg_mgr:-none}"

    # Install gcc + nodejs + npm via system package manager
    local sys_pkgs=()
    if $need_gcc;  then sys_pkgs+=("$(pkg_name_for gcc "$pkg_mgr")"); fi
    if $need_node; then sys_pkgs+=("$(pkg_name_for nodejs "$pkg_mgr")"); fi
    if $need_npm;  then sys_pkgs+=("$(pkg_name_for npm "$pkg_mgr")"); fi

    if [[ ${#sys_pkgs[@]} -gt 0 ]]; then
        log "Installing: ${sys_pkgs[*]}..."
        if ! install_sys_pkgs "$pkg_mgr" "${sys_pkgs[@]}"; then
            warn "System package install failed. Falling back to pre-built artifacts."
            USE_PREBUILT=true
            return 0
        fi
    fi

    # Install .NET 10 via Microsoft's install script
    if $need_dotnet; then
        if ! install_dotnet; then
            warn ".NET install failed. Falling back to pre-built artifacts."
            USE_PREBUILT=true
            return 0
        fi
    fi

    # Install pnpm via npm into ~/.local (no sudo needed)
    if $need_pnpm && command -v npm &>/dev/null; then
        log "Installing pnpm to ~/.local (no sudo required)..."
        npm install -g pnpm --prefix "$HOME/.local" 2>&1 || {
            warn "pnpm install failed. Falling back to pre-built artifacts."
            USE_PREBUILT=true
            return 0
        }
        # Make sure ~/.local/bin is in PATH for the rest of this script
        export PATH="$HOME/.local/bin:$PATH"
    fi

    # Final check — if anything is still missing, fall back
    local still_missing=()
    command -v gcc    &>/dev/null || still_missing+=("gcc")
    command -v dotnet &>/dev/null || still_missing+=("dotnet")
    command -v node   &>/dev/null || still_missing+=("node")
    command -v pnpm   &>/dev/null || still_missing+=("pnpm")

    if [[ ${#still_missing[@]} -gt 0 ]]; then
        warn "Still missing after install attempt: ${still_missing[*]}"
        warn "Falling back to pre-built artifacts."
        USE_PREBUILT=true
    fi
}

# ── Download pre-built artifacts ──

download_prebuilt() {
    resolve_latest_version

    local artifacts_url="https://github.com/The-Uprooted-Project/uprooted/releases/download/v${VERSION}/uprooted-linux-artifacts.tar.gz"

    log "Downloading pre-built artifacts (v$VERSION)..."

    if ! command -v curl &>/dev/null && ! command -v wget &>/dev/null; then
        die "Neither curl nor wget found. Install one and try again."
    fi

    local tmpdir
    tmpdir=$(mktemp -d)
    local tarball="$tmpdir/uprooted-linux-artifacts.tar.gz"

    if command -v curl &>/dev/null; then
        local http_code
        http_code=$(curl -sL -w "%{http_code}" -o "$tarball" --max-time 120 "$artifacts_url" 2>/dev/null) || http_code="000"

        if [[ "$http_code" == "404" ]]; then
            rm -rf "$tmpdir"
            error "Version v$VERSION not found on GitHub (HTTP 404)."
            error "  Check available releases: https://github.com/The-Uprooted-Project/uprooted/releases"
            die "  Run with --diagnose for more info."
        elif [[ "$http_code" != "200" && "$http_code" != "000" ]]; then
            rm -rf "$tmpdir"
            error "Failed to download artifacts (HTTP $http_code)."
            error "  URL: $artifacts_url"
            die "  Run with --diagnose for more info."
        elif [[ "$http_code" == "000" ]]; then
            rm -rf "$tmpdir"
            error "Network error — could not reach GitHub."
            die "  Check your internet connection and try again."
        fi
    else
        if ! wget -q -O "$tarball" "$artifacts_url" 2>/dev/null; then
            rm -rf "$tmpdir"
            error "Failed to download pre-built artifacts."
            error "  URL: $artifacts_url"
            die "  Run with --diagnose for more info."
        fi
    fi

    # Validate tarball (catch corrupt downloads before tar fails cryptically)
    if command -v file &>/dev/null; then
        if ! file "$tarball" | grep -qi "gzip"; then
            rm -rf "$tmpdir"
            error "Downloaded file is not a valid gzip archive (corrupt download?)."
            die "  Try again or download manually from: $artifacts_url"
        fi
    else
        # Fallback: check gzip magic bytes (1f 8b)
        local magic
        magic=$(od -A n -t x1 -N 2 "$tarball" 2>/dev/null | tr -d ' ')
        if [[ "$magic" != "1f8b" ]]; then
            rm -rf "$tmpdir"
            error "Downloaded file is not a valid gzip archive (corrupt download?)."
            die "  Try again or download manually from: $artifacts_url"
        fi
    fi

    mkdir -p "$INSTALL_DIR"
    tar -xzf "$tarball" -C "$INSTALL_DIR"
    chmod +x "$INSTALL_DIR/libuprooted_profiler.so"
    rm -rf "$tmpdir"

    # Verify all expected files exist
    local files=("libuprooted_profiler.so" "UprootedHook.dll" "UprootedHook.deps.json" "uprooted-preload.js" "uprooted.css")
    for f in "${files[@]}"; do
        if [[ ! -f "$INSTALL_DIR/$f" ]]; then
            die "Pre-built artifact missing after extraction: $f"
        fi
    done

    log "Pre-built artifacts deployed to $INSTALL_DIR"
}

# ── Build artifacts from source ──

build_artifacts() {
    local script_dir
    script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

    log "Building artifacts from source..."

    # Build TypeScript layer
    log "Building TypeScript layer..."
    if ! (cd "$script_dir" && pnpm install --frozen-lockfile && pnpm build); then
        error "TypeScript build failed."
        return 1
    fi

    # Build Hook DLL
    log "Building UprootedHook.dll..."
    if ! dotnet build "$script_dir/hook/UprootedHook.csproj" -c Release; then
        error "Hook DLL build failed."
        return 1
    fi

    # Build profiler .so
    log "Compiling libuprooted_profiler.so..."
    if ! gcc -shared -fPIC -O2 -o "$script_dir/libuprooted_profiler.so" "$script_dir/tools/uprooted_profiler_linux.c"; then
        error "Profiler build failed."
        return 1
    fi

    # Deploy
    mkdir -p "$INSTALL_DIR"

    cp "$script_dir/libuprooted_profiler.so" "$INSTALL_DIR/"
    cp "$script_dir/hook/bin/Release/net9.0/UprootedHook.dll" "$INSTALL_DIR/"
    cp "$script_dir/hook/bin/Release/net9.0/UprootedHook.deps.json" "$INSTALL_DIR/"
    cp "$script_dir/dist/uprooted-preload.js" "$INSTALL_DIR/"
    cp "$script_dir/dist/uprooted.css" "$INSTALL_DIR/"

    chmod +x "$INSTALL_DIR/libuprooted_profiler.so"

    log "Artifacts deployed to $INSTALL_DIR"
}

# ── Deploy artifacts (prebuilt or from source) ──

deploy_artifacts() {
    if [[ "$USE_PREBUILT" == true ]]; then
        download_prebuilt
    else
        # Auto-detect: if we're not inside the full repo, fall back to prebuilt
        local script_dir
        script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
        if [[ ! -f "$script_dir/package.json" ]] || [[ ! -d "$script_dir/hook" ]] || [[ ! -d "$script_dir/tools" ]]; then
            log "Standalone script detected (no repo found). Using pre-built artifacts."
            download_prebuilt
        else
            check_prereqs
            if ! build_artifacts; then
                warn "Build from source failed. Falling back to pre-built artifacts..."
                download_prebuilt
            fi
        fi
    fi
}

# ── Desktop environment detection ──

is_kde() {
    [[ "${XDG_CURRENT_DESKTOP:-}" == *KDE* ]] \
    || [[ "${KDE_SESSION_VERSION:-}" != "" ]] \
    || [[ "${KDE_FULL_SESSION:-}" == "true" ]]
}

# ── Set session-wide env vars (systemd environment.d) ──

set_env_vars() {
    local env_dir="$HOME/.config/environment.d"
    mkdir -p "$env_dir"

    cat > "$env_dir/uprooted.conf" << ENVCONF
# Uprooted -- remove this file or run the uninstaller to disable
# .NET 10+ (DOTNET_ prefix)
DOTNET_EnableDiagnostics=1
DOTNET_ENABLE_PROFILING=1
DOTNET_PROFILER=$PROFILER_GUID
DOTNET_PROFILER_PATH=$INSTALL_DIR/libuprooted_profiler.so
DOTNET_ReadyToRun=0
# Legacy (.NET 8/9)
CORECLR_ENABLE_PROFILING=1
CORECLR_PROFILER=$PROFILER_GUID
CORECLR_PROFILER_PATH=$INSTALL_DIR/libuprooted_profiler.so
ENVCONF
    log "Session env vars written to $env_dir/uprooted.conf"

    # KDE Plasma env script -- only written when running under KDE
    if is_kde; then
        local plasma_env_dir="$HOME/.config/plasma-workspace/env"
        mkdir -p "$plasma_env_dir"
        cat > "$plasma_env_dir/uprooted.sh" << PLASMAENV
#!/bin/sh
# Uprooted -- remove this file or run the uninstaller to disable
export DOTNET_EnableDiagnostics=1
export DOTNET_ENABLE_PROFILING=1
export DOTNET_PROFILER='$PROFILER_GUID'
export DOTNET_PROFILER_PATH='$INSTALL_DIR/libuprooted_profiler.so'
export DOTNET_ReadyToRun=0
export CORECLR_ENABLE_PROFILING=1
export CORECLR_PROFILER='$PROFILER_GUID'
export CORECLR_PROFILER_PATH='$INSTALL_DIR/libuprooted_profiler.so'
PLASMAENV
        chmod +x "$plasma_env_dir/uprooted.sh"
        log "KDE Plasma env script written to $plasma_env_dir/uprooted.sh"
    fi

    # Also add to ~/.profile as fallback for non-systemd sessions (X11, login shells)
    if ! grep -q "DOTNET_ENABLE_PROFILING" "$HOME/.profile" 2>/dev/null; then
        cat >> "$HOME/.profile" << PROFILE

# Uprooted (remove these lines to disable)
export DOTNET_EnableDiagnostics=1
export DOTNET_ENABLE_PROFILING=1
export DOTNET_PROFILER='$PROFILER_GUID'
export DOTNET_PROFILER_PATH='$INSTALL_DIR/libuprooted_profiler.so'
export DOTNET_ReadyToRun=0
export CORECLR_ENABLE_PROFILING=1
export CORECLR_PROFILER='$PROFILER_GUID'
export CORECLR_PROFILER_PATH='$INSTALL_DIR/libuprooted_profiler.so'
PROFILE
        log "Env vars appended to ~/.profile (login shell fallback)"
    else
        log "~/.profile already contains Uprooted env vars"
    fi

    warn "Log out and back in (or reboot) for env vars to take effect globally."
    warn "Or use the wrapper script below for immediate use."
}

# ── Create wrapper script ──

create_wrapper() {
    local wrapper="$INSTALL_DIR/launch-root.sh"
    # Bake in the AppImage dir so the wrapper can detect squashfs-root/ at
    # runtime — this means extraction order doesn't matter (extract before or
    # after install, the wrapper just works).
    local appimage_dir
    appimage_dir="$(dirname "$(realpath "$ROOT_PATH")")"

    {
        echo '#!/bin/bash'
        echo '# Uprooted launcher — sets CLR profiler env vars and launches Root.'
        echo '# Detects squashfs-root/ at runtime so extraction order does not matter.'
        echo ''
        echo "APPIMAGE='$ROOT_PATH'"
        echo "APPIMAGE_DIR='$appimage_dir'"
        echo ''
        echo '# Prefer extracted AppImage (required on systems without FUSE).'
        echo '# AppRun adds usr/bin/ to PATH and execs Root via the .desktop Exec= field.'
        echo '# Fall through to the AppImage itself if no extraction is found.'
        echo 'if [[ -f "$APPIMAGE_DIR/squashfs-root/AppRun" ]]; then'
        echo '    ROOT_EXEC="$APPIMAGE_DIR/squashfs-root/AppRun"'
        echo '    export APPDIR="$APPIMAGE_DIR/squashfs-root"'
        echo 'elif [[ -f "$APPIMAGE_DIR/squashfs-root/usr/bin/Root" ]]; then'
        echo '    ROOT_EXEC="$APPIMAGE_DIR/squashfs-root/usr/bin/Root"'
        echo '    export PATH="$APPIMAGE_DIR/squashfs-root/usr/bin:$PATH"'
        echo 'else'
        echo '    ROOT_EXEC="$APPIMAGE"'
        echo 'fi'
        echo ''
        echo '# .NET 10+ (DOTNET_ prefix)'
        echo 'export DOTNET_EnableDiagnostics=1'
        echo 'export DOTNET_ENABLE_PROFILING=1'
        echo "export DOTNET_PROFILER='$PROFILER_GUID'"
        echo "export DOTNET_PROFILER_PATH='$INSTALL_DIR/libuprooted_profiler.so'"
        echo 'export DOTNET_ReadyToRun=0'
        echo '# Legacy (.NET 8/9)'
        echo 'export CORECLR_ENABLE_PROFILING=1'
        echo "export CORECLR_PROFILER='$PROFILER_GUID'"
        echo "export CORECLR_PROFILER_PATH='$INSTALL_DIR/libuprooted_profiler.so'"
        echo ''
        echo 'exec "$ROOT_EXEC" "$@"'
    } > "$wrapper"
    chmod +x "$wrapper"
    log "Wrapper script created: $wrapper"
}

# ── Create .desktop file (opt-in via --desktop) ──

create_desktop_file() {
    local apps_dir="$HOME/.local/share/applications"
    mkdir -p "$apps_dir"

    cat > "$apps_dir/root-uprooted.desktop" << DESKTOP
[Desktop Entry]
Name=Root (Uprooted)
Comment=Root Communications with Uprooted mods
Exec=$INSTALL_DIR/launch-root.sh
Type=Application
Categories=Network;Chat;
Terminal=false
DESKTOP
    chmod +x "$apps_dir/root-uprooted.desktop"
    log ".desktop file created"
}

# ── Patch HTML files ──

patch_html() {
    if [[ ! -d "$PROFILE_DIR" ]]; then
        warn "Profile directory not found: $PROFILE_DIR"
        warn "Launch Root once to generate it, then re-run this script."
        return
    fi

    local patched=0
    local js_path="$INSTALL_DIR/uprooted-preload.js"
    local css_path="$INSTALL_DIR/uprooted.css"

    # Find HTML files
    local html_files=()
    if [[ -f "$PROFILE_DIR/WebRtcBundle/index.html" ]]; then
        html_files+=("$PROFILE_DIR/WebRtcBundle/index.html")
    fi
    for app_dir in "$PROFILE_DIR/RootApps"/*/; do
        if [[ -f "${app_dir}index.html" ]]; then
            html_files+=("${app_dir}index.html")
        fi
    done

    if [[ ${#html_files[@]} -eq 0 ]]; then
        warn "No HTML files found to patch."
        warn "Launch Root once, then re-run this script."
        return
    fi

    local script_tag="<script src=\"file://$js_path\"></script>"
    local css_tag="<link rel=\"stylesheet\" href=\"file://$css_path\">"
    local marker_start="<!-- uprooted:start -->"
    local marker_end="<!-- uprooted:end -->"

    for html in "${html_files[@]}"; do
        if grep -qE "(uprooted:start|uprooted-preload|<!-- uprooted -->)" "$html" 2>/dev/null; then
            log "Already patched: $(basename "$(dirname "$html")")/index.html"
            continue
        fi

        # Backup original
        cp "$html" "${html}.uprooted.bak"

        # Build injection block with markers
        local injection="${marker_start}\n    ${css_tag}\n    ${script_tag}\n    ${marker_end}"

        # Insert before </head>
        sed -i "s|</head>|    ${injection}\n  </head>|" "$html"
        patched=$((patched + 1))
        log "Patched: $(basename "$(dirname "$html")")/index.html"
    done

    log "$patched HTML file(s) patched"
}

# ── Strip HTML patches (used by repair) ──

strip_html_patches() {
    if [[ ! -d "$PROFILE_DIR" ]]; then
        return
    fi

    local html_files=()
    if [[ -f "$PROFILE_DIR/WebRtcBundle/index.html" ]]; then
        html_files+=("$PROFILE_DIR/WebRtcBundle/index.html")
    fi
    for app_dir in "$PROFILE_DIR/RootApps"/*/; do
        if [[ -f "${app_dir}index.html" ]]; then
            html_files+=("${app_dir}index.html")
        fi
    done

    for html in "${html_files[@]}"; do
        if grep -qE "(uprooted:start|uprooted-preload|<!-- uprooted -->|__UPROOTED_SETTINGS__)" "$html" 2>/dev/null; then
            local tmp="${html}.tmp"
            local inside_block=false
            while IFS= read -r line; do
                if [[ "$line" == *"<!-- uprooted:start -->"* ]]; then
                    inside_block=true
                    continue
                fi
                if [[ "$line" == *"<!-- uprooted:end -->"* ]]; then
                    inside_block=false
                    continue
                fi
                if [[ "$inside_block" == true ]]; then
                    continue
                fi
                if [[ "$line" == *"<!-- uprooted -->"* ]]; then
                    continue
                fi
                if [[ "$line" == *"uprooted-preload"* ]] && [[ "$line" == *"<script"* || "$line" == *"</script"* ]]; then
                    continue
                fi
                if [[ "$line" == *"uprooted.css"* ]] && [[ "$line" == *"<link"* ]]; then
                    continue
                fi
                if [[ "$line" == *"__UPROOTED_SETTINGS__"* ]] && [[ "$line" == *"<script"* ]]; then
                    continue
                fi
                echo "$line"
            done < "$html" > "$tmp"
            mv "$tmp" "$html"
            log "  Stripped: $(basename "$(dirname "$html")")/index.html"
        fi
    done
}

# ── Repair function ──

run_repair() {
    echo ""
    echo "  Uprooted Repair v$VERSION"
    echo "  ────────────────────────"
    echo ""

    find_root
    resolve_root_exec

    # Re-deploy artifacts
    log "Re-deploying artifacts..."
    deploy_artifacts

    # Re-set env vars
    set_env_vars
    create_wrapper

    if [[ "$CREATE_DESKTOP" == true ]]; then
        create_desktop_file
    fi

    # Strip existing patches and re-apply
    log "Stripping existing HTML patches..."
    strip_html_patches

    log "Re-applying HTML patches..."
    patch_html

    echo ""
    echo -e "  ${YELLOW}┌──────────────────────────────────────────────────────────────┐${NC}"
    echo -e "  ${YELLOW}│${NC}"
    echo -e "  ${YELLOW}│${NC}  ${GREEN}Repair complete!${NC}"
    echo -e "  ${YELLOW}│${NC}"
    echo -e "  ${YELLOW}│${NC}  You ${BOLD}MUST${NC} log out and log back in for changes to take effect."
    echo -e "  ${YELLOW}│${NC}"
    echo -e "  ${YELLOW}│${NC}  Or launch immediately:"
    echo -e "  ${YELLOW}│${NC}    ${GREEN}$INSTALL_DIR/launch-root.sh${NC}"
    echo -e "  ${YELLOW}│${NC}"
    echo -e "  ${YELLOW}│${NC}  Trouble? Run: ${GREEN}$0 --diagnose${NC}"
    echo -e "  ${YELLOW}│${NC}"
    echo -e "  ${YELLOW}└──────────────────────────────────────────────────────────────┘${NC}"
    echo ""
}

# ── Main ──

if [[ "$MODE" == "diagnose" ]]; then
    run_diagnose
    exit 0
fi

if [[ "$MODE" == "uninstall" ]]; then
    run_uninstall
    exit 0
fi

if [[ "$MODE" == "repair" ]]; then
    run_repair
    exit 0
fi

echo ""
echo "  Uprooted Linux Installer v$VERSION"
echo "  ─────────────────────────────────"
echo ""

find_root
resolve_root_exec
deploy_artifacts
set_env_vars
create_wrapper

if [[ "$CREATE_DESKTOP" == true ]]; then
    create_desktop_file
fi

patch_html

echo ""
echo -e "  ${YELLOW}┌──────────────────────────────────────────────────────────────┐${NC}"
echo -e "  ${YELLOW}│${NC}"
echo -e "  ${YELLOW}│${NC}  ${GREEN}Installation complete!${NC}"
echo -e "  ${YELLOW}│${NC}"
echo -e "  ${YELLOW}│${NC}  You ${BOLD}MUST${NC} log out and log back in for Uprooted to activate."
echo -e "  ${YELLOW}│${NC}"
echo -e "  ${YELLOW}│${NC}  Or launch immediately:"
echo -e "  ${YELLOW}│${NC}    ${GREEN}$INSTALL_DIR/launch-root.sh${NC}"
echo -e "  ${YELLOW}│${NC}"
echo -e "  ${YELLOW}│${NC}  Trouble? Run: ${GREEN}$0 --diagnose${NC}"
echo -e "  ${YELLOW}│${NC}"
echo -e "  ${YELLOW}└──────────────────────────────────────────────────────────────┘${NC}"
echo ""
