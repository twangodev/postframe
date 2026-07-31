use std::path::Path;

use mtb_align::{Gray, Options, Shift, align_stack, common_crop};
use rawler::decoders::{Orientation, RawDecodeParams};
use rawler::imgop::xyz::Illuminant;
use rawler::rawsource::RawSource;

use crate::color::{self, WorkingSpace};
use crate::decode::{linear, linear::Linear, sooc, sooc::Sooc};
use crate::error::{Error, Result};
use crate::fit::pair::{Pairing, pair};
use crate::fit::transfer::{Report, Transfer, measure as fit_transfer};

pub struct Frame {
    pub camera: Linear,
    pub sooc: Sooc,
    pub balance: [f32; 3],
    pub xyz_to_cam: Vec<f32>,
    pub orientation: Orientation,
}

pub struct Rendered {
    pub width: usize,
    pub height: usize,
    pub rgb8: Vec<u8>,
}

pub struct MergeReport {
    pub fit: Report,
    pub exposures: Vec<f32>,
    pub shifts: Vec<(i32, i32)>,
    pub radiance_max: f32,
}

pub struct Merged {
    pub radiance: Linear,
    pub transfer: Transfer,
    pub space: WorkingSpace,
    pub report: MergeReport,
}

pub fn load(raf: &Path, jpeg: Option<&Path>) -> Result<Frame> {
    let source = RawSource::new(raf)?;
    let external = jpeg.map(std::fs::read).transpose()?;
    let bytes = match &external {
        Some(bytes) => bytes.as_slice(),
        None => embedded_jpeg(&source, raf)?,
    };
    let sooc = sooc::decode(bytes)?;

    let raw = rawler::decode(&source, &RawDecodeParams::default())?;
    let camera = linear::from_raw(&raw)?;

    let [r, g, b, _] = raw.wb_coeffs;
    if [r, g, b].iter().any(|c| !c.is_finite()) {
        return Err(Error::Unsupported("raw carries no white balance"));
    }
    let xyz_to_cam = raw
        .color_matrix
        .get(&Illuminant::D65)
        .or_else(|| raw.color_matrix.values().next())
        .ok_or(Error::Unsupported("raw carries no color matrix"))?
        .clone();

    let orientation = match sooc.orientation {
        Some(value) => Orientation::from_u16(value),
        None => raw.orientation,
    };
    Ok(Frame {
        camera,
        sooc,
        balance: [r, g, b],
        xyz_to_cam,
        orientation,
    })
}

fn embedded_jpeg<'a>(source: &'a RawSource, raf: &Path) -> Result<&'a [u8]> {
    let file_len = std::fs::metadata(raf)?.len();
    let (offset, len) = crate::decode::raf::jpeg_extent(
        source.subview(0, crate::decode::raf::HEADER_LEN)?,
        file_len,
    )?;
    Ok(source.subview(offset, len)?)
}

pub fn exposure_bias(raf: &Path, jpeg: Option<&Path>) -> Result<Option<f32>> {
    let bias = match jpeg {
        Some(path) => sooc::exposure_bias(&std::fs::read(path)?),
        None => {
            let source = RawSource::new(raf)?;
            sooc::exposure_bias(embedded_jpeg(&source, raf)?)
        }
    };
    Ok(bias)
}

pub fn to_working(frame: &Frame, space: WorkingSpace) -> Result<[[f32; 3]; 3]> {
    color::cam_to_working(&frame.xyz_to_cam, space)
        .ok_or(Error::Unsupported("color matrix is not 3x3"))
}

pub fn merge(mut frames: Vec<Frame>) -> Result<Merged> {
    if frames.len() < 2 {
        return Err(Error::Unsupported("a bracket needs at least two frames"));
    }
    if frames.iter().any(|f| f.sooc.exposure.is_none()) {
        return Err(Error::Unsupported("every frame needs an exposure time"));
    }
    frames.sort_by(|a, b| {
        a.sooc
            .exposure
            .unwrap()
            .total_cmp(&b.sooc.exposure.unwrap())
    });
    let reference = frames.len() / 2;
    let exposures: Vec<f32> = frames.iter().map(|f| f.sooc.exposure.unwrap()).collect();
    let space = frames[reference].sooc.space;
    let matrix = to_working(&frames[reference], space)?;
    let balance = frames[reference].balance;

    for frame in &mut frames {
        for pixel in &mut frame.camera.rgb {
            *pixel = color::apply(
                &matrix,
                [
                    pixel[0] * balance[0],
                    pixel[1] * balance[1],
                    pixel[2] * balance[2],
                ],
            );
        }
    }

    let mut samples = Vec::new();
    let mut rejected = 0;
    for frame in &frames {
        let pairing = pair(&frame.camera, &frame.sooc)?;
        samples.extend(pairing.samples);
        rejected += pairing.rejected;
    }
    let (transfer, fit) = fit_transfer(&Pairing { samples, rejected }, space)?;

    let (shifts, radiance) = merge_radiance(&frames, &exposures, reference)?;
    let radiance = upright(radiance, frames[reference].orientation);
    let radiance_max = radiance.rgb.iter().flatten().copied().fold(0.0, f32::max);

    Ok(Merged {
        radiance,
        transfer,
        space,
        report: MergeReport {
            fit,
            exposures,
            shifts: shifts.iter().map(|s| (s.x, s.y)).collect(),
            radiance_max,
        },
    })
}

impl Merged {
    pub fn render(&self, ev: f32) -> Rendered {
        render(&self.radiance, &self.transfer, ev)
    }

    // Extended Reinhard on the brightest channel, white point at the bracket's
    // measured maximum, so recovered highlights roll into SDR range instead of
    // clipping. The gain is applied as a scalar per pixel to preserve hue.
    pub fn render_tone_mapped(&self, ev: f32) -> Rendered {
        let gain = (2.0f32).powf(ev);
        let white = (self.report.radiance_max * gain).max(1.0);
        let mut rgb8 = Vec::with_capacity(self.radiance.rgb.len() * 3);
        for pixel in &self.radiance.rgb {
            let exposed = pixel.map(|c| c * gain);
            let brightest = exposed.iter().fold(0.0f32, |m, &c| m.max(c));
            let compress = (1.0 + brightest / (white * white)) / (1.0 + brightest);
            let coded = self.transfer.eval(exposed.map(|c| c * compress));
            rgb8.extend(coded.map(|v| v.round().clamp(0.0, 255.0) as u8));
        }
        Rendered {
            width: self.radiance.width,
            height: self.radiance.height,
            rgb8,
        }
    }
}

fn upright(linear: Linear, orientation: Orientation) -> Linear {
    let (w, h) = (linear.width, linear.height);
    let remap = |source: fn(usize, usize, usize, usize) -> usize, width: usize, height: usize| {
        let mut rgb = Vec::with_capacity(w * h);
        let mut clipped = Vec::with_capacity(w * h);
        for y in 0..height {
            for x in 0..width {
                let i = source(x, y, w, h);
                rgb.push(linear.rgb[i]);
                clipped.push(linear.clipped[i]);
            }
        }
        Linear {
            width,
            height,
            rgb,
            clipped,
        }
    };
    match orientation {
        Orientation::Rotate90 => remap(|x, y, w, h| (h - 1 - x) * w + y, h, w),
        Orientation::Rotate180 => remap(|x, y, w, h| (h - 1 - y) * w + (w - 1 - x), w, h),
        Orientation::Rotate270 => remap(|x, y, w, _| x * w + (w - 1 - y), h, w),
        _ => linear,
    }
}

fn merge_radiance(
    frames: &[Frame],
    exposures: &[f32],
    reference: usize,
) -> Result<(Vec<Shift>, Linear)> {
    let (width, height) = (frames[0].camera.width, frames[0].camera.height);
    if frames
        .iter()
        .any(|f| (f.camera.width, f.camera.height) != (width, height))
    {
        return Err(Error::Unsupported("bracket frames differ in size"));
    }

    let grays: Vec<Gray> = frames
        .iter()
        .map(|f| Gray::from_rgb(&f.sooc.rgb8, f.sooc.width, f.sooc.height))
        .collect();
    let jpeg_shifts = align_stack(
        &grays,
        reference,
        &Options {
            bits: 8,
            ..Options::default()
        },
    )
    .map_err(|_| Error::Unsupported("bracket alignment failed"))?;
    let jpeg_scale = width as f32 / frames[0].sooc.width as f32;
    let shifts: Vec<Shift> = jpeg_shifts
        .iter()
        .map(|s| {
            Shift::new(
                (s.x as f32 * jpeg_scale).round() as i32,
                (s.y as f32 * jpeg_scale).round() as i32,
            )
        })
        .collect();
    let crop = common_crop(&shifts, width, height);

    let t_ref = exposures[reference];
    let shortest = 0;
    let mut rgb = vec![[0.0f32; 3]; crop.width * crop.height];
    let mut clipped = vec![false; crop.width * crop.height];
    for y in 0..crop.height {
        for x in 0..crop.width {
            let out = y * crop.width + x;
            let mut sum = [0.0f64; 3];
            let mut weight = 0.0f64;
            for (i, frame) in frames.iter().enumerate() {
                let sx = (crop.x + x) as i64 - shifts[i].x as i64;
                let sy = (crop.y + y) as i64 - shifts[i].y as i64;
                let src = sy as usize * width + sx as usize;
                if frame.camera.clipped[src] {
                    continue;
                }
                let scale = (t_ref / exposures[i]) as f64;
                let w = exposures[i] as f64;
                for (total, &channel) in sum.iter_mut().zip(&frame.camera.rgb[src]) {
                    *total += channel as f64 * scale * w;
                }
                weight += w;
            }
            rgb[out] = if weight > 0.0 {
                [0, 1, 2].map(|c| (sum[c] / weight) as f32)
            } else {
                // Clipped in every frame: the per-channel ratios are meaningless
                // (each channel saturates at its own ceiling), so render neutral
                // at the brightest channel's level, as the camera would.
                let sx = (crop.x + x) as i64 - shifts[shortest].x as i64;
                let sy = (crop.y + y) as i64 - shifts[shortest].y as i64;
                let src = sy as usize * width + sx as usize;
                clipped[out] = true;
                let brightest = frames[shortest].camera.rgb[src]
                    .iter()
                    .fold(0.0f32, |m, &v| m.max(v));
                [brightest * t_ref / exposures[shortest]; 3]
            };
        }
    }

    Ok((
        shifts,
        Linear {
            width: crop.width,
            height: crop.height,
            rgb,
            clipped,
        },
    ))
}

fn render(radiance: &Linear, transfer: &Transfer, ev: f32) -> Rendered {
    let gain = (2.0f32).powf(ev);
    let mut rgb8 = Vec::with_capacity(radiance.rgb.len() * 3);
    for pixel in &radiance.rgb {
        let coded = transfer.eval([pixel[0] * gain, pixel[1] * gain, pixel[2] * gain]);
        rgb8.extend(coded.map(|v| v.round().clamp(0.0, 255.0) as u8));
    }
    Rendered {
        width: radiance.width,
        height: radiance.height,
        rgb8,
    }
}
