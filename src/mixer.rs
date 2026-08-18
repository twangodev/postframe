//! The hue-band color mixer: eight bands of hue, saturation and luminance
//! resolved into the per-degree tables both render paths sample.

use crate::error::within;
use crate::hue::{chroma_fraction, hue_degrees, scale_luminance, scale_saturation, with_hue_shift};
use crate::{Error, Result};

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

pub(crate) const NEUTRAL_BAND: MixerBand = MixerBand {
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_band_owns_its_center_alone() {
        for (band, center) in MIXER_BAND_CENTERS.into_iter().enumerate() {
            let weights = mixer_band_weights(center);
            assert_eq!(weights[band], 1.0, "band {band} does not own {center}");
            assert_eq!(weights.into_iter().sum::<f32>(), 1.0);
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
}
