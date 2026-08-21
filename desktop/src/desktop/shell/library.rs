use super::super::{DesktopState, DesktopStatus, command_error};
use std::path::Path;
use tauri::State;

type CommandResult<T> = std::result::Result<T, String>;

#[tauri::command]
pub fn desktop_status(state: State<'_, DesktopState>) -> DesktopStatus {
    state.status()
}

#[tauri::command(rename_all = "camelCase")]
pub fn create_library(
    parent_path: String,
    state: State<'_, DesktopState>,
) -> CommandResult<String> {
    state
        .create_library(Path::new(&parent_path))
        .map_err(command_error)
}

#[tauri::command(rename_all = "camelCase")]
pub fn open_library(path: String, state: State<'_, DesktopState>) -> CommandResult<String> {
    state.open_library(Path::new(&path)).map_err(command_error)
}

#[tauri::command]
pub fn close_library(state: State<'_, DesktopState>) {
    state.close_library();
}

#[tauri::command]
pub fn reveal_library(state: State<'_, DesktopState>) -> CommandResult<()> {
    state.reveal_library().map_err(command_error)
}
