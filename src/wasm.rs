use std::sync::Arc;

use wasm_bindgen::prelude::*;

use crate::bracket::{self, Frame, FrameData};
use crate::{Merged, Preview};

fn err(error: crate::Error) -> JsError {
    JsError::new(&error.to_string())
}

#[wasm_bindgen]
pub fn supported_raw_extensions() -> Vec<String> {
    rawler::decoders::supported_extensions()
        .iter()
        .map(|extension| extension.to_ascii_lowercase())
        .collect()
}

#[wasm_bindgen]
pub fn validate_raw(raw: Vec<u8>) -> Result<(), JsError> {
    let source = rawler::rawsource::RawSource::new_from_shared_vec(Arc::new(raw));
    rawler::decode_dummy(&source)
        .map(|_| ())
        .map_err(|error| JsError::new(&error.to_string()))
}

#[wasm_bindgen]
pub struct Session {
    frames: Vec<Frame>,
    merged: Option<Merged>,
    thumb: Option<(Merged, Preview)>,
}

#[wasm_bindgen]
impl Session {
    #[wasm_bindgen(constructor)]
    pub fn new() -> Session {
        Session {
            frames: Vec::new(),
            merged: None,
            thumb: None,
        }
    }

    pub fn add_frame(&mut self, raw: Vec<u8>, jpeg: Option<Vec<u8>>) -> Result<(), JsError> {
        let data = FrameData {
            raw: Arc::new(raw),
            jpeg,
        };
        self.frames.push(bracket::load(&data).map_err(err)?);
        Ok(())
    }

    pub fn frame_count(&self) -> usize {
        self.frames.len()
    }

    pub fn merge(&mut self, preview_dimension: usize) -> Result<(), JsError> {
        let merged = bracket::merge(std::mem::take(&mut self.frames)).map_err(err)?;
        let thumb = merged.thumbnail(preview_dimension.max(256));
        let lut = Preview::new(&thumb);
        self.thumb = Some((thumb, lut));
        self.merged = Some(merged);
        Ok(())
    }

    pub fn boost_stops(&self) -> f32 {
        self.merged
            .as_ref()
            .map(|m| m.report.radiance_max.max(1.0).log2())
            .unwrap_or(0.0)
    }

    /// Interactive preview: SDR JPEG at the thumbnail size, LUT-rendered.
    pub fn preview_jpeg(&self, ev: f32, tone: bool) -> Result<Vec<u8>, JsError> {
        let (thumb, lut) = self.thumb.as_ref().ok_or(JsError::new("merge first"))?;
        let rgb8 = lut.render(thumb, ev, tone);
        encode_jpeg(&rgb8, thumb.radiance.width, thumb.radiance.height)
    }

    /// Ultra HDR JPEG at the thumbnail size, for HDR-capable display.
    pub fn preview_ultra(&self) -> Result<Vec<u8>, JsError> {
        let (thumb, _) = self.thumb.as_ref().ok_or(JsError::new("merge first"))?;
        Ok(crate::hdr::encode(thumb).map_err(err)?.bytes)
    }

    /// Ultra HDR JPEG at the merged resolution.
    pub fn export_ultra(&self) -> Result<Vec<u8>, JsError> {
        let merged = self.merged.as_ref().ok_or(JsError::new("merge first"))?;
        Ok(crate::hdr::encode(merged).map_err(err)?.bytes)
    }
}

impl Default for Session {
    fn default() -> Self {
        Self::new()
    }
}

fn encode_jpeg(rgb8: &[u8], width: usize, height: usize) -> Result<Vec<u8>, JsError> {
    let mut bytes = Vec::new();
    jpeg_encoder::Encoder::new(&mut bytes, 90)
        .encode(
            rgb8,
            width as u16,
            height as u16,
            jpeg_encoder::ColorType::Rgb,
        )
        .map_err(|e| JsError::new(&e.to_string()))?;
    Ok(bytes)
}
