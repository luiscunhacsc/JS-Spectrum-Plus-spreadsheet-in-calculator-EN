#!/bin/sh
set -eu

APP_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
APP="$APP_DIR/index.html"

if [ ! -f "$APP" ]; then
    echo "Could not find index.html next to this launcher." >&2
    exit 1
fi

if ! command -v xdg-open >/dev/null 2>&1; then
    echo "xdg-open is required to launch the emulator in your default browser." >&2
    exit 1
fi

if ! xdg-open "$APP"; then
    echo "Could not open the emulator. Check that a default browser is installed." >&2
    exit 1
fi
