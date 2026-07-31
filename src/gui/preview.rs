use half::f16;
use postframe::Merged;
use rayon::prelude::*;

const SAMPLES: usize = 4096;
const LOG2_LO: f32 = -18.0;
const LOG2_HI: f32 = 6.0;

pub struct Preview {
    pub width: usize,
    pub height: usize,
    display_linear: [Vec<f32>; 3],
}

impl Preview {
    pub fn new(merged: &Merged) -> Self {
        let step = (LOG2_HI - LOG2_LO) / (SAMPLES - 1) as f32;
        let display_linear = std::array::from_fn(|channel| {
            (0..SAMPLES)
                .map(|i| {
                    let x = (2.0f32).powf(LOG2_LO + i as f32 * step);
                    srgb_to_linear(merged.transfer.channels[channel].eval(x) / 255.0)
                })
                .collect()
        });
        Self {
            width: merged.radiance.width,
            height: merged.radiance.height,
            display_linear,
        }
    }

    fn lookup(&self, channel: usize, value: f32) -> f32 {
        let step = (LOG2_HI - LOG2_LO) / (SAMPLES - 1) as f32;
        let position = (value.max(1e-9).log2() - LOG2_LO) / step;
        let clamped = position.clamp(0.0, (SAMPLES - 1) as f32);
        let index = (clamped as usize).min(SAMPLES - 2);
        let t = clamped - index as f32;
        let table = &self.display_linear[channel];
        table[index] + t * (table[index + 1] - table[index])
    }

    pub fn pixels(&self, merged: &Merged, ev: f32, tone: bool, hdr: bool) -> Vec<u16> {
        let gain = (2.0f32).powf(ev);
        let white = (merged.report.radiance_max * gain).max(1.0);
        let mix = merged.transfer.mix;

        merged
            .radiance
            .rgb
            .par_iter()
            .flat_map_iter(|pixel| {
                let exposed = pixel.map(|c| c * gain);
                let brightest = exposed.iter().fold(0.0f32, |m, &c| m.max(c));
                let compress = if tone {
                    (1.0 + brightest / (white * white)) / (1.0 + brightest)
                } else {
                    1.0
                };
                let mixed = apply(&mix, exposed.map(|c| c * compress));
                let boost = if hdr && !tone {
                    brightest.max(1.0)
                } else {
                    1.0
                };
                let rgb = [0, 1, 2].map(|c| self.lookup(c, mixed[c]) * boost);
                [
                    f16::from_f32(rgb[0]).to_bits(),
                    f16::from_f32(rgb[1]).to_bits(),
                    f16::from_f32(rgb[2]).to_bits(),
                    f16::from_f32(1.0).to_bits(),
                ]
            })
            .collect()
    }
}

fn apply(m: &[[f32; 3]; 3], [r, g, b]: [f32; 3]) -> [f32; 3] {
    [
        m[0][0] * r + m[0][1] * g + m[0][2] * b,
        m[1][0] * r + m[1][1] * g + m[1][2] * b,
        m[2][0] * r + m[2][1] * g + m[2][2] * b,
    ]
}

fn srgb_to_linear(coded: f32) -> f32 {
    if coded <= 0.04045 {
        coded / 12.92
    } else {
        ((coded + 0.055) / 1.055).powf(2.4)
    }
}
