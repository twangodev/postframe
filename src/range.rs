//! Luminance and colour range masks: per-pixel weights read from a
//! document's source pixels, rasterized once and stored like any other
//! mask component.

use crate::error::within;
use crate::hue;
use crate::light::srgb_to_linear;
use crate::{Error, Result, parallel};

/// The span of hue, in degrees, that a fully feathered colour range fades over.
pub const COLOR_FEATHER_DEGREES: f32 = 90.0;

#[derive(Clone, Copy, Debug, PartialEq)]
#[cfg_attr(feature = "wasm", derive(serde::Deserialize))]
pub struct LuminanceRange {
    pub low: f32,
    pub high: f32,
    pub feather: f32,
}

#[derive(Clone, Copy, Debug, PartialEq)]
#[cfg_attr(feature = "wasm", derive(serde::Deserialize))]
#[cfg_attr(feature = "wasm", serde(rename_all = "camelCase"))]
pub struct ColorRange {
    pub hue: f32,
    pub width: f32,
    pub saturation_floor: f32,
    pub feather: f32,
}

impl LuminanceRange {
    pub fn validated(self) -> Result<Self> {
        if !within(&[self.low, self.high, self.feather], 0.0, 1.0) {
            return Err(Error::Unsupported(
                "luminance range bounds and feather must be between 0 and 1",
            ));
        }
        if self.low > self.high {
            return Err(Error::Unsupported(
                "luminance range low bound must not exceed its high bound",
            ));
        }
        Ok(self)
    }

    /// How fully a pixel of encoded luma `luma` belongs to the range: one
    /// inside `[low, high]`, fading to zero over half the feather beyond each
    /// bound.
    pub fn weight(&self, luma: f32) -> f32 {
        let soft = self.feather * 0.5;
        let rise = if luma >= self.low {
            1.0
        } else {
            smoothstep(self.low - soft, self.low, luma)
        };
        let fall = if luma <= self.high {
            1.0
        } else {
            1.0 - smoothstep(self.high, self.high + soft, luma)
        };
        rise * fall
    }
}

impl ColorRange {
    pub fn validated(self) -> Result<Self> {
        if !within(&[self.hue], 0.0, 360.0) {
            return Err(Error::Unsupported(
                "colour range hue must be between 0 and 360 degrees",
            ));
        }
        if !within(&[self.width], 0.0, 90.0) {
            return Err(Error::Unsupported(
                "colour range width must be between 0 and 90 degrees",
            ));
        }
        if !within(&[self.saturation_floor, self.feather], 0.0, 1.0) {
            return Err(Error::Unsupported(
                "colour range saturation floor and feather must be between 0 and 1",
            ));
        }
        Ok(self)
    }

    /// How fully a linear pixel belongs to the range: one inside the hue band
    /// above the saturation floor, fading over the feather beyond the band and
    /// below the floor. Achromatic pixels never pass a non-zero floor.
    pub fn weight(&self, linear: [f32; 3]) -> f32 {
        let distance = hue_distance(hue::hue_degrees(linear), self.hue);
        let hue_weight = if distance <= self.width {
            1.0
        } else {
            1.0 - smoothstep(
                self.width,
                self.width + self.feather * COLOR_FEATHER_DEGREES,
                distance,
            )
        };
        let chroma = hue::chroma_fraction(linear);
        let chroma_weight = if chroma >= self.saturation_floor {
            1.0
        } else {
            smoothstep(
                self.saturation_floor * (1.0 - self.feather),
                self.saturation_floor,
                chroma,
            )
        };
        hue_weight * chroma_weight
    }
}

/// One alpha byte per pixel of an encoded RGBA image, weighing each pixel's
/// histogram luma against the range. Input alpha is ignored.
pub fn luminance_range_alpha(
    rgba8: &[u8],
    width: usize,
    height: usize,
    range: &LuminanceRange,
) -> Result<Vec<u8>> {
    let range = range.validated()?;
    let pixels = pixels(rgba8, width, height)?;
    Ok(parallel::map_pixels(pixels, |&[red, green, blue, _]| {
        [alpha_byte(range.weight(encoded_luma([red, green, blue])))]
    }))
}

/// One alpha byte per pixel of an encoded RGBA image, weighing each pixel's
/// linear hue and chroma against the range. Input alpha is ignored.
pub fn color_range_alpha(
    rgba8: &[u8],
    width: usize,
    height: usize,
    range: &ColorRange,
) -> Result<Vec<u8>> {
    let range = range.validated()?;
    let pixels = pixels(rgba8, width, height)?;
    Ok(parallel::map_pixels(pixels, |&[red, green, blue, _]| {
        [alpha_byte(
            range.weight([red, green, blue].map(srgb_to_linear)),
        )]
    }))
}

fn pixels(rgba8: &[u8], width: usize, height: usize) -> Result<&[[u8; 4]]> {
    let expected = width
        .checked_mul(height)
        .and_then(|count| count.checked_mul(4))
        .ok_or(Error::Unsupported("range mask dimensions overflow"))?;
    if width == 0 || height == 0 || rgba8.len() != expected {
        return Err(Error::Unsupported("range mask buffer size mismatch"));
    }
    let (pixels, _) = rgba8.as_chunks::<4>();
    Ok(pixels)
}

/// The histogram's luma: luminance weights over encoded channel values, so a
/// range's bounds line up with the L histogram the user reads.
fn encoded_luma(encoded: [u8; 3]) -> f32 {
    hue::luminance(encoded.map(|channel| channel as f32 / 255.0))
}

fn alpha_byte(weight: f32) -> u8 {
    (weight.clamp(0.0, 1.0) * 255.0).round() as u8
}

fn hue_distance(a: f32, b: f32) -> f32 {
    let apart = (a - b).rem_euclid(360.0);
    apart.min(360.0 - apart)
}

fn smoothstep(start: f32, end: f32, value: f32) -> f32 {
    if end <= start {
        return if value < end { 0.0 } else { 1.0 };
    }
    let position = ((value - start) / (end - start)).clamp(0.0, 1.0);
    position * position * (3.0 - 2.0 * position)
}

#[cfg(test)]
mod tests {
    use super::*;

    const HARD: LuminanceRange = LuminanceRange {
        low: 0.25,
        high: 0.75,
        feather: 0.0,
    };

    fn grey_ramp() -> Vec<u8> {
        (0..=255u8)
            .flat_map(|value| [value, value, value, 255])
            .collect()
    }

    fn encoded_luma(value: u8) -> f32 {
        hue::luminance([value as f32 / 255.0; 3])
    }

    fn red_pixel() -> Vec<u8> {
        vec![255, 0, 0, 255]
    }

    fn coverage(alpha: &[u8]) -> u32 {
        alpha.iter().map(|&weight| weight as u32).sum()
    }

    #[test]
    fn luminance_validation_rejects_inverted_and_out_of_range_bounds() {
        assert!(HARD.validated().is_ok());
        assert!(
            LuminanceRange {
                low: 0.6,
                high: 0.4,
                feather: 0.0
            }
            .validated()
            .is_err()
        );
        assert!(
            LuminanceRange {
                low: -0.1,
                high: 0.5,
                feather: 0.0
            }
            .validated()
            .is_err()
        );
        assert!(
            LuminanceRange {
                low: 0.0,
                high: 1.1,
                feather: 0.0
            }
            .validated()
            .is_err()
        );
        assert!(
            LuminanceRange {
                low: 0.0,
                high: 1.0,
                feather: 1.5
            }
            .validated()
            .is_err()
        );
        assert!(
            LuminanceRange {
                low: f32::NAN,
                high: 1.0,
                feather: 0.0
            }
            .validated()
            .is_err()
        );
        assert!(
            LuminanceRange {
                low: 0.0,
                high: 1.0,
                feather: f32::INFINITY
            }
            .validated()
            .is_err()
        );
    }

    #[test]
    fn color_validation_rejects_out_of_range_and_non_finite_values() {
        let valid = ColorRange {
            hue: 210.0,
            width: 30.0,
            saturation_floor: 0.2,
            feather: 0.25,
        };
        assert!(valid.validated().is_ok());
        assert!(
            ColorRange {
                hue: 361.0,
                ..valid
            }
            .validated()
            .is_err()
        );
        assert!(ColorRange { hue: -1.0, ..valid }.validated().is_err());
        assert!(
            ColorRange {
                width: 91.0,
                ..valid
            }
            .validated()
            .is_err()
        );
        assert!(
            ColorRange {
                width: -1.0,
                ..valid
            }
            .validated()
            .is_err()
        );
        assert!(
            ColorRange {
                saturation_floor: 1.5,
                ..valid
            }
            .validated()
            .is_err()
        );
        assert!(
            ColorRange {
                feather: -0.5,
                ..valid
            }
            .validated()
            .is_err()
        );
        assert!(
            ColorRange {
                hue: f32::NAN,
                ..valid
            }
            .validated()
            .is_err()
        );
        assert!(
            ColorRange {
                feather: f32::NEG_INFINITY,
                ..valid
            }
            .validated()
            .is_err()
        );
    }

    #[test]
    fn hard_luminance_range_selects_exactly_the_bytes_whose_luma_is_inside() {
        let alpha = luminance_range_alpha(&grey_ramp(), 256, 1, &HARD).unwrap();
        for (value, &weight) in alpha.iter().enumerate() {
            let luma = encoded_luma(value as u8);
            let inside = (HARD.low..=HARD.high).contains(&luma);
            assert_eq!(weight, if inside { 255 } else { 0 }, "byte {value}");
        }
        assert!(alpha.contains(&255));
        assert!(alpha.contains(&0));
    }

    #[test]
    fn luminance_endpoints_accept_pure_black_and_pure_white() {
        let full = LuminanceRange {
            low: 0.0,
            high: 1.0,
            feather: 0.0,
        };
        assert_eq!(full.weight(0.0), 1.0);
        assert_eq!(full.weight(1.0), 1.0);
        let alpha = luminance_range_alpha(&grey_ramp(), 256, 1, &full).unwrap();
        assert!(alpha.iter().all(|&weight| weight == 255));
    }

    #[test]
    fn feather_widens_the_luminance_selection_monotonically() {
        let ramp = grey_ramp();
        let mut previous = luminance_range_alpha(&ramp, 256, 1, &HARD).unwrap();
        for feather in [0.1, 0.25, 0.5, 0.75, 1.0] {
            let alpha =
                luminance_range_alpha(&ramp, 256, 1, &LuminanceRange { feather, ..HARD }).unwrap();
            assert!(
                alpha
                    .iter()
                    .zip(&previous)
                    .all(|(now, before)| now >= before),
                "feather {feather} narrowed the selection"
            );
            assert!(
                coverage(&alpha) > coverage(&previous),
                "feather {feather} did not widen the selection"
            );
            previous = alpha;
        }
    }

    #[test]
    fn feathered_luminance_alpha_on_a_ramp_rises_then_falls() {
        for feather in [0.0, 0.2, 0.6, 1.0] {
            for (low, high) in [(0.0, 0.3), (0.2, 0.6), (0.5, 0.5), (0.7, 1.0)] {
                let range = LuminanceRange { low, high, feather };
                let alpha = luminance_range_alpha(&grey_ramp(), 256, 1, &range).unwrap();
                let peak = alpha
                    .iter()
                    .position(|&weight| weight == *alpha.iter().max().unwrap());
                let peak = peak.unwrap();
                assert!(alpha[..=peak].is_sorted(), "{range:?} does not rise");
                assert!(
                    alpha[peak..].iter().rev().is_sorted(),
                    "{range:?} does not fall"
                );
                for luma in (0..=100).map(|step| step as f32 / 100.0) {
                    let weight = range.weight(luma);
                    assert!(
                        (0.0..=1.0).contains(&weight),
                        "{range:?} at {luma}: {weight}"
                    );
                }
            }
        }
    }

    #[test]
    fn color_range_centred_on_red_takes_red_and_leaves_cyan_and_grey() {
        let range = ColorRange {
            hue: 0.0,
            width: 20.0,
            saturation_floor: 0.2,
            feather: 0.25,
        };
        assert_eq!(range.weight([1.0, 0.0, 0.0]), 1.0);
        assert_eq!(range.weight([0.0, 1.0, 1.0]), 0.0);
        for hue in (0..360).step_by(15) {
            let grey = ColorRange {
                hue: hue as f32,
                ..range
            };
            assert_eq!(grey.weight([0.4, 0.4, 0.4]), 0.0, "grey passed at {hue}");
            assert_eq!(grey.weight([0.0, 0.0, 0.0]), 0.0, "black passed at {hue}");
        }
        assert_eq!(
            color_range_alpha(&red_pixel(), 1, 1, &range).unwrap(),
            [255]
        );
        assert_eq!(
            color_range_alpha(&[0, 255, 255, 255], 1, 1, &range).unwrap(),
            [0]
        );
        assert_eq!(
            color_range_alpha(&[128, 128, 128, 255], 1, 1, &range).unwrap(),
            [0]
        );
    }

    #[test]
    fn hue_distance_wraps_around_the_wheel() {
        let range = ColorRange {
            hue: 350.0,
            width: 20.0,
            saturation_floor: 0.0,
            feather: 0.0,
        };
        assert_eq!(range.weight(hue::from_hue(5.0, 1.0, 1.0)), 1.0);
        assert_eq!(range.weight(hue::from_hue(340.0, 1.0, 1.0)), 1.0);
        assert_eq!(range.weight(hue::from_hue(15.0, 1.0, 1.0)), 0.0);
        assert_eq!(range.weight(hue::from_hue(180.0, 1.0, 1.0)), 0.0);
    }

    #[test]
    fn a_zero_saturation_floor_lets_grey_through_the_chroma_gate() {
        let range = ColorRange {
            hue: 0.0,
            width: 20.0,
            saturation_floor: 0.0,
            feather: 0.0,
        };
        assert_eq!(range.weight([0.4, 0.4, 0.4]), 1.0);
        let floored = ColorRange {
            saturation_floor: 0.1,
            ..range
        };
        assert_eq!(floored.weight([0.4, 0.4, 0.4]), 0.0);
        assert_eq!(floored.weight([0.4, 0.38, 0.38]), 0.0);
        assert_eq!(floored.weight([0.4, 0.3, 0.3]), 1.0);
    }

    #[test]
    fn color_feather_fades_the_hue_band_and_the_chroma_gate() {
        let hard = ColorRange {
            hue: 120.0,
            width: 10.0,
            saturation_floor: 0.5,
            feather: 0.0,
        };
        let soft = ColorRange {
            feather: 0.5,
            ..hard
        };
        let at_thirty = hue::from_hue(150.0, 1.0, 1.0);
        assert_eq!(hard.weight(at_thirty), 0.0);
        let faded = soft.weight(at_thirty);
        assert!(faded > 0.0 && faded < 1.0, "{faded}");
        let half_chroma = hue::from_hue(120.0, 0.35, 1.0);
        assert_eq!(hard.weight(half_chroma), 0.0);
        let gated = soft.weight(half_chroma);
        assert!(gated > 0.0 && gated < 1.0, "{gated}");
    }

    #[test]
    fn color_weights_stay_within_the_unit_interval_across_the_wheel() {
        for hue in (0..360).step_by(30) {
            for width in [0.0, 15.0, 45.0, 90.0] {
                for floor in [0.0, 0.3, 1.0] {
                    for feather in [0.0, 0.5, 1.0] {
                        let range = ColorRange {
                            hue: hue as f32,
                            width,
                            saturation_floor: floor,
                            feather,
                        };
                        for degrees in (0..360).step_by(20) {
                            for saturation in [0.0, 0.2, 0.6, 1.0] {
                                let weight =
                                    range.weight(hue::from_hue(degrees as f32, saturation, 0.8));
                                assert!(
                                    (0.0..=1.0).contains(&weight),
                                    "{range:?} at {degrees}/{saturation}: {weight}"
                                );
                            }
                        }
                    }
                }
            }
        }
    }

    #[test]
    fn alpha_rasters_ignore_input_alpha_and_reject_bad_dimensions() {
        let opaque = luminance_range_alpha(&[200, 200, 200, 255], 1, 1, &HARD).unwrap();
        let clear = luminance_range_alpha(&[200, 200, 200, 0], 1, 1, &HARD).unwrap();
        assert_eq!(opaque, clear);
        assert!(luminance_range_alpha(&[0; 8], 1, 1, &HARD).is_err());
        assert!(luminance_range_alpha(&[0; 4], 0, 1, &HARD).is_err());
        let range = ColorRange {
            hue: 0.0,
            width: 20.0,
            saturation_floor: 0.2,
            feather: 0.25,
        };
        assert!(color_range_alpha(&[0; 8], 1, 1, &range).is_err());
        assert!(color_range_alpha(&[0; 4], 1, 0, &range).is_err());
        let invalid = LuminanceRange {
            low: 0.9,
            high: 0.1,
            feather: 0.0,
        };
        assert!(luminance_range_alpha(&[0; 4], 1, 1, &invalid).is_err());
    }
}
