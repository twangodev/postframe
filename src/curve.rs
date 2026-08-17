use crate::develop::{CurvePoint, CurvePoints};

/// Resolution of the per-channel curves every render path samples.
pub const CHANNEL_CURVE_SAMPLES: usize = 1024;

/// A tone curve resolved into a dense lookup table over the unit interval.
#[derive(Clone, Debug)]
pub struct ToneCurve {
    samples: Vec<f32>,
}

impl ToneCurve {
    pub fn new(points: &CurvePoints, resolution: usize) -> Self {
        let resolution = resolution.max(2);
        let positions = (0..resolution).map(move |index| index as f32 / (resolution - 1) as f32);
        Self {
            samples: match MonotoneSpline::through(points) {
                Some(spline) => positions.map(|x| spline.eval(x)).collect(),
                None => positions.collect(),
            },
        }
    }

    pub fn is_identity(&self) -> bool {
        self.samples
            .iter()
            .enumerate()
            .all(|(index, &sample)| sample == self.position(index))
    }

    pub fn samples(&self) -> &[f32] {
        &self.samples
    }

    pub fn eval(&self, x: f32) -> f32 {
        let position = x.clamp(0.0, 1.0) * (self.samples.len() - 1) as f32;
        let index = (position as usize).min(self.samples.len() - 2);
        let fraction = position - index as f32;
        self.samples[index] + fraction * (self.samples[index + 1] - self.samples[index])
    }

    fn position(&self, index: usize) -> f32 {
        index as f32 / (self.samples.len() - 1) as f32
    }
}

/// Cubic Hermite segments whose tangents are limited the Fritsch–Carlson way,
/// so the interpolant never leaves the band its control points bracket. A
/// natural cubic would overshoot, and overshoot in a tone curve reads as halos
/// and inverted local contrast.
struct MonotoneSpline {
    points: Vec<CurvePoint>,
    tangents: Vec<f32>,
}

impl MonotoneSpline {
    fn through(points: &CurvePoints) -> Option<Self> {
        if points.is_identity() {
            return None;
        }
        let secants: Vec<f32> = points
            .0
            .windows(2)
            .map(|pair| (pair[1].y - pair[0].y) / (pair[1].x - pair[0].x))
            .collect();
        Some(Self {
            tangents: limited_tangents(&secants),
            points: points.0.clone(),
        })
    }

    fn eval(&self, x: f32) -> f32 {
        let first = self.points[0];
        let last = self.points[self.points.len() - 1];
        if x <= first.x {
            return first.y.clamp(0.0, 1.0);
        }
        if x >= last.x {
            return last.y.clamp(0.0, 1.0);
        }
        let segment = self.points.partition_point(|point| point.x <= x) - 1;
        let (start, end) = (self.points[segment], self.points[segment + 1]);
        let width = end.x - start.x;
        let t = (x - start.x) / width;
        let (square, cube) = (t * t, t * t * t);
        ((2.0 * cube - 3.0 * square + 1.0) * start.y
            + (cube - 2.0 * square + t) * width * self.tangents[segment]
            + (-2.0 * cube + 3.0 * square) * end.y
            + (cube - square) * width * self.tangents[segment + 1])
            .clamp(0.0, 1.0)
    }
}

fn limited_tangents(secants: &[f32]) -> Vec<f32> {
    let last = secants.len();
    let mut tangents: Vec<f32> = (0..=last)
        .map(|index| match index {
            0 => secants[0],
            index if index == last => secants[last - 1],
            index => {
                let (before, after) = (secants[index - 1], secants[index]);
                if before * after <= 0.0 {
                    0.0
                } else {
                    (before + after) / 2.0
                }
            }
        })
        .collect();
    for (index, secant) in secants.iter().enumerate() {
        let limit = 3.0 * secant.abs();
        tangents[index] = tangents[index].clamp(-limit, limit);
        tangents[index + 1] = tangents[index + 1].clamp(-limit, limit);
    }
    tangents
}

#[cfg(test)]
mod tests {
    use super::*;

    fn curve(points: &[(f32, f32)], resolution: usize) -> ToneCurve {
        ToneCurve::new(&self::points(points), resolution)
    }

    fn points(points: &[(f32, f32)]) -> CurvePoints {
        CurvePoints(
            points
                .iter()
                .map(|&(x, y)| CurvePoint { x, y })
                .collect::<Vec<_>>(),
        )
    }

    fn code(curve: &ToneCurve, value: u8) -> u8 {
        (curve.eval(f32::from(value) / 255.0) * 255.0).round() as u8
    }

    #[test]
    fn the_identity_curve_returns_every_code_untouched() {
        let curve = ToneCurve::new(&CurvePoints::identity(), CHANNEL_CURVE_SAMPLES);
        assert!(curve.is_identity());
        for value in 0..=u8::MAX {
            assert_eq!(code(&curve, value), value);
        }
    }

    #[test]
    fn a_shaped_curve_is_not_mistaken_for_the_identity() {
        assert!(
            !curve(
                &[(0.0, 0.0), (0.5, 0.62), (1.0, 1.0)],
                CHANNEL_CURVE_SAMPLES
            )
            .is_identity()
        );
    }

    #[test]
    fn segments_pass_through_their_control_points() {
        let control = [(0.0, 0.05), (0.25, 0.1), (0.6, 0.72), (1.0, 0.95)];
        let curve = curve(&control, CHANNEL_CURVE_SAMPLES);
        for (x, y) in control {
            let sampled = curve.eval(x);
            assert!(
                (sampled - y).abs() < 0.001,
                "curve at {x} is {sampled}, expected {y}"
            );
        }
    }

    #[test]
    fn monotone_control_points_yield_a_monotone_curve() {
        let curve = curve(
            &[
                (0.0, 0.0),
                (0.1, 0.02),
                (0.45, 0.55),
                (0.8, 0.98),
                (1.0, 1.0),
            ],
            CHANNEL_CURVE_SAMPLES,
        );
        for (index, pair) in curve.samples().windows(2).enumerate() {
            assert!(
                pair[0] <= pair[1],
                "curve reverses at sample {index}: {} then {}",
                pair[0],
                pair[1]
            );
        }
    }

    #[test]
    fn no_segment_overshoots_its_control_points() {
        let control = [(0.0, 0.0), (0.1, 0.85), (0.5, 0.9), (1.0, 1.0)];
        let curve = curve(&control, CHANNEL_CURVE_SAMPLES);
        for (start, end) in control.iter().zip(&control[1..]) {
            let mut x = start.0;
            while x <= end.0 {
                let sampled = curve.eval(x);
                assert!(
                    sampled >= start.1 - 0.0001 && sampled <= end.1 + 0.0001,
                    "curve at {x} is {sampled}, outside [{}, {}]",
                    start.1,
                    end.1
                );
                x += 0.001;
            }
        }
    }

    #[test]
    fn a_reversal_flattens_instead_of_swinging_past_its_extremum() {
        let curve = curve(&[(0.0, 0.1), (0.5, 0.8), (1.0, 0.2)], CHANNEL_CURVE_SAMPLES);
        let peak = curve
            .samples()
            .iter()
            .fold(0.0f32, |highest, &sample| highest.max(sample));
        assert!((peak - 0.8).abs() < 0.0001, "peaked at {peak}");
    }

    #[test]
    fn a_curve_narrower_than_the_unit_interval_extends_flat() {
        let curve = curve(&[(0.25, 0.1), (0.75, 0.9)], CHANNEL_CURVE_SAMPLES);
        assert!((curve.eval(0.0) - 0.1).abs() < 0.0001);
        assert!((curve.eval(1.0) - 0.9).abs() < 0.0001);
    }

    #[test]
    fn evaluation_clamps_its_input_to_the_unit_interval() {
        let curve = curve(&[(0.0, 0.2), (1.0, 0.8)], CHANNEL_CURVE_SAMPLES);
        assert_eq!(curve.eval(-1.0), curve.eval(0.0));
        assert_eq!(curve.eval(2.0), curve.eval(1.0));
    }
}
