use crate::curve::{CurvePoint, CurvePoints, CurveSettings};
use crate::fit::transfer::{FULL_CAMERA_LOOK, Transfer};
use crate::light::{decode_srgb, encode_srgb};
use crate::{
    ColorSettings, ColorTransform, DevelopSettings, DevelopTransform, LightSettings, Merged,
    Preview, neutralizing_balance,
};

const ANALYSIS_DIMENSION: usize = 384;
const CURVE_POINTS: usize = 17;
const RESIDUAL_STEP: usize = 1;

#[derive(Clone, Debug)]
#[cfg_attr(feature = "wasm", derive(serde::Serialize))]
#[cfg_attr(feature = "wasm", serde(rename_all = "camelCase"))]
pub struct CameraMatch {
    pub light: LightSettings,
    pub color: ColorSettings,
    pub curve: CurveSettings,
    pub camera_look: f32,
    pub mean_error: f32,
    pub p99_error: f32,
    pub settings_only_error: f32,
    pub fit_error: f32,
}

impl CameraMatch {
    pub fn develop_settings(&self) -> DevelopSettings {
        DevelopSettings {
            light: self.light,
            color: self.color,
            curve: self.curve.clone(),
            ..DevelopSettings::neutral()
        }
    }
}

pub fn camera_match(merged: &Merged) -> crate::Result<CameraMatch> {
    let image = merged.thumbnail(ANALYSIS_DIMENSION);
    let target = render(&image, &image.transfer, &DevelopSettings::neutral())?;
    let neutral = image.transfer.with_camera_look(0.0);
    let visible = visible_settings(&image.transfer, &neutral)?;
    let settings_only = errors(
        &render(&image, &image.transfer.with_camera_look(0.0), &visible)?,
        &target,
    );
    let fit_error = image.report.fit.rms.iter().sum::<f32>() / 3.0;

    let mut selected = None;
    for amount in (0..=FULL_CAMERA_LOOK as usize).step_by(RESIDUAL_STEP) {
        let residual = image.transfer.with_camera_look(amount as f32);
        let settings = visible_settings(&image.transfer, &residual)?;
        let reconstructed = render(&image, &residual, &settings)?;
        let measured = errors(&reconstructed, &target);
        if measured.mean <= fit_error {
            selected = Some((amount as f32, settings, measured));
            break;
        }
    }
    let (camera_look, settings, measured) = selected.unwrap_or_else(|| {
        (
            FULL_CAMERA_LOOK,
            DevelopSettings::neutral(),
            MatchError::default(),
        )
    });

    Ok(CameraMatch {
        light: settings.light,
        color: settings.color,
        curve: settings.curve,
        camera_look,
        mean_error: measured.mean,
        p99_error: measured.p99,
        settings_only_error: settings_only.mean,
        fit_error,
    })
}

fn visible_settings(fitted: &Transfer, base: &Transfer) -> crate::Result<DevelopSettings> {
    let fitted_diagonal = fitted
        .mix
        .map(|row| row.into_iter().sum::<f32>().max(f32::EPSILON));
    let base_diagonal = base
        .mix
        .map(|row| row.into_iter().sum::<f32>().max(f32::EPSILON));
    let remaining =
        std::array::from_fn(|channel| fitted_diagonal[channel] / base_diagonal[channel]);
    let (temperature, tint) = neutralizing_balance(remaining).unwrap_or_default();
    let color = ColorSettings {
        temperature: -temperature,
        tint: -tint,
        ..ColorSettings::NEUTRAL
    };
    let balance = ColorTransform::new(color)?.balanced([1.0; 3]);
    Ok(DevelopSettings {
        color,
        curve: CurveSettings {
            luminance: CurvePoints::identity(),
            red: transfer_curve(fitted, base, fitted_diagonal, base_diagonal, balance, 0),
            green: transfer_curve(fitted, base, fitted_diagonal, base_diagonal, balance, 1),
            blue: transfer_curve(fitted, base, fitted_diagonal, base_diagonal, balance, 2),
        },
        ..DevelopSettings::neutral()
    })
}

fn transfer_curve(
    fitted: &Transfer,
    base: &Transfer,
    fitted_diagonal: [f32; 3],
    base_diagonal: [f32; 3],
    balance: [f32; 3],
    channel: usize,
) -> CurvePoints {
    CurvePoints(
        (0..CURVE_POINTS)
            .map(|index| {
                let x = index as f32 / (CURVE_POINTS - 1) as f32;
                let base_coded = 255.0 * encode_srgb(decode_srgb(x) / balance[channel]);
                let base_mixed = inverse_curve(&base.channels[channel], base_coded);
                let radiance = base_mixed / base_diagonal[channel];
                let fitted_mixed = fitted_diagonal[channel] * radiance;
                CurvePoint {
                    x,
                    y: (fitted.channels[channel].eval(fitted_mixed) / 255.0).clamp(0.0, 1.0),
                }
            })
            .collect(),
    )
}

fn inverse_curve(curve: &crate::fit::transfer::Curve, coded: f32) -> f32 {
    let Some(index) = curve.coded.iter().position(|&value| value >= coded) else {
        return curve.knots_log2.last().copied().unwrap_or_default().exp2();
    };
    if index == 0 {
        return curve.knots_log2[0].exp2();
    }
    let (below, above) = (curve.coded[index - 1], curve.coded[index]);
    let fraction = if above > below {
        (coded - below) / (above - below)
    } else {
        0.0
    };
    (curve.knots_log2[index - 1]
        + fraction * (curve.knots_log2[index] - curve.knots_log2[index - 1]))
        .exp2()
}

fn render(
    image: &Merged,
    transfer: &Transfer,
    settings: &DevelopSettings,
) -> crate::Result<Vec<u8>> {
    let preview = Preview::from_transfer(transfer);
    let develop = DevelopTransform::new(settings.clone())?;
    Ok(preview.render_adjusted(image, &develop, true))
}

#[derive(Clone, Copy, Default)]
struct MatchError {
    mean: f32,
    p99: f32,
}

fn errors(candidate: &[u8], target: &[u8]) -> MatchError {
    let mut absolute: Vec<u8> = candidate
        .iter()
        .zip(target)
        .map(|(&left, &right)| left.abs_diff(right))
        .collect();
    let mean =
        absolute.iter().map(|&value| f64::from(value)).sum::<f64>() / absolute.len().max(1) as f64;
    let p99 = if absolute.is_empty() {
        0.0
    } else {
        let index = ((absolute.len() - 1) as f32 * 0.99).round() as usize;
        let (_, value, _) = absolute.select_nth_unstable(index);
        f32::from(*value)
    };
    MatchError {
        mean: mean as f32,
        p99,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::bracket::MergeReport;
    use crate::color::WorkingSpace;
    use crate::decode::linear::Linear;
    use crate::fit::transfer::{Curve, Report};

    fn synthetic_curve(channel: usize) -> Curve {
        let knots_log2: Vec<f32> = (-10..=1).map(|stop| stop as f32).collect();
        let coded = knots_log2
            .iter()
            .map(|&stop| {
                let encoded = encode_srgb(stop.exp2()).clamp(0.0, 1.0);
                let shaped = match channel {
                    0 => encoded.powf(0.94),
                    1 => encoded.powf(1.02),
                    _ => encoded.powf(1.08),
                };
                255.0 * shaped
            })
            .collect();
        Curve { knots_log2, coded }
    }

    fn synthetic_merged() -> Merged {
        let (width, height) = (96, 64);
        let rgb = (0..height)
            .flat_map(|y| {
                (0..width).map(move |x| {
                    let luma = 0.01 + 0.9 * x as f32 / (width - 1) as f32;
                    let color = y as f32 / (height - 1) as f32;
                    [
                        luma,
                        luma * (0.75 + 0.25 * color),
                        luma * (1.0 - 0.3 * color),
                    ]
                })
            })
            .collect();
        Merged {
            radiance: Linear {
                width,
                height,
                rgb,
                clipped: vec![false; width * height],
            },
            transfer: Transfer {
                mix: [[1.06, 0.03, -0.01], [0.01, 0.96, 0.01], [-0.01, 0.02, 0.93]],
                channels: std::array::from_fn(synthetic_curve),
            },
            space: WorkingSpace::LinearSrgb,
            report: MergeReport {
                fit: Report {
                    space: WorkingSpace::LinearSrgb,
                    accepted: width * height,
                    rejected: 0,
                    rms: [3.0; 3],
                    flat_rms: [3.0; 3],
                    grad_corr: [1.0; 3],
                },
                exposures: vec![0.0],
                shifts: vec![(0, 0)],
                radiance_max: 1.0,
            },
        }
    }

    #[test]
    fn decomposes_a_synthetic_transfer_with_a_small_measured_residual() {
        let merged = synthetic_merged();

        let matched = camera_match(&merged).unwrap();
        let target = render(&merged, &merged.transfer, &DevelopSettings::neutral()).unwrap();
        let residual = merged.transfer.with_camera_look(matched.camera_look);
        let reconstructed = render(&merged, &residual, &matched.develop_settings()).unwrap();
        let measured = errors(&reconstructed, &target);

        assert!(
            matched.camera_look <= 40.0,
            "residual {}",
            matched.camera_look
        );
        assert!(measured.mean < 8.0, "mean error {}", measured.mean);
        assert!((measured.mean - matched.mean_error).abs() < 0.001);
    }

    #[test]
    fn transfer_curve_is_monotone_and_compact() {
        let channel = Curve {
            knots_log2: vec![-8.0, 0.0],
            coded: vec![0.0, 255.0],
        };
        let transfer = Transfer {
            mix: [[1.0, 0.0, 0.0], [0.0, 1.0, 0.0], [0.0, 0.0, 1.0]],
            channels: [channel.clone(), channel.clone(), channel],
        };
        let curve = transfer_curve(&transfer, &transfer, [1.0; 3], [1.0; 3], [1.0; 3], 0);

        assert_eq!(curve.0.len(), CURVE_POINTS);
        assert_eq!(curve.0.first().unwrap().x, 0.0);
        assert_eq!(curve.0.last().unwrap().x, 1.0);
        assert!(curve.0.windows(2).all(|pair| pair[0].y <= pair[1].y));
    }
}
