// Prevents an additional console window on Windows in release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::fs;
use std::path::PathBuf;
use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Manager,
};

// ── Proxy configuration ─────────────────────────────────────────────────

#[derive(serde::Deserialize, serde::Serialize, Default)]
struct ProxyConfig {
    proxy_type: String, // "none", "socks5", "http"
    host: String,
    port: String,
}

fn proxy_config_path() -> PathBuf {
    let mut p = dirs::config_dir().unwrap_or_else(|| PathBuf::from("."));
    p.push("discreet");
    p.push("proxy.json");
    p
}

fn load_proxy_config() -> ProxyConfig {
    let path = proxy_config_path();
    fs::read_to_string(&path)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

/// Apply proxy to WebView2 via environment variable (must be called before
/// tauri::Builder::default()). On Windows, WebView2 reads
/// WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS for Chromium flags.
fn apply_proxy_env() {
    let cfg = load_proxy_config();
    let url = match cfg.proxy_type.as_str() {
        "socks5" if !cfg.host.is_empty() => {
            let port = if cfg.port.is_empty() { "1080" } else { &cfg.port };
            format!("socks5://{}:{}", cfg.host, port)
        }
        "http" if !cfg.host.is_empty() => {
            let port = if cfg.port.is_empty() { "8080" } else { &cfg.port };
            format!("http://{}:{}", cfg.host, port)
        }
        _ => return,
    };
    std::env::set_var(
        "WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS",
        format!("--proxy-server={}", url),
    );
}

#[tauri::command]
fn set_proxy_config(proxy_type: String, host: String, port: String) -> Result<(), String> {
    let cfg = ProxyConfig { proxy_type, host, port };
    let path = proxy_config_path();
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let json = serde_json::to_string_pretty(&cfg).map_err(|e| e.to_string())?;
    fs::write(&path, json).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn get_proxy_config() -> ProxyConfig {
    load_proxy_config()
}

// ── Tauri command: native OS notification ──────────────────────────────

#[tauri::command]
fn send_notification(app: tauri::AppHandle, title: String, body: String) {
    use tauri_plugin_notification::NotificationExt;
    let _ = app
        .notification()
        .builder()
        .title(&title)
        .body(&body)
        .show();
}

// ── Helpers ─────────────────────────────────────────────────────────────

fn show_window(app: &tauri::AppHandle) {
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.show();
        let _ = win.set_focus();
        let _ = win.unminimize();
    }
}

// ── Entry point ─────────────────────────────────────────────────────────

fn main() {
    // Apply proxy before webview creation — requires restart to change
    apply_proxy_env();

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_notification::init())
        .invoke_handler(tauri::generate_handler![send_notification, set_proxy_config, get_proxy_config])
        .setup(|app| {
            // Build tray menu
            let show = MenuItem::with_id(app, "show", "Show Window", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let sep  = PredefinedMenuItem::separator(app)?;
            let menu = Menu::with_items(app, &[&show, &sep, &quit])?;

            // Build tray icon
            TrayIconBuilder::new()
                .icon(app.default_window_icon().cloned().unwrap())
                .menu(&menu)
                .tooltip("Discreet")
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        show_window(tray.app_handle());
                    }
                })
                .on_menu_event(|app, event| match event.id().as_ref() {
                    "show" => show_window(app),
                    "quit" => app.exit(0),
                    _ => {}
                })
                .build(app)?;

            // Override close button: hide to tray instead of quitting
            if let Some(win) = app.get_webview_window("main") {
                let win_clone = win.clone();
                win.on_window_event(move |event| {
                    if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                        api.prevent_close();
                        let _ = win_clone.hide();
                    }
                });
            }

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Discreet desktop application");
}
