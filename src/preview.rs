use crate::Merged;
use crate::color;

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
            let exposed = pixel.map(|c| c * gain);
            let compress = if tone {
                let brightest = exposed.iter().fold(0.0f32, |m, &c| m.max(c));
                (1.0 + brightest / (white * white)) / (1.0 + brightest)
            } else {
                1.0
            };
            let mixed = color::apply(&self.mix, exposed.map(|c| c * compress));
            for (c, &value) in mixed.iter().enumerate() {
                rgb8.push(self.lookup(c, value).round().clamp(0.0, 255.0) as u8);
            }
        }
        rgb8
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
    }
}
