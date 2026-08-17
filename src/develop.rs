use crate::grade::{ColorSettings, ColorTransform};
use crate::hue::{
    brightest, chroma_fraction, from_hue, hue_degrees, luminance, scale_luminance,
    scale_saturation, with_hue_shift,
};
use crate::light::{LightSettings, LightTransform, MIDDLE_GRAY, linear_to_srgb, srgb_to_linear};
use crate::{Error, Result};

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

pub const MIXER_BAND_CENTERS: [f32; MIXER_BANDS] =
    [0.0, 30.0, 60.0, 120.0, 180.0, 240.0, 280.0, 320.0];
pub const MIXER_LUT_LENGTH: usize = 360;
pub const MAX_MIXER_HUE_SHIFT_DEGREES: f32 = 30.0;

/// How much each band claims of a hue. Adjacent bands cross over as a raised
/// cosine and every other band contributes nothing, so the eight weights sum
/// to one at every hue and a color between two bands blends them.
pub fn mixer_band_weights(degrees: f32) -> [f32; MIXER_BANDS] {
    let hue = degrees.rem_euclid(360.0);
    let below = MIXER_BAND_CENTERS
        .iter()
        .rposition(|&center| center <= hue)
        .unwrap_or(MIXER_BANDS - 1);
    let above = (below + 1) % MIXER_BANDS;
    let span = (MIXER_BAND_CENTERS[above] - MIXER_BAND_CENTERS[below]).rem_euclid(360.0);
    let position = (hue - MIXER_BAND_CENTERS[below]).rem_euclid(360.0) / span;
    let crossfade = (1.0 - (std::f32::consts::PI * position).cos()) / 2.0;
    let mut weights = [0.0; MIXER_BANDS];
    weights[below] = 1.0 - crossfade;
    weights[above] = crossfade;
    weights
}

/// The mixer's response sampled once per hue degree: a shift in degrees plus
/// multiplicative saturation and luminance scales.
#[derive(Clone, Debug, PartialEq)]
pub struct MixerLuts {
    hue_shift: Vec<f32>,
    saturation: Vec<f32>,
    luminance: Vec<f32>,
}

impl MixerLuts {
    pub fn new(settings: &MixerSettings) -> Self {
        let bands = settings.bands();
        let blend = |control: fn(&MixerBand) -> f32, neutral: f32, range: f32| {
            (0..MIXER_LUT_LENGTH)
                .map(|degree| {
                    let weighted: f32 = mixer_band_weights(degree as f32)
                        .iter()
                        .zip(&bands)
                        .map(|(weight, band)| weight * control(band) / 100.0 * range)
                        .sum();
                    neutral + weighted
                })
                .collect()
        };
        Self {
            hue_shift: blend(|band| band.hue, 0.0, MAX_MIXER_HUE_SHIFT_DEGREES),
            saturation: blend(|band| band.saturation, 1.0, 1.0),
            luminance: blend(|band| band.luminance, 1.0, 1.0),
        }
    }

    /// The three tables end to end, in the order the shader reads them.
    pub fn values(&self) -> Vec<f32> {
        [&self.hue_shift, &self.saturation, &self.luminance]
            .into_iter()
            .flatten()
            .copied()
            .collect()
    }

    pub fn apply(&self, linear: [f32; 3]) -> [f32; 3] {
        let chroma = chroma_fraction(linear);
        if chroma <= 0.0 {
            return linear;
        }
        let hue = hue_degrees(linear);
        let faded = |table: &[f32], neutral: f32| neutral + (sample(table, hue) - neutral) * chroma;
        let shifted = with_hue_shift(linear, faded(&self.hue_shift, 0.0));
        let saturated = scale_saturation(shifted, faded(&self.saturation, 1.0));
        scale_luminance(saturated, faded(&self.luminance, 1.0))
    }
}

/// Wrapping linear interpolation, so hue 359.5 blends back into hue 0.
fn sample(table: &[f32], hue: f32) -> f32 {
    let position = hue.rem_euclid(table.len() as f32);
    let index = position as usize % table.len();
    let fraction = position - index as f32;
    let above = table[(index + 1) % table.len()];
    table[index] + fraction * (above - table[index])
}

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

pub const GRADING_SHADOW_EDGE_STOPS: f32 = -1.0;
pub const GRADING_HIGHLIGHT_EDGE_STOPS: f32 = 1.0;
pub const MIN_GRADING_CROSSFADE_STOPS: f32 = 0.5;
pub const MAX_GRADING_CROSSFADE_STOPS: f32 = 2.5;
pub const MAX_GRADING_BALANCE_STOPS: f32 = 2.0;
pub const MAX_GRADING_LUMINANCE_STOPS: f32 = 0.5;
pub const MAX_GRADING_MIX: f32 = 0.5;
pub const GRADING_SCALARS: usize = 12;

/// One wheel reduced to what a pixel needs: a hue to move toward, how far to
/// move at full range weight, and an exposure shift in stops.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct GradingRange {
    pub hue: f32,
    pub mix: f32,
    pub stops: f32,
}

impl GradingRange {
    fn blend(&self, linear: [f32; 3], weight: f32) -> [f32; 3] {
        let amount = self.mix * weight;
        if amount <= 0.0 {
            return linear;
        }
        let tint = from_hue(self.hue, 1.0, brightest(linear));
        std::array::from_fn(|channel| linear[channel] + (tint[channel] - linear[channel]) * amount)
    }
}

/// The grading wheels compiled to the tonal ramps and per-range tints both
/// render paths apply.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct GradingTransform {
    pub shadow_edge: f32,
    pub highlight_edge: f32,
    pub crossfade: f32,
    pub ranges: [GradingRange; 3],
}

impl GradingTransform {
    pub fn new(settings: GradingSettings) -> Self {
        let balance = settings.balance / 100.0 * MAX_GRADING_BALANCE_STOPS;
        let widening =
            settings.blending / 100.0 * (MAX_GRADING_CROSSFADE_STOPS - MIN_GRADING_CROSSFADE_STOPS);
        Self {
            shadow_edge: GRADING_SHADOW_EDGE_STOPS + balance,
            highlight_edge: GRADING_HIGHLIGHT_EDGE_STOPS + balance,
            crossfade: MIN_GRADING_CROSSFADE_STOPS + widening,
            ranges: settings.wheels().map(|wheel| GradingRange {
                hue: wheel.hue,
                mix: wheel.saturation / 100.0 * MAX_GRADING_MIX,
                stops: wheel.luminance / 100.0 * MAX_GRADING_LUMINANCE_STOPS,
            }),
        }
    }

    /// Shadow, midtone and highlight weights at a linear luminance. The
    /// midtone is the remainder, so the three sum to one everywhere and
    /// grading on its own can neither darken nor brighten the image.
    pub fn range_weights(&self, luminance: f32) -> [f32; 3] {
        let stops = (luminance.max(f32::MIN_POSITIVE) / MIDDLE_GRAY).log2();
        let above = |edge: f32| smoothstep(edge - self.crossfade, edge + self.crossfade, stops);
        let shadow = 1.0 - above(self.shadow_edge);
        let highlight = above(self.highlight_edge);
        [shadow, 1.0 - shadow - highlight, highlight]
    }

    /// The ramp edges, the crossfade half-width, then each range's hue, mix and
    /// stops — the order the shader's uniform block declares them in.
    pub fn scalars(&self) -> Vec<f32> {
        [self.shadow_edge, self.highlight_edge, self.crossfade]
            .into_iter()
            .chain(
                self.ranges
                    .iter()
                    .flat_map(|range| [range.hue, range.mix, range.stops]),
            )
            .collect()
    }

    pub fn apply(&self, linear: [f32; 3]) -> [f32; 3] {
        let weights = self.range_weights(luminance(linear));
        let mut tinted = linear;
        let mut stops = 0.0;
        for (range, weight) in self.ranges.iter().zip(weights) {
            tinted = range.blend(tinted, weight);
            stops += range.stops * weight;
        }
        scale_luminance(tinted, exp2(stops))
    }
}

fn smoothstep(start: f32, end: f32, value: f32) -> f32 {
    let position = ((value - start) / (end - start)).clamp(0.0, 1.0);
    position * position * (3.0 - 2.0 * position)
}

fn exp2(stops: f32) -> f32 {
    if stops == 0.0 {
        1.0
    } else {
        2.0f32.powf(stops)
    }
}

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
        if self.is_neutral() {
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

/// The develop pipeline compiled into the form each render path consumes.
#[derive(Clone)]
pub struct DevelopTransform {
    settings: DevelopSettings,
    light: LightTransform,
    color: ColorTransform,
    mixer: MixerLuts,
    grading: GradingTransform,
    hue_identity: bool,
}

impl DevelopTransform {
    pub fn new(settings: DevelopSettings) -> Result<Self> {
        let settings = settings.validated()?;
        Ok(Self {
            light: LightTransform::new(settings.light)?,
            color: ColorTransform::new(settings.color)?,
            mixer: MixerLuts::new(&settings.mixer),
            grading: GradingTransform::new(settings.grading),
            hue_identity: settings.mixer.is_neutral() && settings.grading.is_neutral(),
            settings,
        })
    }

    pub fn settings(&self) -> &DevelopSettings {
        &self.settings
    }

    pub fn luminance_lut(&self) -> &[f32] {
        self.light.luminance_lut()
    }

    pub fn mixer_luts(&self) -> &MixerLuts {
        &self.mixer
    }

    pub fn grading(&self) -> GradingTransform {
        self.grading
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

    pub fn apply_display_pixel(&self, pixel: [u8; 3]) -> [u8; 3] {
        self.light
            .apply_display_pixel(self.apply_chroma_pixel(pixel))
    }

    pub fn apply_encoded_pixel(&self, pixel: [u8; 3]) -> [u8; 3] {
        self.light
            .apply_encoded_pixel(self.apply_chroma_pixel(pixel))
    }

    /// Stages one through four. The hue stages open up the color transform's
    /// linear pass so they can sit between its white balance and its chroma
    /// scale; with both neutral the pass stays closed and untouched.
    fn apply_chroma_pixel(&self, pixel: [u8; 3]) -> [u8; 3] {
        if self.hue_identity {
            return self.color.apply_display_pixel(pixel);
        }
        let balanced = self.color.balanced(pixel.map(srgb_to_linear));
        let graded = self.grading.apply(self.mixer.apply(balanced));
        self.color.scale_chroma(graded).map(linear_to_srgb)
    }
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

    #[test]
    fn neutral_settings_leave_every_byte_untouched() {
        let transform = DevelopTransform::new(DevelopSettings::neutral()).unwrap();
        let source = [0, 31, 127, 9, 201, 240, 255, 73];
        assert_eq!(transform.apply_display_rgba8(&source).unwrap(), source);
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

    fn banded(band: &str, values: MixerBand) -> DevelopSettings {
        let mut mixer = MixerSettings::NEUTRAL;
        match band {
            "red" => mixer.red = values,
            "yellow" => mixer.yellow = values,
            "blue" => mixer.blue = values,
            _ => panic!("unknown band"),
        }
        DevelopSettings {
            mixer,
            ..DevelopSettings::neutral()
        }
    }

    fn shadow_wheel(wheel: GradingWheel) -> GradingSettings {
        GradingSettings {
            shadows: wheel,
            ..GradingSettings::NEUTRAL
        }
    }

    #[test]
    fn mixer_band_weights_sum_to_one_across_the_whole_wheel() {
        let worst = (0..3_600)
            .map(|tenth| {
                let sum: f32 = mixer_band_weights(tenth as f32 / 10.0).into_iter().sum();
                (sum - 1.0).abs()
            })
            .fold(0.0f32, f32::max);
        assert!(worst < 1e-5, "weights deviate from one by {worst}");
    }

    #[test]
    fn every_band_owns_its_center_alone() {
        for (band, center) in MIXER_BAND_CENTERS.into_iter().enumerate() {
            let weights = mixer_band_weights(center);
            assert_eq!(weights[band], 1.0, "band {band} does not own {center}");
            assert_eq!(weights.into_iter().sum::<f32>(), 1.0);
        }
    }

    #[test]
    fn moving_one_band_leaves_a_distant_hue_byte_identical() {
        let moved = MixerBand {
            hue: 100.0,
            saturation: -100.0,
            luminance: 60.0,
        };
        let blue = [0, 0, 255, 255];
        let red = [255, 0, 0, 255];
        let reddened = DevelopTransform::new(banded("red", moved)).unwrap();
        let blued = DevelopTransform::new(banded("blue", moved)).unwrap();
        assert_eq!(reddened.apply_display_rgba8(&blue).unwrap(), blue);
        assert_eq!(blued.apply_display_rgba8(&red).unwrap(), red);
        assert_ne!(reddened.apply_display_rgba8(&red).unwrap(), red);
        assert_ne!(blued.apply_display_rgba8(&blue).unwrap(), blue);
    }

    #[test]
    fn band_saturation_desaturates_only_its_own_hues() {
        let transform = DevelopTransform::new(banded(
            "yellow",
            MixerBand {
                saturation: -100.0,
                ..NEUTRAL_BAND
            },
        ))
        .unwrap();
        let yellow = transform.apply_display_rgba8(&[255, 255, 0, 255]).unwrap();
        assert_eq!(yellow[0], yellow[1]);
        assert_eq!(yellow[1], yellow[2]);
        assert_eq!(
            transform.apply_display_rgba8(&[0, 0, 255, 255]).unwrap(),
            [0, 0, 255, 255]
        );
    }

    #[test]
    fn the_mixer_leaves_grayscale_alone() {
        let transform = DevelopTransform::new(banded(
            "red",
            MixerBand {
                hue: 100.0,
                saturation: 100.0,
                luminance: -100.0,
            },
        ))
        .unwrap();
        let grays = [0, 0, 0, 255, 128, 128, 128, 255, 255, 255, 255, 255];
        assert_eq!(transform.apply_display_rgba8(&grays).unwrap(), grays);
    }

    #[test]
    fn the_compact_gpu_forms_carry_the_whole_stage() {
        let neutral = DevelopTransform::new(DevelopSettings::neutral()).unwrap();
        let luts = neutral.mixer_luts().values();
        assert_eq!(luts.len(), 3 * MIXER_LUT_LENGTH);
        assert!(luts[..MIXER_LUT_LENGTH].iter().all(|&shift| shift == 0.0));
        assert!(luts[MIXER_LUT_LENGTH..].iter().all(|&scale| scale == 1.0));

        let scalars = neutral.grading().scalars();
        assert_eq!(scalars.len(), GRADING_SCALARS);
        assert_eq!(
            scalars[..3],
            [
                GRADING_SHADOW_EDGE_STOPS,
                GRADING_HIGHLIGHT_EDGE_STOPS,
                MIN_GRADING_CROSSFADE_STOPS
                    + 0.5 * (MAX_GRADING_CROSSFADE_STOPS - MIN_GRADING_CROSSFADE_STOPS)
            ]
        );
        assert!(scalars[3..].iter().all(|&scalar| scalar == 0.0));
    }

    #[test]
    fn the_hue_luts_interpolate_across_the_wrap() {
        let luts = MixerLuts::new(&MixerSettings {
            red: MixerBand {
                saturation: 100.0,
                ..NEUTRAL_BAND
            },
            ..MixerSettings::NEUTRAL
        });
        let below = sample(&luts.saturation, 359.0);
        let across = sample(&luts.saturation, 359.5);
        assert!(below < across && across < sample(&luts.saturation, 0.0));
        assert_eq!(
            sample(&luts.saturation, 360.0),
            sample(&luts.saturation, 0.0)
        );
    }

    #[test]
    fn grading_range_weights_sum_to_one_at_every_luminance() {
        for blending in [0.0, 25.0, 50.0, 100.0] {
            for balance in [-100.0, -40.0, 0.0, 40.0, 100.0] {
                let grading = GradingTransform::new(GradingSettings {
                    blending,
                    balance,
                    ..GradingSettings::NEUTRAL
                });
                let worst = (0..=1_000)
                    .map(|step| {
                        let weights = grading.range_weights(step as f32 / 1_000.0);
                        assert!(
                            weights.into_iter().all(|weight| weight >= -1e-6),
                            "negative weight {weights:?} at {step}"
                        );
                        (weights.into_iter().sum::<f32>() - 1.0).abs()
                    })
                    .fold(0.0f32, f32::max);
                assert!(
                    worst < 1e-5,
                    "weights deviate from one by {worst} at blending {blending} balance {balance}"
                );
            }
        }
    }

    #[test]
    fn a_shadow_wheel_warms_shadows_without_touching_near_white() {
        let transform = DevelopTransform::new(DevelopSettings {
            grading: shadow_wheel(GradingWheel {
                hue: 40.0,
                saturation: 100.0,
                luminance: 0.0,
            }),
            ..DevelopSettings::neutral()
        })
        .unwrap();
        let shadow = transform.apply_display_rgba8(&[40, 40, 40, 255]).unwrap();
        assert!(shadow[0] > shadow[1], "shadow {shadow:?} is not warmer");
        assert!(shadow[1] > shadow[2], "shadow {shadow:?} is not warmer");
        assert_eq!(
            transform
                .apply_display_rgba8(&[250, 250, 250, 255])
                .unwrap(),
            [250, 250, 250, 255]
        );
    }

    #[test]
    fn a_wheel_without_saturation_or_luminance_is_a_no_op_at_any_hue() {
        let source = [12, 90, 200, 255, 240, 130, 30, 41];
        for hue in [0.0, 90.0, 210.0, 359.0] {
            let transform = DevelopTransform::new(DevelopSettings {
                grading: GradingSettings {
                    shadows: GradingWheel {
                        hue,
                        ..NEUTRAL_WHEEL
                    },
                    midtones: GradingWheel {
                        hue,
                        ..NEUTRAL_WHEEL
                    },
                    highlights: GradingWheel {
                        hue,
                        ..NEUTRAL_WHEEL
                    },
                    ..GradingSettings::NEUTRAL
                },
                ..DevelopSettings::neutral()
            })
            .unwrap();
            assert_eq!(transform.apply_display_rgba8(&source).unwrap(), source);
        }
    }

    #[test]
    fn grading_luminance_moves_only_its_own_tonal_range() {
        let transform = DevelopTransform::new(DevelopSettings {
            grading: shadow_wheel(GradingWheel {
                hue: 0.0,
                saturation: 0.0,
                luminance: 100.0,
            }),
            ..DevelopSettings::neutral()
        })
        .unwrap();
        let lifted = transform.apply_display_rgba8(&[40, 40, 40, 255]).unwrap();
        assert!(lifted[0] > 40, "shadow {lifted:?} was not lifted");
        assert_eq!(
            transform
                .apply_display_rgba8(&[250, 250, 250, 255])
                .unwrap(),
            [250, 250, 250, 255]
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
