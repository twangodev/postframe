use crate::color;
use crate::{Merged, Rendered};

const SAMPLES: usize = 4096;
const LOG2_LO: f32 = -18.0;
const LOG2_HI: f32 = 6.0;
const STEP: f32 = (LOG2_HI - LOG2_LO) / (SAMPLES - 1) as f32;

// The fitted curves cost a knot scan per pixel; a dense table over the log2
// domain makes slider-rate re-rendering possible.
pub struct Preview {
    coded: [Vec<f32>; 3],
    mix: [[f32; 3]; 3],
}

impl Preview {
    pub fn new(merged: &Merged) -> Self {
        let coded = std::array::from_fn(|channel| {
            (0..SAMPLES)
                .map(|i| {
                    let x = (2.0f32).powf(LOG2_LO + i as f32 * STEP);
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
        let position = (value.max(1e-9).log2() - LOG2_LO) / STEP;
        let clamped = position.clamp(0.0, (SAMPLES - 1) as f32);
        let index = (clamped as usize).min(SAMPLES - 2);
        let t = clamped - index as f32;
        let table = &self.coded[channel];
        table[index] + t * (table[index + 1] - table[index])
    }

    pub fn render(&self, merged: &Merged, ev: f32, tone: bool) -> Vec<u8> {
        let gain = (2.0f32).powf(ev);
        let white = (merged.report.radiance_max * gain).max(1.0);
        let mut rgb8 = Vec::with_capacity(merged.radiance.rgb.len() * 3);
        for pixel in &merged.radiance.rgb {
            rgb8.extend(self.render_pixel(*pixel, gain, white, tone));
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
    ) -> Rendered {
        let bin = bin.max(1);
        let x = origin.0.min(merged.radiance.width);
        let y = origin.1.min(merged.radiance.height);
        let width = size.0.min(merged.radiance.width - x);
        let height = size.1.min(merged.radiance.height - y);
        let out_width = width.div_ceil(bin);
        let out_height = height.div_ceil(bin);
        let gain = (2.0f32).powf(ev);
        let white = (merged.report.radiance_max * gain).max(1.0);
        let mut rgb8 = Vec::with_capacity(out_width * out_height * 3);

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
                rgb8.extend(self.render_pixel(sum.map(|value| value / samples), gain, white, tone));
            }
        }

        Rendered {
            width: out_width,
            height: out_height,
            rgb8,
        }
    }

    fn render_pixel(&self, pixel: [f32; 3], gain: f32, white: f32, tone: bool) -> [u8; 3] {
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
        std::array::from_fn(|channel| {
            self.lookup(channel, mixed[channel])
                .round()
                .clamp(0.0, 255.0) as u8
        })
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

        let fast = Preview::new(&merged).render(&merged, 0.5, false);
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

        let tile = Preview::new(&merged).render_region(&merged, (2, 1), (3, 4), 1, 0.5, false);
        let expected = (1..5)
            .flat_map(|y| {
                let start = (y * 8 + 2) * 3;
                fast[start..start + 9].iter().copied()
            })
            .collect::<Vec<_>>();
        assert_eq!((tile.width, tile.height), (3, 4));
        assert_eq!(tile.rgb8, expected);

        let binned = Preview::new(&merged).render_region(&merged, (0, 0), (8, 8), 4, 0.0, true);
        assert_eq!((binned.width, binned.height, binned.rgb8.len()), (2, 2, 12));
    }
}
