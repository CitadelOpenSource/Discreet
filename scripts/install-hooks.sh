#!/usr/bin/env bash
# install-hooks.sh — Install Glassworm pre-commit hook.
#
# Copies the invisible-Unicode scanner into .git/hooks/pre-commit so it
# runs automatically before every git commit. If the scan finds threat
# characters, the commit is blocked.
#
# Usage:
#   bash scripts/install-hooks.sh
#
# Run this once after cloning the repository.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
HOOK_SRC="${REPO_ROOT}/scripts/check-glassworm.sh"
HOOK_DST="${REPO_ROOT}/.git/hooks/pre-commit"

if [ ! -f "${HOOK_SRC}" ]; then
  echo "Error: ${HOOK_SRC} not found." >&2
  exit 1
fi

if [ ! -d "${REPO_ROOT}/.git/hooks" ]; then
  echo "Error: .git/hooks directory not found. Are you in a git repo?" >&2
  exit 1
fi

# If a pre-commit hook already exists, back it up
if [ -f "${HOOK_DST}" ]; then
  cp "${HOOK_DST}" "${HOOK_DST}.backup"
  echo "Existing pre-commit hook backed up to pre-commit.backup"
fi

cp "${HOOK_SRC}" "${HOOK_DST}"
chmod +x "${HOOK_DST}"
chmod +x "${HOOK_SRC}"

echo "Pre-commit hook installed successfully."
echo "The Glassworm scanner will run before every commit."
echo "To bypass in emergencies: git commit --no-verify"
