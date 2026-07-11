#!/usr/bin/env bash
# size_check.sh — run a project size-budget check.
# Prefers the AMS7-specific `tools/check_idf_size_budget.py` if present, else falls back to `idf.py size`.
# Exits 0 on pass, 1 on size violation (AMS7 budget tool) or build failure (fallback).
# Usage: bash scripts/size_check.sh [--project-dir DIR] [--min-iram-remain BYTES] [--min-dram-remain BYTES]

set -euo pipefail

PROJECT_DIR="."
MIN_IRAM_REMAIN=""
MIN_DRAM_REMAIN=""

while [[ $# -gt 0 ]]; do
    case "$1" in
        --project-dir)
            PROJECT_DIR="${2:?--project-dir requires a value}"
            shift 2
            ;;
        --min-iram-remain)
            MIN_IRAM_REMAIN="${2:?--min-iram-remain requires a value}"
            shift 2
            ;;
        --min-dram-remain)
            MIN_DRAM_REMAIN="${2:?--min-dram-remain requires a value}"
            shift 2
            ;;
        -h|--help)
            sed -n '2,6p' "$0" | sed 's/^# \?//'
            exit 0
            ;;
        *)
            echo "size_check.sh: unknown argument: $1" >&2
            exit 2
            ;;
    esac
done

# Resolve absolute path so the AMS7 budget tool's argparse sees a clean --project-dir.
if [[ -d "${PROJECT_DIR}" ]]; then
    PROJECT_DIR="$(cd "${PROJECT_DIR}" && pwd)"
fi

AMS7_BUDGET="${PROJECT_DIR}/tools/check_idf_size_budget.py"

if [[ -f "${AMS7_BUDGET}" ]]; then
    # AMS7-specific path: uses hard thresholds from tools/check_idf_size_budget.py.
    cmd=(python3 "${AMS7_BUDGET}" --project-dir "${PROJECT_DIR}")
    if [[ -n "${MIN_IRAM_REMAIN}" ]]; then
        cmd+=(--min-iram-remain "${MIN_IRAM_REMAIN}")
    fi
    if [[ -n "${MIN_DRAM_REMAIN}" ]]; then
        cmd+=(--min-dram-remain "${MIN_DRAM_REMAIN}")
    fi
    echo "size_check: running AMS7 budget tool: ${cmd[*]}"
    if "${cmd[@]}"; then
        exit 0
    else
        echo "size_check: AMS7 size budget failed" >&2
        exit 1
    fi
fi

# Fallback: plain idf.py size. This prints IRAM/DRAM/flash but does NOT enforce
# a hard threshold — exit code is whatever idf.py returns.
if ! command -v idf.py >/dev/null 2>&1; then
    echo "size_check: idf.py not on PATH and no AMS7 budget tool found." >&2
    echo "size_check: source esp/esp-idf/export.sh first." >&2
    exit 1
fi

echo "size_check: no AMS7 budget tool; running 'idf.py size' as a fallback."
if idf.py -C "${PROJECT_DIR}" size; then
    exit 0
else
    echo "size_check: idf.py size failed" >&2
    exit 1
fi
