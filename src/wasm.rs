use std::sync::Arc;

use image::codecs::png::PngEncoder;
use image::{DynamicImage, ExtendedColorType, ImageEncoder};
use rawler::decoders::{Orientation, RawDecodeParams, RawMetadata};
use rawler::formats::tiff::Rational;
use rawler::imgop::develop::RawDevelop;
use rawler::rawsource::RawSource;
use wasm_bindgen::prelude::*;

use crate::bracket::{self, Frame, FrameData};
use crate::{Merged, Preview};

const MAX_TILE_DIMENSION: usize = 1024;

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
    let source = RawSource::new_from_shared_vec(Arc::new(raw));
    rawler::decode_dummy(&source)
        .map(|_| ())
        .map_err(|error| JsError::new(&error.to_string()))
}

#[wasm_bindgen]
pub struct RawInspection {
    thumbnail_jpeg: Vec<u8>,
    width: u32,
    height: u32,
    orientation: u16,
    camera_make: Option<String>,
    camera_model: Option<String>,
    lens: Option<String>,
    captured_at: Option<String>,
    exposure_seconds: Option<f64>,
    f_number: Option<f64>,
    iso: Option<u32>,
    focal_length_mm: Option<f64>,
}

#[wasm_bindgen]
impl RawInspection {
    #[wasm_bindgen(getter)]
    pub fn thumbnail_jpeg(&self) -> Vec<u8> {
        self.thumbnail_jpeg.clone()
    }

    #[wasm_bindgen(getter)]
    pub fn width(&self) -> u32 {
        self.width
    }

    #[wasm_bindgen(getter)]
    pub fn height(&self) -> u32 {
        self.height
    }

    #[wasm_bindgen(getter)]
    pub fn orientation(&self) -> u16 {
        self.orientation
    }

    #[wasm_bindgen(getter)]
    pub fn camera_make(&self) -> Option<String> {
        self.camera_make.clone()
    }

    #[wasm_bindgen(getter)]
    pub fn camera_model(&self) -> Option<String> {
        self.camera_model.clone()
    }

    #[wasm_bindgen(getter)]
    pub fn lens(&self) -> Option<String> {
        self.lens.clone()
    }

    #[wasm_bindgen(getter)]
    pub fn captured_at(&self) -> Option<String> {
        self.captured_at.clone()
    }

    #[wasm_bindgen(getter)]
    pub fn exposure_seconds(&self) -> Option<f64> {
        self.exposure_seconds
    }

    #[wasm_bindgen(getter)]
    pub fn f_number(&self) -> Option<f64> {
        self.f_number
    }

    #[wasm_bindgen(getter)]
    pub fn iso(&self) -> Option<u32> {
        self.iso
    }

    #[wasm_bindgen(getter)]
    pub fn focal_length_mm(&self) -> Option<f64> {
        self.focal_length_mm
    }
}

#[wasm_bindgen]
pub fn inspect_raw(raw: Vec<u8>, thumbnail_dimension: usize) -> Result<RawInspection, JsError> {
    let source = RawSource::new_from_shared_vec(Arc::new(raw));
    let decoder = rawler::get_decoder(&source).map_err(rawler_err)?;
    let params = RawDecodeParams::default();
    let raw_image = decoder
        .raw_image(&source, &params, true)
        .map_err(rawler_err)?;
    let metadata = decoder.raw_metadata(&source, &params).map_err(rawler_err)?;
    let orientation = raw_image.orientation;
    let bounds = raw_image.crop_area.or(raw_image.active_area);
    let (mut width, mut height) = bounds
        .map(|area| (area.width(), area.height()))
        .unwrap_or((raw_image.width, raw_image.height));
    if orientation.to_flips().0 {
        (width, height) = (height, width);
    }
    let thumbnail = match embedded_image(decoder.as_ref(), &source, &params) {
        Some(image) => image,
        None => develop_raw(decoder.as_ref(), &source, &params).map_err(rawler_err)?,
    };
    let thumbnail = orient_image(thumbnail, orientation).thumbnail(
        thumbnail_dimension.clamp(64, 4096) as u32,
        thumbnail_dimension.clamp(64, 4096) as u32,
    );

    Ok(inspection(
        metadata,
        width,
        height,
        orientation,
        encode_dynamic_jpeg(&thumbnail)?,
    ))
}

fn embedded_image(
    decoder: &dyn rawler::decoders::Decoder,
    source: &RawSource,
    params: &RawDecodeParams,
) -> Option<DynamicImage> {
    decoder
        .thumbnail_image(source, params)
        .ok()
        .flatten()
        .or_else(|| decoder.preview_image(source, params).ok().flatten())
        .or_else(|| decoder.full_image(source, params).ok().flatten())
}

fn develop_raw(
    decoder: &dyn rawler::decoders::Decoder,
    source: &RawSource,
    params: &RawDecodeParams,
) -> rawler::Result<DynamicImage> {
    let raw = decoder.raw_image(source, params, false)?;
    RawDevelop::default()
        .develop_intermediate(&raw)?
        .to_dynamic_image()
        .ok_or_else(|| "unable to create a RAW thumbnail".into())
}

fn orient_image(image: DynamicImage, orientation: Orientation) -> DynamicImage {
    match orientation {
        Orientation::Normal | Orientation::Unknown => image,
        Orientation::HorizontalFlip => image.fliph(),
        Orientation::Rotate180 => image.rotate180(),
        Orientation::VerticalFlip => image.flipv(),
        Orientation::Transpose => image.rotate90().fliph(),
        Orientation::Rotate90 => image.rotate90(),
        Orientation::Transverse => image.rotate90().flipv(),
        Orientation::Rotate270 => image.rotate270(),
    }
}

fn inspection(
    metadata: RawMetadata,
    width: usize,
    height: usize,
    orientation: Orientation,
    thumbnail_jpeg: Vec<u8>,
) -> RawInspection {
    let exif = &metadata.exif;
    RawInspection {
        thumbnail_jpeg,
        width: width as u32,
        height: height as u32,
        orientation: orientation.to_u16(),
        camera_make: non_empty(metadata.make),
        camera_model: non_empty(metadata.model),
        lens: exif
            .lens_model
            .clone()
            .or_else(|| metadata.lens.map(|lens| lens.lens_name))
            .and_then(non_empty),
        captured_at: exif
            .date_time_original
            .clone()
            .or_else(|| exif.create_date.clone()),
        exposure_seconds: exif.exposure_time.and_then(rational),
        f_number: exif.fnumber.and_then(rational),
        iso: exif
            .iso_speed
            .or(exif.recommended_exposure_index)
            .or(exif.iso_speed_ratings.map(u32::from)),
        focal_length_mm: exif.focal_length.and_then(rational),
    }
}

fn non_empty(value: String) -> Option<String> {
    (!value.trim().is_empty()).then_some(value)
}

fn rational(value: Rational) -> Option<f64> {
    let value = value.n as f64 / value.d as f64;
    value.is_finite().then_some(value)
}

fn rawler_err(error: rawler::RawlerError) -> JsError {
    JsError::new(&error.to_string())
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
        self.frames.push(bracket::load_full(&data).map_err(err)?);
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

    pub fn width(&self) -> Result<u32, JsError> {
        self.merged
            .as_ref()
            .map(|merged| merged.radiance.width as u32)
            .ok_or(JsError::new("merge first"))
    }

    pub fn height(&self) -> Result<u32, JsError> {
        self.merged
            .as_ref()
            .map(|merged| merged.radiance.height as u32)
            .ok_or(JsError::new("merge first"))
    }

    /// Interactive preview: SDR JPEG at the thumbnail size, LUT-rendered.
    pub fn preview_jpeg(&self, ev: f32, tone: bool) -> Result<Vec<u8>, JsError> {
        let (thumb, lut) = self.thumb.as_ref().ok_or(JsError::new("merge first"))?;
        let rgb8 = lut.render(thumb, ev, tone);
        encode_jpeg(&rgb8, thumb.radiance.width, thumb.radiance.height)
    }

    #[allow(clippy::too_many_arguments)]
    pub fn render_tile_png(
        &self,
        x: u32,
        y: u32,
        width: u32,
        height: u32,
        bin: u32,
        ev: f32,
        tone: bool,
    ) -> Result<Vec<u8>, JsError> {
        let merged = self.merged.as_ref().ok_or(JsError::new("merge first"))?;
        let (_, lut) = self.thumb.as_ref().ok_or(JsError::new("merge first"))?;
        let (x, y, width, height, bin) = (
            x as usize,
            y as usize,
            width as usize,
            height as usize,
            bin as usize,
        );
        if bin == 0 || !bin.is_power_of_two() {
            return Err(JsError::new("tile bin must be a non-zero power of two"));
        }
        if x >= merged.radiance.width || y >= merged.radiance.height || width == 0 || height == 0 {
            return Err(JsError::new("tile is outside the image"));
        }
        if width.div_ceil(bin) > MAX_TILE_DIMENSION || height.div_ceil(bin) > MAX_TILE_DIMENSION {
            return Err(JsError::new("tile output exceeds the maximum dimension"));
        }
        let rendered = lut.render_region(merged, (x, y), (width, height), bin, ev, tone);
        encode_png(&rendered.rgb8, rendered.width, rendered.height)
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

fn encode_png(rgb8: &[u8], width: usize, height: usize) -> Result<Vec<u8>, JsError> {
    let mut bytes = Vec::new();
    PngEncoder::new(&mut bytes)
        .write_image(rgb8, width as u32, height as u32, ExtendedColorType::Rgb8)
        .map_err(|error| JsError::new(&error.to_string()))?;
    Ok(bytes)
}

fn encode_dynamic_jpeg(image: &DynamicImage) -> Result<Vec<u8>, JsError> {
    let image = image.to_rgb8();
    encode_jpeg(
        image.as_raw(),
        image.width() as usize,
        image.height() as usize,
    )
}
