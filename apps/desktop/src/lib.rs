mod keep_awake;
mod secure_store;
mod vpn_check;

use keep_awake::KeepAwakeState;
use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    Manager, RunEvent,
};

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
            let awake_item = MenuItem::with_id(app, "toggle_awake", "Не гасить экран (Keep Awake)", true, None::<&str>)?;
            let quit_item = MenuItem::with_id(app, "quit", "Выход", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show_item, &awake_item, &quit_item])?;

            let mut tray_builder = TrayIconBuilder::new()
                .menu(&menu)
                .tooltip("Huseynovlar Terminal")
                .on_menu_event(|app, event| match event.id.as_ref() {
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
                        let _ = st.set(next);
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
        ])
        .build(tauri::generate_context!())
        .expect("error while building Huseynovlar Terminal desktop");

    app.run(|app_handle, event| {
        if let RunEvent::Exit = event {
            app_handle.state::<KeepAwakeState>().release_all();
        }
    });
}
