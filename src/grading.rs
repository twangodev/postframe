//! The color grading wheels: shadow, midtone and highlight tints compiled into
//! the tonal ramps and per-range scalars both render paths apply.

use crate::error::within;
use crate::hue::{brightest, from_hue, luminance, scale_luminance};
use crate::light::MIDDLE_GRAY;
use crate::{Error, Result};

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

pub(crate) const NEUTRAL_WHEEL: GradingWheel = GradingWheel {
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
        scale_luminance(tinted, stops.exp2())
    }
}

fn smoothstep(start: f32, end: f32, value: f32) -> f32 {
    let position = ((value - start) / (end - start)).clamp(0.0, 1.0);
    position * position * (3.0 - 2.0 * position)
}

#[cfg(test)]
mod tests {
    use super::*;

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
}
