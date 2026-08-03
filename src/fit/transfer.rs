use crate::color::WorkingSpace;
use crate::error::{Error, Result};
use crate::fit::pair::Sample;

#[derive(Clone)]
pub struct Curve {
    pub(crate) knots_log2: Vec<f32>,
    pub(crate) coded: Vec<f32>,
}

#[derive(Clone)]
pub struct Transfer {
    pub mix: [[f32; 3]; 3],
    pub channels: [Curve; 3],
}

#[derive(Clone)]
pub struct Report {
    pub space: WorkingSpace,
    pub accepted: usize,
    pub rejected: usize,
    pub rms: [f32; 3],
    pub flat_rms: [f32; 3],
    pub grad_corr: [f32; 3],
}

const BINS: usize = 128;
const MIN_BIN_SAMPLES: usize = 8;
const DARK_FLOOR: f32 = 1.0 / 65536.0;

fn log2_domain(x: f32) -> f32 {
    x.max(DARK_FLOOR).log2()
}

impl Curve {
    pub fn eval(&self, x: f32) -> f32 {
        let u = log2_domain(x);
        let knots = &self.knots_log2;
        match knots.iter().position(|&k| k > u) {
            Some(0) => self.coded[0],
            None => *self.coded.last().unwrap(),
            Some(i) => {
                let t = (u - knots[i - 1]) / (knots[i] - knots[i - 1]);
                self.coded[i - 1] + t * (self.coded[i] - self.coded[i - 1])
            }
        }
    }
}

impl Transfer {
    pub fn eval(&self, linear: [f32; 3]) -> [f32; 3] {
        let mixed = crate::color::apply(&self.mix, linear);
        [
            self.channels[0].eval(mixed[0]),
            self.channels[1].eval(mixed[1]),
            self.channels[2].eval(mixed[2]),
        ]
    }
}

pub fn measure(
    pairing: &crate::fit::pair::Pairing,
    space: WorkingSpace,
) -> Result<(Transfer, Report)> {
    let samples = &pairing.samples;
    let mix = fit_mix(samples);
    let curve = |c: usize| fit_channel(&mixed_values(samples, &mix, c), samples, c);
    let transfer = Transfer {
        mix,
        channels: [curve(0)?, curve(1)?, curve(2)?],
    };

    let mut rms = [0.0; 3];
    let mut flat_rms = [0.0; 3];
    let mut grad_corr = [0.0; 3];
    for c in 0..3 {
        let mut paired: Vec<(f32, f32)> = samples
            .iter()
            .map(|s| (transfer.eval(s.linear)[c] - s.coded[c], s.grad[c]))
            .collect();
        rms[c] = root_mean_square(paired.iter().map(|(r, _)| *r));
        let magnitudes: Vec<f32> = paired.iter().map(|(r, _)| r.abs()).collect();
        let grads: Vec<f32> = paired.iter().map(|(_, g)| *g).collect();
        grad_corr[c] = pearson(&magnitudes, &grads);
        paired.sort_by(|a, b| a.1.total_cmp(&b.1));
        flat_rms[c] = root_mean_square(paired[..paired.len() / 4].iter().map(|(r, _)| *r));
    }

    let report = Report {
        space,
        accepted: samples.len(),
        rejected: pairing.rejected,
        rms,
        flat_rms,
        grad_corr,
    };
    Ok((transfer, report))
}

fn mixed_values(samples: &[Sample], mix: &[[f32; 3]; 3], c: usize) -> Vec<f32> {
    samples
        .iter()
        .map(|s| crate::color::apply(mix, s.linear)[c])
        .collect()
}

// The camera's rendering is not channel-separable after any single 3x3: the
// same linear blue codes differently depending on tile chroma. A small fitted
// cross-term per channel absorbs the first-order dependence; minimum-norm
// tie-breaking handles the degenerate valley where the other two channels are
// collinear within flat tiles.
fn fit_mix(samples: &[Sample]) -> [[f32; 3]; 3] {
    let mut mix = [[0.0; 3]; 3];
    for (c, row) in mix.iter_mut().enumerate() {
        row[c] = 1.0;
        if samples.len() < 4 * MIN_BIN_SAMPLES {
            continue;
        }
        let others = [(c + 1) % 3, (c + 2) % 3];
        let flat = flat_quartile(samples, c);
        let (a, b) = minimize_2d(|a, b| {
            let mixed: Vec<f32> = samples
                .iter()
                .map(|s| s.linear[c] + a * s.linear[others[0]] + b * s.linear[others[1]])
                .collect();
            match fit_channel(&mixed, samples, c) {
                Ok(curve) => root_mean_square(
                    flat.iter()
                        .map(|&i| curve.eval(mixed[i]) - samples[i].coded[c]),
                ),
                Err(_) => f32::INFINITY,
            }
        });
        row[others[0]] = a;
        row[others[1]] = b;
    }
    mix
}

fn flat_quartile(samples: &[Sample], c: usize) -> Vec<usize> {
    let mut order: Vec<usize> = (0..samples.len()).collect();
    order.sort_by(|&i, &j| samples[i].grad[c].total_cmp(&samples[j].grad[c]));
    order.truncate(samples.len() / 4);
    order
}

fn minimize_2d(mut objective: impl FnMut(f32, f32) -> f32) -> (f32, f32) {
    let mut centre = (0.0, 0.0);
    let mut step = 0.02;
    for _ in 0..3 {
        let mut evals = Vec::new();
        for i in -4i32..=4 {
            for j in -4i32..=4 {
                let point = (centre.0 + i as f32 * step, centre.1 + j as f32 * step);
                evals.push((objective(point.0, point.1), point));
            }
        }
        let floor = evals.iter().map(|(v, _)| *v).fold(f32::INFINITY, f32::min);
        centre = evals
            .into_iter()
            .filter(|(v, _)| *v <= floor * 1.005)
            .map(|(_, p)| p)
            .min_by(|a, b| (a.0 * a.0 + a.1 * a.1).total_cmp(&(b.0 * b.0 + b.1 * b.1)))
            .unwrap_or(centre);
        step /= 4.0;
    }
    centre
}

fn fit_channel(domain: &[f32], samples: &[Sample], c: usize) -> Result<Curve> {
    if samples.is_empty() {
        return Err(Error::Unsupported("no samples survived pairing"));
    }
    let mut sorted: Vec<f32> = domain.iter().map(|&x| log2_domain(x)).collect();
    sorted.sort_by(f32::total_cmp);
    let lo = sorted[sorted.len() / 1000];
    let hi = sorted[sorted.len() - 1 - sorted.len() / 1000];
    if hi <= lo {
        return Err(Error::Unsupported("samples span no usable range"));
    }

    let width = (hi - lo) / BINS as f32;
    let mut bins: Vec<Vec<f32>> = vec![Vec::new(); BINS];
    for (&x, s) in domain.iter().zip(samples) {
        let u = log2_domain(x);
        let i = (((u - lo) / width) as usize).min(BINS - 1);
        if u >= lo && u <= hi {
            bins[i].push(s.coded[c]);
        }
    }

    let mut knots_log2 = Vec::new();
    let mut medians = Vec::new();
    let mut weights = Vec::new();
    for (i, bin) in bins.iter_mut().enumerate() {
        if bin.len() < MIN_BIN_SAMPLES {
            continue;
        }
        bin.sort_by(f32::total_cmp);
        knots_log2.push(lo + (i as f32 + 0.5) * width);
        medians.push(bin[bin.len() / 2]);
        weights.push(bin.len() as f32);
    }
    if knots_log2.len() < 2 {
        return Err(Error::Unsupported("too few populated bins to fit a curve"));
    }

    Ok(Curve {
        knots_log2,
        coded: isotonic(&medians, &weights),
    })
}

fn isotonic(values: &[f32], weights: &[f32]) -> Vec<f32> {
    let mut blocks: Vec<(f32, f32, usize)> = Vec::new();
    for (&value, &weight) in values.iter().zip(weights) {
        blocks.push((value, weight, 1));
        while let [.., (below, w1, n1), (above, w2, n2)] = blocks[..] {
            if below <= above {
                break;
            }
            blocks.truncate(blocks.len() - 2);
            let w = w1 + w2;
            blocks.push(((below * w1 + above * w2) / w, w, n1 + n2));
        }
    }
    blocks
        .iter()
        .flat_map(|&(mean, _, n)| std::iter::repeat_n(mean, n))
        .collect()
}

fn root_mean_square(values: impl ExactSizeIterator<Item = f32>) -> f32 {
    let n = values.len() as f64;
    (values.map(|v| (v as f64).powi(2)).sum::<f64>() / n).sqrt() as f32
}

fn pearson(a: &[f32], b: &[f32]) -> f32 {
    let n = a.len() as f64;
    let (ma, mb) = (
        a.iter().map(|&v| v as f64).sum::<f64>() / n,
        b.iter().map(|&v| v as f64).sum::<f64>() / n,
    );
    let mut cov = 0.0;
    let mut va = 0.0;
    let mut vb = 0.0;
    for (&x, &y) in a.iter().zip(b) {
        let (dx, dy) = (x as f64 - ma, y as f64 - mb);
        cov += dx * dy;
        va += dx * dx;
        vb += dy * dy;
    }
    (cov / (va * vb).sqrt()) as f32
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::fit::pair::Pairing;

    fn srgb_encode(x: f32) -> f32 {
        255.0
            * if x <= 0.0031308 {
                12.92 * x
            } else {
                1.055 * x.powf(1.0 / 2.4) - 0.055
            }
    }

    #[test]
    fn recovers_a_known_monotone_curve_within_noise() {
        let samples: Vec<Sample> = (0..6_000)
            .map(|i| {
                let x = (2.0f32).powf(-10.0 + 10.0 * i as f32 / 6_000.0);
                let noise = ((i as u64 * 2654435761 % 1000) as f32 / 1000.0) - 0.5;
                Sample {
                    linear: [x; 3],
                    coded: [(srgb_encode(x) + noise).clamp(0.0, 255.0); 3],
                    grad: [0.0; 3],
                }
            })
            .collect();
        let pairing = Pairing {
            samples,
            rejected: 0,
        };

        let (transfer, report) = measure(&pairing, WorkingSpace::LinearSrgb).unwrap();

        assert!(
            report.rms[0] < 1.5,
            "rms {} should sit near the noise floor",
            report.rms[0]
        );
        for x in [0.01, 0.1, 0.5, 0.9] {
            let err = (transfer.eval([x; 3])[1] - srgb_encode(x)).abs();
            assert!(err < 1.5, "|F({x}) - truth| = {err}");
        }
    }

    #[test]
    fn fitted_curve_is_monotone_and_clamps_outside_its_range() {
        let samples: Vec<Sample> = (0..4_000)
            .map(|i| {
                let x = 0.01 + (i as f32 / 4_000.0);
                Sample {
                    linear: [x; 3],
                    coded: [srgb_encode(x.min(1.0)); 3],
                    grad: [0.0; 3],
                }
            })
            .collect();
        let pairing = Pairing {
            samples,
            rejected: 0,
        };

        let (transfer, _) = measure(&pairing, WorkingSpace::LinearSrgb).unwrap();

        let mut previous = transfer.eval([1e-6; 3])[0];
        for step in 0..200 {
            let value = transfer.eval([1e-6 + step as f32 * 0.01; 3])[0];
            assert!(value >= previous);
            previous = value;
        }
        assert_eq!(transfer.eval([1e-9; 3])[0], transfer.eval([1e-8; 3])[0]);
        assert_eq!(transfer.eval([50.0; 3])[0], transfer.eval([100.0; 3])[0]);
    }

    #[test]
    fn isotonic_pools_violators_to_the_weighted_mean() {
        assert_eq!(
            isotonic(&[1.0, 3.0, 2.0, 4.0], &[1.0, 1.0, 1.0, 1.0]),
            vec![1.0, 2.5, 2.5, 4.0]
        );
        assert_eq!(isotonic(&[3.0, 1.0], &[3.0, 1.0]), vec![2.5, 2.5]);
    }

    #[test]
    fn refuses_degenerate_input() {
        let flat: Vec<Sample> = (0..100)
            .map(|_| Sample {
                linear: [0.5; 3],
                coded: [128.0; 3],
                grad: [0.0; 3],
            })
            .collect();
        assert!(
            measure(
                &Pairing {
                    samples: flat,
                    rejected: 0
                },
                WorkingSpace::LinearSrgb
            )
            .is_err()
        );
    }
}
