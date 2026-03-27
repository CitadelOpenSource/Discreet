#!/usr/bin/env bash
# check-glassworm.sh — Pre-commit scan for invisible Unicode supply chain attacks.
#
# Detects the Glassworm and Shai-Hulud threat families: invisible PUA/variation
# selector characters embedded in source files to hide malicious payloads.
# 433+ compromised npm packages detected as of March 2026.
#
# Scanned ranges:
#   U+FE00–U+FE0F    Variation selectors (16 chars)
#   U+E0100–U+E01EF  Supplementary variation selectors (240 chars)
#   U+200B           Zero-width space
#   U+FEFF           BOM in non-BOM position (not byte 0)
#
# Usage:
#   bash scripts/check-glassworm.sh          # manual scan
#   bash scripts/install-hooks.sh            # install as pre-commit hook
#
# Exit codes:
#   0 — all files clean
#   1 — invisible characters detected (commit should be blocked)

set -euo pipefail

SCAN_DIRS="client/src discreet-kernel/src src"
EXTENSIONS="-name '*.ts' -o -name '*.tsx' -o -name '*.js' -o -name '*.rs'"

FOUND=0

# Use python3 for reliable Unicode detection across platforms.
# The script reads each file, checks every character against the threat ranges,
# and reports the filename + line number + codepoint of any match.
python3 -c "
import sys, os

THREAT_RANGES = set()
# U+FE00 to U+FE0F — variation selectors
for cp in range(0xFE00, 0xFE10):
    THREAT_RANGES.add(cp)
# U+E0100 to U+E01EF — supplementary variation selectors
for cp in range(0xE0100, 0xE01F0):
    THREAT_RANGES.add(cp)
# U+200B — zero-width space
THREAT_RANGES.add(0x200B)
# U+FEFF — BOM (only suspicious when NOT at byte position 0)
BOM = 0xFEFF

scan_dirs = '${SCAN_DIRS}'.split()
extensions = {'.ts', '.tsx', '.js', '.rs'}
found = 0

for scan_dir in scan_dirs:
    if not os.path.isdir(scan_dir):
        continue
    for root, dirs, files in os.walk(scan_dir):
        # Skip build artifacts and dependencies
        dirs[:] = [d for d in dirs if d not in ('node_modules', 'target', 'dist', 'pkg')]
        for fname in files:
            ext = os.path.splitext(fname)[1]
            if ext not in extensions:
                continue
            fpath = os.path.join(root, fname)
            try:
                with open(fpath, 'r', encoding='utf-8', errors='replace') as f:
                    for line_num, line in enumerate(f, 1):
                        for col, ch in enumerate(line):
                            cp = ord(ch)
                            if cp in THREAT_RANGES:
                                print(f'  THREAT: {fpath}:{line_num}:{col} — U+{cp:04X} ({chr(cp)!r})')
                                found += 1
                            elif cp == BOM and not (line_num == 1 and col == 0):
                                print(f'  THREAT: {fpath}:{line_num}:{col} — U+FEFF (BOM in non-BOM position)')
                                found += 1
            except Exception as e:
                print(f'  WARNING: Could not read {fpath}: {e}', file=sys.stderr)

if found > 0:
    print(f'')
    print(f'Glassworm scan: FAILED — {found} invisible character(s) detected')
    print(f'These characters can hide malicious payloads in source files.')
    print(f'Remove them before committing.')
    sys.exit(1)
else:
    print('Glassworm scan: clean')
    sys.exit(0)
" || FOUND=$?

exit ${FOUND}
