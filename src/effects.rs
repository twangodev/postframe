use crate::develop::EffectsSettings;
use crate::{Error, Result};

/// The rectangle a vignette centres on, in fractions of the image.
#[derive(Clone, Copy, Debug, PartialEq)]
#[cfg_attr(feature = "wasm", derive(serde::Deserialize))]
pub struct VignetteFrame {
    pub x: f32,
    pub y: f32,
    pub width: f32,
    pub height: f32,
}

impl VignetteFrame {
    pub const FULL: Self = Self {
        x: 0.0,
        y: 0.0,
        width: 1.0,
        height: 1.0,
    };

    pub fn validated(self) -> Result<Self> {
        let inside_the_image = [self.x, self.y, self.width, self.height]
            .into_iter()
            .all(|value| value.is_finite() && (0.0..=1.0).contains(&value))
            && self.width > 0.0
            && self.height > 0.0
            && self.x + self.width <= 1.0
            && self.y + self.height <= 1.0;
        if !inside_the_image {
            return Err(Error::Unsupported("the vignette frame leaves the image"));
        }
        Ok(self)
    }

    fn centre(self) -> (f32, f32) {
        (self.x + self.width / 2.0, self.y + self.height / 2.0)
    }
}

impl Default for VignetteFrame {
    fn default() -> Self {
        Self::FULL
    }
}

pub const MAX_VIGNETTE_STOPS: f32 = 2.0;
pub const MAX_ROUNDNESS_EXPONENT: f32 = 6.0;
const ELLIPSE_EXPONENT: f32 = 2.0;
const MIN_FEATHER_SPAN: f32 = 0.08;

/// Multiplicative gain for linear RGB at `at`, a position in fractions of the
/// image whose width is `aspect` times its height. Exactly 1.0 at the frame's
/// centre, whatever the controls.
pub fn vignette_gain(
    settings: EffectsSettings,
    frame: VignetteFrame,
    aspect: f32,
    at: (f32, f32),
) -> f32 {
    if settings.vignette_amount == 0.0 {
        return 1.0;
    }
    let (start, end) = falloff_span(settings);
    let falloff = smoothstep(start, end, corner_distance(frame, aspect, at, settings));
    (settings.vignette_amount / 100.0 * MAX_VIGNETTE_STOPS * falloff).exp2()
}

/// Distance from the frame's centre along the iso-gain contour through `at`,
/// as a fraction of the centre-to-corner distance.
fn corner_distance(
    frame: VignetteFrame,
    aspect: f32,
    at: (f32, f32),
    settings: EffectsSettings,
) -> f32 {
    let (centre_x, centre_y) = frame.centre();
    let reach = (
        frame.width / 2.0 * aspect.max(f32::EPSILON),
        frame.height / 2.0,
    );
    let exponent = ELLIPSE_EXPONENT
        + (settings.vignette_roundness / 100.0).max(0.0)
            * (MAX_ROUNDNESS_EXPONENT - ELLIPSE_EXPONENT);
    // The contour's own aspect: square at roundness -100, the frame's above 0.
    let squareness = (settings.vignette_roundness / 100.0 + 1.0).clamp(0.0, 1.0);
    let semi_axis = (reach.0 / reach.1).powf(squareness);
    let offset = ((at.0 - centre_x) * aspect / semi_axis, at.1 - centre_y);
    let corner = (reach.0 / semi_axis, reach.1);
    superellipse(offset, exponent) / superellipse(corner, exponent)
}

fn superellipse(point: (f32, f32), exponent: f32) -> f32 {
    (point.0.abs().powf(exponent) + point.1.abs().powf(exponent)).powf(1.0 / exponent)
}

/// Where the transition begins and ends, in centre-to-corner distance. The
/// start never falls below zero, which is what pins the centre gain at 1.0.
fn falloff_span(settings: EffectsSettings) -> (f32, f32) {
    let midpoint = settings.vignette_midpoint / 100.0;
    let span = MIN_FEATHER_SPAN + settings.vignette_feather / 100.0 * (1.0 - MIN_FEATHER_SPAN);
    let start = (midpoint - span / 2.0).max(0.0);
    (start, (midpoint + span / 2.0).max(start + MIN_FEATHER_SPAN))
}

fn smoothstep(start: f32, end: f32, value: f32) -> f32 {
    let position = ((value - start) / (end - start)).clamp(0.0, 1.0);
    position * position * (3.0 - 2.0 * position)
}

pub const MIN_GRAIN_FRACTION: f32 = 0.000_25;
pub const MAX_GRAIN_FRACTION: f32 = 0.002;
pub const MAX_GRAIN_AMPLITUDE: f32 = 24.0;
const GRAIN_SEED: u32 = 0x9E37_79B9;

/// Side of one noise cell in image pixels, so grain keeps its size in the
/// photograph rather than on screen.
pub fn grain_cell(image_width: usize, image_height: usize, grain_size: f32) -> u32 {
    let reference = image_width.max(image_height) as f32;
    let fraction =
        MIN_GRAIN_FRACTION + (MAX_GRAIN_FRACTION - MIN_GRAIN_FRACTION) * grain_size / 100.0;
    ((reference * fraction + 0.5).floor() as u32).max(1)
}

/// Signed noise in `-1.0..=1.0` for one image pixel, from its absolute
/// coordinates alone. Mirrored verbatim in the tile shader's `grain_at`.
pub fn grain_at(x: u32, y: u32, cell: u32) -> f32 {
    let cell = cell.max(1);
    let mut mixed = (x / cell)
        .wrapping_mul(0x8DA6_B343)
        .wrapping_add((y / cell).wrapping_mul(0xD816_3841))
        ^ GRAIN_SEED;
    mixed ^= mixed >> 16;
    mixed = mixed.wrapping_mul(0x7FEB_352D);
    mixed ^= mixed >> 15;
    mixed = mixed.wrapping_mul(0x846C_A68B);
    mixed ^= mixed >> 16;
    (mixed >> 8) as f32 / 8_388_607.5 - 1.0
}

/// Grain to add to an encoded channel, weighted so midtones carry it and the
/// deepest shadows and brightest highlights stay clean.
pub fn grain_offset(settings: EffectsSettings, luminance: f32, x: u32, y: u32, cell: u32) -> f32 {
    if settings.grain_amount == 0.0 {
        return 0.0;
    }
    let midtone = luminance.clamp(0.0, 1.0);
    let weight = 4.0 * midtone * (1.0 - midtone);
    settings.grain_amount / 100.0 * MAX_GRAIN_AMPLITUDE * weight * grain_at(x, y, cell)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn effects(amount: f32, midpoint: f32, roundness: f32, feather: f32) -> EffectsSettings {
        EffectsSettings {
            vignette_amount: amount,
            vignette_midpoint: midpoint,
            vignette_roundness: roundness,
            vignette_feather: feather,
            ..EffectsSettings::NEUTRAL
        }
    }

    const OFF_CENTRE: VignetteFrame = VignetteFrame {
        x: 0.05,
        y: 0.6,
        width: 0.3,
        height: 0.35,
    };

    #[test]
    fn the_frame_centre_keeps_its_exact_brightness() {
        for amount in [-100.0, -63.0, -1.0, 1.0, 42.0, 100.0] {
            for midpoint in [0.0, 12.0, 50.0, 87.5, 100.0] {
                for roundness in [-100.0, -50.0, 0.0, 50.0, 100.0] {
                    for feather in [0.0, 25.0, 50.0, 100.0] {
                        let settings = effects(amount, midpoint, roundness, feather);
                        for frame in [VignetteFrame::FULL, OFF_CENTRE] {
                            for aspect in [0.5, 1.0, 1.5, 3.0] {
                                let gain = vignette_gain(settings, frame, aspect, frame.centre());
                                assert_eq!(
                                    gain, 1.0,
                                    "centre gain {gain} for {settings:?} on {frame:?} at {aspect}"
                                );
                            }
                        }
                    }
                }
            }
        }
    }

    #[test]
    fn gain_changes_monotonically_from_the_centre_outward() {
        let radius = |settings: EffectsSettings, steps: usize| {
            (0..=steps)
                .map(|step| {
                    let position = step as f32 / steps as f32;
                    vignette_gain(
                        settings,
                        VignetteFrame::FULL,
                        1.5,
                        (0.5, 0.5 - position / 2.0),
                    )
                })
                .collect::<Vec<_>>()
        };
        let darkened = radius(effects(-80.0, 40.0, 0.0, 0.0), 64);
        assert!(darkened.windows(2).all(|pair| pair[0] >= pair[1]));
        assert!(darkened[0] > *darkened.last().unwrap());
        let brightened = radius(effects(80.0, 40.0, 0.0, 100.0), 64);
        assert!(brightened.windows(2).all(|pair| pair[0] <= pair[1]));
        assert!(brightened[0] < *brightened.last().unwrap());
    }

    #[test]
    fn roundness_shapes_the_contour_from_circle_to_rectangle() {
        // Two points at the same distance from the centre, one along the
        // diagonal and one along an axis of a square frame.
        let reach = 0.25 * std::f32::consts::FRAC_1_SQRT_2;
        let diagonal = (0.5 + reach, 0.5 - reach);
        let axis = (0.5, 0.5 - 0.25);
        let separation = |roundness: f32| {
            let settings = effects(-100.0, 30.0, roundness, 20.0);
            vignette_gain(settings, VignetteFrame::FULL, 1.0, diagonal)
                - vignette_gain(settings, VignetteFrame::FULL, 1.0, axis)
        };
        assert!(separation(-100.0).abs() < 1e-6, "{}", separation(-100.0));
        assert!(separation(100.0) > 0.05, "{}", separation(100.0));
    }

    #[test]
    fn the_contour_follows_the_frame_rather_than_the_image() {
        let settings = effects(-100.0, 20.0, 100.0, 10.0);
        let inside = vignette_gain(settings, OFF_CENTRE, 1.5, OFF_CENTRE.centre());
        let elsewhere = vignette_gain(settings, OFF_CENTRE, 1.5, (0.5, 0.5));
        assert_eq!(inside, 1.0);
        assert!(elsewhere < inside);
    }

    #[test]
    fn grain_repeats_exactly_for_a_coordinate_and_stays_signed_and_bounded() {
        assert_eq!(grain_at(1_234, 5_678, 3), grain_at(1_234, 5_678, 3));
        let mut total = 0.0;
        for y in 0..64u32 {
            for x in 0..64u32 {
                let value = grain_at(x, y, 1);
                assert!((-1.0..=1.0).contains(&value), "grain {value} at {x},{y}");
                total += value;
            }
        }
        assert!((total / 4_096.0).abs() < 0.05, "biased grain {total}");
    }

    #[test]
    fn grain_matches_the_values_the_tile_shader_reproduces() {
        for (x, y, cell, expected) in [
            (0u32, 0u32, 1u32, -0.984_469_8f32),
            (1, 0, 1, -0.496_068_9),
            (0, 1, 1, -0.960_77),
            (4_095, 2_047, 1, 0.449_652_08),
            (12, 8, 4, -0.268_981_16),
            (13, 9, 4, -0.268_981_16),
            (16, 8, 4, -0.736_739_5),
        ] {
            let actual = grain_at(x, y, cell);
            assert_eq!(
                actual, expected,
                "grain at {x},{y} cell {cell} drifted to {actual}"
            );
        }
    }

    #[test]
    fn a_larger_cell_clumps_more_neighbours_together() {
        let clumped = |cell: u32| {
            let first = grain_at(64, 64, cell);
            (0..16u32).all(|step| grain_at(64 + step, 64, cell) == first)
        };
        assert!(!clumped(4));
        assert!(clumped(16));
    }

    #[test]
    fn the_cell_grows_with_the_image_and_the_size_control() {
        assert!(grain_cell(6_000, 4_000, 100.0) > grain_cell(6_000, 4_000, 0.0));
        assert!(grain_cell(6_000, 4_000, 25.0) > grain_cell(600, 400, 25.0));
        assert_eq!(grain_cell(1, 1, 0.0), 1);
    }

    #[test]
    fn grain_fades_towards_black_and_white() {
        let settings = EffectsSettings {
            grain_amount: 100.0,
            ..EffectsSettings::NEUTRAL
        };
        let offset = |luminance: f32| grain_offset(settings, luminance, 7, 11, 2).abs();
        assert!(offset(0.5) > offset(0.05));
        assert!(offset(0.5) > offset(0.95));
        assert_eq!(offset(0.0), 0.0);
        assert_eq!(offset(1.0), 0.0);
        assert_eq!(grain_offset(EffectsSettings::NEUTRAL, 0.5, 7, 11, 2), 0.0);
    }

    #[test]
    fn a_frame_outside_the_image_is_rejected() {
        assert!(VignetteFrame::FULL.validated().is_ok());
        assert!(OFF_CENTRE.validated().is_ok());
        assert!(
            VignetteFrame {
                x: 0.8,
                width: 0.4,
                ..VignetteFrame::FULL
            }
            .validated()
            .is_err()
        );
        assert!(
            VignetteFrame {
                height: 0.0,
                ..VignetteFrame::FULL
            }
            .validated()
            .is_err()
        );
    }
}
