mod desktop;

#[cfg(feature = "shell")]
use desktop::{DesktopState, shell};
#[cfg(feature = "shell")]
use tauri::Manager;

#[cfg(feature = "shell")]
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let config_dir = app.path().app_config_dir()?;
            app.manage(DesktopState::new(config_dir));
            Ok(())
        })
        .register_uri_scheme_protocol("postframe-asset", |context, request| {
            let state = context.app_handle().state::<DesktopState>();
            shell::protocol_response(&request, &state)
        })
        .invoke_handler(tauri::generate_handler![
            shell::desktop_status,
            shell::create_library,
            shell::open_library,
            shell::close_library,
            shell::reveal_library,
            shell::asset_source,
            shell::asset_exists,
            shell::begin_asset_write,
            shell::begin_export_write,
            shell::append_asset_write,
            shell::commit_asset_write,
            shell::abort_asset_write,
            shell::delete_assets,
            shell::durable_usage,
            shell::list_assets,
            shell::catalog_load_library,
            shell::catalog_save_library,
            shell::catalog_resolve_imports,
            shell::catalog_add_photos,
            shell::catalog_update_photo,
            shell::catalog_save_collection,
            shell::catalog_delete_collection,
            shell::catalog_save_stacks,
            shell::catalog_list_presets,
            shell::catalog_save_preset,
            shell::catalog_delete_preset,
            shell::catalog_delete_photo,
            shell::catalog_pending_deletions,
            shell::catalog_complete_deletions,
            shell::catalog_storage_references,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Postframe desktop");
}

#[cfg(not(feature = "shell"))]
pub fn run() {
    panic!("postframe-desktop was built without its shell feature");
}
