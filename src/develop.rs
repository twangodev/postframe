use crate::composite::DevelopedTileRegion;
use crate::curve::{CHANNEL_CURVE_SAMPLES, ToneCurve};
use crate::detail::{DetailPlanes, DetailTransform};
use crate::effects::{self, VignetteFrame};
use crate::grade::{ColorSettings, ColorTransform};
use crate::light::{
    LightSettings, LightTransform, decode_srgb, encode_srgb, linear_to_srgb, srgb_to_linear,
};
use crate::{Error, Result, parallel};

#[derive(Clone, Copy, Debug, PartialEq)]
#[cfg_attr(feature = "wasm", derive(serde::Deserialize))]
pub struct CurvePoint {
    pub x: f32,
    pub y: f32,
}

/// Control points of a single tone curve, in ascending `x` order.
#[derive(Clone, Debug, PartialEq)]
#[cfg_attr(feature = "wasm", derive(serde::Deserialize))]
pub struct CurvePoints(pub Vec<CurvePoint>);

impl CurvePoints {
    pub fn identity() -> Self {
        Self(vec![
            CurvePoint { x: 0.0, y: 0.0 },
            CurvePoint { x: 1.0, y: 1.0 },
        ])
    }

    pub fn is_identity(&self) -> bool {
        *self == Self::identity()
    }

    fn validated(&self) -> Result<()> {
        if self.0.len() < 2 {
            return Err(Error::Unsupported("a curve needs at least two points"));
        }
        let mut previous = f32::NEG_INFINITY;
        for point in &self.0 {
            if !within(&[point.x, point.y], 0.0, 1.0) {
                return Err(Error::Unsupported(
                    "curve points must lie inside the unit square",
                ));
            }
            if point.x <= previous {
                return Err(Error::Unsupported("curve points must ascend in x"));
            }
            previous = point.x;
        }
        Ok(())
    }
}

#[derive(Clone, Debug, PartialEq)]
#[cfg_attr(feature = "wasm", derive(serde::Deserialize))]
pub struct CurveSettings {
    pub luminance: CurvePoints,
    pub red: CurvePoints,
    pub green: CurvePoints,
    pub blue: CurvePoints,
}

impl CurveSettings {
    pub fn neutral() -> Self {
        Self {
            luminance: CurvePoints::identity(),
            red: CurvePoints::identity(),
            green: CurvePoints::identity(),
            blue: CurvePoints::identity(),
        }
    }

    pub fn is_neutral(&self) -> bool {
        self.channels().all(CurvePoints::is_identity)
    }

    fn channels(&self) -> impl Iterator<Item = &CurvePoints> {
        [&self.luminance, &self.red, &self.green, &self.blue].into_iter()
    }

    pub fn validated(&self) -> Result<()> {
        self.channels().try_for_each(CurvePoints::validated)
    }
}

/// Hue bands of the color mixer, in wheel order.
pub const MIXER_BANDS: usize = 8;

#[derive(Clone, Copy, Debug, Default, PartialEq)]
#[cfg_attr(feature = "wasm", derive(serde::Deserialize))]
pub struct MixerBand {
    pub hue: f32,
    pub saturation: f32,
    pub luminance: f32,
}

#[derive(Clone, Copy, Debug, Default, PartialEq)]
#[cfg_attr(feature = "wasm", derive(serde::Deserialize))]
pub struct MixerSettings {
    pub red: MixerBand,
    pub orange: MixerBand,
    pub yellow: MixerBand,
    pub green: MixerBand,
    pub aqua: MixerBand,
    pub blue: MixerBand,
    pub purple: MixerBand,
    pub magenta: MixerBand,
}

impl MixerSettings {
    pub const NEUTRAL: Self = Self {
        red: NEUTRAL_BAND,
        orange: NEUTRAL_BAND,
        yellow: NEUTRAL_BAND,
        green: NEUTRAL_BAND,
        aqua: NEUTRAL_BAND,
        blue: NEUTRAL_BAND,
        purple: NEUTRAL_BAND,
        magenta: NEUTRAL_BAND,
    };

    pub fn bands(&self) -> [MixerBand; MIXER_BANDS] {
        [
            self.red,
            self.orange,
            self.yellow,
            self.green,
            self.aqua,
            self.blue,
            self.purple,
            self.magenta,
        ]
    }

    pub fn is_neutral(&self) -> bool {
        *self == Self::NEUTRAL
    }

    pub fn validated(&self) -> Result<()> {
        let within_range = self
            .bands()
            .into_iter()
            .all(|band| within(&[band.hue, band.saturation, band.luminance], -100.0, 100.0));
        if !within_range {
            return Err(Error::Unsupported(
                "color mixer controls must be between -100 and 100",
            ));
        }
        Ok(())
    }
}

const NEUTRAL_BAND: MixerBand = MixerBand {
    hue: 0.0,
    saturation: 0.0,
    luminance: 0.0,
};

#[derive(Clone, Copy, Debug, Default, PartialEq)]
#[cfg_attr(feature = "wasm", derive(serde::Deserialize))]
pub struct GradingWheel {
    pub hue: f32,
    pub saturation: f32,
    pub luminance: f32,
}

#[derive(Clone, Copy, Debug, PartialEq)]
#[cfg_attr(feature = "wasm", derive(serde::Deserialize))]
pub struct GradingSettings {
    pub shadows: GradingWheel,
    pub midtones: GradingWheel,
    pub highlights: GradingWheel,
    pub blending: f32,
    pub balance: f32,
}

impl GradingSettings {
    pub const NEUTRAL: Self = Self {
        shadows: NEUTRAL_WHEEL,
        midtones: NEUTRAL_WHEEL,
        highlights: NEUTRAL_WHEEL,
        blending: 50.0,
        balance: 0.0,
    };

    pub fn wheels(&self) -> [GradingWheel; 3] {
        [self.shadows, self.midtones, self.highlights]
    }

    pub fn is_neutral(&self) -> bool {
        self.wheels()
            .iter()
            .all(|wheel| wheel.saturation == 0.0 && wheel.luminance == 0.0)
    }

    pub fn validated(&self) -> Result<()> {
        let within_range = self.wheels().into_iter().all(|wheel| {
            within(&[wheel.hue], 0.0, 360.0)
                && within(&[wheel.saturation], 0.0, 100.0)
                && within(&[wheel.luminance], -100.0, 100.0)
        }) && within(&[self.blending], 0.0, 100.0)
            && within(&[self.balance], -100.0, 100.0);
        if !within_range {
            return Err(Error::Unsupported(
                "color grading controls are out of range",
            ));
        }
        Ok(())
    }
}

impl Default for GradingSettings {
    fn default() -> Self {
        Self::NEUTRAL
    }
}

const NEUTRAL_WHEEL: GradingWheel = GradingWheel {
    hue: 0.0,
    saturation: 0.0,
    luminance: 0.0,
};

#[derive(Clone, Copy, Debug, PartialEq)]
#[cfg_attr(feature = "wasm", derive(serde::Deserialize))]
#[cfg_attr(feature = "wasm", serde(rename_all = "camelCase"))]
pub struct DetailSettings {
    pub texture: f32,
    pub clarity: f32,
    pub dehaze: f32,
    pub sharpen_amount: f32,
    pub noise_luminance: f32,
    pub noise_color: f32,
}

impl DetailSettings {
    pub const NEUTRAL: Self = Self {
        texture: 0.0,
        clarity: 0.0,
        dehaze: 0.0,
        sharpen_amount: 0.0,
        noise_luminance: 0.0,
        noise_color: 0.0,
    };

    pub fn is_neutral(&self) -> bool {
        *self == Self::NEUTRAL
    }

    /// Radii, in fractions of the image's larger dimension, of the blur planes
    /// this configuration needs. Empty when no spatial stage is active.
    pub fn blur_radii(&self) -> Vec<f32> {
        if self.texture == 0.0 && self.clarity == 0.0 && self.sharpen_amount == 0.0 {
            return Vec::new();
        }
        vec![FINE_BLUR_FRACTION, COARSE_BLUR_FRACTION]
    }

    pub fn validated(&self) -> Result<()> {
        let within_range = within(&[self.texture, self.clarity, self.dehaze], -100.0, 100.0)
            && within(&[self.sharpen_amount], 0.0, 150.0)
            && within(&[self.noise_luminance, self.noise_color], 0.0, 100.0);
        if !within_range {
            return Err(Error::Unsupported("detail controls are out of range"));
        }
        Ok(())
    }
}

impl Default for DetailSettings {
    fn default() -> Self {
        Self::NEUTRAL
    }
}

pub const FINE_BLUR_FRACTION: f32 = 0.005;
pub const COARSE_BLUR_FRACTION: f32 = 0.03;

#[derive(Clone, Copy, Debug, PartialEq)]
#[cfg_attr(feature = "wasm", derive(serde::Deserialize))]
#[cfg_attr(feature = "wasm", serde(rename_all = "camelCase"))]
pub struct EffectsSettings {
    pub vignette_amount: f32,
    pub vignette_midpoint: f32,
    pub vignette_roundness: f32,
    pub vignette_feather: f32,
    pub grain_amount: f32,
    pub grain_size: f32,
}

impl EffectsSettings {
    pub const NEUTRAL: Self = Self {
        vignette_amount: 0.0,
        vignette_midpoint: 50.0,
        vignette_roundness: 0.0,
        vignette_feather: 50.0,
        grain_amount: 0.0,
        grain_size: 25.0,
    };

    pub fn is_neutral(&self) -> bool {
        self.vignette_amount == 0.0 && self.grain_amount == 0.0
    }

    pub fn validated(&self) -> Result<()> {
        let within_range = within(
            &[self.vignette_amount, self.vignette_roundness],
            -100.0,
            100.0,
        ) && within(
            &[
                self.vignette_midpoint,
                self.vignette_feather,
                self.grain_amount,
                self.grain_size,
            ],
            0.0,
            100.0,
        );
        if !within_range {
            return Err(Error::Unsupported("effect controls are out of range"));
        }
        Ok(())
    }
}

impl Default for EffectsSettings {
    fn default() -> Self {
        Self::NEUTRAL
    }
}

/// Every develop control for one document or one mask.
///
/// Stages compose in a fixed order, applied per pixel between an sRGB decode
/// and encode:
///
/// 1. white balance gains          (`color`)
/// 2. hue-band mixer               (`mixer`)
/// 3. grading wheels               (`grading`)
/// 4. saturation and vibrance      (`color`)
/// 5. dehaze                       (`detail`)
/// 6. clarity, texture, sharpening (`detail`, needs blur planes)
/// 7. vignette                     (`effects`, needs pixel position)
/// 8. light curve                  (`light` composed with `curve.luminance`)
/// 9. channel curves               (`curve.red`, `.green`, `.blue`, encoded)
/// 10. grain                       (`effects`, encoded)
///
/// Stages 5 and 6 also depend on tile-side work (noise reduction and blur
/// planes) that runs before the per-pixel chain.
#[derive(Clone, Debug, PartialEq)]
#[cfg_attr(feature = "wasm", derive(serde::Deserialize))]
pub struct DevelopSettings {
    pub light: LightSettings,
    pub color: ColorSettings,
    pub curve: CurveSettings,
    pub mixer: MixerSettings,
    pub grading: GradingSettings,
    pub detail: DetailSettings,
    pub effects: EffectsSettings,
}

impl DevelopSettings {
    pub fn neutral() -> Self {
        Self {
            light: LightSettings::NEUTRAL,
            color: ColorSettings::NEUTRAL,
            curve: CurveSettings::neutral(),
            mixer: MixerSettings::NEUTRAL,
            grading: GradingSettings::NEUTRAL,
            detail: DetailSettings::NEUTRAL,
            effects: EffectsSettings::NEUTRAL,
        }
    }

    pub fn tonal(light: LightSettings, color: ColorSettings) -> Self {
        Self {
            light,
            color,
            ..Self::neutral()
        }
    }

    pub fn is_neutral(&self) -> bool {
        self.light == LightSettings::NEUTRAL
            && self.color == ColorSettings::NEUTRAL
            && self.curve.is_neutral()
            && self.mixer.is_neutral()
            && self.grading.is_neutral()
            && self.detail.is_neutral()
            && self.effects.is_neutral()
    }

    pub fn validated(self) -> Result<Self> {
        self.light.validated()?;
        self.color.validated()?;
        self.curve.validated()?;
        self.mixer.validated()?;
        self.grading.validated()?;
        self.detail.validated()?;
        self.effects.validated()?;
        Ok(self)
    }
}

impl Default for DevelopSettings {
    fn default() -> Self {
        Self::neutral()
    }
}

/// Where a pixel sits in the image, for stages that are not purely tonal.
#[derive(Clone, Copy, Debug)]
pub struct PixelContext {
    pub x: usize,
    pub y: usize,
    pub image_width: usize,
    pub image_height: usize,
}

impl PixelContext {
    fn normalized(self) -> (f32, f32) {
        (
            (self.x as f32 + 0.5) / self.image_width.max(1) as f32,
            (self.y as f32 + 0.5) / self.image_height.max(1) as f32,
        )
    }

    fn aspect(self) -> f32 {
        self.image_width.max(1) as f32 / self.image_height.max(1) as f32
    }
}

/// The develop pipeline compiled into the form each render path consumes.
#[derive(Clone)]
pub struct DevelopTransform {
    settings: DevelopSettings,
    frame: VignetteFrame,
    light: LightTransform,
    color: ColorTransform,
    detail: DetailTransform,
    channels: Option<[ToneCurve; 3]>,
}

impl DevelopTransform {
    pub fn new(settings: DevelopSettings) -> Result<Self> {
        Self::framed(settings, VignetteFrame::FULL)
    }

    /// The same pipeline with its position-dependent stages centred on a
    /// rectangle of the image — the crop, when the document carries one.
    pub fn framed(settings: DevelopSettings, frame: VignetteFrame) -> Result<Self> {
        let settings = settings.validated()?;
        Ok(Self {
            frame: frame.validated()?,
            light: with_luminance_curve(
                LightTransform::new(settings.light)?,
                &settings.curve.luminance,
            ),
            color: ColorTransform::new(settings.color)?,
            detail: DetailTransform::new(settings.detail),
            channels: channel_curves(&settings.curve),
            settings,
        })
    }

    pub fn settings(&self) -> &DevelopSettings {
        &self.settings
    }

    pub fn frame(&self) -> VignetteFrame {
        self.frame
    }

    /// The luminance response with the luminance curve already composed in.
    pub fn luminance_lut(&self) -> &[f32] {
        self.light.luminance_lut()
    }

    /// Dense tables for the per-channel curves, absent while all three are the
    /// identity.
    pub fn channel_luts(&self) -> Option<[&[f32]; 3]> {
        self.channels
            .as_ref()
            .map(|curves| curves.each_ref().map(ToneCurve::samples))
    }

    pub fn apply_display_rgba8(&self, rgba: &[u8]) -> Result<Vec<u8>> {
        if !rgba.len().is_multiple_of(4) {
            return Err(Error::Unsupported("RGBA buffer size mismatch"));
        }
        let mut adjusted = Vec::with_capacity(rgba.len());
        for pixel in rgba.chunks_exact(4) {
            adjusted.extend(self.apply_display_pixel([pixel[0], pixel[1], pixel[2]]));
            adjusted.push(pixel[3]);
        }
        Ok(adjusted)
    }

    /// Develop a tile in place over the region of the image it covers, so the
    /// position-dependent stages know where each pixel came from.
    pub fn apply_display_rgba8_at(
        &self,
        rgba: &[u8],
        tile: (usize, usize),
        region: DevelopedTileRegion,
    ) -> Result<Vec<u8>> {
        if rgba.len() != tile.0.saturating_mul(tile.1).saturating_mul(4) {
            return Err(Error::Unsupported("RGBA buffer size mismatch"));
        }
        let mut adjusted = rgba.to_vec();
        parallel::fill_rows(&mut adjusted, tile.0 * 4, |output_y, row| {
            for (output_x, pixel) in row.chunks_exact_mut(4).enumerate() {
                let developed = self.apply_display_pixel_at(
                    [pixel[0], pixel[1], pixel[2]],
                    region.pixel_context((output_x, output_y), tile),
                );
                pixel[..3].copy_from_slice(&developed);
            }
        });
        Ok(adjusted)
    }

    /// The plane-free chain the masks share, which skips every stage that needs
    /// to know where a pixel is.
    pub fn apply_display_pixel(&self, pixel: [u8; 3]) -> [u8; 3] {
        self.apply_channel_curves(
            self.light
                .apply_display_pixel(self.color.apply_display_pixel(pixel)),
        )
    }

    /// The display path, which knows where a pixel is but has no blur planes:
    /// it composites unhaloed tiles, so the spatial stages stay out of it.
    /// Showing them in a preview its tiled export could not reproduce is worse
    /// than leaving them absent from both.
    pub fn apply_display_pixel_at(&self, pixel: [u8; 3], at: PixelContext) -> [u8; 3] {
        let shaded = self.vignetted(self.color.apply_display_pixel(pixel), at);
        let toned = self.apply_channel_curves(self.light.apply_display_pixel(shaded));
        self.grained(toned, at)
    }

    pub fn apply_encoded_pixel(&self, pixel: [u8; 3]) -> [u8; 3] {
        self.apply_channel_curves(
            self.light
                .apply_encoded_pixel(self.color.apply_display_pixel(pixel)),
        )
    }

    /// The tile chain, the only one where the spatial stages have the planes
    /// they need. Every stage in the order this type documents runs here.
    pub fn apply_encoded_pixel_at(
        &self,
        pixel: [u8; 3],
        at: PixelContext,
        planes: Option<&DetailPlanes>,
    ) -> [u8; 3] {
        let presented = self.presented(self.color.apply_display_pixel(pixel), at, planes);
        let shaded = self.vignetted(presented, at);
        let toned = self.apply_channel_curves(self.light.apply_encoded_pixel(shaded));
        self.grained(toned, at)
    }

    fn presented(
        &self,
        pixel: [u8; 3],
        at: PixelContext,
        planes: Option<&DetailPlanes>,
    ) -> [u8; 3] {
        self.detail
            .apply(pixel, planes.map(|planes| planes.sample(at)))
    }

    fn apply_channel_curves(&self, encoded: [u8; 3]) -> [u8; 3] {
        match &self.channels {
            None => encoded,
            Some(curves) => std::array::from_fn(|channel| {
                let curved = curves[channel].eval(f32::from(encoded[channel]) / 255.0);
                (curved * 255.0).round() as u8
            }),
        }
    }

    fn vignetted(&self, pixel: [u8; 3], at: PixelContext) -> [u8; 3] {
        let gain = effects::vignette_gain(
            self.settings.effects,
            self.frame,
            at.aspect(),
            at.normalized(),
        );
        if gain == 1.0 {
            return pixel;
        }
        pixel.map(|channel| linear_to_srgb(srgb_to_linear(channel) * gain))
    }

    fn grained(&self, pixel: [u8; 3], at: PixelContext) -> [u8; 3] {
        let effects = self.settings.effects;
        if effects.grain_amount == 0.0 {
            return pixel;
        }
        let luminance =
            (0.2126 * pixel[0] as f32 + 0.7152 * pixel[1] as f32 + 0.0722 * pixel[2] as f32)
                / 255.0;
        let offset = effects::grain_offset(
            effects,
            luminance,
            at.x as u32,
            at.y as u32,
            effects::grain_cell(at.image_width, at.image_height, effects.grain_size),
        );
        pixel.map(|channel| (channel as f32 + offset).round().clamp(0.0, 255.0) as u8)
    }
}

/// Folds the luminance curve into the light response, which every render path
/// already samples, so the curve reaches them all without a new stage. The
/// curve shapes encoded values, so the response is decoded around it.
fn with_luminance_curve(light: LightTransform, points: &CurvePoints) -> LightTransform {
    let curve = ToneCurve::new(points, light.luminance_lut().len());
    if curve.is_identity() {
        return light;
    }
    light.remapping_luminance(|linear| decode_srgb(curve.eval(encode_srgb(linear))))
}

fn channel_curves(settings: &CurveSettings) -> Option<[ToneCurve; 3]> {
    let curves = [&settings.red, &settings.green, &settings.blue]
        .map(|points| ToneCurve::new(points, CHANNEL_CURVE_SAMPLES));
    curves
        .iter()
        .any(|curve| !curve.is_identity())
        .then_some(curves)
}

fn within(values: &[f32], minimum: f32, maximum: f32) -> bool {
    values
        .iter()
        .all(|value| value.is_finite() && (minimum..=maximum).contains(value))
}

/// The wire format the web app sends, pinned so a rename on either side of the
/// boundary fails here rather than at runtime.
#[cfg(all(test, feature = "wasm"))]
mod wire {
    use super::*;

    const NEUTRAL_JSON: &str = r#"{
        "light": {
            "exposure": 0, "contrast": 0, "highlights": 0,
            "shadows": 0, "whites": 0, "blacks": 0
        },
        "color": { "temperature": 0, "tint": 0, "vibrance": 0, "saturation": 0 },
        "curve": {
            "luminance": [{ "x": 0, "y": 0 }, { "x": 1, "y": 1 }],
            "red": [{ "x": 0, "y": 0 }, { "x": 1, "y": 1 }],
            "green": [{ "x": 0, "y": 0 }, { "x": 1, "y": 1 }],
            "blue": [{ "x": 0, "y": 0 }, { "x": 1, "y": 1 }]
        },
        "mixer": {
            "red": { "hue": 0, "saturation": 0, "luminance": 0 },
            "orange": { "hue": 0, "saturation": 0, "luminance": 0 },
            "yellow": { "hue": 0, "saturation": 0, "luminance": 0 },
            "green": { "hue": 0, "saturation": 0, "luminance": 0 },
            "aqua": { "hue": 0, "saturation": 0, "luminance": 0 },
            "blue": { "hue": 0, "saturation": 0, "luminance": 0 },
            "purple": { "hue": 0, "saturation": 0, "luminance": 0 },
            "magenta": { "hue": 0, "saturation": 0, "luminance": 0 }
        },
        "grading": {
            "shadows": { "hue": 0, "saturation": 0, "luminance": 0 },
            "midtones": { "hue": 0, "saturation": 0, "luminance": 0 },
            "highlights": { "hue": 0, "saturation": 0, "luminance": 0 },
            "blending": 50,
            "balance": 0
        },
        "detail": {
            "texture": 0, "clarity": 0, "dehaze": 0,
            "sharpenAmount": 0, "noiseLuminance": 0, "noiseColor": 0
        },
        "effects": {
            "vignetteAmount": 0, "vignetteMidpoint": 50, "vignetteRoundness": 0,
            "vignetteFeather": 50, "grainAmount": 0, "grainSize": 25
        }
    }"#;

    #[test]
    fn the_web_apps_neutral_document_deserializes_to_neutral_settings() {
        let parsed: DevelopSettings = serde_json::from_str(NEUTRAL_JSON).unwrap();
        assert_eq!(parsed, DevelopSettings::neutral());
    }

    #[test]
    fn a_missing_group_is_rejected_rather_than_silently_defaulted() {
        let without_effects = NEUTRAL_JSON
            .split_once(",\n        \"effects\"")
            .map(|(head, _)| format!("{head}\n    }}"))
            .unwrap();
        assert!(serde_json::from_str::<DevelopSettings>(&without_effects).is_err());
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn vivid() -> DevelopSettings {
        DevelopSettings::tonal(
            LightSettings {
                exposure: 0.75,
                contrast: 40.0,
                ..LightSettings::NEUTRAL
            },
            ColorSettings {
                temperature: 60.0,
                tint: -25.0,
                vibrance: 40.0,
                saturation: 30.0,
            },
        )
    }

    fn effected(effects: EffectsSettings) -> DevelopTransform {
        DevelopTransform::new(DevelopSettings {
            effects,
            ..DevelopSettings::neutral()
        })
        .unwrap()
    }

    fn whole(width: usize, height: usize) -> DevelopedTileRegion {
        DevelopedTileRegion {
            image_width: width,
            image_height: height,
            x: 0,
            y: 0,
            width,
            height,
        }
    }

    fn at(x: usize, y: usize) -> PixelContext {
        PixelContext {
            x,
            y,
            image_width: 63,
            image_height: 47,
        }
    }

    #[test]
    fn neutral_settings_leave_every_byte_untouched() {
        let transform = DevelopTransform::new(DevelopSettings::neutral()).unwrap();
        let source = [0, 31, 127, 9, 201, 240, 255, 73];
        assert_eq!(transform.apply_display_rgba8(&source).unwrap(), source);
        assert_eq!(
            transform
                .apply_display_rgba8_at(&source, (2, 1), whole(2, 1))
                .unwrap(),
            source
        );
    }

    #[test]
    fn position_changes_nothing_until_an_effect_asks_for_it() {
        let settings = DevelopSettings {
            effects: EffectsSettings {
                vignette_midpoint: 20.0,
                vignette_roundness: 100.0,
                vignette_feather: 0.0,
                grain_size: 80.0,
                ..EffectsSettings::NEUTRAL
            },
            ..vivid()
        };
        let transform = DevelopTransform::new(settings).unwrap();
        for pixel in [[0, 0, 0], [12, 200, 96], [128, 128, 128], [255, 255, 255]] {
            for position in [(0, 0), (31, 23), (62, 46)] {
                let placed = transform.apply_display_pixel_at(pixel, at(position.0, position.1));
                assert_eq!(placed, transform.apply_display_pixel(pixel));
            }
        }
    }

    #[test]
    fn the_vignette_darkens_the_corners_and_leaves_the_frame_centre_exact() {
        let transform = effected(EffectsSettings {
            vignette_amount: -100.0,
            ..EffectsSettings::NEUTRAL
        });
        let gray = [128, 128, 128];
        assert_eq!(transform.apply_display_pixel_at(gray, at(31, 23)), gray);
        let corner = transform.apply_display_pixel_at(gray, at(0, 0));
        assert!(corner[0] < gray[0], "corner {corner:?}");
        let brightened = effected(EffectsSettings {
            vignette_amount: 100.0,
            ..EffectsSettings::NEUTRAL
        })
        .apply_display_pixel_at(gray, at(0, 0));
        assert!(brightened[0] > gray[0], "corner {brightened:?}");
    }

    #[test]
    fn the_vignette_scales_the_channels_alike() {
        let transform = effected(EffectsSettings {
            vignette_amount: -75.0,
            ..EffectsSettings::NEUTRAL
        });
        let source = [64, 128, 192];
        let corner = transform.apply_display_pixel_at(source, at(0, 46));
        let scale = |channel: usize| {
            crate::light::srgb_to_linear(corner[channel])
                / crate::light::srgb_to_linear(source[channel])
        };
        assert!(
            (scale(0) - scale(1)).abs() < 0.01,
            "{} {}",
            scale(0),
            scale(1)
        );
        assert!(
            (scale(1) - scale(2)).abs() < 0.01,
            "{} {}",
            scale(1),
            scale(2)
        );
    }

    #[test]
    fn the_vignette_centres_on_the_frame_rather_than_the_image() {
        let settings = DevelopSettings {
            effects: EffectsSettings {
                vignette_amount: -100.0,
                vignette_midpoint: 30.0,
                ..EffectsSettings::NEUTRAL
            },
            ..DevelopSettings::neutral()
        };
        let corner = VignetteFrame {
            x: 0.0,
            y: 0.0,
            width: 0.25,
            height: 0.25,
        };
        let transform = DevelopTransform::framed(settings, corner).unwrap();
        let gray = [128, 128, 128];
        let brightest = (0..47)
            .flat_map(|y| (0..63).map(move |x| (x, y)))
            .max_by_key(|&(x, y)| transform.apply_display_pixel_at(gray, at(x, y))[0])
            .unwrap();
        assert!(
            brightest.0 < 16 && brightest.1 < 12,
            "the gain peaks at {brightest:?}, outside the frame"
        );
        assert!(
            transform.apply_display_pixel_at(gray, at(31, 23))[0] < gray[0],
            "the image centre escaped the falloff"
        );
    }

    #[test]
    fn grain_ignores_which_tile_carried_the_pixel() {
        let transform = effected(EffectsSettings {
            grain_amount: 100.0,
            ..EffectsSettings::NEUTRAL
        });
        let strip: Vec<u8> = std::iter::repeat_n([128, 128, 128, 255], 4)
            .flatten()
            .collect();
        let region = |x: usize, width: usize| DevelopedTileRegion {
            image_width: 4,
            image_height: 1,
            x,
            y: 0,
            width,
            height: 1,
        };
        let whole_strip = transform
            .apply_display_rgba8_at(&strip, (4, 1), region(0, 4))
            .unwrap();
        let left = transform
            .apply_display_rgba8_at(&strip[..8], (2, 1), region(0, 2))
            .unwrap();
        let right = transform
            .apply_display_rgba8_at(&strip[8..], (2, 1), region(2, 2))
            .unwrap();
        assert_eq!(whole_strip[..8], left[..]);
        assert_eq!(whole_strip[8..], right[..]);
        assert_ne!(whole_strip, strip);
    }

    #[test]
    fn grain_spares_the_darkest_and_brightest_pixels() {
        let transform = effected(EffectsSettings {
            grain_amount: 100.0,
            ..EffectsSettings::NEUTRAL
        });
        let moved = |pixel: [u8; 3]| {
            (0..16)
                .map(|x| {
                    let developed = transform.apply_display_pixel_at(pixel, at(x, 3));
                    (developed[0] as i16 - pixel[0] as i16).abs()
                })
                .max()
                .unwrap()
        };
        assert_eq!(moved([0, 0, 0]), 0);
        assert_eq!(moved([255, 255, 255]), 0);
        assert!(moved([128, 128, 128]) > 0);
        assert_eq!(
            effected(EffectsSettings::NEUTRAL).apply_display_pixel_at([128, 128, 128], at(3, 3)),
            [128, 128, 128]
        );
    }

    #[test]
    fn stages_compose_color_before_light() {
        let settings = vivid();
        let transform = DevelopTransform::new(settings.clone()).unwrap();
        let source = [180, 120, 60, 255, 32, 96, 200, 137];
        let staged = ColorTransform::new(settings.color)
            .unwrap()
            .apply_display_rgba8(&source)
            .unwrap();
        let expected = LightTransform::new(settings.light)
            .unwrap()
            .apply_display_rgba8(&staged)
            .unwrap();
        assert_eq!(transform.apply_display_rgba8(&source).unwrap(), expected);
    }

    fn presence() -> DevelopSettings {
        DevelopSettings {
            detail: DetailSettings {
                clarity: 70.0,
                texture: -40.0,
                dehaze: 55.0,
                sharpen_amount: 90.0,
                ..DetailSettings::NEUTRAL
            },
            ..vivid()
        }
    }

    fn single_pixel_planes(settings: &DetailSettings) -> DetailPlanes {
        let tile: Vec<[f32; 3]> = (0..16)
            .map(|index| [0.05 + index as f32 * 0.06; 3])
            .collect();
        DetailPlanes::build(
            &tile,
            DevelopedTileRegion {
                image_width: 4,
                image_height: 4,
                x: 0,
                y: 0,
                width: 4,
                height: 4,
            },
            (4, 4),
            1,
            settings,
        )
        .unwrap()
    }

    fn origin(image: (usize, usize)) -> PixelContext {
        PixelContext {
            x: 0,
            y: 0,
            image_width: image.0,
            image_height: image.1,
        }
    }

    #[test]
    fn the_plane_free_entry_points_leave_the_detail_group_inactive() {
        let settings = presence();
        let detailed = DevelopTransform::new(settings.clone()).unwrap();
        let tonal = DevelopTransform::new(DevelopSettings {
            detail: DetailSettings::NEUTRAL,
            ..settings
        })
        .unwrap();
        for code in [0u8, 17, 96, 128, 200, 255] {
            let pixel = [code, 255 - code, code / 3];
            assert_eq!(
                detailed.apply_display_pixel(pixel),
                tonal.apply_display_pixel(pixel)
            );
            assert_eq!(
                detailed.apply_encoded_pixel(pixel),
                tonal.apply_encoded_pixel(pixel)
            );
        }
    }

    #[test]
    fn the_detail_stages_run_between_color_and_light() {
        let settings = presence();
        let transform = DevelopTransform::new(settings.clone()).unwrap();
        let planes = single_pixel_planes(&settings.detail);
        let color = ColorTransform::new(settings.color).unwrap();
        let light = LightTransform::new(settings.light).unwrap();
        let detail = DetailTransform::new(settings.detail);
        for code in [12u8, 77, 143, 219] {
            let pixel = [code, code / 2, 255 - code];
            let at = origin((4, 4));
            let staged = light.apply_encoded_pixel(
                detail.apply(color.apply_display_pixel(pixel), Some(planes.sample(at))),
            );
            assert_eq!(
                transform.apply_encoded_pixel_at(pixel, at, Some(&planes)),
                staged
            );
        }
    }

    #[test]
    fn a_neutral_detail_group_renders_a_tile_exactly_as_before() {
        let transform = DevelopTransform::new(vivid()).unwrap();
        let planes = single_pixel_planes(&DetailSettings {
            clarity: 40.0,
            ..DetailSettings::NEUTRAL
        });
        for code in 0..=255u8 {
            let pixel = [code, 255 - code, 128];
            assert_eq!(
                transform.apply_encoded_pixel_at(pixel, origin((4, 4)), Some(&planes)),
                transform.apply_encoded_pixel(pixel)
            );
        }
    }

    /// A dropped stage compiles and passes most tests, so every one of them is
    /// pinned by a control that must move the tile it renders.
    #[test]
    fn every_stage_reaches_the_tile_chain() {
        let planes = single_pixel_planes(&DetailSettings {
            clarity: 60.0,
            ..DetailSettings::NEUTRAL
        });
        let region = DevelopedTileRegion {
            image_width: 4,
            image_height: 4,
            x: 0,
            y: 0,
            width: 4,
            height: 4,
        };
        let tile = |settings: DevelopSettings| {
            let transform = DevelopTransform::new(settings).unwrap();
            (0..16)
                .flat_map(|index| {
                    let output = (index % 4, index / 4);
                    let shade = 40 + index as u8 * 12;
                    transform.apply_encoded_pixel_at(
                        [shade, 255 - shade, 128],
                        region.pixel_context(output, (4, 4)),
                        Some(&planes),
                    )
                })
                .collect::<Vec<u8>>()
        };
        let neutral = tile(DevelopSettings::neutral());
        let bent = CurvePoints(vec![
            CurvePoint { x: 0.0, y: 0.0 },
            CurvePoint { x: 0.5, y: 0.62 },
            CurvePoint { x: 1.0, y: 1.0 },
        ]);

        let stages: [(&str, DevelopSettings); 9] = [
            ("1 white balance", tweak(|s| s.color.temperature = 70.0)),
            ("4 saturation", tweak(|s| s.color.saturation = -80.0)),
            ("5 dehaze", tweak(|s| s.detail.dehaze = 70.0)),
            ("6 clarity", tweak(|s| s.detail.clarity = 90.0)),
            ("7 vignette", tweak(|s| s.effects.vignette_amount = -90.0)),
            ("8 light", tweak(|s| s.light.contrast = 60.0)),
            (
                "8 luminance curve",
                tweak(|s| s.curve.luminance = bent.clone()),
            ),
            ("9 channel curves", tweak(|s| s.curve.red = bent.clone())),
            ("10 grain", tweak(|s| s.effects.grain_amount = 100.0)),
        ];
        for (stage, settings) in stages {
            assert_ne!(
                tile(settings),
                neutral,
                "stage {stage} never reached the tile"
            );
        }
    }

    fn tweak(change: impl FnOnce(&mut DevelopSettings)) -> DevelopSettings {
        let mut settings = DevelopSettings::neutral();
        change(&mut settings);
        settings
    }

    #[test]
    fn neutrality_tracks_every_group() {
        assert!(DevelopSettings::neutral().is_neutral());
        assert!(!vivid().is_neutral());
        let curved = DevelopSettings {
            curve: CurveSettings {
                luminance: CurvePoints(vec![
                    CurvePoint { x: 0.0, y: 0.0 },
                    CurvePoint { x: 0.5, y: 0.6 },
                    CurvePoint { x: 1.0, y: 1.0 },
                ]),
                ..CurveSettings::neutral()
            },
            ..DevelopSettings::neutral()
        };
        assert!(!curved.is_neutral());
        let vignetted = DevelopSettings {
            effects: EffectsSettings {
                vignette_amount: -40.0,
                ..EffectsSettings::NEUTRAL
            },
            ..DevelopSettings::neutral()
        };
        assert!(!vignetted.is_neutral());
    }

    #[test]
    fn spatial_stages_request_blur_planes_only_when_active() {
        assert!(DetailSettings::NEUTRAL.blur_radii().is_empty());
        assert!(
            DetailSettings {
                noise_luminance: 60.0,
                dehaze: 40.0,
                ..DetailSettings::NEUTRAL
            }
            .blur_radii()
            .is_empty(),
            "only the unsharp stages read a blur plane"
        );
        assert_eq!(
            DetailSettings {
                clarity: 30.0,
                ..DetailSettings::NEUTRAL
            }
            .blur_radii(),
            vec![FINE_BLUR_FRACTION, COARSE_BLUR_FRACTION]
        );
    }

    #[test]
    fn validation_rejects_out_of_range_controls() {
        let out_of_range = |settings: DevelopSettings| settings.validated().is_err();
        assert!(out_of_range(DevelopSettings {
            detail: DetailSettings {
                clarity: 101.0,
                ..DetailSettings::NEUTRAL
            },
            ..DevelopSettings::neutral()
        }));
        assert!(out_of_range(DevelopSettings {
            effects: EffectsSettings {
                grain_amount: f32::NAN,
                ..EffectsSettings::NEUTRAL
            },
            ..DevelopSettings::neutral()
        }));
        assert!(out_of_range(DevelopSettings {
            grading: GradingSettings {
                shadows: GradingWheel {
                    hue: 361.0,
                    ..NEUTRAL_WHEEL
                },
                ..GradingSettings::NEUTRAL
            },
            ..DevelopSettings::neutral()
        }));
        assert!(DevelopSettings::neutral().validated().is_ok());
    }

    fn shaped(points: &[(f32, f32)]) -> CurvePoints {
        CurvePoints(
            points
                .iter()
                .map(|&(x, y)| CurvePoint { x, y })
                .collect::<Vec<_>>(),
        )
    }

    fn curved(curve: CurveSettings) -> DevelopTransform {
        DevelopTransform::new(DevelopSettings {
            curve,
            ..DevelopSettings::neutral()
        })
        .unwrap()
    }

    fn gray(transform: &DevelopTransform, value: u8) -> [u8; 3] {
        transform.apply_display_pixel([value; 3])
    }

    #[test]
    fn an_identity_curve_leaves_the_light_response_untouched() {
        let settings = LightSettings {
            contrast: 35.0,
            shadows: -20.0,
            ..LightSettings::NEUTRAL
        };
        let transform = DevelopTransform::new(DevelopSettings {
            light: settings,
            ..DevelopSettings::neutral()
        })
        .unwrap();
        assert_eq!(
            transform.luminance_lut(),
            LightTransform::new(settings).unwrap().luminance_lut()
        );
        assert!(transform.channel_luts().is_none());
    }

    #[test]
    fn the_luminance_curve_reaches_every_path_through_the_light_response() {
        let transform = curved(CurveSettings {
            luminance: shaped(&[(0.0, 0.0), (0.25, 0.45), (1.0, 1.0)]),
            ..CurveSettings::neutral()
        });
        assert_ne!(
            transform.luminance_lut(),
            LightTransform::new(LightSettings::NEUTRAL)
                .unwrap()
                .luminance_lut()
        );
        assert!(gray(&transform, 128)[1] > 128);
        for (index, pair) in transform.luminance_lut().windows(2).enumerate() {
            assert!(
                pair[0] <= pair[1],
                "composed response reverses at sample {index}: {} then {}",
                pair[0],
                pair[1]
            );
        }
    }

    #[test]
    fn a_channel_curve_moves_only_its_own_channel() {
        let transform = curved(CurveSettings {
            red: shaped(&[(0.0, 0.0), (0.5, 0.7), (1.0, 1.0)]),
            ..CurveSettings::neutral()
        });
        let adjusted = gray(&transform, 128);
        assert!(adjusted[0] > 128, "red stayed at {}", adjusted[0]);
        assert_eq!([adjusted[1], adjusted[2]], [128, 128]);
        assert_eq!(
            transform.channel_luts().map(|luts| luts.map(<[f32]>::len)),
            Some([CHANNEL_CURVE_SAMPLES; 3])
        );
    }

    #[test]
    fn channel_curves_run_on_encoded_values_after_the_light_stage() {
        let curve = CurveSettings {
            blue: shaped(&[(0.0, 0.0), (0.5, 0.3), (1.0, 1.0)]),
            ..CurveSettings::neutral()
        };
        let transform = DevelopTransform::new(DevelopSettings {
            light: LightSettings {
                contrast: 30.0,
                ..LightSettings::NEUTRAL
            },
            curve: curve.clone(),
            ..DevelopSettings::neutral()
        })
        .unwrap();
        let lit = DevelopTransform::new(DevelopSettings {
            light: transform.settings().light,
            ..DevelopSettings::neutral()
        })
        .unwrap();
        let blue = ToneCurve::new(&curve.blue, CHANNEL_CURVE_SAMPLES);
        let source = [90, 140, 200];
        let expected = lit.apply_display_pixel(source);
        assert_eq!(
            transform.apply_display_pixel(source),
            [
                expected[0],
                expected[1],
                (blue.eval(f32::from(expected[2]) / 255.0) * 255.0).round() as u8
            ]
        );
    }

    #[test]
    fn a_malformed_curve_never_reaches_the_curve_stage() {
        assert!(
            DevelopTransform::new(DevelopSettings {
                curve: CurveSettings {
                    red: shaped(&[(0.0, 0.0), (0.5, 1.5), (1.0, 1.0)]),
                    ..CurveSettings::neutral()
                },
                ..DevelopSettings::neutral()
            })
            .is_err()
        );
    }

    #[test]
    fn validation_rejects_malformed_curves() {
        let curve = |points: Vec<CurvePoint>| {
            DevelopSettings {
                curve: CurveSettings {
                    luminance: CurvePoints(points),
                    ..CurveSettings::neutral()
                },
                ..DevelopSettings::neutral()
            }
            .validated()
            .is_err()
        };
        let point = |x: f32, y: f32| CurvePoint { x, y };
        assert!(curve(vec![point(0.0, 0.0)]));
        assert!(curve(vec![point(0.5, 0.0), point(0.5, 1.0)]));
        assert!(curve(vec![point(0.0, 0.0), point(1.0, 1.5)]));
        assert!(!curve(vec![
            point(0.0, 0.0),
            point(0.5, 0.6),
            point(1.0, 1.0)
        ]));
    }
}
