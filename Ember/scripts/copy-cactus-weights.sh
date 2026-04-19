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
  local src="${CACTUS_WEIGHTS}/${name}"
  if [[ -d "$src" ]]; then
    rm -rf "${DEST}/${name}"
    ditto "$src" "${DEST}/${name}"
    echo "Copied weights: ${name}"
  else
    echo "warning: Missing ${src}"
    case "${name}" in
      functiongemma-270m-it) echo "  → cactus download google/functiongemma-270m-it" ;;
      parakeet-tdt-0.6b-v3) echo "  → cactus download nvidia/parakeet-tdt-0.6b-v3" ;;
    esac
  fi
}

copy_one "functiongemma-270m-it"
copy_one "parakeet-tdt-0.6b-v3"
