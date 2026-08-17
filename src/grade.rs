use crate::light::{linear_to_srgb, srgb_to_linear};
use crate::{Error, Result};

pub const MAX_TEMPERATURE_SHIFT_STOPS: f32 = 0.5;
pub const MAX_TINT_SHIFT_STOPS: f32 = 0.5;

const LUMINANCE_WEIGHTS: [f32; 3] = [0.2126, 0.7152, 0.0722];

#[derive(Clone, Copy, Debug, PartialEq)]
#[cfg_attr(feature = "wasm", derive(serde::Deserialize))]
pub struct ColorSettings {
    pub temperature: f32,
    pub tint: f32,
    pub vibrance: f32,
    pub saturation: f32,
}

impl ColorSettings {
    pub const NEUTRAL: Self = Self {
        temperature: 0.0,
        tint: 0.0,
        vibrance: 0.0,
        saturation: 0.0,
    };

    pub fn validated(self) -> Result<Self> {
        if [self.temperature, self.tint, self.vibrance, self.saturation]
            .into_iter()
            .any(|value| !value.is_finite() || !(-100.0..=100.0).contains(&value))
        {
            return Err(Error::Unsupported(
                "color controls must be between -100 and 100",
            ));
        }
        Ok(self)
    }
}

impl Default for ColorSettings {
    fn default() -> Self {
        Self::NEUTRAL
    }
}

#[derive(Clone)]
pub struct ColorTransform {
    settings: ColorSettings,
    balance: [f32; 3],
}

impl ColorTransform {
    pub fn new(settings: ColorSettings) -> Result<Self> {
        let settings = settings.validated()?;
        Ok(Self {
            balance: balance_gains(settings),
            settings,
        })
    }

    pub fn settings(&self) -> ColorSettings {
        self.settings
    }

    pub fn apply_display_rgba8(&self, rgba8: &[u8]) -> Result<Vec<u8>> {
        if !rgba8.len().is_multiple_of(4) {
            return Err(Error::Unsupported("RGBA buffer size mismatch"));
        }
        let mut adjusted = Vec::with_capacity(rgba8.len());
        for pixel in rgba8.chunks_exact(4) {
            adjusted.extend(self.apply_display_pixel([pixel[0], pixel[1], pixel[2]]));
            adjusted.push(pixel[3]);
        }
        Ok(adjusted)
    }

    pub(crate) fn apply_display_pixel(&self, pixel: [u8; 3]) -> [u8; 3] {
        if self.settings == ColorSettings::NEUTRAL {
            return pixel;
        }
        let linear = pixel.map(srgb_to_linear);
        let balanced = [
            linear[0] * self.balance[0],
            linear[1] * self.balance[1],
            linear[2] * self.balance[2],
        ];
        self.scale_chroma(balanced).map(linear_to_srgb)
    }

    fn scale_chroma(&self, linear: [f32; 3]) -> [f32; 3] {
        let scale = self.chroma_scale(linear);
        if scale == 1.0 {
            return linear;
        }
        let luminance = luminance(linear);
        linear.map(|channel| (luminance + (channel - luminance) * scale).max(0.0))
    }

    fn chroma_scale(&self, linear: [f32; 3]) -> f32 {
        let saturation = 1.0 + self.settings.saturation / 100.0;
        let vibrance = 1.0 + self.settings.vibrance / 100.0 * (1.0 - chroma_fraction(linear));
        (saturation * vibrance).max(0.0)
    }
}

fn balance_gains(settings: ColorSettings) -> [f32; 3] {
    let warmth = settings.temperature / 100.0 * MAX_TEMPERATURE_SHIFT_STOPS;
    let magenta = settings.tint / 100.0 * MAX_TINT_SHIFT_STOPS;
    let gains = [
        2.0f32.powf(warmth),
        2.0f32.powf(-magenta),
        2.0f32.powf(-warmth),
    ];
    let luminance = luminance(gains);
    gains.map(|gain| gain / luminance)
}

pub(crate) fn luminance([red, green, blue]: [f32; 3]) -> f32 {
    LUMINANCE_WEIGHTS[0] * red + LUMINANCE_WEIGHTS[1] * green + LUMINANCE_WEIGHTS[2] * blue
}

fn chroma_fraction(linear: [f32; 3]) -> f32 {
    let maximum = linear.into_iter().fold(0.0f32, f32::max);
    if maximum <= 0.0 {
        return 0.0;
    }
    let minimum = linear.into_iter().fold(f32::INFINITY, f32::min);
    ((maximum - minimum) / maximum).clamp(0.0, 1.0)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn settings(name: &str, value: f32) -> ColorSettings {
        let mut settings = ColorSettings::NEUTRAL;
        match name {
            "temperature" => settings.temperature = value,
            "tint" => settings.tint = value,
            "vibrance" => settings.vibrance = value,
            "saturation" => settings.saturation = value,
            _ => panic!("unknown setting"),
        }
        settings
    }

    fn adjust(transform: &ColorTransform, pixel: [u8; 3]) -> [u8; 3] {
        let adjusted = transform
            .apply_display_rgba8(&[pixel[0], pixel[1], pixel[2], 255])
            .unwrap();
        [adjusted[0], adjusted[1], adjusted[2]]
    }

    fn linear_luminance(pixel: [u8; 3]) -> f32 {
        luminance(pixel.map(srgb_to_linear))
    }

    #[test]
    fn neutral_transform_is_exact_and_preserves_alpha() {
        let transform = ColorTransform::new(ColorSettings::NEUTRAL).unwrap();
        let source = [0, 31, 127, 9, 201, 240, 255, 73];
        assert_eq!(transform.apply_display_rgba8(&source).unwrap(), source);
    }

    #[test]
    fn temperature_shifts_warm_and_cool_without_changing_luminance() {
        let warm = ColorTransform::new(settings("temperature", 100.0)).unwrap();
        let cool = ColorTransform::new(settings("temperature", -100.0)).unwrap();
        let gray = [128, 128, 128];
        let warmed = adjust(&warm, gray);
        let cooled = adjust(&cool, gray);
        assert!(warmed[0] > warmed[2]);
        assert!(cooled[2] > cooled[0]);
        assert!((linear_luminance(warmed) - linear_luminance(gray)).abs() < 0.01);
        assert!((linear_luminance(cooled) - linear_luminance(gray)).abs() < 0.01);
    }

    #[test]
    fn tint_moves_between_green_and_magenta() {
        let magenta = ColorTransform::new(settings("tint", 100.0)).unwrap();
        let green = ColorTransform::new(settings("tint", -100.0)).unwrap();
        let gray = [128, 128, 128];
        assert!(adjust(&magenta, gray)[1] < adjust(&magenta, gray)[0]);
        assert!(adjust(&green, gray)[1] > adjust(&green, gray)[0]);
    }

    #[test]
    fn saturation_scales_chroma_to_gray_at_the_minimum() {
        let muted = ColorTransform::new(settings("saturation", -100.0)).unwrap();
        let boosted = ColorTransform::new(settings("saturation", 60.0)).unwrap();
        let source = [180, 120, 60];
        let gray = adjust(&muted, source);
        assert_eq!(gray[0], gray[1]);
        assert_eq!(gray[1], gray[2]);
        let vivid = adjust(&boosted, source);
        assert!(i16::from(vivid[0]) - i16::from(vivid[2]) > 180 - 60);
    }

    #[test]
    fn vibrance_protects_already_saturated_colors() {
        let transform = ColorTransform::new(settings("vibrance", 80.0)).unwrap();
        let muted = [140, 120, 110];
        let vivid = [250, 60, 20];
        let spread = |pixel: [u8; 3]| {
            i16::from(*pixel.iter().max().unwrap()) - i16::from(*pixel.iter().min().unwrap())
        };
        let muted_gain = spread(adjust(&transform, muted)) - spread(muted);
        let vivid_gain = spread(adjust(&transform, vivid)) - spread(vivid);
        assert!(muted_gain > 0);
        assert!(muted_gain > vivid_gain);
    }

    #[test]
    fn validates_public_ranges_and_buffer_shapes() {
        assert!(ColorTransform::new(settings("temperature", 100.1)).is_err());
        assert!(ColorTransform::new(settings("saturation", f32::NAN)).is_err());
        let transform = ColorTransform::new(ColorSettings::NEUTRAL).unwrap();
        assert!(transform.apply_display_rgba8(&[0, 0, 0]).is_err());
    }
}
