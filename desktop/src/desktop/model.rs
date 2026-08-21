use super::{DesktopError, Result};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;

#[derive(Serialize)]
#[serde(rename_all = "camelCase", tag = "kind")]
pub enum DesktopStatus {
    Ready { path: String },
    NeedsLibrary,
    Error { message: String },
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AssetSource {
    pub(super) url: String,
    pub(super) name: String,
    pub(super) size: u64,
}

#[derive(Clone, Copy, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum AssetKind {
    Originals,
    Thumbnails,
    Edits,
    Masks,
}

impl AssetKind {
    pub(super) fn directory(self) -> &'static str {
        match self {
            Self::Originals => "originals",
            Self::Thumbnails => "thumbnails",
            Self::Edits => "edits",
            Self::Masks => "masks",
        }
    }
}

impl std::str::FromStr for AssetKind {
    type Err = DesktopError;

    fn from_str(value: &str) -> Result<Self> {
        match value {
            "originals" => Ok(Self::Originals),
            "thumbnails" => Ok(Self::Thumbnails),
            "edits" => Ok(Self::Edits),
            "masks" => Ok(Self::Masks),
            _ => Err(DesktopError::Invalid(format!("Unknown asset kind {value}"))),
        }
    }
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryManifest {
    pub(super) version: u64,
    pub(super) created_at: u64,
    pub(super) updated_at: u64,
    pub(super) photos: Vec<Photo>,
    pub(super) collections: Vec<Collection>,
    pub(super) stacks: Vec<Stack>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Photo {
    pub(super) id: String,
    pub(super) kind: PhotoKind,
    pub(super) name: String,
    pub(super) imported_at: u64,
    pub(super) frames: Vec<PhotoFrame>,
    pub(super) bracket_detection: Option<BracketDetection>,
    pub(super) thumbnail_storage_name: Option<String>,
    pub(super) metadata: Option<PhotoMetadata>,
    pub(super) width: Option<u32>,
    pub(super) height: Option<u32>,
    pub(super) rating: u8,
    pub(super) flagged: bool,
    pub(super) rejected: bool,
    pub(super) color_label: ColorLabel,
    pub(super) stack_id: Option<String>,
}

impl Photo {
    pub(super) fn fingerprint(&self) -> String {
        let mut parts = vec![self.kind.as_str().to_owned()];
        for frame in &self.frames {
            let raw = frame
                .raw
                .as_ref()
                .map(|asset| asset.content_hash.as_str())
                .unwrap_or_default();
            let display = frame
                .display
                .as_ref()
                .map(|asset| asset.content_hash.as_str())
                .unwrap_or_default();
            let hint = frame
                .filename_exposure_hint
                .map(|hint| hint.to_string())
                .unwrap_or_default();
            parts.push(format!("{raw}:{display}:{hint}"));
        }
        parts.join("|")
    }

    pub(super) fn assets(&self) -> impl Iterator<Item = &PhotoAsset> {
        self.frames.iter().flat_map(|frame| {
            [frame.raw.as_ref(), frame.display.as_ref()]
                .into_iter()
                .flatten()
        })
    }
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum PhotoKind {
    Display,
    Raw,
    RawPair,
    Bracket,
}

impl PhotoKind {
    fn as_str(self) -> &'static str {
        match self {
            Self::Display => "display",
            Self::Raw => "raw",
            Self::RawPair => "raw-pair",
            Self::Bracket => "bracket",
        }
    }
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum BracketDetection {
    FilenameCandidate,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum ColorLabel {
    None,
    Red,
    Yellow,
    Green,
    Blue,
    Purple,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PhotoFrame {
    pub(super) raw: Option<PhotoAsset>,
    pub(super) display: Option<PhotoAsset>,
    pub(super) filename_exposure_hint: Option<f64>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PhotoAsset {
    pub(super) id: String,
    pub(super) storage_name: String,
    pub(super) name: String,
    pub(super) content_hash: String,
    pub(super) source: PhotoSource,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PhotoSource {
    pub(super) kind: PhotoSourceKind,
    pub(super) format: String,
    pub(super) media_type: String,
    pub(super) size: u64,
    pub(super) last_modified: u64,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum PhotoSourceKind {
    Raw,
    Image,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PhotoMetadata {
    pub(super) orientation: u8,
    pub(super) camera_make: Option<String>,
    pub(super) camera_model: Option<String>,
    pub(super) lens: Option<String>,
    pub(super) captured_at: Option<String>,
    pub(super) exposure_seconds: Option<f64>,
    pub(super) f_number: Option<f64>,
    pub(super) iso: Option<u32>,
    pub(super) focal_length_mm: Option<f64>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Collection {
    pub(super) id: String,
    pub(super) name: String,
    pub(super) created_at: u64,
    pub(super) updated_at: u64,
    pub(super) photo_ids: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(super) normalized_name: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Stack {
    pub(super) id: String,
    pub(super) name: String,
    pub(super) photo_ids: Vec<String>,
    pub(super) collapsed: bool,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Preset {
    pub(super) id: String,
    pub(super) name: String,
    pub(super) normalized_name: String,
    pub(super) groups: Vec<String>,
    pub(super) settings: Value,
    pub(super) created_at: String,
    pub(super) updated_at: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportResolution {
    pub(super) additions: Vec<Photo>,
    pub(super) photo_ids: HashMap<String, String>,
}

#[derive(Deserialize, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PendingDelete {
    pub(super) kind: PendingDeleteKind,
    pub(super) storage_name: String,
    pub(super) queued_at: u64,
}

#[derive(Clone, Copy, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub(super) enum PendingDeleteKind {
    Original,
    Thumbnail,
    Edit,
    Derived,
}

impl PendingDeleteKind {
    pub(super) fn as_str(self) -> &'static str {
        match self {
            Self::Original => "original",
            Self::Thumbnail => "thumbnail",
            Self::Edit => "edit",
            Self::Derived => "derived",
        }
    }
}

impl std::str::FromStr for PendingDeleteKind {
    type Err = DesktopError;

    fn from_str(value: &str) -> Result<Self> {
        match value {
            "original" => Ok(Self::Original),
            "thumbnail" => Ok(Self::Thumbnail),
            "edit" => Ok(Self::Edit),
            "derived" => Ok(Self::Derived),
            _ => Err(DesktopError::Invalid(format!(
                "Unknown pending deletion kind {value}"
            ))),
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DurableUsage {
    pub(super) originals: u64,
    pub(super) thumbnails: u64,
    pub(super) edits: u64,
    pub(super) masks: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredAssetFile {
    pub(super) storage_name: String,
    pub(super) size: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StorageReferences {
    pub(super) originals: Vec<String>,
    pub(super) thumbnails: Vec<String>,
    pub(super) edits: Vec<String>,
    pub(super) masks: Vec<String>,
    pub(super) photo_ids: Vec<String>,
}
