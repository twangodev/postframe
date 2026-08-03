use crate::{Error, Result};

const CURVE_SAMPLES: usize = 4096;
const ANCHOR_INPUTS: [f32; 7] = [0.0, 0.08, 0.25, 0.5, 0.75, 0.92, 1.0];

#[derive(Clone, Copy, Debug, PartialEq)]
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

    pub fn apply_display_rgb8(&self, rgb8: &[u8]) -> Result<Vec<u8>> {
        if !rgb8.len().is_multiple_of(3) {
            return Err(Error::Unsupported("RGB buffer size mismatch"));
        }
        let mut adjusted = Vec::with_capacity(rgb8.len());
        for pixel in rgb8.chunks_exact(3) {
            adjusted.extend(self.display_pixel([pixel[0], pixel[1], pixel[2]]));
        }
        Ok(adjusted)
    }

    pub fn apply_display_rgba8(&self, rgba8: &[u8]) -> Result<Vec<u8>> {
        if !rgba8.len().is_multiple_of(4) {
            return Err(Error::Unsupported("RGBA buffer size mismatch"));
        }
        let mut adjusted = Vec::with_capacity(rgba8.len());
        for pixel in rgba8.chunks_exact(4) {
            adjusted.extend(self.display_pixel([pixel[0], pixel[1], pixel[2]]));
            adjusted.push(pixel[3]);
        }
        Ok(adjusted)
    }

    pub(crate) fn apply_encoded_pixel(&self, pixel: [u8; 3]) -> [u8; 3] {
        if self.identity_tone {
            return pixel;
        }
        self.tone_pixel(pixel.map(srgb_to_linear))
    }

    fn display_pixel(&self, pixel: [u8; 3]) -> [u8; 3] {
        if self.settings == LightSettings::NEUTRAL {
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

    let contrast = settings.contrast / 100.0;
    let highlights = settings.highlights / 100.0;
    let shadows = settings.shadows / 100.0;
    let whites = settings.whites / 100.0;
    let blacks = settings.blacks / 100.0;
    let mut outputs = [
        blacks.max(0.0) * 0.05,
        0.08 - contrast * 0.03 + shadows * 0.04 + blacks * 0.1,
        0.25 - contrast * 0.07 + shadows * 0.16 + blacks * 0.025,
        0.5,
        0.75 + contrast * 0.07 + highlights * 0.16 + whites * 0.025,
        0.92 + contrast * 0.03 + highlights * 0.04 + whites * 0.1,
        1.0 + whites.min(0.0) * 0.05,
    ];
    outputs[0] = outputs[0].clamp(0.0, 1.0);
    for index in 1..outputs.len() {
        outputs[index] = outputs[index].clamp(outputs[index - 1], 1.0);
    }

    let tangents = monotone_tangents(&ANCHOR_INPUTS, &outputs);
    std::array::from_fn(|index| {
        let input = index as f32 / (CURVE_SAMPLES - 1) as f32;
        monotone_sample(input, &ANCHOR_INPUTS, &outputs, &tangents).clamp(0.0, 1.0)
    })
}

fn monotone_tangents(inputs: &[f32; 7], outputs: &[f32; 7]) -> [f32; 7] {
    let slopes: [f32; 6] = std::array::from_fn(|index| {
        (outputs[index + 1] - outputs[index]) / (inputs[index + 1] - inputs[index])
    });
    let mut tangents = [0.0; 7];
    tangents[0] = slopes[0];
    tangents[6] = slopes[5];
    for index in 1..6 {
        if slopes[index - 1] == 0.0 || slopes[index] == 0.0 {
            continue;
        }
        let before = inputs[index] - inputs[index - 1];
        let after = inputs[index + 1] - inputs[index];
        let left_weight = 2.0 * after + before;
        let right_weight = after + 2.0 * before;
        tangents[index] = (left_weight + right_weight)
            / (left_weight / slopes[index - 1] + right_weight / slopes[index]);
    }
    tangents
}

fn monotone_sample(input: f32, inputs: &[f32; 7], outputs: &[f32; 7], tangents: &[f32; 7]) -> f32 {
    let segment = inputs
        .windows(2)
        .position(|range| input <= range[1])
        .unwrap_or(inputs.len() - 2);
    let width = inputs[segment + 1] - inputs[segment];
    let t = (input - inputs[segment]) / width;
    let t2 = t * t;
    let t3 = t2 * t;
    (2.0 * t3 - 3.0 * t2 + 1.0) * outputs[segment]
        + (t3 - 2.0 * t2 + t) * width * tangents[segment]
        + (-2.0 * t3 + 3.0 * t2) * outputs[segment + 1]
        + (t3 - t2) * width * tangents[segment + 1]
}

fn srgb_to_linear(channel: u8) -> f32 {
    let encoded = channel as f32 / 255.0;
    if encoded <= 0.04045 {
        encoded / 12.92
    } else {
        ((encoded + 0.055) / 1.055).powf(2.4)
    }
}

fn linear_to_srgb(channel: f32) -> u8 {
    let linear = channel.clamp(0.0, 1.0);
    let encoded = if linear <= 0.003_130_8 {
        12.92 * linear
    } else {
        1.055 * linear.powf(1.0 / 2.4) - 0.055
    };
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
        assert!(delta(&blacks, 30) > delta(&blacks, 128));
        assert!(delta(&whites, 235) > delta(&whites, 128));
    }

    #[test]
    fn every_extreme_curve_remains_monotonic() {
        for name in ["contrast", "highlights", "shadows", "whites", "blacks"] {
            for value in [-100.0, 100.0] {
                let transform = LightTransform::new(settings(name, value)).unwrap();
                assert!(
                    transform
                        .luminance
                        .windows(2)
                        .all(|samples| samples[0] <= samples[1])
                );
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
