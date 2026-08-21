use super::super::{
    AssetKind, AssetSource, DesktopState, DurableUsage, StoredAssetFile, command_error,
};
use std::path::PathBuf;
use tauri::State;

type CommandResult<T> = std::result::Result<T, String>;

#[tauri::command(rename_all = "camelCase")]
pub fn asset_source(
    kind: AssetKind,
    storage_name: String,
    state: State<'_, DesktopState>,
) -> CommandResult<AssetSource> {
    state
        .asset_source(kind, storage_name)
        .map_err(command_error)
}

#[tauri::command(rename_all = "camelCase")]
pub fn asset_exists(
    kind: AssetKind,
    storage_name: String,
    state: State<'_, DesktopState>,
) -> CommandResult<bool> {
    state
        .asset_exists(kind, &storage_name)
        .map_err(command_error)
}

#[tauri::command(rename_all = "camelCase")]
pub fn begin_asset_write(
    kind: AssetKind,
    storage_name: String,
    expected_size: u64,
    expected_hash: Option<String>,
    state: State<'_, DesktopState>,
) -> CommandResult<String> {
    state
        .begin_asset_write(kind, &storage_name, expected_size, expected_hash)
        .map_err(command_error)
}

#[tauri::command(rename_all = "camelCase")]
pub fn begin_export_write(
    path: String,
    expected_size: u64,
    expected_hash: Option<String>,
    state: State<'_, DesktopState>,
) -> CommandResult<String> {
    state
        .begin_export_write(PathBuf::from(path), expected_size, expected_hash)
        .map_err(command_error)
}

#[tauri::command(rename_all = "camelCase")]
pub fn append_asset_write(
    token: String,
    offset: u64,
    data: Vec<u8>,
    state: State<'_, DesktopState>,
) -> CommandResult<()> {
    state
        .append_write(&token, offset, &data)
        .map_err(command_error)
}

#[tauri::command(rename_all = "camelCase")]
pub fn commit_asset_write(token: String, state: State<'_, DesktopState>) -> CommandResult<()> {
    state.commit_write(&token).map_err(command_error)
}

#[tauri::command(rename_all = "camelCase")]
pub fn abort_asset_write(token: String, state: State<'_, DesktopState>) -> CommandResult<()> {
    state.abort_write(&token).map_err(command_error)
}

#[tauri::command(rename_all = "camelCase")]
pub fn delete_assets(
    kind: AssetKind,
    storage_names: Vec<String>,
    state: State<'_, DesktopState>,
) -> CommandResult<()> {
    state
        .delete_assets(kind, &storage_names)
        .map_err(command_error)
}

#[tauri::command]
pub fn durable_usage(state: State<'_, DesktopState>) -> CommandResult<DurableUsage> {
    state.durable_usage().map_err(command_error)
}

#[tauri::command(rename_all = "camelCase")]
pub fn list_assets(
    kind: AssetKind,
    state: State<'_, DesktopState>,
) -> CommandResult<Vec<StoredAssetFile>> {
    state.list_assets(kind).map_err(command_error)
}
