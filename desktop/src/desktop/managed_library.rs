use super::{
    DesktopError, DesktopInner, DesktopState, DesktopStatus, Library, Result, discard_writes,
    display_path, remember_path, remembered_path, reveal_path,
};
use std::collections::HashMap;
use std::path::{Path, PathBuf};

impl DesktopState {
    pub fn new(config_dir: PathBuf) -> Self {
        let (library, startup_error) = match remembered_path(&config_dir) {
            Ok(Some(path)) => match Library::open(&path) {
                Ok(library) => (Some(library), None),
                Err(error) => (None, Some(error.to_string())),
            },
            Ok(None) => (None, None),
            Err(error) => (None, Some(error.to_string())),
        };
        Self {
            inner: std::sync::Mutex::new(DesktopInner {
                library,
                writes: HashMap::new(),
                startup_error,
            }),
            config_dir,
        }
    }

    pub(super) fn status(&self) -> DesktopStatus {
        let inner = self.inner.lock().expect("desktop state poisoned");
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

    pub(super) fn create_library(&self, parent: &Path) -> Result<String> {
        self.switch(Library::create(parent)?)
    }

    pub(super) fn open_library(&self, path: &Path) -> Result<String> {
        self.switch(Library::open(path)?)
    }

    pub(super) fn close_library(&self) {
        let mut inner = self.inner.lock().expect("desktop state poisoned");
        discard_writes(&mut inner.writes);
        inner.library = None;
    }

    pub(super) fn reveal_library(&self) -> Result<()> {
        let inner = self.inner.lock().expect("desktop state poisoned");
        let library = inner.library.as_ref().ok_or(DesktopError::NoLibrary)?;
        reveal_path(&library.root)
    }

    fn switch(&self, library: Library) -> Result<String> {
        let path = library.root.clone();
        remember_path(&self.config_dir, &path)?;
        let mut inner = self.inner.lock().expect("desktop state poisoned");
        discard_writes(&mut inner.writes);
        inner.library = Some(library);
        inner.startup_error = None;
        Ok(display_path(&path))
    }
}
