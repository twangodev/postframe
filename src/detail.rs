//! The spatial stages: noise reduction and the blur planes that clarity,
//! texture and sharpening read. Neighbourhood work runs once per tile, before
//! the per-pixel develop chain, so the chain itself stays a pure function of a
//! pixel and its two precomputed detail signals.

use crate::composite::DevelopedTileRegion;
use crate::develop::PixelContext;
use crate::error::within;
use crate::hue::luminance;
use crate::light::{linear_to_srgb, srgb_to_linear};
use crate::{Error, Result};

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
        if self.texture == 0.0 && self.clarity == 0.0 && self.sharpen_amount == 0.0 {
            return Vec::new();
        }
        vec![FINE_BLUR_FRACTION, COARSE_BLUR_FRACTION]
    }

    /// Context pixels a tile needs per side (binned), to match a whole-image pass:
    /// the widest plane's reach, plus the cleaning it reads on top of that.
    pub fn apron(&self, image: (usize, usize), bin: usize) -> usize {
        let planes = self
            .blur_radii()
            .into_iter()
            .map(|fraction| blur_footprint(blur_radius(fraction, image, bin)))
            .max()
            .unwrap_or(0);
        planes + self.noise_footprint()
    }

    /// How far `reduce_noise` reads from a pixel: each active pass reads a
    /// neighbourhood of the previous pass's output, so the reach compounds.
    fn noise_footprint(&self) -> usize {
        [self.noise_luminance, self.noise_color]
            .into_iter()
            .filter(|amount| *amount > 0.0)
            .count()
            * NOISE_RADIUS
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

/// Stops of luminance gain each control reaches at the end of its range.
pub const MAX_TEXTURE_STOPS: f32 = 0.5;
pub const MAX_CLARITY_STOPS: f32 = 0.75;
pub const MAX_SHARPEN_STOPS: f32 = 0.6;
/// Fraction of a pixel's own dark channel that full dehaze reads as veil.
pub const MAX_DEHAZE_VEIL: f32 = 0.9;
/// Fraction of the way to the ambient white that full negative dehaze blends.
pub const MAX_HAZE_BLEND: f32 = 0.6;
/// The estimated atmospheric white: display-referred haze settles on paper white.
pub const DEHAZE_AMBIENT: f32 = 1.0;
pub const SHARPEN_RANGE: f32 = 150.0;

const MIN_TRANSMISSION: f32 = 0.1;
const MAX_LOCAL_CONTRAST_STOPS: f32 = 3.0;
const LUMINANCE_FLOOR: f32 = 1.0 / 65536.0;
const NOISE_RADIUS: usize = 2;
const NOISE_RANGE_STOPS: f32 = 0.35;

/// Blurring a plane wider than this many pixels runs on a decimated copy: a
/// Gaussian that broad carries no detail the finer grid would preserve.
const MAX_DIRECT_BLUR_RADIUS: usize = 24;

/// One pixel's local contrast against each blur plane, in stops.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct DetailSample {
    pub fine: f32,
    pub coarse: f32,
}

/// The two local-contrast planes of a cleaned tile, addressed by where a pixel
/// sits in the image so every render path shares one convention.
pub struct DetailPlanes {
    region: DevelopedTileRegion,
    tile: (usize, usize),
    fine: Vec<f32>,
    coarse: Vec<f32>,
}

impl DetailPlanes {
    pub fn build(
        rgb: &[[f32; 3]],
        region: DevelopedTileRegion,
        tile: (usize, usize),
        bin: usize,
        settings: &DetailSettings,
    ) -> Option<Self> {
        let [fine, coarse]: [f32; 2] = settings.blur_radii().try_into().ok()?;
        let base = log_luminance(rgb);
        let image = (region.image_width, region.image_height);
        let radius = |fraction| blur_radius(fraction, image, bin);
        Some(Self {
            fine: local_contrast(&base, tile, radius(fine)),
            coarse: local_contrast(&base, tile, radius(coarse)),
            region,
            tile,
        })
    }

    /// Inverts `DevelopedTileRegion::pixel_context`, which every render path
    /// uses to place a pixel, so a plane is read through the same convention.
    pub fn sample(&self, at: PixelContext) -> DetailSample {
        let local = |position: usize, origin: usize, span: usize, extent: usize| {
            if span == 0 {
                return 0;
            }
            (position.saturating_sub(origin) * extent / span).min(extent - 1)
        };
        let x = local(at.x, self.region.x, self.region.width, self.tile.0);
        let y = local(at.y, self.region.y, self.region.height, self.tile.1);
        let index = y * self.tile.0 + x;
        DetailSample {
            fine: self.fine[index],
            coarse: self.coarse[index],
        }
    }

    /// The fine plane followed by the coarse one, as the GPU's aux texture wants
    /// them: one single-channel image of twice the tile's height.
    pub fn stacked(&self) -> Vec<f32> {
        [self.fine.as_slice(), self.coarse.as_slice()].concat()
    }

    pub fn byte_len(&self) -> usize {
        (self.fine.len() + self.coarse.len()) * std::mem::size_of::<f32>()
    }
}

/// Tile-side work the spatial stages read: noise-cleaned tile, then blur planes built
/// from it — both depend only on the source and the noise controls.
pub struct PreparedDetail {
    pub cleaned: Option<Vec<[f32; 3]>>,
    pub planes: Option<DetailPlanes>,
}

pub fn prepare(
    rgb: &[[f32; 3]],
    region: DevelopedTileRegion,
    tile: (usize, usize),
    bin: usize,
    settings: &DetailSettings,
) -> PreparedDetail {
    let cleaned = reduce_noise(rgb, tile, settings);
    let planes = DetailPlanes::build(
        cleaned.as_deref().unwrap_or(rgb),
        region,
        tile,
        bin,
        settings,
    );
    PreparedDetail { cleaned, planes }
}

/// The presence and detail stages compiled from their controls.
#[derive(Clone, Copy, Debug)]
pub struct DetailTransform {
    texture: f32,
    clarity: f32,
    sharpen: f32,
    haze: f32,
}

impl DetailTransform {
    pub fn new(settings: DetailSettings) -> Self {
        Self {
            texture: settings.texture / 100.0 * MAX_TEXTURE_STOPS,
            clarity: settings.clarity / 100.0 * MAX_CLARITY_STOPS,
            sharpen: settings.sharpen_amount / SHARPEN_RANGE * MAX_SHARPEN_STOPS,
            haze: settings.dehaze / 100.0,
        }
    }

    pub fn is_identity(&self) -> bool {
        self.haze == 0.0 && self.presence_is_identity()
    }

    fn presence_is_identity(&self) -> bool {
        self.texture == 0.0 && self.clarity == 0.0 && self.sharpen == 0.0
    }

    pub fn apply(&self, pixel: [u8; 3], detail: Option<DetailSample>) -> [u8; 3] {
        let detail = detail.filter(|_| !self.presence_is_identity());
        if self.haze == 0.0 && detail.is_none() {
            return pixel;
        }
        let dehazed = self.dehaze(pixel.map(srgb_to_linear));
        detail
            .map_or(dehazed, |detail| self.present(dehazed, detail))
            .map(linear_to_srgb)
    }

    /// The haze model `radiance = (observed - ambient(1 - t)) / t`, with the
    /// transmission `t` read from each pixel's own dark channel.
    fn dehaze(&self, linear: [f32; 3]) -> [f32; 3] {
        if self.haze == 0.0 {
            return linear;
        }
        if self.haze < 0.0 {
            let blend = -self.haze * MAX_HAZE_BLEND;
            return linear.map(|channel| mix(channel, DEHAZE_AMBIENT, blend));
        }
        let dark = linear.into_iter().fold(f32::INFINITY, f32::min);
        let transmission = (1.0 - self.haze * MAX_DEHAZE_VEIL * dark).max(MIN_TRANSMISSION);
        linear.map(|channel| {
            ((channel - DEHAZE_AMBIENT * (1.0 - transmission)) / transmission).max(0.0)
        })
    }

    /// Unsharp masking on luminance alone: the whole pixel scales by the
    /// luminance ratio, so hue and saturation survive untouched.
    fn present(&self, linear: [f32; 3], detail: DetailSample) -> [f32; 3] {
        let luminance = luminance(linear);
        if luminance <= LUMINANCE_FLOOR {
            return linear;
        }
        let stops = (self.texture + self.sharpen) * detail.fine
            + self.clarity * midtone_weight(luminance) * detail.coarse;
        if stops == 0.0 {
            return linear;
        }
        let maximum = linear.into_iter().fold(0.0f32, f32::max);
        let gamut = if maximum > 0.0 {
            1.0 / maximum
        } else {
            f32::INFINITY
        };
        let scale = 2.0f32.powf(stops).min(gamut);
        linear.map(|channel| channel * scale)
    }
}

/// Clarity leans on the midtones so it neither crushes blacks nor blows
/// highlights, weighted where the eye reads tone rather than in linear light.
fn midtone_weight(luminance: f32) -> f32 {
    let encoded = encode_srgb(luminance.clamp(0.0, 1.0));
    4.0 * encoded * (1.0 - encoded)
}

/// The continuous transfer the shader also evaluates, where `light`'s table
/// would quantise the weight to a code and drift the two paths apart.
fn encode_srgb(linear: f32) -> f32 {
    if linear <= 0.003_130_8 {
        12.92 * linear
    } else {
        1.055 * linear.powf(1.0 / 2.4) - 0.055
    }
}

/// Edge-preserving smoothing of luminance, then of chroma, leaving the tile
/// borrowed rather than copied when neither control asks for anything.
pub fn reduce_noise(
    rgb: &[[f32; 3]],
    size: (usize, usize),
    settings: &DetailSettings,
) -> Option<Vec<[f32; 3]>> {
    let luminance = settings.noise_luminance / 100.0;
    let color = settings.noise_color / 100.0;
    if luminance == 0.0 && color == 0.0 {
        return None;
    }
    let mut cleaned = None;
    if luminance > 0.0 {
        cleaned = Some(calm_luminance(rgb, size, luminance));
    }
    if color > 0.0 {
        cleaned = Some(calm_chroma(cleaned.as_deref().unwrap_or(rgb), size, color));
    }
    cleaned
}

fn calm_luminance(rgb: &[[f32; 3]], size: (usize, usize), amount: f32) -> Vec<[f32; 3]> {
    let (width, height) = size;
    let base = log_luminance(rgb);
    let spatial = gaussian_kernel(NOISE_RADIUS);
    let range = -0.5 / (NOISE_RANGE_STOPS * NOISE_RANGE_STOPS);
    let mut cleaned = vec![[0.0f32; 3]; rgb.len()];
    crate::parallel::fill_rows(&mut cleaned, width, |y, row| {
        for (x, cleaned) in row.iter_mut().enumerate() {
            let center = base[y * width + x];
            let mut sum = 0.0;
            let mut total = 0.0;
            for (tap_y, vertical) in spatial.iter().enumerate() {
                let row = (y + tap_y).saturating_sub(NOISE_RADIUS).min(height - 1) * width;
                for (tap_x, horizontal) in spatial.iter().enumerate() {
                    let value = base[row + (x + tap_x).saturating_sub(NOISE_RADIUS).min(width - 1)];
                    let difference = value - center;
                    let weight = vertical * horizontal * (difference * difference * range).exp();
                    sum += weight * value;
                    total += weight;
                }
            }
            let source = rgb[y * width + x];
            let target = mix(luminance(source), (sum / total).exp2(), amount);
            *cleaned = scaled_to_luminance(source, target);
        }
    });
    cleaned
}

fn calm_chroma(rgb: &[[f32; 3]], size: (usize, usize), amount: f32) -> Vec<[f32; 3]> {
    let kernel = gaussian_kernel(NOISE_RADIUS);
    let chroma: [Vec<f32>; 3] = std::array::from_fn(|channel| {
        let plane: Vec<f32> = rgb
            .iter()
            .map(|&pixel| pixel[channel] / luminance(pixel).max(LUMINANCE_FLOOR))
            .collect();
        blur(&plane, size.0, size.1, kernel.len() / 2)
    });
    rgb.iter()
        .enumerate()
        .map(|(index, &source)| {
            let smoothed = std::array::from_fn(|channel| chroma[channel][index]);
            let smoothed = scaled_to_luminance(smoothed, luminance(source));
            std::array::from_fn(|channel| mix(source[channel], smoothed[channel], amount))
        })
        .collect()
}

fn scaled_to_luminance(linear: [f32; 3], target: f32) -> [f32; 3] {
    let luminance = luminance(linear);
    if luminance <= LUMINANCE_FLOOR {
        return [target.max(0.0); 3];
    }
    linear.map(|channel| channel * target / luminance)
}

fn log_luminance(rgb: &[[f32; 3]]) -> Vec<f32> {
    crate::parallel::map_pixels(rgb, |&pixel| [luminance(pixel).max(LUMINANCE_FLOOR).log2()])
}

fn local_contrast(base: &[f32], size: (usize, usize), radius: usize) -> Vec<f32> {
    blur_plane(base, size, radius)
        .into_iter()
        .zip(base)
        .map(|(blurred, base)| {
            (base - blurred).clamp(-MAX_LOCAL_CONTRAST_STOPS, MAX_LOCAL_CONTRAST_STOPS)
        })
        .collect()
}

pub fn blur_radius(fraction: f32, image: (usize, usize), bin: usize) -> usize {
    let extent = image.0.max(image.1) as f32 / bin.max(1) as f32;
    ((fraction * extent).round().max(1.0)) as usize
}

/// Reach of one blurred value: the kernel radius, or on a decimated grid, the two
/// coarse cells it interpolates between plus their own blur's reach.
pub fn blur_footprint(radius: usize) -> usize {
    let stride = radius.div_ceil(MAX_DIRECT_BLUR_RADIUS);
    if stride <= 1 {
        return radius;
    }
    (radius.div_ceil(stride) + 2) * stride
}

fn gaussian_kernel(radius: usize) -> Vec<f32> {
    let sigma = (radius as f32 / 2.0).max(0.5);
    let scale = -0.5 / (sigma * sigma);
    (0..=radius * 2)
        .map(|tap| {
            let offset = tap as f32 - radius as f32;
            (offset * offset * scale).exp()
        })
        .collect()
}

fn blur_rows(values: &[f32], width: usize, kernel: &[f32]) -> Vec<f32> {
    let radius = kernel.len() / 2;
    let total: f32 = kernel.iter().sum();
    let mut blurred = vec![0.0; values.len()];
    crate::parallel::fill_rows(&mut blurred, width, |y, row| {
        let source = &values[y * width..y * width + row.len()];
        for (x, blurred) in row.iter_mut().enumerate() {
            let mut sum = 0.0;
            for (tap, weight) in kernel.iter().enumerate() {
                sum += weight * source[(x + tap).saturating_sub(radius).min(source.len() - 1)];
            }
            *blurred = sum / total;
        }
    });
    blurred
}

fn transpose(values: &[f32], width: usize, height: usize) -> Vec<f32> {
    let mut transposed = vec![0.0; values.len()];
    crate::parallel::fill_rows(&mut transposed, height, |x, column| {
        for (y, value) in column.iter_mut().enumerate() {
            *value = values[y * width + x];
        }
    });
    transposed
}

fn blur(values: &[f32], width: usize, height: usize, radius: usize) -> Vec<f32> {
    if values.is_empty() || width == 0 || height == 0 {
        return values.to_vec();
    }
    let kernel = gaussian_kernel(radius);
    let rows = blur_rows(values, width, &kernel);
    let columns = blur_rows(&transpose(&rows, width, height), height, &kernel);
    transpose(&columns, height, width)
}

fn decimate(values: &[f32], width: usize, height: usize, stride: usize) -> Vec<f32> {
    let coarse_width = width.div_ceil(stride);
    let coarse_height = height.div_ceil(stride);
    let mut coarse = vec![0.0; coarse_width * coarse_height];
    crate::parallel::fill_rows(&mut coarse, coarse_width, |coarse_y, row| {
        let rows = coarse_y * stride..((coarse_y + 1) * stride).min(height);
        for (coarse_x, value) in row.iter_mut().enumerate() {
            let columns = coarse_x * stride..((coarse_x + 1) * stride).min(width);
            let mut sum = 0.0;
            for y in rows.clone() {
                sum += columns.clone().map(|x| values[y * width + x]).sum::<f32>();
            }
            *value = sum / (rows.len() * columns.len()) as f32;
        }
    });
    coarse
}

fn magnify(
    coarse: &[f32],
    coarse_size: (usize, usize),
    size: (usize, usize),
    stride: usize,
) -> Vec<f32> {
    let (coarse_width, coarse_height) = coarse_size;
    let center = (stride - 1) as f32 / 2.0;
    let position = |value: usize, limit: usize| {
        let exact = (value as f32 - center) / stride as f32;
        let clamped = exact.clamp(0.0, (limit - 1) as f32);
        let low = clamped.floor() as usize;
        (low, (low + 1).min(limit - 1), clamped - low as f32)
    };
    let mut magnified = vec![0.0; size.0 * size.1];
    crate::parallel::fill_rows(&mut magnified, size.0, |y, row| {
        let (top, bottom, vertical) = position(y, coarse_height);
        for (x, value) in row.iter_mut().enumerate() {
            let (left, right, horizontal) = position(x, coarse_width);
            let above = mix(
                coarse[top * coarse_width + left],
                coarse[top * coarse_width + right],
                horizontal,
            );
            let below = mix(
                coarse[bottom * coarse_width + left],
                coarse[bottom * coarse_width + right],
                horizontal,
            );
            *value = mix(above, below, vertical);
        }
    });
    magnified
}

fn blur_plane(values: &[f32], size: (usize, usize), radius: usize) -> Vec<f32> {
    let stride = radius.div_ceil(MAX_DIRECT_BLUR_RADIUS);
    if stride <= 1 {
        return blur(values, size.0, size.1, radius);
    }
    let coarse_size = (size.0.div_ceil(stride), size.1.div_ceil(stride));
    let coarse = decimate(values, size.0, size.1, stride);
    let blurred = blur(
        &coarse,
        coarse_size.0,
        coarse_size.1,
        radius.div_ceil(stride),
    );
    magnify(&blurred, coarse_size, size, stride)
}

fn mix(left: f32, right: f32, weight: f32) -> f32 {
    left + (right - left) * weight
}

#[cfg(test)]
mod tests {
    use super::*;

    fn convolve_directly(values: &[f32], width: usize, height: usize, radius: usize) -> Vec<f32> {
        let kernel = gaussian_kernel(radius);
        let total: f32 = kernel.iter().sum();
        let clamped = |value: usize, tap: usize, limit: usize| {
            (value + tap).saturating_sub(radius).min(limit - 1)
        };
        (0..width * height)
            .map(|index| {
                let (x, y) = (index % width, index / width);
                let mut sum = 0.0;
                for (tap_y, weight_y) in kernel.iter().enumerate() {
                    let sample_y = clamped(y, tap_y, height);
                    for (tap_x, weight_x) in kernel.iter().enumerate() {
                        let sample_x = clamped(x, tap_x, width);
                        sum += weight_y * weight_x * values[sample_y * width + sample_x];
                    }
                }
                sum / (total * total)
            })
            .collect()
    }

    fn worst_difference(left: &[f32], right: &[f32]) -> f32 {
        left.iter()
            .zip(right)
            .map(|(left, right)| (left - right).abs())
            .fold(0.0f32, f32::max)
    }

    #[test]
    fn a_constant_plane_survives_the_blur_without_darkened_edges() {
        let plane = vec![0.375; 7 * 5];
        for radius in [1, 3, 8] {
            let blurred = blur(&plane, 7, 5, radius);
            assert!(
                worst_difference(&blurred, &plane) < 1e-6,
                "radius {radius} drifted {}",
                worst_difference(&blurred, &plane)
            );
        }
    }

    #[test]
    fn the_separable_blur_matches_a_direct_two_dimensional_convolution() {
        let (width, height) = (13, 11);
        let plane: Vec<f32> = (0..width * height)
            .map(|index| {
                let (x, y) = (index % width, index / width);
                (x as f32 * 0.37).sin() + (y as f32 * 0.21).cos() * 0.5
            })
            .collect();
        for radius in [1, 2, 5] {
            let separable = blur(&plane, width, height, radius);
            let direct = convolve_directly(&plane, width, height, radius);
            let worst = worst_difference(&separable, &direct);
            assert!(worst < 1e-5, "radius {radius} drifted {worst}");
        }
    }

    #[test]
    fn a_decimated_blur_tracks_the_direct_blur_at_wide_radii() {
        let (width, height) = (200, 150);
        let plane: Vec<f32> = (0..width * height)
            .map(|index| {
                let (x, y) = (index % width, index / width);
                (x as f32 * 0.04).sin() + (y as f32 * 0.03).cos()
            })
            .collect();
        let radius = 48;
        let decimated = blur_plane(&plane, (width, height), radius);
        let direct = blur(&plane, width, height, radius);
        let margin = 56;
        let interior = |plane: &[f32]| {
            (margin..height - margin)
                .flat_map(|y| plane[y * width + margin..y * width + width - margin].to_vec())
                .collect::<Vec<_>>()
        };
        let inside = worst_difference(&interior(&decimated), &interior(&direct));
        assert!(inside < 0.01, "decimated blur drifted {inside} inside");
        let overall = worst_difference(&decimated, &direct);
        assert!(
            overall < 0.08,
            "decimated blur drifted {overall} at the clamped edge"
        );
    }

    #[test]
    fn a_decimated_blur_still_preserves_a_constant_plane() {
        let plane = vec![-1.25; 40 * 30];
        let blurred = blur_plane(&plane, (40, 30), 96);
        assert!(worst_difference(&blurred, &plane) < 1e-5);
    }

    fn detail(settings: DetailSettings) -> DetailTransform {
        DetailTransform::new(settings)
    }

    fn presence(name: &str, value: f32) -> DetailSettings {
        let mut settings = DetailSettings::NEUTRAL;
        match name {
            "texture" => settings.texture = value,
            "clarity" => settings.clarity = value,
            "dehaze" => settings.dehaze = value,
            "sharpenAmount" => settings.sharpen_amount = value,
            _ => panic!("unknown control"),
        }
        settings
    }

    fn michelson(patches: [[f32; 3]; 2]) -> f32 {
        let [dark, bright] = patches.map(luminance);
        (bright - dark) / (bright + dark)
    }

    fn gray(encoded: u8) -> [f32; 3] {
        [srgb_to_linear(encoded); 3]
    }

    #[test]
    fn neutral_detail_leaves_every_byte_untouched() {
        let neutral = detail(DetailSettings::NEUTRAL);
        assert!(neutral.is_identity());
        let signal = DetailSample {
            fine: 0.8,
            coarse: -1.2,
        };
        for code in 0..=255u8 {
            let pixel = [code, 255 - code, code / 2];
            assert_eq!(neutral.apply(pixel, Some(signal)), pixel);
            assert_eq!(neutral.apply(pixel, None), pixel);
        }
        let denoised = detail(DetailSettings {
            noise_luminance: 80.0,
            noise_color: 40.0,
            ..DetailSettings::NEUTRAL
        });
        assert!(denoised.is_identity());
        assert_eq!(denoised.apply([200, 90, 40], Some(signal)), [200, 90, 40]);
    }

    #[test]
    fn presence_without_planes_leaves_a_pixel_untouched() {
        let sharpened = detail(presence("sharpenAmount", 150.0));
        assert_eq!(sharpened.apply([120, 60, 30], None), [120, 60, 30]);
    }

    #[test]
    fn positive_clarity_expands_a_midtone_edge_and_spares_flat_regions() {
        let clarity = detail(presence("clarity", 60.0));
        let edge =
            |coarse| clarity.apply([128, 128, 128], Some(DetailSample { fine: 0.0, coarse }))[0];
        assert!(
            edge(0.5) > 128,
            "bright side of the edge stayed at {}",
            edge(0.5)
        );
        assert!(
            edge(-0.5) < 128,
            "dark side of the edge stayed at {}",
            edge(-0.5)
        );
        assert_eq!(edge(0.0), 128);
    }

    #[test]
    fn clarity_favours_midtones_over_the_extremes() {
        let clarity = detail(presence("clarity", 100.0));
        let signal = DetailSample {
            fine: 0.0,
            coarse: 0.4,
        };
        let lift = |encoded: u8| {
            let source = gray(encoded);
            luminance(clarity.present(source, signal)) / luminance(source)
        };
        assert!(
            lift(128) > lift(20),
            "midtone {} vs shadow {}",
            lift(128),
            lift(20)
        );
        assert!(
            lift(128) > lift(240),
            "midtone {} vs highlight {}",
            lift(128),
            lift(240)
        );
        assert!(lift(20) > 1.0 && lift(240) > 1.0);
    }

    #[test]
    fn detail_scales_channels_together_so_hue_survives() {
        let textured = detail(presence("texture", 90.0));
        let source = [0.42, 0.09, 0.035];
        let signal = DetailSample {
            fine: 0.6,
            coarse: 0.0,
        };
        let presented = textured.present(source, signal);
        let scales: Vec<f32> = presented
            .iter()
            .zip(source)
            .map(|(presented, source)| presented / source)
            .collect();
        assert!(presented[0] > source[0]);
        for scale in &scales {
            assert!(
                (scale - scales[0]).abs() < 1e-6,
                "channel scales diverged: {scales:?}"
            );
        }
    }

    #[test]
    fn dehaze_is_exact_at_zero() {
        let none = detail(presence("dehaze", 0.0));
        let hazy = [0.5, 0.52, 0.55];
        assert_eq!(none.dehaze(hazy), hazy);
    }

    #[test]
    fn positive_dehaze_restores_the_contrast_a_veil_flattened() {
        let veiled = [gray(180), gray(196)];
        let source = michelson(veiled);
        let mut previous = source;
        for strength in [25.0, 50.0, 100.0] {
            let dehazed = veiled.map(|patch| detail(presence("dehaze", strength)).dehaze(patch));
            let restored = michelson(dehazed);
            assert!(
                restored > previous,
                "dehaze {strength} gave {restored}, no better than {previous}"
            );
            previous = restored;
        }
        assert!(
            previous > source * 1.75,
            "full dehaze lifted {source} only to {previous}"
        );
    }

    #[test]
    fn negative_dehaze_blends_toward_the_ambient_white() {
        let added = detail(presence("dehaze", -80.0));
        let source = [0.2, 0.3, 0.45];
        let hazed = added.dehaze(source);
        for (hazed, source) in hazed.iter().zip(source) {
            assert!(*hazed > source, "{hazed} did not rise from {source}");
            assert!(*hazed < DEHAZE_AMBIENT);
        }
        assert!(michelson([hazed, [DEHAZE_AMBIENT; 3]]) < michelson([source, [DEHAZE_AMBIENT; 3]]));
    }

    fn noisy_tile(size: (usize, usize)) -> Vec<[f32; 3]> {
        (0..size.0 * size.1)
            .map(|index| {
                let (x, y) = (index % size.0, index / size.0);
                let base = if x < size.0 / 2 { 0.2 } else { 0.8 };
                let grain = ((x * 7 + y * 13) % 5) as f32 / 4.0 - 0.5;
                let tint = ((x * 3 + y * 11) % 7) as f32 / 6.0 - 0.5;
                [
                    base * (1.0 + 0.3 * grain + 0.4 * tint),
                    base * (1.0 + 0.3 * grain),
                    base * (1.0 + 0.3 * grain - 0.4 * tint),
                ]
            })
            .collect()
    }

    fn variance(values: impl Iterator<Item = f32>) -> f32 {
        let values: Vec<f32> = values.collect();
        let mean = values.iter().sum::<f32>() / values.len() as f32;
        values
            .iter()
            .map(|value| (value - mean).powi(2))
            .sum::<f32>()
            / values.len() as f32
    }

    fn half_variance(tile: &[[f32; 3]], size: (usize, usize), right: bool) -> f32 {
        variance((0..size.1).flat_map(|y| {
            let columns = if right {
                size.0 / 2 + 2..size.0
            } else {
                0..size.0 / 2 - 2
            };
            columns.map(move |x| luminance(tile[y * size.0 + x]))
        }))
    }

    fn half_mean(tile: &[[f32; 3]], size: (usize, usize), right: bool) -> f32 {
        let columns: Vec<f32> = (0..size.1)
            .flat_map(|y| {
                let columns = if right {
                    size.0 / 2 + 2..size.0
                } else {
                    0..size.0 / 2 - 2
                };
                columns.map(move |x| luminance(tile[y * size.0 + x]))
            })
            .collect();
        columns.iter().sum::<f32>() / columns.len() as f32
    }

    #[test]
    fn noise_reduction_is_exact_at_zero() {
        let size = (24, 18);
        let tile = noisy_tile(size);
        assert!(reduce_noise(&tile, size, &DetailSettings::NEUTRAL).is_none());
        assert!(
            reduce_noise(
                &tile,
                size,
                &DetailSettings {
                    clarity: 70.0,
                    ..DetailSettings::NEUTRAL
                }
            )
            .is_none()
        );
    }

    #[test]
    fn luminance_noise_reduction_calms_grain_and_keeps_the_edge() {
        let size = (24, 18);
        let tile = noisy_tile(size);
        let cleaned = reduce_noise(
            &tile,
            size,
            &DetailSettings {
                noise_luminance: 100.0,
                ..DetailSettings::NEUTRAL
            },
        )
        .unwrap();
        for side in [false, true] {
            let before = half_variance(&tile, size, side);
            let after = half_variance(&cleaned, size, side);
            assert!(after < before * 0.5, "variance went {before} to {after}");
        }
        let step = |tile: &[[f32; 3]]| half_mean(tile, size, true) - half_mean(tile, size, false);
        assert!(
            (step(&cleaned) - step(&tile)).abs() < step(&tile) * 0.05,
            "edge moved from {} to {}",
            step(&tile),
            step(&cleaned)
        );
    }

    #[test]
    fn color_noise_reduction_leaves_luminance_intact() {
        let size = (24, 18);
        let tile = noisy_tile(size);
        let cleaned = reduce_noise(
            &tile,
            size,
            &DetailSettings {
                noise_color: 100.0,
                ..DetailSettings::NEUTRAL
            },
        )
        .unwrap();
        let spread = |tile: &[[f32; 3]]| variance(tile.iter().map(|pixel| pixel[0] - pixel[2]));
        assert!(spread(&cleaned) < spread(&tile) * 0.5);
        for (cleaned, source) in cleaned.iter().zip(&tile) {
            let (cleaned, source) = (luminance(*cleaned), luminance(*source));
            assert!(
                (cleaned - source).abs() < source * 1e-5,
                "luminance moved from {source} to {cleaned}"
            );
        }
    }

    #[test]
    fn preparing_a_tile_cleans_it_before_building_its_planes() {
        let size = (24, 18);
        let tile = noisy_tile(size);
        let region = DevelopedTileRegion {
            image_width: 240,
            image_height: 180,
            x: 24,
            y: 36,
            width: 24,
            height: 18,
        };
        let settings = DetailSettings {
            clarity: 50.0,
            noise_luminance: 80.0,
            ..DetailSettings::NEUTRAL
        };
        let prepared = prepare(&tile, region, size, 1, &settings);
        let cleaned = reduce_noise(&tile, size, &settings).unwrap();
        assert_eq!(prepared.cleaned.as_deref(), Some(cleaned.as_slice()));
        let planes = DetailPlanes::build(&cleaned, region, size, 1, &settings).unwrap();
        let prepared_planes = prepared.planes.unwrap();
        assert_eq!(prepared_planes.fine, planes.fine);
        assert_eq!(prepared_planes.coarse, planes.coarse);
        let unprepared = DetailPlanes::build(&tile, region, size, 1, &settings).unwrap();
        assert_ne!(
            prepared_planes.fine, unprepared.fine,
            "the planes should read the cleaned tile"
        );

        let untouched = prepare(&tile, region, size, 1, &DetailSettings::NEUTRAL);
        assert!(untouched.cleaned.is_none() && untouched.planes.is_none());
    }

    #[test]
    fn a_blurred_value_reads_no_further_than_its_footprint() {
        let (width, height) = (1200, 3);
        for radius in [1usize, 3, 24, 25, 48, 100, 180] {
            let footprint = blur_footprint(radius);
            for spike in [0usize, 493, 600, 1199] {
                let mut plane = vec![0.0; width * height];
                for y in 0..height {
                    plane[y * width + spike] = 1.0;
                }
                let blurred = blur_plane(&plane, (width, height), radius);
                let row = &blurred[width..2 * width];
                for (x, value) in row.iter().enumerate() {
                    if x.abs_diff(spike) > footprint {
                        assert_eq!(
                            *value,
                            0.0,
                            "radius {radius} reached {} past its footprint {footprint}",
                            x.abs_diff(spike)
                        );
                    }
                }
                let reach = row
                    .iter()
                    .enumerate()
                    .filter(|(_, value)| **value != 0.0)
                    .map(|(x, _)| x.abs_diff(spike))
                    .max()
                    .unwrap();
                assert!(
                    reach + radius.div_ceil(MAX_DIRECT_BLUR_RADIUS) >= footprint,
                    "radius {radius} at {spike} reached only {reach} of footprint {footprint}"
                );
            }
            assert!(footprint >= radius);
        }
    }

    #[test]
    fn cleaning_a_padded_window_matches_the_whole_tile_inside_the_footprint() {
        let size = (40, 30);
        let tile = noisy_tile(size);
        let window = (10..30, 8..22);
        let excerpt = |tile: &[[f32; 3]], pad: usize| {
            let columns = window.0.start - pad..window.0.end + pad;
            let rows = window.1.start - pad..window.1.end + pad;
            let width = columns.len();
            let pixels: Vec<[f32; 3]> = rows
                .clone()
                .flat_map(|y| tile[y * size.0 + columns.start..y * size.0 + columns.end].to_vec())
                .collect();
            (pixels, (width, rows.len()))
        };
        let inside = |cleaned: &[[f32; 3]], stride: usize, origin: (usize, usize)| {
            (window.1.clone())
                .flat_map(|y| {
                    let start = (y - origin.1) * stride + window.0.start - origin.0;
                    cleaned[start..start + window.0.len()].to_vec()
                })
                .collect::<Vec<_>>()
        };
        for settings in [
            DetailSettings {
                noise_luminance: 100.0,
                ..DetailSettings::NEUTRAL
            },
            DetailSettings {
                noise_color: 100.0,
                ..DetailSettings::NEUTRAL
            },
            DetailSettings {
                noise_luminance: 60.0,
                noise_color: 80.0,
                ..DetailSettings::NEUTRAL
            },
        ] {
            let whole = inside(
                &reduce_noise(&tile, size, &settings).unwrap(),
                size.0,
                (0, 0),
            );
            let padded_by = |pad: usize| {
                let (excerpt, excerpt_size) = excerpt(&tile, pad);
                let cleaned = reduce_noise(&excerpt, excerpt_size, &settings).unwrap();
                inside(
                    &cleaned,
                    excerpt_size.0,
                    (window.0.start - pad, window.1.start - pad),
                )
            };
            assert_eq!(padded_by(settings.noise_footprint()), whole);
            assert_ne!(padded_by(NOISE_RADIUS - 1), whole);
        }
        assert_eq!(DetailSettings::NEUTRAL.noise_footprint(), 0);
    }

    #[test]
    fn the_apron_covers_the_widest_plane_and_the_cleaning_it_reads() {
        let clarity = DetailSettings {
            clarity: 40.0,
            ..DetailSettings::NEUTRAL
        };
        assert_eq!(DetailSettings::NEUTRAL.apron((6000, 4000), 1), 0);
        assert_eq!(
            DetailSettings {
                dehaze: 60.0,
                ..DetailSettings::NEUTRAL
            }
            .apron((6000, 4000), 1),
            0,
            "dehaze reads no neighbourhood"
        );
        assert_eq!(clarity.apron((6000, 4000), 1), blur_footprint(180));
        assert_eq!(clarity.apron((3000, 2000), 1), blur_footprint(90));
        assert_eq!(clarity.apron((6000, 4000), 4), blur_footprint(45));
        assert_eq!(clarity.apron((6000, 4000), 8), 23);
        assert!(clarity.apron((6000, 4000), 1) > clarity.apron((3000, 2000), 1));
        assert!(clarity.apron((6000, 4000), 1) > clarity.apron((6000, 4000), 4));
        assert_eq!(
            DetailSettings {
                noise_luminance: 30.0,
                ..DetailSettings::NEUTRAL
            }
            .apron((6000, 4000), 1),
            NOISE_RADIUS
        );
        assert_eq!(
            DetailSettings {
                noise_luminance: 30.0,
                noise_color: 30.0,
                sharpen_amount: 50.0,
                ..DetailSettings::NEUTRAL
            }
            .apron((6000, 4000), 1),
            blur_footprint(180) + 2 * NOISE_RADIUS
        );
    }

    #[test]
    fn planes_are_addressed_by_where_a_pixel_sits_in_the_image() {
        let size = (8, 6);
        let region = DevelopedTileRegion {
            image_width: 2000,
            image_height: 1500,
            x: 32,
            y: 24,
            width: size.0 * 4,
            height: size.1 * 4,
        };
        let rgb: Vec<[f32; 3]> = (0..size.0 * size.1)
            .map(|index| [0.1 + index as f32 * 0.05; 3])
            .collect();
        let planes = DetailPlanes::build(
            &rgb,
            region,
            size,
            4,
            &DetailSettings {
                clarity: 40.0,
                ..DetailSettings::NEUTRAL
            },
        )
        .unwrap();

        for output_y in 0..size.1 {
            for output_x in 0..size.0 {
                let index = output_y * size.0 + output_x;
                let sampled = planes.sample(region.pixel_context((output_x, output_y), size));
                assert_eq!(
                    sampled,
                    DetailSample {
                        fine: planes.fine[index],
                        coarse: planes.coarse[index]
                    },
                    "output ({output_x}, {output_y}) sampled the wrong plane entry"
                );
            }
        }

        let at = |x, y| PixelContext {
            x,
            y,
            image_width: 2000,
            image_height: 1500,
        };
        assert_eq!(planes.sample(at(0, 0)), planes.sample(at(32, 24)));
        assert_eq!(planes.sample(at(9000, 9000)), planes.sample(at(60, 44)));
        assert_eq!(planes.stacked().len(), size.0 * size.1 * 2);
        assert_eq!(planes.byte_len(), size.0 * size.1 * 2 * 4);
        assert!(
            DetailPlanes::build(&rgb, region, size, 4, &DetailSettings::NEUTRAL).is_none(),
            "neutral detail should not pay for planes"
        );
    }

    #[test]
    fn blur_radius_scales_with_the_image_and_shrinks_with_the_mip_bin() {
        assert_eq!(blur_radius(COARSE_BLUR_FRACTION, (6000, 4000), 1), 180);
        assert_eq!(blur_radius(COARSE_BLUR_FRACTION, (3000, 2000), 1), 90);
        assert_eq!(blur_radius(COARSE_BLUR_FRACTION, (6000, 4000), 4), 45);
        assert_eq!(blur_radius(FINE_BLUR_FRACTION, (6000, 4000), 1), 30);
        assert_eq!(blur_radius(FINE_BLUR_FRACTION, (6000, 4000), 16), 2);
        assert_eq!(blur_radius(FINE_BLUR_FRACTION, (64, 48), 1), 1);
    }

    #[test]
    fn spatial_stages_request_blur_planes_only_when_active() {
        assert!(DetailSettings::NEUTRAL.blur_radii().is_empty());
        assert!(
            DetailSettings {
                noise_luminance: 60.0,
                dehaze: 40.0,
                ..DetailSettings::NEUTRAL
            }
            .blur_radii()
            .is_empty(),
            "only the unsharp stages read a blur plane"
        );
        assert_eq!(
            DetailSettings {
                clarity: 30.0,
                ..DetailSettings::NEUTRAL
            }
            .blur_radii(),
            vec![FINE_BLUR_FRACTION, COARSE_BLUR_FRACTION]
        );
    }
}
