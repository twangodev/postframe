use std::sync::Arc;

use lru::LruCache;
use wasm_bindgen::prelude::*;

use super::shared::{develop_settings, encode_jpeg, err, vignette_frame};
use crate::bracket::{self, Frame, FrameData};
use crate::effects::VignetteFrame;
use crate::fit::transfer::FULL_CAMERA_LOOK;
use crate::preview::{MipPyramid, PreparedRegion};
use crate::{
    DetailSettings, DevelopSettings, DevelopTransform, ImageScope, Merged, Preview, camera_match,
};

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
    detail: DetailKey,
}

/// The tile-side work a cached region already carries: cleaning it and building
/// its blur planes depend on nothing else in the develop chain.
#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
struct DetailKey {
    noise_luminance: u32,
    noise_color: u32,
    planes: bool,
}

impl From<&DetailSettings> for DetailKey {
    fn from(settings: &DetailSettings) -> Self {
        Self {
            noise_luminance: settings.noise_luminance.to_bits(),
            noise_color: settings.noise_color.to_bits(),
            planes: !settings.blur_radii().is_empty(),
        }
    }
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
    settings: DevelopSettings,
    frame: VignetteFrame,
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
    camera_look: f32,
    merged: Option<Merged>,
    thumb: Option<(Merged, Preview)>,
    pyramid: Option<MipPyramid>,
    tiles: TileCache,
    develop: Option<DevelopTransform>,
    preview: Option<CachedPreview>,
    preview_source: Option<PreviewSource>,
}

/// The thumbnail put through the tile-side stages, kept while those controls
/// hold still so dragging clarity never rebuilds a blur plane.
struct PreviewSource {
    detail: DetailKey,
    region: PreparedRegion,
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
    detail: Vec<f32>,
    width: u32,
    height: u32,
}

#[wasm_bindgen]
impl LinearTile {
    #[wasm_bindgen(getter)]
    pub fn rgba(&self) -> Vec<f32> {
        self.rgba.clone()
    }

    /// The fine plane followed by the coarse one, empty when no stage reads them.
    #[wasm_bindgen(getter)]
    pub fn detail(&self) -> Vec<f32> {
        self.detail.clone()
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
            camera_look: FULL_CAMERA_LOOK,
            merged: None,
            thumb: None,
            pyramid: None,
            tiles: TileCache::new(TILE_CACHE_BUDGET),
            develop: None,
            preview: None,
            preview_source: None,
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

    /// How much of the camera's own rendering the photograph keeps, from zero
    /// for a plain sRGB one to `FULL_CAMERA_LOOK` for the fit as measured. The
    /// merged radiance and its cache never carry it, so it stays reversible.
    pub fn set_camera_look(&mut self, camera_look: f32) -> Result<(), JsError> {
        if !camera_look.is_finite() || !(0.0..=FULL_CAMERA_LOOK).contains(&camera_look) {
            return Err(JsError::new("camera look sits between 0 and 100"));
        }
        if self.camera_look == camera_look {
            return Ok(());
        }
        self.camera_look = camera_look;
        if let Some((thumb, lut)) = self.thumb.as_mut() {
            *lut = Preview::from_transfer(&thumb.transfer.with_camera_look(camera_look));
        }
        self.tiles.clear();
        self.preview = None;
        self.preview_source = None;
        Ok(())
    }

    #[wasm_bindgen(getter)]
    pub fn camera_look(&self) -> f32 {
        self.camera_look
    }

    pub fn camera_match(&self) -> Result<JsValue, JsError> {
        let merged = self.merged.as_ref().ok_or(JsError::new("merge first"))?;
        let matched = camera_match(merged).map_err(err)?;
        serde_wasm_bindgen::to_value(&matched).map_err(|error| JsError::new(&error.to_string()))
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
        let lut = Preview::from_transfer(&thumb.transfer.with_camera_look(self.camera_look));
        self.tiles.clear();
        self.preview = None;
        self.preview_source = None;
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
            mix: merged
                .transfer
                .with_camera_look(self.camera_look)
                .mix
                .into_iter()
                .flatten()
                .collect(),
            lookup_low_bits: Preview::gpu_lookup_low_bits(),
            lookup_shift: Preview::gpu_lookup_shift(),
            radiance_max: merged.report.radiance_max,
        })
    }

    /// Interactive preview: SDR JPEG at the thumbnail size, LUT-rendered.
    pub fn preview_jpeg(
        &mut self,
        settings: JsValue,
        crop: JsValue,
        tone: bool,
    ) -> Result<Vec<u8>, JsError> {
        self.prepare_preview(develop_settings(settings)?, vignette_frame(crop)?, tone)?;
        let (thumb, _) = self.thumb.as_ref().ok_or(JsError::new("merge first"))?;
        let preview = self
            .preview
            .as_ref()
            .ok_or(JsError::new("missing preview"))?;
        encode_jpeg(&preview.rgb8, thumb.radiance.width, thumb.radiance.height)
    }

    pub fn preview_frame(
        &mut self,
        settings: JsValue,
        crop: JsValue,
        tone: bool,
    ) -> Result<PreviewFrame, JsError> {
        self.prepare_preview(develop_settings(settings)?, vignette_frame(crop)?, tone)?;
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

    pub fn preview_scope(
        &mut self,
        settings: JsValue,
        crop: JsValue,
        tone: bool,
        sample_target: u32,
    ) -> Result<ScopeFrame, JsError> {
        self.prepare_preview(develop_settings(settings)?, vignette_frame(crop)?, tone)?;
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
        settings: JsValue,
        crop: JsValue,
        tone: bool,
    ) -> Result<RenderedTile, JsError> {
        self.prepare_develop(develop_settings(settings)?, vignette_frame(crop)?)?;
        let detail = self.detail_settings()?;
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
            detail: DetailKey::from(&detail),
        };
        if !self.tiles.contains(&region) {
            let prepared = self
                .pyramid
                .as_ref()
                .ok_or(JsError::new("merge first"))?
                .prepare(merged, (x, y), (width, height), bin)
                .detailed(&detail, bin);
            self.tiles.insert(region, prepared);
        }
        let prepared = self
            .tiles
            .get(&region)
            .ok_or(JsError::new("unable to prepare tile"))?;
        let develop = self
            .develop
            .as_ref()
            .ok_or(JsError::new("missing develop transform"))?;
        let rendered = lut.render_prepared_adjusted(merged, prepared, develop, tone);
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

    #[allow(clippy::too_many_arguments)]
    pub fn render_tile_linear(
        &mut self,
        x: u32,
        y: u32,
        width: u32,
        height: u32,
        bin: u32,
        settings: JsValue,
    ) -> Result<LinearTile, JsError> {
        let detail = develop_settings(settings)?.detail;
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
            detail: DetailKey::from(&detail),
        };
        if !self.tiles.contains(&region) {
            let prepared = self
                .pyramid
                .as_ref()
                .ok_or(JsError::new("merge first"))?
                .prepare(merged, (x, y), (width, height), bin)
                .detailed(&detail, bin);
            self.tiles.insert(region, prepared);
        }
        let prepared = self
            .tiles
            .get(&region)
            .ok_or(JsError::new("unable to prepare tile"))?;
        let (tile_width, tile_height) = prepared.dimensions();
        Ok(LinearTile {
            rgba: prepared.rgba32(),
            detail: prepared.stacked_planes(),
            width: tile_width as u32,
            height: tile_height as u32,
        })
    }

    /// Ultra HDR JPEG at the thumbnail size, for HDR-capable display.
    pub fn preview_ultra(&self) -> Result<Vec<u8>, JsError> {
        let (thumb, _) = self.thumb.as_ref().ok_or(JsError::new("merge first"))?;
        let transfer = thumb.transfer.with_camera_look(self.camera_look);
        Ok(crate::hdr::encode(thumb, &transfer).map_err(err)?.bytes)
    }

    /// Ultra HDR JPEG at the merged resolution.
    pub fn export_ultra(&self) -> Result<Vec<u8>, JsError> {
        let merged = self.merged.as_ref().ok_or(JsError::new("merge first"))?;
        let transfer = merged.transfer.with_camera_look(self.camera_look);
        Ok(crate::hdr::encode(merged, &transfer).map_err(err)?.bytes)
    }

    fn prepare_develop(
        &mut self,
        settings: DevelopSettings,
        frame: VignetteFrame,
    ) -> Result<(), JsError> {
        let compiled = self.develop.as_ref();
        if compiled.map(DevelopTransform::settings) != Some(&settings)
            || compiled.map(DevelopTransform::frame) != Some(frame)
        {
            self.develop = Some(DevelopTransform::framed(settings, frame).map_err(err)?);
        }
        Ok(())
    }

    fn detail_settings(&self) -> Result<DetailSettings, JsError> {
        Ok(self
            .develop
            .as_ref()
            .ok_or(JsError::new("missing develop transform"))?
            .settings()
            .detail)
    }

    fn prepare_preview(
        &mut self,
        settings: DevelopSettings,
        frame: VignetteFrame,
        tone: bool,
    ) -> Result<(), JsError> {
        if self.preview.as_ref().is_some_and(|preview| {
            preview.settings == settings && preview.frame == frame && preview.tone == tone
        }) {
            return Ok(());
        }
        self.prepare_develop(settings.clone(), frame)?;
        if !settings.detail.is_neutral() {
            self.prepare_preview_source(settings.detail)?;
        }
        let develop = self
            .develop
            .as_ref()
            .ok_or(JsError::new("missing develop transform"))?;
        let (thumb, lut) = self.thumb.as_ref().ok_or(JsError::new("merge first"))?;
        let rgb8 = match self.preview_source.as_ref() {
            Some(source) if !settings.detail.is_neutral() => {
                lut.render_prepared_adjusted(thumb, &source.region, develop, tone)
                    .rgb8
            }
            _ => lut.render_adjusted(thumb, develop, tone),
        };
        self.preview = Some(CachedPreview {
            settings,
            frame,
            tone,
            rgb8,
        });
        Ok(())
    }

    fn prepare_preview_source(&mut self, detail: DetailSettings) -> Result<(), JsError> {
        let key = DetailKey::from(&detail);
        if self.preview_source.as_ref().map(|source| source.detail) == Some(key) {
            return Ok(());
        }
        let (thumb, _) = self.thumb.as_ref().ok_or(JsError::new("merge first"))?;
        let size = (thumb.radiance.width, thumb.radiance.height);
        self.preview_source = Some(PreviewSource {
            detail: key,
            region: PreparedRegion::new(thumb, (0, 0), size, 1).detailed(&detail, 1),
        });
        Ok(())
    }
}

impl Default for Session {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn detail(name: &str, value: f32) -> DetailSettings {
        let mut settings = DetailSettings::NEUTRAL;
        match name {
            "clarity" => settings.clarity = value,
            "noiseLuminance" => settings.noise_luminance = value,
            "noiseColor" => settings.noise_color = value,
            "dehaze" => settings.dehaze = value,
            _ => panic!("unknown control"),
        }
        settings
    }

    fn region(detail: &DetailSettings) -> TileRegion {
        TileRegion {
            x: 0,
            y: 0,
            width: 16,
            height: 16,
            bin: 1,
            detail: DetailKey::from(detail),
        }
    }

    #[test]
    fn the_tile_cache_keys_on_the_tile_side_work_alone() {
        let neutral = DetailSettings::NEUTRAL;
        for changed in [
            detail("noiseLuminance", 40.0),
            detail("noiseColor", 15.0),
            detail("clarity", 20.0),
        ] {
            assert_ne!(region(&changed), region(&neutral));
        }
        assert_eq!(region(&detail("dehaze", 80.0)), region(&neutral));
        assert_eq!(
            region(&detail("clarity", 20.0)),
            region(&detail("clarity", 90.0))
        );
    }

    #[test]
    fn the_cache_budget_counts_the_blur_planes() {
        let tile = (16, 16);
        let quiet = DetailSettings::NEUTRAL;
        let sharp = detail("clarity", 60.0);
        let plain = PreparedRegion::fabricated(tile, &quiet);
        let detailed = PreparedRegion::fabricated(tile, &sharp);
        let planes = 16 * 16 * 2 * std::mem::size_of::<f32>();
        assert_eq!(detailed.byte_len(), plain.byte_len() + planes);

        let mut cache = TileCache::new(plain.byte_len() + planes);
        cache.insert(region(&quiet), PreparedRegion::fabricated(tile, &quiet));
        cache.insert(region(&sharp), PreparedRegion::fabricated(tile, &sharp));
        assert!(
            !cache.contains(&region(&quiet)),
            "the planes must count toward the budget"
        );
        assert_eq!(cache.bytes, detailed.byte_len());
    }
}
