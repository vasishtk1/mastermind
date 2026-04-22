#!/bin/bash
# Copies model weights from the local Cactus checkout into the app bundle so
# Copy Bundle Resources does not need multi‑GB folders checked into git.
set -euo pipefail

CACTUS_WEIGHTS="${SRCROOT}/../cactus/weights"
APP_ROOT="${CODESIGNING_FOLDER_PATH:-}"
if [[ -z "$APP_ROOT" ]]; then
  APP_ROOT="${TARGET_BUILD_DIR}/${FULL_PRODUCT_NAME}"
fi
if [[ ! -d "$APP_ROOT" ]]; then
  echo "warning: App bundle not found at $APP_ROOT; skipping weight copy."
  exit 0
fi

DEST="${APP_ROOT}/weights"
mkdir -p "$DEST"

copy_one() {
  local name="$1"
  local required="${2:-0}"
  local src="${CACTUS_WEIGHTS}/${name}"
  if [[ -d "$src" ]]; then
    rm -rf "${DEST}/${name}"
    if ditto "$src" "${DEST}/${name}"; then
      echo "Copied weights: ${name}"
    else
      rm -rf "${DEST:?}/${name}" || true
      echo "warning: Failed to copy ${name} (likely low disk space)."
      if [[ "$required" == "1" ]]; then
        echo "warning: Required model ${name} is unavailable in this build."
      fi
    fi
  else
    echo "warning: Missing ${src}"
    case "${name}" in
      functiongemma-270m-it) echo "  → cactus download google/functiongemma-270m-it" ;;
      parakeet-tdt-0.6b-v3) echo "  → cactus download nvidia/parakeet-tdt-0.6b-v3" ;;
    esac
  fi
}

copy_one "functiongemma-270m-it" 1

# Parakeet can be very large; skip by default to avoid script-phase failures on low disk.
# Set EMBER_COPY_PARAKEET_WEIGHTS=1 in Build Settings -> Environment Variables if needed.
if [[ "${EMBER_COPY_PARAKEET_WEIGHTS:-0}" == "1" ]]; then
  copy_one "parakeet-tdt-0.6b-v3" 0
else
  echo "Skipping parakeet-tdt-0.6b-v3 copy (set EMBER_COPY_PARAKEET_WEIGHTS=1 to enable)."
fi
