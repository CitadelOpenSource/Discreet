# Troubleshooting — Desktop App (Tauri)

## Build Errors

### "feature `shell-open` does not exist"
Tauri v2 moved shell to a plugin. In `desktop/src-tauri/Cargo.toml`:
```toml
tauri = { version = "2", features = [] }    # NOT ["shell-open"]
tauri-plugin-shell = "2"                     # handles shell operations
```

### "icons/icon.ico not found"
Tauri needs icon files for Windows resource embedding. Ensure these exist in `desktop/src-tauri/icons/`:
- `icon.png` (256x256)
- `icon.ico` (multi-resolution)
- `32x32.png`
- `128x128.png`

Generate from a source PNG: `cargo tauri icon path/to/icon.png`

### "no method named `menu` found for TrayIcon"
Tauri 2.10 removed `.menu()` getter from TrayIcon. Use the simplified tray pattern — build menu and tray in `.setup()`, handle events via `.on_menu_event()`.

### "Waiting for your frontend dev server"
`cargo tauri dev` expects `http://localhost:3000/next/` to respond. Start the Rust server first:
```powershell
# Terminal 1:
cd C:\dev\Discreet2
cargo run

# Terminal 2:
cd C:\dev\Discreet2\desktop
cargo tauri dev
```

### "frontendDist" path wrong in production build
Path resolves from `desktop/src-tauri/`. Must be `../../client/dist` — two directories up.

### Window close doesn't quit the app
By design — Discreet minimizes to system tray on close. Right-click the tray icon → Quit.

## Development Workflow

```
cargo tauri dev     # Hot-reload, points at localhost:3000/next/
cargo tauri build   # Production .msi/.dmg/.AppImage
```

Production build requires `client/dist/` to exist:
```powershell
cd client && npm run build && cd ..
cd desktop && cargo tauri build
```

## Architecture
- Tauri v2 wraps the Vite web client in a native WebView
- ~15MB binary (vs Electron's ~150MB)
- System tray with Show/Quit
- Native OS notifications via `tauri-plugin-notification`
- Close-to-tray behavior (hide instead of quit)
