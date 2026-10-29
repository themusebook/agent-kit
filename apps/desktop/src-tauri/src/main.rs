#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use agent_kit_desktop_lib::{route_popup, Popup};
use tauri::webview::{NewWindowResponse, WebviewWindowBuilder};
use tauri::WebviewUrl;

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
                .title("musebook agents")
                .inner_size(1100.0, 760.0)
                .min_inner_size(720.0, 520.0)
                .on_new_window(|url, _features| {
                    if let Popup::External(u) = route_popup(&url) {
                        let _ = tauri_plugin_opener::open_url(u, None::<&str>);
                    }
                    NewWindowResponse::Deny
                })
                .build()?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running agent-kit desktop");
}
