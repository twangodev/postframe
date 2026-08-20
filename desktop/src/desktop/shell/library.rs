use super::super::*;

#[tauri::command]
pub fn desktop_status(state: State<'_, DesktopState>) -> DesktopStatus {
    let inner = state.inner.lock().expect("desktop state poisoned");
    if let Some(library) = &inner.library {
        DesktopStatus::Ready {
            path: display_path(&library.root),
        }
    } else if let Some(message) = &inner.startup_error {
        DesktopStatus::Error {
            message: message.clone(),
        }
    } else {
        DesktopStatus::NeedsLibrary
    }
}

#[tauri::command(rename_all = "camelCase")]
pub fn create_library(
    parent_path: String,
    state: State<'_, DesktopState>,
) -> CommandResult<String> {
    Library::create(Path::new(&parent_path))
        .and_then(|library| state.switch(library))
        .map_err(command_error)
}

#[tauri::command(rename_all = "camelCase")]
pub fn open_library(path: String, state: State<'_, DesktopState>) -> CommandResult<String> {
    Library::open(Path::new(&path))
        .and_then(|library| state.switch(library))
        .map_err(command_error)
}

#[tauri::command]
pub fn close_library(state: State<'_, DesktopState>) -> CommandResult<()> {
    let mut inner = state.inner.lock().expect("desktop state poisoned");
    discard_writes(&mut inner.writes);
    inner.library = None;
    Ok(())
}

#[tauri::command]
pub fn reveal_library(state: State<'_, DesktopState>) -> CommandResult<()> {
    let inner = state.inner.lock().expect("desktop state poisoned");
    let path = &inner
        .library
        .as_ref()
        .ok_or(DesktopError::NoLibrary)
        .map_err(command_error)?
        .root;
    reveal_path(path).map_err(command_error)
}
