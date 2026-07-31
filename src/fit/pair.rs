use crate::decode::linear::Linear;
use crate::decode::sooc::Sooc;
use crate::error::{Error, Result};

pub struct Sample {
    pub linear: [f32; 3],
    pub coded: [f32; 3],
    pub grad: [f32; 3],
}

pub struct Pairing {
    pub samples: Vec<Sample>,
    pub rejected: usize,
}

const TILE: usize = 16;
const CENTRAL_FRACTION: f32 = 0.5;
const CODED_LOW: f32 = 1.0;
const CODED_HIGH: f32 = 254.0;

pub fn pair(linear: &Linear, sooc: &Sooc) -> Result<Pairing> {
    let scale_x = linear.width as f32 / sooc.width as f32;
    let scale_y = linear.height as f32 / sooc.height as f32;
    if (scale_x - scale_y).abs() > 1e-3 {
        return Err(Error::Unsupported("preview and raw aspect ratios disagree"));
    }

    let margin_x = (sooc.width as f32 * (1.0 - CENTRAL_FRACTION) / 2.0) as usize;
    let margin_y = (sooc.height as f32 * (1.0 - CENTRAL_FRACTION) / 2.0) as usize;
    let mut samples = Vec::new();
    let mut rejected = 0;

    for jy in (margin_y..sooc.height - margin_y - TILE).step_by(TILE) {
        for jx in (margin_x..sooc.width - margin_x - TILE).step_by(TILE) {
            let (coded, grad) = coded_tile(sooc, jx, jy);
            let linear_mean = box_mean(
                linear,
                scale_x * jx as f32,
                scale_x * (jx + TILE) as f32,
                scale_y * jy as f32,
                scale_y * (jy + TILE) as f32,
            );
            match linear_mean {
                Some(linear) if accept(&coded, &linear) => samples.push(Sample {
                    linear,
                    coded,
                    grad,
                }),
                _ => rejected += 1,
            }
        }
    }
    Ok(Pairing { samples, rejected })
}

fn accept(coded: &[f32; 3], linear: &[f32; 3]) -> bool {
    coded.iter().all(|&c| c > CODED_LOW && c < CODED_HIGH) && linear.iter().all(|v| v.is_finite())
}

fn coded_tile(sooc: &Sooc, jx: usize, jy: usize) -> ([f32; 3], [f32; 3]) {
    let mut sum = [0.0f64; 3];
    let mut grad_sum = [0.0f64; 3];
    for y in jy..jy + TILE {
        for x in jx..jx + TILE {
            let at = |x: usize, y: usize, c: usize| sooc.rgb8[(y * sooc.width + x) * 3 + c] as f64;
            for c in 0..3 {
                let v = at(x, y, c);
                sum[c] += v;
                let dx = at(x + 1, y, c) - v;
                let dy = at(x, y + 1, c) - v;
                grad_sum[c] += (dx * dx + dy * dy).sqrt();
            }
        }
    }
    let n = (TILE * TILE) as f64;
    (
        sum.map(|s| (s / n) as f32),
        grad_sum.map(|g| (g / n) as f32),
    )
}

fn box_mean(linear: &Linear, x0: f32, x1: f32, y0: f32, y1: f32) -> Option<[f32; 3]> {
    let overlap =
        |i: usize, lo: f32, hi: f32| (hi.min((i + 1) as f32) - lo.max(i as f32)).max(0.0) as f64;
    let mut sum = [0.0f64; 3];
    let mut area = 0.0f64;
    for y in y0.floor() as usize..(y1.ceil() as usize).min(linear.height) {
        let wy = overlap(y, y0, y1);
        for x in x0.floor() as usize..(x1.ceil() as usize).min(linear.width) {
            let i = y * linear.width + x;
            if linear.clipped[i] {
                return None;
            }
            let w = wy * overlap(x, x0, x1);
            for (total, &channel) in sum.iter_mut().zip(&linear.rgb[i]) {
                *total += channel as f64 * w;
            }
            area += w;
        }
    }
    (area > 0.0).then(|| sum.map(|s| (s / area) as f32))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn plane(width: usize, height: usize, value: fn(usize, usize) -> f32) -> Linear {
        let rgb = (0..width * height)
            .map(|i| [value(i % width, i / width); 3])
            .collect();
        Linear {
            width,
            height,
            rgb,
            clipped: vec![false; width * height],
        }
    }

    #[test]
    fn box_mean_of_constant_is_the_constant() {
        let linear = plane(8, 8, |_, _| 3.5);
        let mean = box_mean(&linear, 0.7, 5.3, 1.2, 6.9).unwrap();
        assert!((mean[0] - 3.5).abs() < 1e-6);
    }

    #[test]
    fn box_mean_of_ramp_matches_analytic_centroid() {
        let linear = plane(16, 4, |x, _| x as f32);
        let mean = box_mean(&linear, 2.5, 7.5, 0.0, 4.0).unwrap();
        assert!((mean[0] - 4.5).abs() < 1e-5);
    }

    #[test]
    fn clipped_superpixel_poisons_the_box() {
        let mut linear = plane(8, 8, |_, _| 1.0);
        linear.clipped[3 * 8 + 3] = true;
        assert!(box_mean(&linear, 2.0, 5.0, 2.0, 5.0).is_none());
        assert!(box_mean(&linear, 5.0, 8.0, 5.0, 8.0).is_some());
    }
}
