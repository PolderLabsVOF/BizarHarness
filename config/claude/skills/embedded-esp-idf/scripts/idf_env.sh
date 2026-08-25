#!/usr/bin/env bash
# idf_env.sh — print the source line for the ESP-IDF environment and verify idf.py is reachable.
# Run as: bash scripts/idf_env.sh
# Exits 0 if `idf.py` is on PATH after a (dry-run) env probe; 1 otherwise.

set -euo pipefail

# Find the repo root from the skill directory. We resolve the script's real
# path so it works whether invoked from the skill dir or anywhere else.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Heuristic: the project root is two levels up from scripts/ inside the skill.
# Skill layout: <repo>/scripts/<this>.sh  →  PROJECT_ROOT is SCRIPT_DIR's parent.
PROJECT_ROOT_DEFAULT="$(cd "${SCRIPT_DIR}/.." && pwd)"

PROJECT_ROOT="${PROJECT_ROOT:-${PROJECT_ROOT_DEFAULT}}"

# The vendored ESP-IDF is conventionally at <repo>/esp/esp-idf.
IDF_DIR_CANDIDATE="${PROJECT_ROOT}/esp/esp-idf"
EXPORT_LINE="source ${IDF_DIR_CANDIDATE}/export.sh"

if [[ ! -d "${IDF_DIR_CANDIDATE}" ]]; then
    echo "Run: ${EXPORT_LINE}    # (note: esp-idf not found at ${IDF_DIR_CANDIDATE})" >&2
    echo "info: set PROJECT_ROOT to override the discovery path" >&2
    echo "info: set IDF_PATH to a different ESP-IDF checkout" >&2
    exit 1
fi

if [[ ! -x "${IDF_DIR_CANDIDATE}/tools/idf.py" ]] && [[ ! -f "${IDF_DIR_CANDIDATE}/tools/idf.py" ]]; then
    echo "Run: ${EXPORT_LINE}    # (note: idf.py not present at expected path)" >&2
    exit 1
fi

# Probe: source the env in a subshell, then check whether idf.py is on PATH.
# We avoid printing the env's own banner by sending output to /dev/null.
if (
    set +e
    # shellcheck disable=SC1091
    source "${IDF_DIR_CANDIDATE}/export.sh" >/dev/null 2>&1
    command -v idf.py >/dev/null 2>&1
) ; then
    echo "Run: ${EXPORT_LINE}"
    exit 0
else
    echo "Run: ${EXPORT_LINE}    # (env probe failed; check IDF_PATH and Python)" >&2
    exit 1
fi
