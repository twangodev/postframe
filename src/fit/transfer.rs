use crate::color::WorkingSpace;
use crate::error::{Error, Result};
use crate::fit::pair::Sample;

pub struct Curve {
    knots_log2: Vec<f32>,
    coded: Vec<f32>,
}

pub struct Transfer {
    pub channels: [Curve; 3],
}

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

pub fn measure(
    pairing: &crate::fit::pair::Pairing,
    space: WorkingSpace,
) -> Result<(Transfer, Report)> {
    let samples = &pairing.samples;
    let channels = [
        fit_channel(samples, 0)?,
        fit_channel(samples, 1)?,
        fit_channel(samples, 2)?,
    ];
    let transfer = Transfer { channels };

    let mut rms = [0.0; 3];
    let mut flat_rms = [0.0; 3];
    let mut grad_corr = [0.0; 3];
    for c in 0..3 {
        let mut paired: Vec<(f32, f32)> = samples
            .iter()
            .map(|s| {
                (
                    transfer.channels[c].eval(s.linear[c]) - s.coded[c],
                    s.grad[c],
                )
            })
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

fn fit_channel(samples: &[Sample], c: usize) -> Result<Curve> {
    if samples.is_empty() {
        return Err(Error::Unsupported("no samples survived pairing"));
    }
    let mut domain: Vec<f32> = samples.iter().map(|s| log2_domain(s.linear[c])).collect();
    domain.sort_by(f32::total_cmp);
    let lo = domain[domain.len() / 1000];
    let hi = domain[domain.len() - 1 - domain.len() / 1000];
    if hi <= lo {
        return Err(Error::Unsupported("samples span no usable range"));
    }

    let width = (hi - lo) / BINS as f32;
    let mut bins: Vec<Vec<f32>> = vec![Vec::new(); BINS];
    for s in samples {
        let u = log2_domain(s.linear[c]);
        let i = (((u - lo) / width) as usize).min(BINS - 1);
        if u >= lo && u <= hi {
            bins[i].push(s.coded[c]);
        }
    }

    let mut knots_log2 = Vec::new();
    let mut coded = Vec::new();
    for (i, bin) in bins.iter_mut().enumerate() {
        if bin.len() < MIN_BIN_SAMPLES {
            continue;
        }
        bin.sort_by(f32::total_cmp);
        knots_log2.push(lo + (i as f32 + 0.5) * width);
        coded.push(bin[bin.len() / 2]);
    }
    if knots_log2.len() < 2 {
        return Err(Error::Unsupported("too few populated bins to fit a curve"));
    }

    let mut running_max = f32::NEG_INFINITY;
    for value in &mut coded {
        running_max = running_max.max(*value);
        *value = running_max;
    }
    Ok(Curve { knots_log2, coded })
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
        let samples: Vec<Sample> = (0..20_000)
            .map(|i| {
                let x = 0.001 + 0.998 * (i as f32 / 20_000.0);
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
            let err = (transfer.channels[1].eval(x) - srgb_encode(x)).abs();
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

        let curve = &transfer.channels[0];
        let mut previous = curve.eval(1e-6);
        for step in 0..200 {
            let value = curve.eval(1e-6 + step as f32 * 0.01);
            assert!(value >= previous);
            previous = value;
        }
        assert_eq!(curve.eval(1e-9), curve.eval(1e-8));
        assert_eq!(curve.eval(50.0), curve.eval(100.0));
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
