mod keep_awake;
mod secure_store;
mod vpn_check;

use keep_awake::KeepAwakeState;
use tauri::{
    menu::{CheckMenuItem, Menu, MenuItem},
    tray::TrayIconBuilder,
    AppHandle, Manager, RunEvent, WebviewUrl, WebviewWindowBuilder,
};
use std::sync::atomic::{AtomicU64, Ordering};

static NEXT_EXTERNAL_WINDOW_ID: AtomicU64 = AtomicU64::new(1);

#[tauri::command]
fn open_external_window(app: AppHandle, url: String) -> Result<(), String> {
    let parsed = url::Url::parse(&url).map_err(|error| format!("Invalid URL: {error}"))?;
    if parsed.scheme() != "https" && parsed.scheme() != "http" {
        return Err("Only HTTP and HTTPS links can be opened".to_string());
    }

    let host = parsed.host_str().unwrap_or("External link");
    let label = format!(
        "external-{}",
        NEXT_EXTERNAL_WINDOW_ID.fetch_add(1, Ordering::Relaxed)
    );

    WebviewWindowBuilder::new(&app, &label, WebviewUrl::External(parsed))
        .title(host)
        .inner_size(1180.0, 820.0)
        .min_inner_size(640.0, 480.0)
        .resizable(true)
        .center()
        .build()
        .map(|_| ())
        .map_err(|error| format!("Could not create external window: {error}"))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .manage(KeepAwakeState::default())
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(win) = app.get_webview_window("main") {
                let _ = win.show();
                let _ = win.unminimize();
                let _ = win.set_focus();
            }
        }))
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            // System Tray with quick controls (Show, Toggle Keep-Awake, Quit)
            let show_item = MenuItem::with_id(app, "show", "Открыть Huseynovlar Terminal", true, None::<&str>)?;
            let awake_item = CheckMenuItem::with_id(app, "toggle_awake", "Не гасить экран (Keep Awake)", true, false, None::<&str>)?;
            let quit_item = MenuItem::with_id(app, "quit", "Выход", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show_item, &awake_item, &quit_item])?;

            let awake_item_for_events = awake_item.clone();
            let mut tray_builder = TrayIconBuilder::new()
                .menu(&menu)
                .tooltip("Huseynovlar Terminal")
                .on_menu_event(move |app, event| match event.id.as_ref() {
                    "show" => {
                        if let Some(win) = app.get_webview_window("main") {
                            let _ = win.show();
                            let _ = win.unminimize();
                            let _ = win.set_focus();
                        }
                    }
                    "toggle_awake" => {
                        let st = app.state::<KeepAwakeState>();
                        let next = !st.is_enabled();
                        match st.set(next) {
                            Ok(enabled) => {
                                let _ = awake_item_for_events.set_checked(enabled);
                            }
                            Err(error) => {
                                let _ = awake_item_for_events.set_checked(st.is_enabled());
                                eprintln!("Keep Awake toggle failed: {error}");
                            }
                        }
                    }
                    "quit" => {
                        app.state::<KeepAwakeState>().release_all();
                        app.exit(0);
                    }
                    _ => {}
                });

            if let Some(icon) = app.default_window_icon() {
                tray_builder = tray_builder.icon(icon.clone());
            }
            let _ = tray_builder.build(app)?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            keep_awake::set_keep_awake,
            keep_awake::get_keep_awake,
            vpn_check::check_vpn_status,
            secure_store::secure_store_set,
            secure_store::secure_store_get,
            secure_store::secure_store_delete,
            open_external_window,
        ])
        .build(tauri::generate_context!())
        .expect("error while building Huseynovlar Terminal desktop");

    app.run(|app_handle, event| {
        if let RunEvent::Exit = event {
            app_handle.state::<KeepAwakeState>().release_all();
        }
    });
}
