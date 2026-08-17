use crate::color;
use crate::detail::{DetailPlanes, TilePlacement};
use crate::develop::PixelContext;
use crate::{
    ColorSettings, DevelopSettings, DevelopTransform, LightSettings, Merged, Rendered, Result,
    parallel,
};

#[cfg(any(test, feature = "wasm"))]
use crate::{DetailSettings, detail::reduce_noise};

#[cfg(feature = "wasm")]
use crate::decode::linear::Linear;

const LOOKUP_LOW_BITS: u32 = 0x3680_0000;
const LOOKUP_HIGH_BITS: u32 = 0x4280_0000;
const LOOKUP_SHIFT: u32 = 13;
const LOOKUP_FRACTION_MASK: u32 = (1 << LOOKUP_SHIFT) - 1;

// The fitted curves cost a knot scan per pixel; a dense table over the log2
// domain makes slider-rate re-rendering possible.
pub struct Preview {
    coded: [Vec<f32>; 3],
    mix: [[f32; 3]; 3],
}

pub(crate) struct PreparedRegion {
    placement: TilePlacement,
    rgb: Vec<[f32; 3]>,
    planes: Option<DetailPlanes>,
}

#[cfg(feature = "wasm")]
pub(crate) struct MipPyramid {
    source_width: usize,
    source_height: usize,
    levels: Vec<MipLevel>,
}

#[cfg(feature = "wasm")]
struct MipLevel {
    bin: usize,
    image: Linear,
}

impl PreparedRegion {
    pub(crate) fn new(
        merged: &Merged,
        origin: (usize, usize),
        size: (usize, usize),
        bin: usize,
    ) -> Self {
        let bin = bin.max(1);
        let x = origin.0.min(merged.radiance.width);
        let y = origin.1.min(merged.radiance.height);
        let width = size.0.min(merged.radiance.width - x);
        let height = size.1.min(merged.radiance.height - y);
        let out_width = width.div_ceil(bin);
        let out_height = height.div_ceil(bin);
        let mut rgb = Vec::with_capacity(out_width * out_height);

        for output_y in 0..out_height {
            let start_y = y + output_y * bin;
            let end_y = (start_y + bin).min(y + height);
            for output_x in 0..out_width {
                let start_x = x + output_x * bin;
                let end_x = (start_x + bin).min(x + width);
                let mut sum = [0.0; 3];
                for source_y in start_y..end_y {
                    for source_x in start_x..end_x {
                        let pixel =
                            merged.radiance.rgb[source_y * merged.radiance.width + source_x];
                        for (total, value) in sum.iter_mut().zip(pixel) {
                            *total += value;
                        }
                    }
                }
                let samples = ((end_x - start_x) * (end_y - start_y)) as f32;
                rgb.push(sum.map(|value| value / samples));
            }
        }

        Self::around(
            TilePlacement {
                origin: (x, y),
                size: (out_width, out_height),
                bin,
                image: (merged.radiance.width, merged.radiance.height),
            },
            rgb,
        )
    }

    fn around(placement: TilePlacement, rgb: Vec<[f32; 3]>) -> Self {
        Self {
            placement,
            rgb,
            planes: None,
        }
    }

    /// Runs the spatial stages: the tile is cleaned first, then its blur planes
    /// come off the cleaned luminance, so both depend only on the source and the
    /// noise controls and so cache alongside the tile.
    #[cfg(any(test, feature = "wasm"))]
    pub(crate) fn detailed(mut self, settings: &DetailSettings) -> Self {
        if let Some(cleaned) = reduce_noise(&self.rgb, self.placement.size, settings) {
            self.rgb = cleaned;
        }
        self.planes = DetailPlanes::build(&self.rgb, self.placement, settings);
        self
    }

    #[cfg(all(test, feature = "wasm"))]
    pub(crate) fn fabricated(placement: TilePlacement, settings: &DetailSettings) -> Self {
        let rgb = vec![[0.25, 0.5, 0.75]; placement.size.0 * placement.size.1];
        Self::around(placement, rgb).detailed(settings)
    }

    #[cfg(feature = "wasm")]
    fn from_level(
        level: &MipLevel,
        origin: (usize, usize),
        size: (usize, usize),
        image: (usize, usize),
    ) -> Self {
        let x = origin.0 / level.bin;
        let y = origin.1 / level.bin;
        let width = size.0.div_ceil(level.bin).min(level.image.width - x);
        let height = size.1.div_ceil(level.bin).min(level.image.height - y);
        let mut rgb = Vec::with_capacity(width * height);
        for row in y..y + height {
            let start = row * level.image.width + x;
            rgb.extend_from_slice(&level.image.rgb[start..start + width]);
        }
        Self::around(
            TilePlacement {
                origin: (x * level.bin, y * level.bin),
                size: (width, height),
                bin: level.bin,
                image,
            },
            rgb,
        )
    }

    #[cfg(any(test, feature = "wasm"))]
    pub(crate) fn byte_len(&self) -> usize {
        self.rgb.len() * std::mem::size_of::<[f32; 3]>()
            + self.planes.as_ref().map_or(0, DetailPlanes::byte_len)
    }

    #[cfg(feature = "wasm")]
    pub(crate) fn dimensions(&self) -> (usize, usize) {
        self.placement.size
    }

    #[cfg(feature = "wasm")]
    pub(crate) fn rgba32(&self) -> Vec<f32> {
        parallel::map_pixels(&self.rgb, |pixel| [pixel[0], pixel[1], pixel[2], 1.0])
    }

    #[cfg(feature = "wasm")]
    pub(crate) fn stacked_planes(&self) -> Vec<f32> {
        self.planes
            .as_ref()
            .map(DetailPlanes::stacked)
            .unwrap_or_default()
    }
}

#[cfg(feature = "wasm")]
impl MipPyramid {
    pub(crate) fn new(merged: &Merged, max_bin: usize) -> Self {
        let source_width = merged.radiance.width;
        let source_height = merged.radiance.height;
        let mut levels = Vec::new();
        let mut level = MipLevel::from_source(&merged.radiance, 2);
        loop {
            let bin = level.bin;
            levels.push(level);
            if bin >= max_bin
                || (source_width.div_ceil(bin) == 1 && source_height.div_ceil(bin) == 1)
            {
                break;
            }
            level = MipLevel::downsample(levels.last().unwrap(), source_width, source_height);
        }
        Self {
            source_width,
            source_height,
            levels,
        }
    }

    pub(crate) fn prepare(
        &self,
        merged: &Merged,
        origin: (usize, usize),
        size: (usize, usize),
        bin: usize,
    ) -> PreparedRegion {
        self.levels
            .iter()
            .find(|level| level.bin == bin)
            .map(|level| {
                PreparedRegion::from_level(
                    level,
                    origin,
                    size,
                    (merged.radiance.width, merged.radiance.height),
                )
            })
            .unwrap_or_else(|| PreparedRegion::new(merged, origin, size, bin))
    }

    pub(crate) fn thumbnail(&self, merged: &Merged, max_dimension: usize) -> Merged {
        let Some(level) = self
            .levels
            .iter()
            .find(|level| level.image.width.max(level.image.height) <= max_dimension)
            .or_else(|| self.levels.last())
        else {
            return merged.thumbnail(max_dimension);
        };
        if self.source_width.max(self.source_height) <= max_dimension {
            return merged.thumbnail(max_dimension);
        }
        Merged {
            radiance: level.image.clone(),
            transfer: merged.transfer.clone(),
            space: merged.space,
            report: merged.report.clone(),
        }
    }
}

#[cfg(feature = "wasm")]
impl MipLevel {
    fn from_source(source: &Linear, bin: usize) -> Self {
        let width = source.width.div_ceil(bin);
        let height = source.height.div_ceil(bin);
        let mut rgb = vec![[0.0f32; 3]; width * height];
        let mut clipped = vec![false; width * height];
        parallel::fill_zipped_rows(&mut rgb, &mut clipped, width, |output_y, rgb, clipped| {
            let start_y = output_y * bin;
            let end_y = (start_y + bin).min(source.height);
            for (output_x, (pixel, clipped)) in rgb.iter_mut().zip(clipped).enumerate() {
                let start_x = output_x * bin;
                let end_x = (start_x + bin).min(source.width);
                let mut sum = [0.0; 3];
                let mut any_clipped = false;
                for source_y in start_y..end_y {
                    for source_x in start_x..end_x {
                        let index = source_y * source.width + source_x;
                        for (total, value) in sum.iter_mut().zip(source.rgb[index]) {
                            *total += value;
                        }
                        any_clipped |= source.clipped[index];
                    }
                }
                let samples = ((end_x - start_x) * (end_y - start_y)) as f32;
                *pixel = sum.map(|value| value / samples);
                *clipped = any_clipped;
            }
        });
        Self {
            bin,
            image: Linear {
                width,
                height,
                rgb,
                clipped,
            },
        }
    }

    fn downsample(previous: &Self, source_width: usize, source_height: usize) -> Self {
        let bin = previous.bin * 2;
        let width = source_width.div_ceil(bin);
        let height = source_height.div_ceil(bin);
        let mut rgb = vec![[0.0f32; 3]; width * height];
        let mut clipped = vec![false; width * height];
        parallel::fill_zipped_rows(&mut rgb, &mut clipped, width, |output_y, rgb, clipped| {
            for (output_x, (pixel, clipped)) in rgb.iter_mut().zip(clipped).enumerate() {
                let mut sum = [0.0; 3];
                let mut samples = 0usize;
                let mut any_clipped = false;
                for child_y in output_y * 2..(output_y * 2 + 2).min(previous.image.height) {
                    for child_x in output_x * 2..(output_x * 2 + 2).min(previous.image.width) {
                        let child_width = previous.bin.min(source_width - child_x * previous.bin);
                        let child_height = previous.bin.min(source_height - child_y * previous.bin);
                        let weight = child_width * child_height;
                        let index = child_y * previous.image.width + child_x;
                        for (total, value) in sum.iter_mut().zip(previous.image.rgb[index]) {
                            *total += value * weight as f32;
                        }
                        samples += weight;
                        any_clipped |= previous.image.clipped[index];
                    }
                }
                *pixel = sum.map(|value| value / samples as f32);
                *clipped = any_clipped;
            }
        });
        Self {
            bin,
            image: Linear {
                width,
                height,
                rgb,
                clipped,
            },
        }
    }
}

impl Preview {
    pub fn new(merged: &Merged) -> Self {
        let low = LOOKUP_LOW_BITS;
        let high = LOOKUP_HIGH_BITS;
        let buckets = ((high - low) >> LOOKUP_SHIFT) as usize;
        let coded = std::array::from_fn(|channel| {
            (0..=buckets)
                .map(|i| {
                    let x = f32::from_bits(low + ((i as u32) << LOOKUP_SHIFT));
                    merged.transfer.channels[channel].eval(x)
                })
                .collect()
        });
        Self {
            coded,
            mix: merged.transfer.mix,
        }
    }

    #[cfg(feature = "wasm")]
    pub(crate) fn gpu_lut(&self) -> Vec<f32> {
        self.coded.iter().flatten().copied().collect()
    }

    #[cfg(feature = "wasm")]
    pub(crate) fn gpu_lookup_low_bits() -> u32 {
        LOOKUP_LOW_BITS
    }

    #[cfg(feature = "wasm")]
    pub(crate) fn gpu_lookup_shift() -> u32 {
        LOOKUP_SHIFT
    }

    fn lookup(&self, channel: usize, value: f32) -> f32 {
        let table = &self.coded[channel];
        let low = LOOKUP_LOW_BITS;
        let high = LOOKUP_HIGH_BITS;
        let value = if value.is_finite() { value } else { 0.0 };
        let bits = value
            .clamp(f32::from_bits(low), f32::from_bits(high))
            .to_bits();
        if bits <= low {
            return table[0];
        }
        if bits >= high {
            return *table.last().unwrap();
        }
        let offset = bits - low;
        let index = (offset >> LOOKUP_SHIFT) as usize;
        let t = (offset & LOOKUP_FRACTION_MASK) as f32 / (1 << LOOKUP_SHIFT) as f32;
        table[index] + t * (table[index + 1] - table[index])
    }

    pub fn render(&self, merged: &Merged, ev: f32, tone: bool) -> Result<Vec<u8>> {
        Ok(self.render_adjusted(merged, &exposure_only(ev)?, tone))
    }

    pub fn render_adjusted(
        &self,
        merged: &Merged,
        develop: &DevelopTransform,
        tone: bool,
    ) -> Vec<u8> {
        let whole = TilePlacement {
            origin: (0, 0),
            size: (merged.radiance.width, merged.radiance.height),
            bin: 1,
            image: (merged.radiance.width, merged.radiance.height),
        };
        let tile = TileRender::new(merged, develop, tone, whole, None);
        parallel::map_indexed_pixels(&merged.radiance.rgb, |index, &pixel| {
            self.render_pixel(pixel, index, &tile)
        })
    }

    pub fn render_region(
        &self,
        merged: &Merged,
        origin: (usize, usize),
        size: (usize, usize),
        bin: usize,
        ev: f32,
        tone: bool,
    ) -> Result<Rendered> {
        let region = PreparedRegion::new(merged, origin, size, bin);
        Ok(self.render_prepared_adjusted(merged, &region, &exposure_only(ev)?, tone))
    }

    pub(crate) fn render_prepared_adjusted(
        &self,
        merged: &Merged,
        region: &PreparedRegion,
        develop: &DevelopTransform,
        tone: bool,
    ) -> Rendered {
        let tile = TileRender::new(
            merged,
            develop,
            tone,
            region.placement,
            region.planes.as_ref(),
        );
        let rgb8 = parallel::map_indexed_pixels(&region.rgb, |index, &pixel| {
            self.render_pixel(pixel, index, &tile)
        });

        Rendered {
            width: region.placement.size.0,
            height: region.placement.size.1,
            rgb8,
        }
    }

    fn render_pixel(&self, pixel: [f32; 3], index: usize, tile: &TileRender) -> [u8; 3] {
        let exposed = pixel.map(|channel| channel * tile.gain);
        let compress = if tile.tone {
            let brightest = exposed
                .iter()
                .fold(0.0f32, |maximum, &channel| maximum.max(channel));
            (1.0 + brightest / (tile.white * tile.white)) / (1.0 + brightest)
        } else {
            1.0
        };
        let mixed = color::apply(&self.mix, exposed.map(|channel| channel * compress));
        let coded = std::array::from_fn(|channel| {
            self.lookup(channel, mixed[channel])
                .round()
                .clamp(0.0, 255.0) as u8
        });
        tile.develop
            .apply_encoded_pixel_at(coded, tile.at(index), tile.planes)
    }
}

/// Everything the per-pixel chain needs that does not vary within a tile.
struct TileRender<'a> {
    develop: &'a DevelopTransform,
    planes: Option<&'a DetailPlanes>,
    placement: TilePlacement,
    gain: f32,
    white: f32,
    tone: bool,
}

impl<'a> TileRender<'a> {
    fn new(
        merged: &Merged,
        develop: &'a DevelopTransform,
        tone: bool,
        placement: TilePlacement,
        planes: Option<&'a DetailPlanes>,
    ) -> Self {
        let gain = (2.0f32).powf(develop.settings().light.exposure);
        Self {
            develop,
            planes,
            placement,
            gain,
            white: (merged.report.radiance_max * gain).max(1.0),
            tone,
        }
    }

    fn at(&self, index: usize) -> PixelContext {
        let width = self.placement.size.0.max(1);
        PixelContext {
            x: self.placement.origin.0 + (index % width) * self.placement.bin,
            y: self.placement.origin.1 + (index / width) * self.placement.bin,
            image_width: self.placement.image.0,
            image_height: self.placement.image.1,
        }
    }
}

fn exposure_only(ev: f32) -> Result<DevelopTransform> {
    DevelopTransform::new(DevelopSettings::tonal(
        LightSettings {
            exposure: ev,
            ..LightSettings::NEUTRAL
        },
        ColorSettings::NEUTRAL,
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::decode::linear::Linear;
    use crate::fit::pair::{Pairing, Sample};
    use crate::{ColorTransform, LightTransform};

    fn developed(light: LightSettings, color: ColorSettings) -> DevelopTransform {
        DevelopTransform::new(DevelopSettings::tonal(light, color)).unwrap()
    }

    fn merged_fixture() -> Merged {
        let samples: Vec<Sample> = (0..6_000)
            .map(|i| {
                let x = (2.0f32).powf(-12.0 + 12.5 * (i as f32 / 6_000.0));
                Sample {
                    linear: [x; 3],
                    coded: [(x.sqrt() * 255.0).min(255.0); 3],
                    grad: [0.0; 3],
                }
            })
            .collect();
        let (transfer, report) = crate::fit::transfer::measure(
            &Pairing {
                samples,
                rejected: 0,
            },
            crate::WorkingSpace::LinearSrgb,
        )
        .unwrap();
        let radiance: Vec<[f32; 3]> = (0..64).map(|i| [0.001 + i as f32 * 0.05; 3]).collect();
        Merged {
            radiance: Linear {
                width: 8,
                height: 8,
                clipped: vec![false; 64],
                rgb: radiance.clone(),
            },
            transfer,
            space: crate::WorkingSpace::LinearSrgb,
            report: crate::MergeReport {
                fit: report,
                exposures: vec![1.0],
                shifts: vec![(0, 0)],
                radiance_max: 4.0,
            },
        }
    }

    fn neutral_color() -> ColorTransform {
        ColorTransform::new(ColorSettings::NEUTRAL).unwrap()
    }

    fn exact_render(
        merged: &Merged,
        light: &LightTransform,
        grade: &ColorTransform,
        tone: bool,
    ) -> Vec<u8> {
        let gain = 2.0f32.powf(light.settings().exposure);
        let white = (merged.report.radiance_max * gain).max(1.0);
        merged
            .radiance
            .rgb
            .iter()
            .flat_map(|pixel| {
                let exposed = pixel.map(|channel| channel * gain);
                let compress = if tone {
                    let brightest = exposed.into_iter().fold(0.0f32, f32::max);
                    (1.0 + brightest / (white * white)) / (1.0 + brightest)
                } else {
                    1.0
                };
                let coded = merged
                    .transfer
                    .eval(exposed.map(|channel| channel * compress))
                    .map(|value| value.round().clamp(0.0, 255.0) as u8);
                light.apply_encoded_pixel(grade.apply_display_pixel(coded))
            })
            .collect()
    }

    fn worst_code_error(actual: &[u8], expected: &[u8]) -> i16 {
        actual
            .iter()
            .zip(expected)
            .map(|(&actual, &expected)| (actual as i16 - expected as i16).abs())
            .max()
            .unwrap_or_default()
    }

    #[test]
    fn lut_render_matches_direct_evaluation() {
        let merged = merged_fixture();

        let fast = Preview::new(&merged).render(&merged, 0.5, false).unwrap();
        let exact = merged.render(0.5);
        let worst = worst_code_error(&fast, &exact.rgb8);
        assert!(
            worst <= 1,
            "lut render drifted {worst} codes from direct eval"
        );

        let preview = Preview::new(&merged);
        let prepared = PreparedRegion::new(&merged, (2, 1), (3, 4), 1);
        let brighter = developed(
            LightSettings {
                exposure: 0.5,
                ..LightSettings::NEUTRAL
            },
            ColorSettings::NEUTRAL,
        );
        let tile = preview.render_prepared_adjusted(&merged, &prepared, &brighter, false);
        let expected = (1..5)
            .flat_map(|y| {
                let start = (y * 8 + 2) * 3;
                fast[start..start + 9].iter().copied()
            })
            .collect::<Vec<_>>();
        assert_eq!((tile.width, tile.height), (3, 4));
        assert_eq!(tile.rgb8, expected);

        let darker = developed(
            LightSettings {
                exposure: -0.5,
                ..LightSettings::NEUTRAL
            },
            ColorSettings::NEUTRAL,
        );
        let rerendered = preview.render_prepared_adjusted(&merged, &prepared, &darker, false);
        let direct = preview
            .render_region(&merged, (2, 1), (3, 4), 1, -0.5, false)
            .unwrap();
        assert_eq!(rerendered.rgb8, direct.rgb8);

        let binned = preview
            .render_region(&merged, (0, 0), (8, 8), 4, 0.0, true)
            .unwrap();
        assert_eq!((binned.width, binned.height, binned.rgb8.len()), (2, 2, 12));

        #[cfg(feature = "wasm")]
        {
            let odd = Merged {
                radiance: Linear {
                    width: 7,
                    height: 5,
                    clipped: (0..35).map(|index| index == 34).collect(),
                    rgb: (0..35)
                        .map(|index| {
                            let value = index as f32 / 35.0;
                            [value, value * 2.0, value * 3.0]
                        })
                        .collect(),
                },
                transfer: merged.transfer.clone(),
                space: merged.space,
                report: merged.report.clone(),
            };
            let pyramid = MipPyramid::new(&odd, 8);
            for bin in [2, 4, 8] {
                let direct = PreparedRegion::new(&odd, (0, 0), (7, 5), bin);
                let cached = pyramid.prepare(&odd, (0, 0), (7, 5), bin);
                assert_eq!(cached.placement.size, direct.placement.size);
                for (actual, expected) in cached.rgb.iter().zip(direct.rgb) {
                    for (actual, expected) in actual.iter().zip(expected) {
                        assert!((actual - expected).abs() < 1e-6);
                    }
                }
            }
        }
    }

    fn textured_fixture() -> Merged {
        let mut merged = merged_fixture();
        merged.radiance.rgb = (0..64)
            .map(|index| {
                let (x, y) = (index % 8, index / 8);
                let base = if x < 4 { 0.08 } else { 0.32 };
                let grain = ((x * 5 + y * 3) % 4) as f32 / 3.0 - 0.5;
                let value = base * (1.0 + 0.4 * grain);
                [value * 1.1, value, value * 0.85]
            })
            .collect();
        merged
    }

    #[test]
    fn a_neutral_detail_group_leaves_a_prepared_tile_untouched() {
        let merged = textured_fixture();
        let region = PreparedRegion::new(&merged, (0, 0), (8, 8), 1);
        let detailed =
            PreparedRegion::new(&merged, (0, 0), (8, 8), 1).detailed(&DetailSettings::NEUTRAL);
        assert_eq!(detailed.rgb, region.rgb);
        assert!(detailed.planes.is_none());
        assert_eq!(detailed.byte_len(), region.byte_len());
    }

    #[test]
    fn presence_reaches_a_prepared_tile_and_grows_its_cache_footprint() {
        let merged = textured_fixture();
        let preview = Preview::new(&merged);
        let settings = DetailSettings {
            clarity: 80.0,
            texture: 60.0,
            ..DetailSettings::NEUTRAL
        };
        let plain = PreparedRegion::new(&merged, (0, 0), (8, 8), 1);
        let detailed = PreparedRegion::new(&merged, (0, 0), (8, 8), 1).detailed(&settings);
        assert!(detailed.planes.is_some());
        assert_eq!(
            detailed.byte_len(),
            plain.byte_len() + 8 * 8 * 2 * std::mem::size_of::<f32>()
        );

        let develop = |detail| {
            DevelopTransform::new(DevelopSettings {
                detail,
                ..DevelopSettings::neutral()
            })
            .unwrap()
        };
        let presence =
            preview.render_prepared_adjusted(&merged, &detailed, &develop(settings), true);
        let flat = preview.render_prepared_adjusted(
            &merged,
            &plain,
            &develop(DetailSettings::NEUTRAL),
            true,
        );
        assert_ne!(presence.rgb8, flat.rgb8);

        let unused = preview.render_prepared_adjusted(
            &merged,
            &detailed,
            &develop(DetailSettings::NEUTRAL),
            true,
        );
        assert_eq!(unused.rgb8, flat.rgb8);
    }

    #[test]
    fn noise_reduction_reaches_a_prepared_tile_before_the_chain() {
        let merged = textured_fixture();
        let settings = DetailSettings {
            noise_luminance: 100.0,
            ..DetailSettings::NEUTRAL
        };
        let cleaned = PreparedRegion::new(&merged, (0, 0), (8, 8), 1).detailed(&settings);
        let plain = PreparedRegion::new(&merged, (0, 0), (8, 8), 1);
        assert!(cleaned.planes.is_none(), "noise alone needs no blur plane");
        assert_ne!(cleaned.rgb, plain.rgb);
        let mean = |region: &PreparedRegion| {
            region.rgb.iter().map(|pixel| pixel[1]).sum::<f32>() / region.rgb.len() as f32
        };
        assert!((mean(&cleaned) - mean(&plain)).abs() < mean(&plain) * 0.05);
    }

    #[test]
    fn optimized_preview_stays_within_one_code_across_light_controls() {
        let mut merged = merged_fixture();
        merged.radiance.rgb = (0..64)
            .map(|index| {
                let value = 0.001 + index as f32 * 0.05;
                [value * 0.55, value * 1.35, value * 0.82]
            })
            .collect();
        let preview = Preview::new(&merged);
        let settings = [
            LightSettings::NEUTRAL,
            LightSettings {
                exposure: -4.0,
                contrast: -100.0,
                highlights: -100.0,
                shadows: -100.0,
                whites: -100.0,
                blacks: -100.0,
            },
            LightSettings {
                exposure: 4.0,
                contrast: 100.0,
                highlights: 100.0,
                shadows: 100.0,
                whites: 100.0,
                blacks: 100.0,
            },
            LightSettings {
                exposure: 1.75,
                contrast: 63.0,
                highlights: -82.0,
                shadows: 47.0,
                whites: 91.0,
                blacks: -58.0,
            },
        ];

        for settings in settings {
            let light = LightTransform::new(settings).unwrap();
            let develop = developed(settings, ColorSettings::NEUTRAL);
            for tone in [false, true] {
                let fast = preview.render_adjusted(&merged, &develop, tone);
                let exact = exact_render(&merged, &light, &neutral_color(), tone);
                let worst = worst_code_error(&fast, &exact);
                assert!(
                    worst <= 1,
                    "optimized preview drifted {worst} codes for {settings:?} with tone {tone}"
                );
            }
        }
    }

    #[test]
    fn color_grades_the_rendered_preview_before_the_tone_curve() {
        let mut merged = merged_fixture();
        merged.radiance.rgb = (0..64)
            .map(|index| {
                let value = 0.001 + index as f32 * 0.05;
                [value * 0.55, value * 1.35, value * 0.82]
            })
            .collect();
        let preview = Preview::new(&merged);
        let settings = LightSettings {
            exposure: 0.75,
            contrast: 40.0,
            ..LightSettings::NEUTRAL
        };
        let color = ColorSettings {
            temperature: 60.0,
            tint: -25.0,
            vibrance: 40.0,
            saturation: 30.0,
        };
        let light = LightTransform::new(settings).unwrap();
        let grade = ColorTransform::new(color).unwrap();

        for tone in [false, true] {
            let graded = preview.render_adjusted(&merged, &developed(settings, color), tone);
            let ungraded = preview.render_adjusted(
                &merged,
                &developed(settings, ColorSettings::NEUTRAL),
                tone,
            );
            assert_ne!(graded, ungraded);
            let worst = worst_code_error(&graded, &exact_render(&merged, &light, &grade, tone));
            assert!(worst <= 1, "graded preview drifted {worst} codes");
        }
    }
}
