#!/usr/bin/env bash
# compute-sri.sh — Compute Subresource Integrity hashes for security-critical assets.
#
# Run after `npm run build` to generate SHA-384 hashes for:
#   1. The kernel Web Worker script (kernel-worker.ts compiled output)
#   2. The WASM binary (discreet-kernel compiled output)
#
# Usage:
#   cd client && npm run build && cd ..
#   bash scripts/compute-sri.sh
#
# Output: SHA-384 integrity attributes for each asset, suitable for
# <script integrity="..."> or Worker({ integrity: ... }) if supported.
#
# Limitation: SRI on Worker scripts (new Worker(url, { integrity: ... }))
# is not universally supported across browsers as of 2026. The Worker
# constructor's `integrity` option is defined in the HTML spec but browser
# support is incomplete (Chrome 109+, no Firefox/Safari as of early 2026).
# See: https://developer.mozilla.org/en-US/docs/Web/API/Worker/Worker
#
# Primary defense for Worker integrity is strict CSP: worker-src 'self'.
# SRI hashes generated here serve two purposes:
#   1. CI pipeline verification — compare hashes across builds to detect
#      unexpected changes in security-critical assets.
#   2. Future browser support — once Worker SRI is universal, these
#      hashes can be wired into the Worker constructor call.

set -euo pipefail

DIST_DIR="client/dist"

if [ ! -d "$DIST_DIR" ]; then
  echo "Error: $DIST_DIR not found. Run 'cd client && npm run build' first." >&2
  exit 1
fi

compute_hash() {
  openssl dgst -sha384 -binary "$1" | openssl base64 -A
}

echo "=== Subresource Integrity Hashes ==="
echo ""

# Find kernel worker script(s)
found_worker=0
for f in "$DIST_DIR"/assets/*worker*.js; do
  [ -f "$f" ] || continue
  hash=$(compute_hash "$f")
  echo "Worker: $(basename "$f")"
  echo "  integrity=\"sha384-${hash}\""
  echo ""
  found_worker=1
done

# Find WASM binaries
found_wasm=0
for f in "$DIST_DIR"/assets/*.wasm; do
  [ -f "$f" ] || continue
  hash=$(compute_hash "$f")
  echo "WASM:   $(basename "$f")"
  echo "  integrity=\"sha384-${hash}\""
  echo ""
  found_wasm=1
done

if [ "$found_worker" -eq 0 ]; then
  echo "Warning: No worker JS files found in $DIST_DIR/assets/" >&2
fi
if [ "$found_wasm" -eq 0 ]; then
  echo "Warning: No WASM files found in $DIST_DIR/assets/" >&2
fi

echo "=== Done ==="
echo ""
echo "Note: Worker SRI (integrity option in Worker constructor) has limited"
echo "browser support. Primary defense: CSP worker-src 'self' restricts"
echo "Worker script origins to same-origin only."
