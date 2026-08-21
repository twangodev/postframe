use super::super::model::{
    CameraMatchPreference, Collection, ImportResolution, LibraryManifest, PendingDelete, Photo,
    Preset, Stack, StorageReferences,
};
use super::super::{DesktopState, command_error, with_library, with_library_mut};
use std::collections::HashMap;
use tauri::State;

type CommandResult<T> = std::result::Result<T, String>;

#[tauri::command]
pub fn catalog_load_library(
    state: State<'_, DesktopState>,
) -> CommandResult<Option<LibraryManifest>> {
    with_library(&state, |library| library.load_library()).map_err(command_error)
}

#[tauri::command(rename_all = "camelCase")]
pub fn catalog_save_library(
    library: LibraryManifest,
    state: State<'_, DesktopState>,
) -> CommandResult<()> {
    with_library_mut(&state, |active| active.save_library(&library)).map_err(command_error)
}

#[tauri::command(rename_all = "camelCase")]
pub fn catalog_resolve_imports(
    photos: Vec<Photo>,
    state: State<'_, DesktopState>,
) -> CommandResult<ImportResolution> {
    with_library(&state, |library| library.resolve_imports(&photos)).map_err(command_error)
}

#[tauri::command(rename_all = "camelCase")]
pub fn catalog_add_photos(
    library_created_at: u64,
    photos: Vec<Photo>,
    collection: Option<Collection>,
    state: State<'_, DesktopState>,
) -> CommandResult<()> {
    with_library_mut(&state, |library| {
        library.add_photos(library_created_at, &photos, collection.as_ref())
    })
    .map_err(command_error)
}

#[tauri::command(rename_all = "camelCase")]
pub fn catalog_update_photo(photo: Photo, state: State<'_, DesktopState>) -> CommandResult<()> {
    with_library_mut(&state, |library| library.update_photo(&photo)).map_err(command_error)
}

#[tauri::command(rename_all = "camelCase")]
pub fn catalog_save_collection(
    collection: Collection,
    state: State<'_, DesktopState>,
) -> CommandResult<()> {
    with_library_mut(&state, |library| library.save_collection(&collection)).map_err(command_error)
}

#[tauri::command(rename_all = "camelCase")]
pub fn catalog_delete_collection(
    collection_id: String,
    state: State<'_, DesktopState>,
) -> CommandResult<()> {
    with_library_mut(&state, |library| library.delete_collection(&collection_id))
        .map_err(command_error)
}

#[tauri::command(rename_all = "camelCase")]
pub fn catalog_save_stacks(
    stacks: Vec<Stack>,
    changed_photos: HashMap<String, Option<String>>,
    state: State<'_, DesktopState>,
) -> CommandResult<()> {
    with_library_mut(&state, |library| {
        library.save_stacks(&stacks, &changed_photos)
    })
    .map_err(command_error)
}

#[tauri::command]
pub fn catalog_list_presets(state: State<'_, DesktopState>) -> CommandResult<Vec<Preset>> {
    with_library(&state, |library| library.list_presets()).map_err(command_error)
}

#[tauri::command(rename_all = "camelCase")]
pub fn catalog_save_preset(preset: Preset, state: State<'_, DesktopState>) -> CommandResult<()> {
    with_library(&state, |library| library.save_preset(&preset)).map_err(command_error)
}

#[tauri::command(rename_all = "camelCase")]
pub fn catalog_delete_preset(
    preset_id: String,
    state: State<'_, DesktopState>,
) -> CommandResult<()> {
    with_library(&state, |library| library.delete_preset(&preset_id)).map_err(command_error)
}

#[tauri::command(rename_all = "camelCase")]
pub fn catalog_save_camera_match_preference(
    preference: CameraMatchPreference,
    state: State<'_, DesktopState>,
) -> CommandResult<()> {
    with_library(&state, |library| {
        library.save_camera_match_preference(preference)
    })
    .map_err(command_error)
}

#[tauri::command(rename_all = "camelCase")]
pub fn catalog_delete_photo(
    photo_id: String,
    render_cache_name: String,
    state: State<'_, DesktopState>,
) -> CommandResult<Vec<PendingDelete>> {
    with_library_mut(&state, |library| {
        library.delete_photo(&photo_id, render_cache_name)
    })
    .map_err(command_error)
}

#[tauri::command]
pub fn catalog_pending_deletions(
    state: State<'_, DesktopState>,
) -> CommandResult<Vec<PendingDelete>> {
    with_library(&state, |library| library.pending_deletions()).map_err(command_error)
}

#[tauri::command(rename_all = "camelCase")]
pub fn catalog_complete_deletions(
    deletions: Vec<PendingDelete>,
    state: State<'_, DesktopState>,
) -> CommandResult<()> {
    with_library_mut(&state, |library| library.complete_deletions(&deletions))
        .map_err(command_error)
}

#[tauri::command]
pub fn catalog_storage_references(
    state: State<'_, DesktopState>,
) -> CommandResult<StorageReferences> {
    with_library(&state, |library| library.storage_references()).map_err(command_error)
}
