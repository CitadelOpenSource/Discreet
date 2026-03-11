# Icons

Place a high-resolution source image (at least 1024x1024 PNG or SVG) in this
directory, then run the Tauri icon generator to produce all required platform
sizes automatically:

```bash
# From the desktop/ directory
cargo tauri icon path/to/source-icon.png
```

This generates:
- `icon.png` (general fallback, 32x32 / 128x128 / 256x256)
- `icon.ico` (Windows — multi-resolution)
- `icon.icns` (macOS)
- `32x32.png`, `128x128.png`, `128x128@2x.png` (Linux)

The SVG source for the Discreet logo lives at client-next/src/assets/ (if
present) or can be exported from the UI design files.
