use crate::color;
use crate::decode::linear::Linear;
use crate::{LightSettings, LightTransform, Merged, Rendered, Result};

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
    width: usize,
    height: usize,
    rgb: Vec<[f32; 3]>,
}

pub(crate) struct MipPyramid {
    source_width: usize,
    source_height: usize,
    levels: Vec<MipLevel>,
}

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

        Self {
            width: out_width,
            height: out_height,
            rgb,
        }
    }

    fn from_level(level: &MipLevel, origin: (usize, usize), size: (usize, usize)) -> Self {
        let x = origin.0 / level.bin;
        let y = origin.1 / level.bin;
        let width = size.0.div_ceil(level.bin).min(level.image.width - x);
        let height = size.1.div_ceil(level.bin).min(level.image.height - y);
        let mut rgb = Vec::with_capacity(width * height);
        for row in y..y + height {
            let start = row * level.image.width + x;
            rgb.extend_from_slice(&level.image.rgb[start..start + width]);
        }
        Self { width, height, rgb }
    }

    pub(crate) fn byte_len(&self) -> usize {
        self.rgb.len() * std::mem::size_of::<[f32; 3]>()
    }
}

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
            .map(|level| PreparedRegion::from_level(level, origin, size))
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

impl MipLevel {
    fn from_source(source: &Linear, bin: usize) -> Self {
        let width = source.width.div_ceil(bin);
        let height = source.height.div_ceil(bin);
        let mut rgb = Vec::with_capacity(width * height);
        let mut clipped = Vec::with_capacity(width * height);
        for output_y in 0..height {
            let start_y = output_y * bin;
            let end_y = (start_y + bin).min(source.height);
            for output_x in 0..width {
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
                rgb.push(sum.map(|value| value / samples));
                clipped.push(any_clipped);
            }
        }
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
        let mut rgb = Vec::with_capacity(width * height);
        let mut clipped = Vec::with_capacity(width * height);
        for output_y in 0..height {
            for output_x in 0..width {
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
                rgb.push(sum.map(|value| value / samples as f32));
                clipped.push(any_clipped);
            }
        }
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
        let settings = LightSettings {
            exposure: ev,
            ..LightSettings::NEUTRAL
        };
        Ok(self.render_adjusted(merged, &LightTransform::new(settings)?, tone))
    }

    pub fn render_adjusted(&self, merged: &Merged, light: &LightTransform, tone: bool) -> Vec<u8> {
        let gain = (2.0f32).powf(light.settings().exposure);
        let white = (merged.report.radiance_max * gain).max(1.0);
        let mut rgb8 = Vec::with_capacity(merged.radiance.rgb.len() * 3);
        for pixel in &merged.radiance.rgb {
            rgb8.extend(self.render_pixel(*pixel, gain, white, tone, light));
        }
        rgb8
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
        let settings = LightSettings {
            exposure: ev,
            ..LightSettings::NEUTRAL
        };
        Ok(self.render_prepared_adjusted(merged, &region, &LightTransform::new(settings)?, tone))
    }

    pub(crate) fn render_prepared_adjusted(
        &self,
        merged: &Merged,
        region: &PreparedRegion,
        light: &LightTransform,
        tone: bool,
    ) -> Rendered {
        let gain = (2.0f32).powf(light.settings().exposure);
        let white = (merged.report.radiance_max * gain).max(1.0);
        let mut rgb8 = Vec::with_capacity(region.rgb.len() * 3);
        for pixel in &region.rgb {
            rgb8.extend(self.render_pixel(*pixel, gain, white, tone, light));
        }

        Rendered {
            width: region.width,
            height: region.height,
            rgb8,
        }
    }

    fn render_pixel(
        &self,
        pixel: [f32; 3],
        gain: f32,
        white: f32,
        tone: bool,
        light: &LightTransform,
    ) -> [u8; 3] {
        let exposed = pixel.map(|channel| channel * gain);
        let compress = if tone {
            let brightest = exposed
                .iter()
                .fold(0.0f32, |maximum, &channel| maximum.max(channel));
            (1.0 + brightest / (white * white)) / (1.0 + brightest)
        } else {
            1.0
        };
        let mixed = color::apply(&self.mix, exposed.map(|channel| channel * compress));
        light.apply_encoded_pixel(std::array::from_fn(|channel| {
            self.lookup(channel, mixed[channel])
                .round()
                .clamp(0.0, 255.0) as u8
        }))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::decode::linear::Linear;
    use crate::fit::pair::{Pairing, Sample};

    #[test]
    fn lut_render_matches_direct_evaluation() {
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
        let merged = Merged {
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
        };

        let fast = Preview::new(&merged).render(&merged, 0.5, false).unwrap();
        let exact = merged.render(0.5);
        let worst = fast
            .iter()
            .zip(&exact.rgb8)
            .map(|(&a, &b)| (a as i16 - b as i16).abs())
            .max()
            .unwrap();
        assert!(
            worst <= 1,
            "lut render drifted {worst} codes from direct eval"
        );

        let preview = Preview::new(&merged);
        let prepared = PreparedRegion::new(&merged, (2, 1), (3, 4), 1);
        let light = LightTransform::new(LightSettings {
            exposure: 0.5,
            ..LightSettings::NEUTRAL
        })
        .unwrap();
        let tile = preview.render_prepared_adjusted(&merged, &prepared, &light, false);
        let expected = (1..5)
            .flat_map(|y| {
                let start = (y * 8 + 2) * 3;
                fast[start..start + 9].iter().copied()
            })
            .collect::<Vec<_>>();
        assert_eq!((tile.width, tile.height), (3, 4));
        assert_eq!(tile.rgb8, expected);

        let light = LightTransform::new(LightSettings {
            exposure: -0.5,
            ..LightSettings::NEUTRAL
        })
        .unwrap();
        let rerendered = preview.render_prepared_adjusted(&merged, &prepared, &light, false);
        let direct = preview
            .render_region(&merged, (2, 1), (3, 4), 1, -0.5, false)
            .unwrap();
        assert_eq!(rerendered.rgb8, direct.rgb8);

        let binned = preview
            .render_region(&merged, (0, 0), (8, 8), 4, 0.0, true)
            .unwrap();
        assert_eq!((binned.width, binned.height, binned.rgb8.len()), (2, 2, 12));

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
            assert_eq!((cached.width, cached.height), (direct.width, direct.height));
            for (actual, expected) in cached.rgb.iter().zip(direct.rgb) {
                for (actual, expected) in actual.iter().zip(expected) {
                    assert!((actual - expected).abs() < 1e-6);
                }
            }
        }
    }
}
