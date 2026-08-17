use crate::grade::{ColorSettings, ColorTransform};
use crate::light::{LightSettings, LightTransform};
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
}

impl DevelopTransform {
    pub fn new(settings: DevelopSettings) -> Result<Self> {
        let settings = settings.validated()?;
        Ok(Self {
            light: LightTransform::new(settings.light)?,
            color: ColorTransform::new(settings.color)?,
            settings,
        })
    }

    pub fn settings(&self) -> &DevelopSettings {
        &self.settings
    }

    pub fn luminance_lut(&self) -> &[f32] {
        self.light.luminance_lut()
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
            .apply_display_pixel(self.color.apply_display_pixel(pixel))
    }

    pub fn apply_encoded_pixel(&self, pixel: [u8; 3]) -> [u8; 3] {
        self.light
            .apply_encoded_pixel(self.color.apply_display_pixel(pixel))
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
