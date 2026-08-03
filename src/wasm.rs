use std::sync::Arc;

use image::DynamicImage;
use lru::LruCache;
use rawler::decoders::{Orientation, RawDecodeParams, RawMetadata};
use rawler::formats::tiff::Rational;
use rawler::imgop::develop::RawDevelop;
use rawler::rawsource::RawSource;
use wasm_bindgen::prelude::*;

use crate::bracket::{self, Frame, FrameData};
use crate::preview::{MipPyramid, PreparedRegion};
use crate::{ImageScope, LightSettings, LightTransform, Merged, Preview};

const MAX_TILE_DIMENSION: usize = 1024;
const MAX_PYRAMID_BIN: usize = 64;
const TILE_CACHE_BUDGET: usize = 96 * 1024 * 1024;

#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
struct TileRegion {
    x: usize,
    y: usize,
    width: usize,
    height: usize,
    bin: usize,
}

struct TileCache {
    entries: LruCache<TileRegion, PreparedRegion>,
    bytes: usize,
    budget: usize,
}

impl TileCache {
    fn new(budget: usize) -> Self {
        Self {
            entries: LruCache::unbounded(),
            bytes: 0,
            budget,
        }
    }

    fn clear(&mut self) {
        self.entries.clear();
        self.bytes = 0;
    }

    fn insert(&mut self, region: TileRegion, prepared: PreparedRegion) {
        let bytes = prepared.byte_len();
        while self.bytes + bytes > self.budget {
            let Some((_, evicted)) = self.entries.pop_lru() else {
                break;
            };
            self.bytes -= evicted.byte_len();
        }
        if let Some(replaced) = self.entries.put(region, prepared) {
            self.bytes -= replaced.byte_len();
        }
        self.bytes += bytes;
    }

    fn contains(&self, region: &TileRegion) -> bool {
        self.entries.peek(region).is_some()
    }

    fn get(&mut self, region: &TileRegion) -> Option<&PreparedRegion> {
        self.entries.get(region)
    }
}

fn validate_tile(
    merged: &Merged,
    x: usize,
    y: usize,
    width: usize,
    height: usize,
    bin: usize,
) -> Result<(), JsError> {
    if bin == 0 || !bin.is_power_of_two() {
        return Err(JsError::new("tile bin must be a non-zero power of two"));
    }
    if !x.is_multiple_of(bin) || !y.is_multiple_of(bin) {
        return Err(JsError::new("tile origin must align to its bin"));
    }
    if x >= merged.radiance.width || y >= merged.radiance.height || width == 0 || height == 0 {
        return Err(JsError::new("tile is outside the image"));
    }
    if width.div_ceil(bin) > MAX_TILE_DIMENSION || height.div_ceil(bin) > MAX_TILE_DIMENSION {
        return Err(JsError::new("tile output exceeds the maximum dimension"));
    }
    Ok(())
}

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
pub struct DisplayTransform {
    light: LightTransform,
}

#[wasm_bindgen]
impl DisplayTransform {
    #[wasm_bindgen(constructor)]
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        exposure: f32,
        contrast: f32,
        highlights: f32,
        shadows: f32,
        whites: f32,
        blacks: f32,
    ) -> Result<DisplayTransform, JsError> {
        Ok(Self {
            light: LightTransform::new(light_settings(
                exposure, contrast, highlights, shadows, whites, blacks,
            ))
            .map_err(err)?,
        })
    }

    pub fn apply_rgba(&self, rgba: Vec<u8>) -> Result<Vec<u8>, JsError> {
        self.light.apply_display_rgba8(&rgba).map_err(err)
    }

    #[wasm_bindgen(getter)]
    pub fn luminance_lut(&self) -> Vec<f32> {
        self.light.luminance_lut().to_vec()
    }
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
pub struct PreviewFrame {
    jpeg: Vec<u8>,
    histogram: Vec<u32>,
    waveform: Vec<u16>,
    waveform_width: u32,
    waveform_height: u32,
    sample_count: u32,
}

#[wasm_bindgen]
pub struct ScopeFrame {
    histogram: Vec<u32>,
    waveform: Vec<u16>,
    waveform_width: u32,
    waveform_height: u32,
    sample_count: u32,
}

#[wasm_bindgen]
impl ScopeFrame {
    #[wasm_bindgen(getter)]
    pub fn histogram(&self) -> Vec<u32> {
        self.histogram.clone()
    }

    #[wasm_bindgen(getter)]
    pub fn waveform(&self) -> Vec<u16> {
        self.waveform.clone()
    }

    #[wasm_bindgen(getter)]
    pub fn waveform_width(&self) -> u32 {
        self.waveform_width
    }

    #[wasm_bindgen(getter)]
    pub fn waveform_height(&self) -> u32 {
        self.waveform_height
    }

    #[wasm_bindgen(getter)]
    pub fn sample_count(&self) -> u32 {
        self.sample_count
    }
}

struct CachedPreview {
    settings: LightSettings,
    tone: bool,
    rgb8: Vec<u8>,
}

#[wasm_bindgen]
impl PreviewFrame {
    #[wasm_bindgen(getter)]
    pub fn jpeg(&self) -> Vec<u8> {
        self.jpeg.clone()
    }

    #[wasm_bindgen(getter)]
    pub fn histogram(&self) -> Vec<u32> {
        self.histogram.clone()
    }

    #[wasm_bindgen(getter)]
    pub fn waveform(&self) -> Vec<u16> {
        self.waveform.clone()
    }

    #[wasm_bindgen(getter)]
    pub fn waveform_width(&self) -> u32 {
        self.waveform_width
    }

    #[wasm_bindgen(getter)]
    pub fn waveform_height(&self) -> u32 {
        self.waveform_height
    }

    #[wasm_bindgen(getter)]
    pub fn sample_count(&self) -> u32 {
        self.sample_count
    }
}

#[wasm_bindgen]
pub struct Session {
    frames: Vec<Frame>,
    merged: Option<Merged>,
    thumb: Option<(Merged, Preview)>,
    pyramid: Option<MipPyramid>,
    tiles: TileCache,
    light: Option<LightTransform>,
    preview: Option<CachedPreview>,
}

#[wasm_bindgen]
pub struct RenderedTile {
    rgba: Vec<u8>,
    width: u32,
    height: u32,
}

#[wasm_bindgen]
pub struct LinearTile {
    rgba: Vec<f32>,
    width: u32,
    height: u32,
}

#[wasm_bindgen]
impl LinearTile {
    #[wasm_bindgen(getter)]
    pub fn rgba(&self) -> Vec<f32> {
        self.rgba.clone()
    }

    #[wasm_bindgen(getter)]
    pub fn width(&self) -> u32 {
        self.width
    }

    #[wasm_bindgen(getter)]
    pub fn height(&self) -> u32 {
        self.height
    }
}

#[wasm_bindgen]
pub struct RenderProfile {
    transfer_lut: Vec<f32>,
    transfer_lut_length: u32,
    mix: Vec<f32>,
    lookup_low_bits: u32,
    lookup_shift: u32,
    radiance_max: f32,
}

#[wasm_bindgen]
impl RenderProfile {
    #[wasm_bindgen(getter)]
    pub fn transfer_lut(&self) -> Vec<f32> {
        self.transfer_lut.clone()
    }

    #[wasm_bindgen(getter)]
    pub fn transfer_lut_length(&self) -> u32 {
        self.transfer_lut_length
    }

    #[wasm_bindgen(getter)]
    pub fn mix(&self) -> Vec<f32> {
        self.mix.clone()
    }

    #[wasm_bindgen(getter)]
    pub fn lookup_low_bits(&self) -> u32 {
        self.lookup_low_bits
    }

    #[wasm_bindgen(getter)]
    pub fn lookup_shift(&self) -> u32 {
        self.lookup_shift
    }

    #[wasm_bindgen(getter)]
    pub fn radiance_max(&self) -> f32 {
        self.radiance_max
    }
}

#[wasm_bindgen]
impl RenderedTile {
    #[wasm_bindgen(getter)]
    pub fn rgba(&self) -> Vec<u8> {
        self.rgba.clone()
    }

    #[wasm_bindgen(getter)]
    pub fn width(&self) -> u32 {
        self.width
    }

    #[wasm_bindgen(getter)]
    pub fn height(&self) -> u32 {
        self.height
    }
}

#[wasm_bindgen]
impl Session {
    #[wasm_bindgen(constructor)]
    pub fn new() -> Session {
        Session {
            frames: Vec::new(),
            merged: None,
            thumb: None,
            pyramid: None,
            tiles: TileCache::new(TILE_CACHE_BUDGET),
            light: None,
            preview: None,
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
        self.install_merged(merged, preview_dimension);
        Ok(())
    }

    pub fn restore_cache(
        &mut self,
        cache: Vec<u8>,
        preview_dimension: usize,
    ) -> Result<(), JsError> {
        let merged = Merged::from_cache_bytes(&cache).map_err(err)?;
        self.frames.clear();
        self.install_merged(merged, preview_dimension);
        Ok(())
    }

    pub fn cache_bytes(&self) -> Result<Vec<u8>, JsError> {
        self.merged
            .as_ref()
            .map(Merged::to_cache_bytes)
            .ok_or(JsError::new("merge first"))
    }

    fn install_merged(&mut self, merged: Merged, preview_dimension: usize) {
        let pyramid = MipPyramid::new(&merged, MAX_PYRAMID_BIN);
        let thumb = pyramid.thumbnail(&merged, preview_dimension.max(256));
        let lut = Preview::new(&thumb);
        self.tiles.clear();
        self.preview = None;
        self.thumb = Some((thumb, lut));
        self.pyramid = Some(pyramid);
        self.merged = Some(merged);
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

    pub fn render_profile(&self) -> Result<RenderProfile, JsError> {
        let merged = self.merged.as_ref().ok_or(JsError::new("merge first"))?;
        let (_, preview) = self.thumb.as_ref().ok_or(JsError::new("merge first"))?;
        let transfer_lut = preview.gpu_lut();
        Ok(RenderProfile {
            transfer_lut_length: (transfer_lut.len() / 3) as u32,
            transfer_lut,
            mix: merged.transfer.mix.into_iter().flatten().collect(),
            lookup_low_bits: Preview::gpu_lookup_low_bits(),
            lookup_shift: Preview::gpu_lookup_shift(),
            radiance_max: merged.report.radiance_max,
        })
    }

    /// Interactive preview: SDR JPEG at the thumbnail size, LUT-rendered.
    #[allow(clippy::too_many_arguments)]
    pub fn preview_jpeg(
        &mut self,
        exposure: f32,
        contrast: f32,
        highlights: f32,
        shadows: f32,
        whites: f32,
        blacks: f32,
        tone: bool,
    ) -> Result<Vec<u8>, JsError> {
        let settings = light_settings(exposure, contrast, highlights, shadows, whites, blacks);
        self.prepare_preview(settings, tone)?;
        let (thumb, _) = self.thumb.as_ref().ok_or(JsError::new("merge first"))?;
        let preview = self
            .preview
            .as_ref()
            .ok_or(JsError::new("missing preview"))?;
        encode_jpeg(&preview.rgb8, thumb.radiance.width, thumb.radiance.height)
    }

    #[allow(clippy::too_many_arguments)]
    pub fn preview_frame(
        &mut self,
        exposure: f32,
        contrast: f32,
        highlights: f32,
        shadows: f32,
        whites: f32,
        blacks: f32,
        tone: bool,
    ) -> Result<PreviewFrame, JsError> {
        let settings = light_settings(exposure, contrast, highlights, shadows, whites, blacks);
        self.prepare_preview(settings, tone)?;
        let (thumb, _) = self.thumb.as_ref().ok_or(JsError::new("merge first"))?;
        let preview = self
            .preview
            .as_ref()
            .ok_or(JsError::new("missing preview"))?;
        let scope = ImageScope::analyze(&preview.rgb8, thumb.radiance.width, thumb.radiance.height)
            .map_err(err)?;
        Ok(PreviewFrame {
            jpeg: encode_jpeg(&preview.rgb8, thumb.radiance.width, thumb.radiance.height)?,
            histogram: scope.histogram().to_vec(),
            waveform: scope.waveform().to_vec(),
            waveform_width: crate::scope::WAVEFORM_WIDTH as u32,
            waveform_height: crate::scope::WAVEFORM_HEIGHT as u32,
            sample_count: scope.sample_count() as u32,
        })
    }

    #[allow(clippy::too_many_arguments)]
    pub fn preview_scope(
        &mut self,
        exposure: f32,
        contrast: f32,
        highlights: f32,
        shadows: f32,
        whites: f32,
        blacks: f32,
        tone: bool,
        sample_target: u32,
    ) -> Result<ScopeFrame, JsError> {
        let settings = light_settings(exposure, contrast, highlights, shadows, whites, blacks);
        self.prepare_preview(settings, tone)?;
        let (thumb, _) = self.thumb.as_ref().ok_or(JsError::new("merge first"))?;
        let preview = self
            .preview
            .as_ref()
            .ok_or(JsError::new("missing preview"))?;
        let scope = ImageScope::analyze_sampled(
            &preview.rgb8,
            thumb.radiance.width,
            thumb.radiance.height,
            sample_target as usize,
        )
        .map_err(err)?;
        Ok(ScopeFrame {
            histogram: scope.histogram().to_vec(),
            waveform: scope.waveform().to_vec(),
            waveform_width: crate::scope::WAVEFORM_WIDTH as u32,
            waveform_height: crate::scope::WAVEFORM_HEIGHT as u32,
            sample_count: scope.sample_count() as u32,
        })
    }

    #[allow(clippy::too_many_arguments)]
    pub fn render_tile(
        &mut self,
        x: u32,
        y: u32,
        width: u32,
        height: u32,
        bin: u32,
        exposure: f32,
        contrast: f32,
        highlights: f32,
        shadows: f32,
        whites: f32,
        blacks: f32,
        tone: bool,
    ) -> Result<RenderedTile, JsError> {
        self.prepare_light(light_settings(
            exposure, contrast, highlights, shadows, whites, blacks,
        ))?;
        let merged = self.merged.as_ref().ok_or(JsError::new("merge first"))?;
        let (_, lut) = self.thumb.as_ref().ok_or(JsError::new("merge first"))?;
        let (x, y, width, height, bin) = (
            x as usize,
            y as usize,
            width as usize,
            height as usize,
            bin as usize,
        );
        validate_tile(merged, x, y, width, height, bin)?;
        let region = TileRegion {
            x,
            y,
            width,
            height,
            bin,
        };
        if !self.tiles.contains(&region) {
            let prepared = self
                .pyramid
                .as_ref()
                .ok_or(JsError::new("merge first"))?
                .prepare(merged, (x, y), (width, height), bin);
            self.tiles.insert(region, prepared);
        }
        let prepared = self
            .tiles
            .get(&region)
            .ok_or(JsError::new("unable to prepare tile"))?;
        let light = self
            .light
            .as_ref()
            .ok_or(JsError::new("missing light transform"))?;
        let rendered = lut.render_prepared_adjusted(merged, prepared, light, tone);
        let mut rgba = Vec::with_capacity(rendered.width * rendered.height * 4);
        for pixel in rendered.rgb8.chunks_exact(3) {
            rgba.extend_from_slice(&[pixel[0], pixel[1], pixel[2], u8::MAX]);
        }
        Ok(RenderedTile {
            rgba,
            width: rendered.width as u32,
            height: rendered.height as u32,
        })
    }

    pub fn render_tile_linear(
        &mut self,
        x: u32,
        y: u32,
        width: u32,
        height: u32,
        bin: u32,
    ) -> Result<LinearTile, JsError> {
        let merged = self.merged.as_ref().ok_or(JsError::new("merge first"))?;
        let (x, y, width, height, bin) = (
            x as usize,
            y as usize,
            width as usize,
            height as usize,
            bin as usize,
        );
        validate_tile(merged, x, y, width, height, bin)?;
        let region = TileRegion {
            x,
            y,
            width,
            height,
            bin,
        };
        if !self.tiles.contains(&region) {
            let prepared = self
                .pyramid
                .as_ref()
                .ok_or(JsError::new("merge first"))?
                .prepare(merged, (x, y), (width, height), bin);
            self.tiles.insert(region, prepared);
        }
        let prepared = self
            .tiles
            .get(&region)
            .ok_or(JsError::new("unable to prepare tile"))?;
        Ok(LinearTile {
            rgba: prepared.rgba32(),
            width: width.div_ceil(bin) as u32,
            height: height.div_ceil(bin) as u32,
        })
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

    fn prepare_light(&mut self, settings: LightSettings) -> Result<(), JsError> {
        settings.validated().map_err(err)?;
        if self.light.as_ref().map(LightTransform::settings) != Some(settings) {
            self.light = Some(LightTransform::new(settings).map_err(err)?);
        }
        Ok(())
    }

    fn prepare_preview(&mut self, settings: LightSettings, tone: bool) -> Result<(), JsError> {
        if self
            .preview
            .as_ref()
            .is_some_and(|preview| preview.settings == settings && preview.tone == tone)
        {
            return Ok(());
        }
        self.prepare_light(settings)?;
        let light = self
            .light
            .as_ref()
            .ok_or(JsError::new("missing light transform"))?;
        let (thumb, lut) = self.thumb.as_ref().ok_or(JsError::new("merge first"))?;
        self.preview = Some(CachedPreview {
            settings,
            tone,
            rgb8: lut.render_adjusted(thumb, light, tone),
        });
        Ok(())
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

fn encode_dynamic_jpeg(image: &DynamicImage) -> Result<Vec<u8>, JsError> {
    let image = image.to_rgb8();
    encode_jpeg(
        image.as_raw(),
        image.width() as usize,
        image.height() as usize,
    )
}

fn light_settings(
    exposure: f32,
    contrast: f32,
    highlights: f32,
    shadows: f32,
    whites: f32,
    blacks: f32,
) -> LightSettings {
    LightSettings {
        exposure,
        contrast,
        highlights,
        shadows,
        whites,
        blacks,
    }
}
