//! One-click estimates for the develop controls: the white balance that
//! neutralises a sampled colour, a grey-world white balance for a whole image,
//! and the exposure, blacks and whites that bring an image's tones to
//! textbook percentiles.

use crate::grade::{MAX_TEMPERATURE_SHIFT_STOPS, MAX_TINT_SHIFT_STOPS};
use crate::hue::{LUMINANCE_WEIGHTS, chroma_fraction};
use crate::light::{LightSettings, LightTransform, srgb_to_linear};
use crate::{Error, Result};

pub const AUTO_EXPOSURE_LIMIT_STOPS: f32 = 2.0;
pub const SAMPLE_TARGET: usize = 100_000;
/// Estimates land on the slider grids so the controls show exactly what was set.
pub const EXPOSURE_STEP: f32 = 0.05;
const NEUTRAL_CHROMA_LIMIT: f32 = 0.35;
const NEUTRAL_SHARE_FLOOR: f32 = 0.01;
const BISECTION_STEPS: usize = 10;
const CONTROL_LIMIT: f32 = 100.0;

/// Temperature and tint that render this linear sample neutral, clamped to the
/// slider range; None when a channel is zero and there is nothing to balance.
pub fn neutralizing_balance(linear: [f32; 3]) -> Option<(f32, f32)> {
    let [red, green, blue] = linear;
    if linear
        .into_iter()
        .any(|channel| !channel.is_finite() || channel <= 0.0)
    {
        return None;
    }
    let warmth = ((blue / red).log2() / 2.0)
        .clamp(-MAX_TEMPERATURE_SHIFT_STOPS, MAX_TEMPERATURE_SHIFT_STOPS);
    let magenta = (green / (red * 2.0f32.powf(warmth))).log2();
    Some((
        control_value(warmth / MAX_TEMPERATURE_SHIFT_STOPS),
        control_value(magenta / MAX_TINT_SHIFT_STOPS),
    ))
}

/// Grey-world estimate over the low-chroma pixels of an encoded RGBA image.
pub fn auto_white_balance(rgba8: &[u8], width: usize, height: usize) -> Result<(f32, f32)> {
    let linear: Vec<[f32; 3]> = sampled_pixels(rgba8, width, height)?
        .into_iter()
        .map(|pixel| pixel.map(srgb_to_linear))
        .collect();
    let neutrals: Vec<[f32; 3]> = linear
        .iter()
        .copied()
        .filter(|&pixel| chroma_fraction(pixel) <= NEUTRAL_CHROMA_LIMIT)
        .collect();
    let population = if (neutrals.len() as f32) < NEUTRAL_SHARE_FLOOR * linear.len() as f32 {
        &linear
    } else {
        &neutrals
    };
    neutralizing_balance(mean(population))
        .ok_or(Error::Unsupported("the image has no colour to balance"))
}

/// Exposure, blacks and whites that bring the image's luma percentiles to the
/// targets; contrast, highlights and shadows stay 0.
pub fn auto_tone(rgba8: &[u8], width: usize, height: usize) -> Result<LightSettings> {
    let samples = sampled_pixels(rgba8, width, height)?.concat();
    let mut settings = LightSettings::NEUTRAL;
    for _ in 0..2 {
        for control in [
            ToneControl::Exposure,
            ToneControl::Blacks,
            ToneControl::Whites,
        ] {
            settings = control.with(settings, control.solve(&samples, settings)?);
        }
    }
    Ok(settings)
}

#[derive(Clone, Copy)]
enum ToneControl {
    Exposure,
    Blacks,
    Whites,
}

struct ToneTarget {
    percentile: f32,
    luma: f32,
}

impl ToneControl {
    /// Monotonic spans for bisection; blacks/whites bend at zero, so each side is its own span.
    fn spans(self) -> Vec<(f32, f32)> {
        match self {
            Self::Exposure => vec![(-AUTO_EXPOSURE_LIMIT_STOPS, AUTO_EXPOSURE_LIMIT_STOPS)],
            Self::Blacks | Self::Whites => vec![(-CONTROL_LIMIT, -1.0), (1.0, CONTROL_LIMIT)],
        }
    }

    fn target(self) -> ToneTarget {
        match self {
            Self::Exposure => ToneTarget {
                percentile: 0.5,
                luma: 0.45,
            },
            Self::Blacks => ToneTarget {
                percentile: 0.005,
                luma: 0.02,
            },
            Self::Whites => ToneTarget {
                percentile: 0.995,
                luma: 0.98,
            },
        }
    }

    fn with(self, settings: LightSettings, value: f32) -> LightSettings {
        match self {
            Self::Exposure => LightSettings {
                exposure: (value / EXPOSURE_STEP).round() * EXPOSURE_STEP,
                ..settings
            },
            Self::Blacks => LightSettings {
                blacks: value.round(),
                ..settings
            },
            Self::Whites => LightSettings {
                whites: value.round(),
                ..settings
            },
        }
    }

    /// Exposure takes the closest-to-target value, limit included, so a night scene lifts as far as allowed;
    /// blacks/whites only leave zero if that at least halves the miss.
    fn solve(self, samples: &[u8], settings: LightSettings) -> Result<f32> {
        let target = self.target();
        let miss = |value: f32| -> Result<f32> {
            Ok(
                percentile_luma(samples, self.with(settings, value), target.percentile)?
                    - target.luma,
            )
        };
        let mut best = Candidate::at(0.0, &miss)?;
        for (low, high) in self.spans() {
            let found = bisect(low, high, &miss)?;
            let accepted = match self {
                Self::Exposure => found.miss.abs() < best.miss.abs(),
                Self::Blacks | Self::Whites => found.miss.abs() <= best.miss.abs() / 2.0,
            };
            if accepted {
                best = found;
            }
        }
        Ok(best.value)
    }
}

#[derive(Clone, Copy)]
struct Candidate {
    value: f32,
    miss: f32,
}

impl Candidate {
    fn at(value: f32, miss: &impl Fn(f32) -> Result<f32>) -> Result<Self> {
        Ok(Self {
            value,
            miss: miss(value)?,
        })
    }
}

/// Value on `[low, high]` with miss nearest zero, assuming miss rises across the span:
/// an end if unreachable, otherwise the closer bisected bound.
fn bisect(low: f32, high: f32, miss: &impl Fn(f32) -> Result<f32>) -> Result<Candidate> {
    let mut low = Candidate::at(low, miss)?;
    if low.miss >= 0.0 {
        return Ok(low);
    }
    let mut high = Candidate::at(high, miss)?;
    if high.miss <= 0.0 {
        return Ok(high);
    }
    for _ in 0..BISECTION_STEPS {
        let middle = Candidate::at((low.value + high.value) / 2.0, miss)?;
        if middle.miss > 0.0 {
            high = middle;
        } else {
            low = middle;
        }
    }
    Ok(if -low.miss <= high.miss { low } else { high })
}

fn percentile_luma(samples: &[u8], settings: LightSettings, percentile: f32) -> Result<f32> {
    let developed = LightTransform::new(settings)?.apply_display_rgb8(samples)?;
    let mut lumas: Vec<f32> = developed
        .as_chunks::<3>()
        .0
        .iter()
        .map(|pixel| encoded_luma([pixel[0], pixel[1], pixel[2]]))
        .collect();
    let index = ((lumas.len() - 1) as f32 * percentile).round() as usize;
    let (_, value, _) = lumas.select_nth_unstable_by(index, f32::total_cmp);
    Ok(*value)
}

fn encoded_luma([red, green, blue]: [u8; 3]) -> f32 {
    (LUMINANCE_WEIGHTS[0] * red as f32
        + LUMINANCE_WEIGHTS[1] * green as f32
        + LUMINANCE_WEIGHTS[2] * blue as f32)
        / 255.0
}

fn control_value(fraction: f32) -> f32 {
    (fraction * CONTROL_LIMIT)
        .round()
        .clamp(-CONTROL_LIMIT, CONTROL_LIMIT)
}

fn mean(pixels: &[[f32; 3]]) -> [f32; 3] {
    let count = pixels.len().max(1) as f32;
    pixels.iter().fold([0.0f32; 3], |sum, pixel| {
        std::array::from_fn(|channel| sum[channel] + pixel[channel] / count)
    })
}

/// The opaque pixels on a stride that keeps roughly `SAMPLE_TARGET` of them.
fn sampled_pixels(rgba8: &[u8], width: usize, height: usize) -> Result<Vec<[u8; 3]>> {
    let pixel_count = width
        .checked_mul(height)
        .ok_or(Error::Unsupported("image dimensions overflow"))?;
    if width == 0 || height == 0 || rgba8.len() != pixel_count * 4 {
        return Err(Error::Unsupported("RGBA buffer size mismatch"));
    }
    let stride = ((pixel_count as f64 / SAMPLE_TARGET as f64).sqrt().ceil() as usize).max(1);
    let mut pixels = Vec::with_capacity(pixel_count / (stride * stride) + 1);
    for y in (0..height).step_by(stride) {
        for x in (0..width).step_by(stride) {
            let offset = (y * width + x) * 4;
            if rgba8[offset + 3] == 0 {
                continue;
            }
            pixels.push([rgba8[offset], rgba8[offset + 1], rgba8[offset + 2]]);
        }
    }
    if pixels.is_empty() {
        return Err(Error::Unsupported("the image has no opaque pixels"));
    }
    Ok(pixels)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::grade::{ColorSettings, ColorTransform};
    use crate::light::linear_to_srgb;

    fn field(pixel: [u8; 3], width: usize, height: usize) -> Vec<u8> {
        [pixel[0], pixel[1], pixel[2], 255].repeat(width * height)
    }

    fn encoded_luma([red, green, blue]: [u8; 3]) -> f32 {
        (LUMINANCE_WEIGHTS[0] * red as f32
            + LUMINANCE_WEIGHTS[1] * green as f32
            + LUMINANCE_WEIGHTS[2] * blue as f32)
            / 255.0
    }

    fn developed_lumas(rgba8: &[u8], light: LightSettings) -> Vec<f32> {
        let transform = LightTransform::new(light).unwrap();
        let mut lumas: Vec<f32> = rgba8
            .as_chunks::<4>()
            .0
            .iter()
            .map(|pixel| {
                encoded_luma(transform.apply_display_pixel([pixel[0], pixel[1], pixel[2]]))
            })
            .collect();
        lumas.sort_by(f32::total_cmp);
        lumas
    }

    fn percentile(sorted: &[f32], fraction: f32) -> f32 {
        sorted[((sorted.len() - 1) as f32 * fraction).round() as usize]
    }

    #[test]
    fn neutralizing_balance_undoes_the_balance_that_warmed_a_neutral() {
        for temperature in [-100.0f32, -60.0, -15.0, 0.0, 25.0, 70.0, 100.0] {
            for tint in [-100.0f32, -40.0, 0.0, 35.0, 100.0] {
                for gray in [0.02f32, 0.18, 0.5, 0.95] {
                    let transform = ColorTransform::new(ColorSettings {
                        temperature,
                        tint,
                        ..ColorSettings::NEUTRAL
                    })
                    .unwrap();
                    let cast = transform.balanced([gray; 3]);
                    let (found_temperature, found_tint) = neutralizing_balance(cast).unwrap();
                    assert!(
                        (found_temperature + temperature).abs() < 0.5,
                        "temperature {temperature} came back as {found_temperature}"
                    );
                    assert!(
                        (found_tint + tint).abs() < 0.5,
                        "tint {tint} came back as {found_tint}"
                    );
                }
            }
        }
    }

    #[test]
    fn estimates_sit_on_the_slider_grids() {
        let (temperature, tint) = neutralizing_balance([0.21, 0.2, 0.19]).unwrap();
        assert_eq!(temperature.fract(), 0.0);
        assert_eq!(tint.fract(), 0.0);
        let mut ramp = Vec::new();
        for value in 0..=255u8 {
            ramp.extend_from_slice(&[value, value, value, 255]);
        }
        let light = auto_tone(&ramp, 256, 1).unwrap();
        assert!(
            ((light.exposure / EXPOSURE_STEP).round() * EXPOSURE_STEP - light.exposure).abs()
                < 1e-6
        );
        assert_eq!(light.blacks.fract(), 0.0);
        assert_eq!(light.whites.fract(), 0.0);
    }

    #[test]
    fn neutralizing_balance_leaves_gray_alone_and_clamps_extreme_casts() {
        assert_eq!(neutralizing_balance([0.4, 0.4, 0.4]), Some((0.0, 0.0)));
        let (temperature, tint) = neutralizing_balance([0.05, 0.9, 0.9]).unwrap();
        assert_eq!(temperature, 100.0);
        assert_eq!(tint, 100.0);
        let (temperature, tint) = neutralizing_balance([0.9, 0.05, 0.05]).unwrap();
        assert_eq!(temperature, -100.0);
        assert_eq!(tint, -100.0);
    }

    #[test]
    fn neutralizing_balance_has_nothing_to_balance_without_every_channel() {
        assert_eq!(neutralizing_balance([0.0, 0.5, 0.5]), None);
        assert_eq!(neutralizing_balance([0.5, 0.0, 0.5]), None);
        assert_eq!(neutralizing_balance([0.5, 0.5, 0.0]), None);
        assert_eq!(neutralizing_balance([0.0, 0.0, 0.0]), None);
    }

    #[test]
    fn auto_white_balance_neutralizes_a_blue_cast_field() {
        let cast = [120u8, 125, 145];
        let rgba = field(cast, 64, 48);
        let (temperature, tint) = auto_white_balance(&rgba, 64, 48).unwrap();
        assert!(
            temperature > 20.0,
            "expected a warm correction, got {temperature}"
        );

        let transform = ColorTransform::new(ColorSettings {
            temperature,
            tint,
            ..ColorSettings::NEUTRAL
        })
        .unwrap();
        let balanced = transform.apply_display_rgba8(&rgba[..4]).unwrap();
        let spread = balanced[..3].iter().max().unwrap() - balanced[..3].iter().min().unwrap();
        assert!(spread <= 1, "balanced field is {balanced:?}");
    }

    #[test]
    fn auto_white_balance_reads_only_the_near_neutrals_when_there_are_enough() {
        let mut rgba = field([255, 20, 20], 100, 100);
        for pixel in rgba.as_chunks_mut::<4>().0.iter_mut().take(500) {
            pixel.copy_from_slice(&[128, 128, 128, 255]);
        }
        let (temperature, tint) = auto_white_balance(&rgba, 100, 100).unwrap();
        assert!(temperature.abs() < 0.5, "temperature {temperature}");
        assert!(tint.abs() < 0.5, "tint {tint}");
    }

    #[test]
    fn auto_white_balance_rejects_bad_buffers() {
        assert!(auto_white_balance(&[0, 0, 0], 1, 1).is_err());
        assert!(auto_white_balance(&[], 0, 0).is_err());
        assert!(auto_white_balance(&field([0, 0, 0], 4, 4), 4, 4).is_err());
    }

    #[test]
    fn auto_tone_leaves_middle_gray_where_it_is() {
        let gray = linear_to_srgb(0.171);
        assert!((encoded_luma([gray; 3]) - 0.45).abs() < 0.005);
        let rgba = field([gray; 3], 40, 30);
        let light = auto_tone(&rgba, 40, 30).unwrap();
        assert!(light.exposure.abs() < 0.05, "exposure {}", light.exposure);
        assert!(light.blacks.abs() < 5.0, "blacks {}", light.blacks);
        assert!(light.whites.abs() < 5.0, "whites {}", light.whites);
        assert_eq!(light.contrast, 0.0);
        assert_eq!(light.highlights, 0.0);
        assert_eq!(light.shadows, 0.0);
    }

    #[test]
    fn auto_tone_leaves_the_endpoints_alone_when_they_would_barely_help() {
        let mut rgba = field([70; 3], 40, 30);
        for pixel in rgba.as_chunks_mut::<4>().0.iter_mut().skip(600) {
            pixel.copy_from_slice(&[115, 115, 115, 255]);
        }
        let light = auto_tone(&rgba, 40, 30).unwrap();
        assert_eq!(light.blacks, 0.0, "{light:?}");
        assert_eq!(light.whites, 0.0, "{light:?}");
    }

    #[test]
    fn auto_tone_lifts_a_dark_field_to_the_median_target() {
        let rgba = field([72; 3], 40, 30);
        let light = auto_tone(&rgba, 40, 30).unwrap();
        assert!(light.exposure > 0.5, "exposure {}", light.exposure);
        let median = percentile(&developed_lumas(&rgba, light), 0.5);
        assert!((median - 0.45).abs() < 0.03, "median landed at {median}");
    }

    #[test]
    fn auto_tone_clamps_exposure_for_a_night_scene() {
        let rgba = field([6; 3], 40, 30);
        let light = auto_tone(&rgba, 40, 30).unwrap();
        assert_eq!(light.exposure, AUTO_EXPOSURE_LIMIT_STOPS);
    }

    #[test]
    fn auto_tone_meets_every_percentile_target_on_a_ramp() {
        let width = 256;
        let height = 8;
        let mut rgba = Vec::with_capacity(width * height * 4);
        for _ in 0..height {
            for x in 0..width {
                let value = (8 + x * 240 / (width - 1)) as u8;
                rgba.extend_from_slice(&[value, value, value, 255]);
            }
        }
        let light = auto_tone(&rgba, width, height).unwrap();
        let lumas = developed_lumas(&rgba, light);
        let median = percentile(&lumas, 0.5);
        let shadows = percentile(&lumas, 0.005);
        let highlights = percentile(&lumas, 0.995);
        assert!((median - 0.45).abs() < 0.03, "median {median}");
        assert!((shadows - 0.02).abs() < 0.03, "shadows {shadows}");
        assert!((highlights - 0.98).abs() < 0.03, "highlights {highlights}");
        assert!(light.blacks != 0.0 && light.whites != 0.0, "{light:?}");
    }

    #[test]
    fn auto_tone_ignores_transparent_pixels() {
        let mut rgba = field([72; 3], 20, 20);
        for pixel in rgba.as_chunks_mut::<4>().0.iter_mut().skip(200) {
            pixel.copy_from_slice(&[0, 0, 0, 0]);
        }
        let light = auto_tone(&rgba, 20, 20).unwrap();
        assert!(light.exposure > 0.5, "exposure {}", light.exposure);
        assert!(auto_tone(&[0u8; 4 * 4 * 4], 4, 4).is_err());
    }

    #[test]
    fn auto_tone_rejects_bad_buffers() {
        assert!(auto_tone(&[0, 0, 0], 1, 1).is_err());
        assert!(auto_tone(&[], 0, 0).is_err());
    }
}
