use crate::{Error, Result, parallel};
use std::sync::OnceLock;

const CURVE_SAMPLES: usize = 4096;
pub const MIDDLE_GRAY: f32 = 0.18;
pub const MAX_ZONE_COMPENSATION_STOPS: f32 = 1.5;
pub const MAX_WHITE_POINT_SHIFT_STOPS: f32 = 0.5;
pub const BLACK_POINT_STOPS_BELOW_MIDDLE_GRAY: f32 = 5.0;
pub const MIN_CONTRAST_SLOPE: f32 = 0.5;
pub const MAX_CONTRAST_SLOPE: f32 = 2.0;
const SHADOW_ZONE_STOPS: f32 = BLACK_POINT_STOPS_BELOW_MIDDLE_GRAY;
static SRGB_TO_LINEAR: OnceLock<[f32; 256]> = OnceLock::new();
static LINEAR_TO_SRGB: OnceLock<[u8; CURVE_SAMPLES]> = OnceLock::new();

#[derive(Clone, Copy, Debug, PartialEq)]
#[cfg_attr(feature = "wasm", derive(serde::Deserialize))]
pub struct LightSettings {
    pub exposure: f32,
    pub contrast: f32,
    pub highlights: f32,
    pub shadows: f32,
    pub whites: f32,
    pub blacks: f32,
}

impl LightSettings {
    pub const NEUTRAL: Self = Self {
        exposure: 0.0,
        contrast: 0.0,
        highlights: 0.0,
        shadows: 0.0,
        whites: 0.0,
        blacks: 0.0,
    };

    pub fn validated(self) -> Result<Self> {
        if !(-4.0..=4.0).contains(&self.exposure) || !self.exposure.is_finite() {
            return Err(Error::Unsupported("exposure must be between -4 and 4"));
        }
        if [
            self.contrast,
            self.highlights,
            self.shadows,
            self.whites,
            self.blacks,
        ]
        .into_iter()
        .any(|value| !value.is_finite() || !(-100.0..=100.0).contains(&value))
        {
            return Err(Error::Unsupported(
                "light controls must be between -100 and 100",
            ));
        }
        Ok(self)
    }

    fn has_tone_adjustments(self) -> bool {
        self.contrast != 0.0
            || self.highlights != 0.0
            || self.shadows != 0.0
            || self.whites != 0.0
            || self.blacks != 0.0
    }
}

impl Default for LightSettings {
    fn default() -> Self {
        Self::NEUTRAL
    }
}

#[derive(Clone)]
pub struct LightTransform {
    settings: LightSettings,
    luminance: Box<[f32; CURVE_SAMPLES]>,
    identity_tone: bool,
}

impl LightTransform {
    pub fn new(settings: LightSettings) -> Result<Self> {
        let settings = settings.validated()?;
        Ok(Self {
            luminance: Box::new(luminance_curve(settings)),
            identity_tone: !settings.has_tone_adjustments(),
            settings,
        })
    }

    pub fn settings(&self) -> LightSettings {
        self.settings
    }

    pub fn luminance_lut(&self) -> &[f32] {
        self.luminance.as_slice()
    }

    /// The same response with its luminance table rewritten, so a tone curve
    /// composes into the table every render path already samples.
    pub fn remapping_luminance(mut self, remap: impl Fn(f32) -> f32) -> Self {
        for sample in self.luminance.iter_mut() {
            *sample = remap(*sample);
        }
        self.identity_tone = false;
        self
    }

    pub fn apply_display_rgb8(&self, rgb8: &[u8]) -> Result<Vec<u8>> {
        if !rgb8.len().is_multiple_of(3) {
            return Err(Error::Unsupported("RGB buffer size mismatch"));
        }
        let (pixels, _) = rgb8.as_chunks::<3>();
        Ok(parallel::map_pixels(pixels, |&pixel| {
            self.apply_display_pixel(pixel)
        }))
    }

    pub fn apply_display_rgba8(&self, rgba8: &[u8]) -> Result<Vec<u8>> {
        if !rgba8.len().is_multiple_of(4) {
            return Err(Error::Unsupported("RGBA buffer size mismatch"));
        }
        let (pixels, _) = rgba8.as_chunks::<4>();
        Ok(parallel::map_pixels(
            pixels,
            |&[red, green, blue, alpha]| {
                let adjusted = self.apply_display_pixel([red, green, blue]);
                [adjusted[0], adjusted[1], adjusted[2], alpha]
            },
        ))
    }

    pub(crate) fn apply_encoded_pixel(&self, pixel: [u8; 3]) -> [u8; 3] {
        if self.identity_tone {
            return pixel;
        }
        self.tone_pixel(pixel.map(srgb_to_linear))
    }

    pub(crate) fn apply_display_pixel(&self, pixel: [u8; 3]) -> [u8; 3] {
        if self.identity_tone && self.settings.exposure == 0.0 {
            return pixel;
        }
        let gain = 2.0f32.powf(self.settings.exposure);
        self.tone_pixel(pixel.map(|channel| srgb_to_linear(channel) * gain))
    }

    fn tone_pixel(&self, linear: [f32; 3]) -> [u8; 3] {
        let luminance = 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
        let target = if self.identity_tone {
            luminance.clamp(0.0, 1.0)
        } else {
            self.lookup(luminance)
        };
        let maximum = linear.into_iter().fold(0.0f32, f32::max);
        let adjusted = if luminance <= f32::EPSILON {
            [target; 3]
        } else {
            let gamut_scale = if maximum > 0.0 {
                1.0 / maximum
            } else {
                f32::INFINITY
            };
            let hue_preserving_scale = (target / luminance).min(gamut_scale);
            linear.map(|channel| channel * hue_preserving_scale)
        };
        adjusted.map(linear_to_srgb)
    }

    fn lookup(&self, luminance: f32) -> f32 {
        let position = luminance.clamp(0.0, 1.0) * (CURVE_SAMPLES - 1) as f32;
        let index = (position as usize).min(CURVE_SAMPLES - 2);
        let fraction = position - index as f32;
        self.luminance[index] + fraction * (self.luminance[index + 1] - self.luminance[index])
    }
}

fn luminance_curve(settings: LightSettings) -> [f32; CURVE_SAMPLES] {
    if !settings.has_tone_adjustments() {
        return std::array::from_fn(|index| index as f32 / (CURVE_SAMPLES - 1) as f32);
    }

    std::array::from_fn(|index| {
        let input = index as f64 / (CURVE_SAMPLES - 1) as f64;
        let zoned = apply_zone_compensation(input, settings.shadows, settings.highlights);
        let contrasted = apply_contrast(zoned, settings.contrast);
        remap_endpoints(contrasted, settings.blacks, settings.whites) as f32
    })
}

fn apply_zone_compensation(luminance: f64, shadows: f32, highlights: f32) -> f64 {
    if luminance <= 0.0 {
        return 0.0;
    }
    let middle_gray = f64::from(MIDDLE_GRAY);
    let relative_ev = (luminance / middle_gray).log2();
    let shadow_weight = 1.0 - smoothstep(-f64::from(SHADOW_ZONE_STOPS), 0.0, relative_ev);
    let highlight_weight = smoothstep(0.0, -middle_gray.log2(), relative_ev);
    let compensation = f64::from(MAX_ZONE_COMPENSATION_STOPS)
        * (f64::from(shadows) / 100.0 * shadow_weight
            + f64::from(highlights) / 100.0 * highlight_weight);
    (luminance * 2.0f64.powf(compensation)).clamp(0.0, 1.0)
}

fn apply_contrast(luminance: f64, contrast: f32) -> f64 {
    if luminance <= 0.0 || luminance >= 1.0 || contrast == 0.0 {
        return luminance;
    }
    let slope = 2.0f64.powf(f64::from(contrast) / 100.0);
    let pivot = logit(f64::from(MIDDLE_GRAY));
    logistic(pivot + slope * (logit(luminance) - pivot))
}

fn remap_endpoints(luminance: f64, blacks: f32, whites: f32) -> f64 {
    let middle_gray = f64::from(MIDDLE_GRAY);
    let black_reference =
        middle_gray * 2.0f64.powf(-f64::from(BLACK_POINT_STOPS_BELOW_MIDDLE_GRAY));
    let black = f64::from(blacks) / 100.0;
    let white = f64::from(whites) / 100.0;
    let input_black = black.min(0.0).abs() * black_reference;
    let output_black = black.max(0.0) * black_reference;
    let white_point_shift = f64::from(MAX_WHITE_POINT_SHIFT_STOPS);
    let input_white = 2.0f64.powf(-white.max(0.0) * white_point_shift);
    let output_white = 2.0f64.powf(white.min(0.0) * white_point_shift);
    let pivot = CurvePoint::new(middle_gray, middle_gray, 1.0);

    if luminance <= input_black {
        return output_black;
    }
    if luminance >= input_white {
        return output_white;
    }
    if luminance <= middle_gray {
        return hermite_segment(
            luminance,
            CurvePoint::new(
                input_black,
                output_black,
                if blacks == 0.0 { 1.0 } else { 0.0 },
            ),
            pivot,
        );
    }
    hermite_segment(
        luminance,
        pivot,
        CurvePoint::new(
            input_white,
            output_white,
            if whites == 0.0 { 1.0 } else { 0.0 },
        ),
    )
}

#[derive(Clone, Copy)]
struct CurvePoint {
    input: f64,
    output: f64,
    slope: f64,
}

impl CurvePoint {
    const fn new(input: f64, output: f64, slope: f64) -> Self {
        Self {
            input,
            output,
            slope,
        }
    }
}

fn hermite_segment(input: f64, start: CurvePoint, end: CurvePoint) -> f64 {
    let width = end.input - start.input;
    let t = (input - start.input) / width;
    let t2 = t * t;
    let t3 = t2 * t;
    ((2.0 * t3 - 3.0 * t2 + 1.0) * start.output
        + (t3 - 2.0 * t2 + t) * width * start.slope
        + (-2.0 * t3 + 3.0 * t2) * end.output
        + (t3 - t2) * width * end.slope)
        .clamp(0.0, 1.0)
}

fn smoothstep(start: f64, end: f64, value: f64) -> f64 {
    let position = ((value - start) / (end - start)).clamp(0.0, 1.0);
    position * position * (3.0 - 2.0 * position)
}

fn logit(value: f64) -> f64 {
    (value / (1.0 - value)).ln()
}

fn logistic(value: f64) -> f64 {
    1.0 / (1.0 + (-value).exp())
}

pub(crate) fn srgb_to_linear(channel: u8) -> f32 {
    SRGB_TO_LINEAR.get_or_init(|| std::array::from_fn(|index| decode_srgb(index as f32 / 255.0)))
        [channel as usize]
}

pub(crate) fn decode_srgb(encoded: f32) -> f32 {
    if encoded <= 0.04045 {
        encoded / 12.92
    } else {
        ((encoded + 0.055) / 1.055).powf(2.4)
    }
}

pub(crate) fn linear_to_srgb(channel: f32) -> u8 {
    let position = channel.clamp(0.0, 1.0) * (CURVE_SAMPLES - 1) as f32;
    LINEAR_TO_SRGB.get_or_init(|| std::array::from_fn(quantize_linear))[position.round() as usize]
}

pub(crate) fn encode_srgb(linear: f32) -> f32 {
    if linear <= 0.003_130_8 {
        12.92 * linear
    } else {
        1.055 * linear.powf(1.0 / 2.4) - 0.055
    }
}

fn quantize_linear(index: usize) -> u8 {
    let encoded = encode_srgb(index as f32 / (CURVE_SAMPLES - 1) as f32);
    (encoded * 255.0).round().clamp(0.0, 255.0) as u8
}

#[cfg(test)]
mod tests {
    use super::*;

    fn settings(name: &str, value: f32) -> LightSettings {
        let mut settings = LightSettings::NEUTRAL;
        match name {
            "contrast" => settings.contrast = value,
            "highlights" => settings.highlights = value,
            "shadows" => settings.shadows = value,
            "whites" => settings.whites = value,
            "blacks" => settings.blacks = value,
            _ => panic!("unknown setting"),
        }
        settings
    }

    fn gray(transform: &LightTransform, value: u8) -> u8 {
        transform.apply_display_rgb8(&[value; 3]).unwrap()[0]
    }

    fn assert_approximately_eq(actual: f32, expected: f32, tolerance: f32) {
        assert!(
            (actual - expected).abs() <= tolerance,
            "expected {expected}, got {actual}"
        );
    }

    #[test]
    fn neutral_transform_is_exact_for_rgb_and_rgba() {
        let transform = LightTransform::new(LightSettings::NEUTRAL).unwrap();
        assert_eq!(
            transform
                .apply_display_rgb8(&[0, 31, 127, 201, 240, 255])
                .unwrap(),
            [0, 31, 127, 201, 240, 255]
        );
        assert_eq!(
            transform.apply_display_rgba8(&[24, 80, 160, 73]).unwrap(),
            [24, 80, 160, 73]
        );
    }

    #[test]
    fn exposure_operates_in_linear_light() {
        let raised = LightTransform::new(LightSettings {
            exposure: 1.0,
            ..LightSettings::NEUTRAL
        })
        .unwrap();
        let lowered = LightTransform::new(LightSettings {
            exposure: -1.0,
            ..LightSettings::NEUTRAL
        })
        .unwrap();
        assert!(gray(&raised, 96) > 125);
        assert!(gray(&lowered, 96) < 75);
    }

    #[test]
    fn controls_concentrate_changes_in_their_tonal_zones() {
        let shadows = LightTransform::new(settings("shadows", 60.0)).unwrap();
        let highlights = LightTransform::new(settings("highlights", 60.0)).unwrap();
        let blacks = LightTransform::new(settings("blacks", 60.0)).unwrap();
        let whites = LightTransform::new(settings("whites", 60.0)).unwrap();
        let delta =
            |transform: &LightTransform, value: u8| gray(transform, value) as i16 - value as i16;
        assert!(delta(&shadows, 80) > delta(&shadows, 210));
        assert!(
            delta(&highlights, 210) > delta(&highlights, 80),
            "highlight deltas: {} and {}",
            delta(&highlights, 210),
            delta(&highlights, 80)
        );
        assert!(delta(&blacks, 8) > delta(&blacks, 128));
        assert!(delta(&whites, 235) > delta(&whites, 128));
    }

    #[test]
    fn contrast_uses_a_measurable_middle_gray_slope() {
        for (value, expected_slope) in [(-100.0, MIN_CONTRAST_SLOPE), (100.0, MAX_CONTRAST_SLOPE)] {
            let transform = LightTransform::new(settings("contrast", value)).unwrap();
            let interval = 0.001;
            let measured_slope = (transform.lookup(MIDDLE_GRAY + interval)
                - transform.lookup(MIDDLE_GRAY - interval))
                / (2.0 * interval);

            assert_approximately_eq(transform.lookup(MIDDLE_GRAY), MIDDLE_GRAY, 0.000_01);
            assert_approximately_eq(measured_slope, expected_slope, 0.01);
        }
    }

    #[test]
    fn zone_controls_apply_bounded_exposure_compensation() {
        let shadow_reference = MIDDLE_GRAY * 2.0f32.powf(-SHADOW_ZONE_STOPS);
        for value in [-100.0, 100.0] {
            let transform = LightTransform::new(settings("shadows", value)).unwrap();
            let expected =
                shadow_reference * 2.0f32.powf(value.signum() * MAX_ZONE_COMPENSATION_STOPS);
            assert_approximately_eq(transform.lookup(shadow_reference), expected, 0.000_02);
        }

        let transform = LightTransform::new(settings("highlights", -100.0)).unwrap();
        assert_approximately_eq(
            transform.lookup(1.0),
            2.0f32.powf(-MAX_ZONE_COMPENSATION_STOPS),
            0.000_01,
        );
    }

    #[test]
    fn endpoint_controls_move_documented_black_and_white_points() {
        let black_reference = MIDDLE_GRAY * 2.0f32.powf(-BLACK_POINT_STOPS_BELOW_MIDDLE_GRAY);
        let shifted_white = 2.0f32.powf(-MAX_WHITE_POINT_SHIFT_STOPS);

        let crushed_blacks = LightTransform::new(settings("blacks", -100.0)).unwrap();
        let lifted_blacks = LightTransform::new(settings("blacks", 100.0)).unwrap();
        let expanded_whites = LightTransform::new(settings("whites", 100.0)).unwrap();
        let lowered_whites = LightTransform::new(settings("whites", -100.0)).unwrap();

        assert_approximately_eq(crushed_blacks.lookup(black_reference), 0.0, 0.000_01);
        assert_approximately_eq(lifted_blacks.lookup(0.0), black_reference, 0.000_01);
        assert_approximately_eq(expanded_whites.lookup(shifted_white), 1.0, 0.000_2);
        assert_approximately_eq(lowered_whites.lookup(1.0), shifted_white, 0.000_01);

        for transform in [
            crushed_blacks,
            lifted_blacks,
            expanded_whites,
            lowered_whites,
        ] {
            assert_approximately_eq(transform.lookup(MIDDLE_GRAY), MIDDLE_GRAY, 0.000_01);
        }
    }

    #[test]
    fn every_extreme_curve_combination_remains_monotonic() {
        for contrast in [-100.0, 0.0, 100.0] {
            for highlights in [-100.0, 0.0, 100.0] {
                for shadows in [-100.0, 0.0, 100.0] {
                    for whites in [-100.0, 0.0, 100.0] {
                        for blacks in [-100.0, 0.0, 100.0] {
                            let settings = LightSettings {
                                contrast,
                                highlights,
                                shadows,
                                whites,
                                blacks,
                                ..LightSettings::NEUTRAL
                            };
                            let transform = LightTransform::new(settings).unwrap();
                            if let Some((index, samples)) = transform
                                .luminance
                                .windows(2)
                                .enumerate()
                                .find(|(_, samples)| samples[0] > samples[1])
                            {
                                panic!(
                                    "non-monotonic curve at sample {index} for {settings:?}: {} > {}",
                                    samples[0], samples[1]
                                );
                            }
                        }
                    }
                }
            }
        }
    }

    #[test]
    fn luminance_scaling_preserves_hue_and_alpha() {
        let transform = LightTransform::new(settings("contrast", 45.0)).unwrap();
        let source = [64, 128, 192, 41];
        let adjusted = transform.apply_display_rgba8(&source).unwrap();
        let source_linear = [source[0], source[1], source[2]].map(srgb_to_linear);
        let adjusted_linear = [adjusted[0], adjusted[1], adjusted[2]].map(srgb_to_linear);
        let red_scale = adjusted_linear[0] / source_linear[0];
        let green_scale = adjusted_linear[1] / source_linear[1];
        let blue_scale = adjusted_linear[2] / source_linear[2];
        assert!((red_scale - green_scale).abs() < 0.04);
        assert!((green_scale - blue_scale).abs() < 0.04);
        assert_eq!(adjusted[3], source[3]);
    }

    #[test]
    fn validates_public_ranges_and_buffer_shapes() {
        assert!(
            LightTransform::new(LightSettings {
                exposure: 4.1,
                ..LightSettings::NEUTRAL
            })
            .is_err()
        );
        let transform = LightTransform::new(LightSettings::NEUTRAL).unwrap();
        assert!(transform.apply_display_rgb8(&[0]).is_err());
        assert!(transform.apply_display_rgba8(&[0, 0, 0]).is_err());
    }
}
