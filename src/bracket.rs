use std::sync::Arc;

use mtb_align::{Gray, Options, Shift, align_stack, common_crop};
use rawler::decoders::{Orientation, RawDecodeParams};
use rawler::imgop::xyz::Illuminant;
use rawler::rawsource::RawSource;

use crate::color::{self, WorkingSpace};
use crate::decode::{linear, linear::Linear, sooc, sooc::Sooc};
use crate::error::{Error, Result};
use crate::fit::pair::{Pairing, pair};
use crate::fit::transfer::{Report, Transfer, measure as fit_transfer};
use crate::parallel;

pub struct FrameData {
    pub raw: Arc<Vec<u8>>,
    pub jpeg: Option<Vec<u8>>,
}

pub struct Frame {
    pub camera: Linear,
    pub full: Option<Linear>,
    pub sooc: Sooc,
    pub balance: [f32; 3],
    pub xyz_to_cam: Vec<f32>,
    pub orientation: Orientation,
}

impl Frame {
    fn image(&self) -> &Linear {
        self.full.as_ref().unwrap_or(&self.camera)
    }
}

pub struct Rendered {
    pub width: usize,
    pub height: usize,
    pub rgb8: Vec<u8>,
}

#[derive(Clone)]
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

pub fn load(data: &FrameData) -> Result<Frame> {
    load_at(data, false)
}

pub fn load_full(data: &FrameData) -> Result<Frame> {
    load_at(data, true)
}

fn load_at(data: &FrameData, full_resolution: bool) -> Result<Frame> {
    let source = RawSource::new_from_shared_vec(data.raw.clone());
    let decoder = rawler::get_decoder(&source)?;
    let params = RawDecodeParams::default();
    let metadata = decoder.raw_metadata(&source, &params)?;
    let raw = decoder.raw_image(&source, &params, false)?;
    let mut sooc = match &data.jpeg {
        Some(bytes) => sooc::decode(bytes)?,
        None => decoder_preview(decoder.as_ref(), &source, &params, &metadata)?,
    };
    sooc.exposure = sooc
        .exposure
        .or_else(|| metadata.exif.exposure_time.and_then(rational));
    sooc.orientation = sooc.orientation.or(Some(raw.orientation.to_u16()));
    let camera = linear::from_raw(&raw)?;
    let full = full_resolution
        .then(|| linear::demosaic_full(&raw))
        .transpose()?;

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
        full,
        sooc,
        balance: [r, g, b],
        xyz_to_cam,
        orientation,
    })
}

fn decoder_preview(
    decoder: &dyn rawler::decoders::Decoder,
    source: &RawSource,
    params: &RawDecodeParams,
    metadata: &rawler::decoders::RawMetadata,
) -> Result<Sooc> {
    let image = if let Some(image) = decoder.preview_image(source, params)? {
        image
    } else if let Some(image) = decoder.thumbnail_image(source, params)? {
        image
    } else {
        decoder
            .full_image(source, params)?
            .ok_or(Error::Unsupported("raw carries no rendered preview"))?
    }
    .to_rgb8();
    let (width, height) = image.dimensions();
    sooc::from_rgb8(
        width as usize,
        height as usize,
        image.into_raw(),
        match metadata.exif.color_space {
            Some(2) => WorkingSpace::LinearAdobeRgb,
            _ => WorkingSpace::LinearSrgb,
        },
        metadata.exif.exposure_time.and_then(rational),
        metadata.exif.orientation,
    )
}

fn rational(value: rawler::formats::tiff::Rational) -> Option<f32> {
    let value = value.n as f32 / value.d as f32;
    (value.is_finite() && value > 0.0).then_some(value)
}

pub fn exposure_bias(data: &FrameData) -> Result<Option<f32>> {
    let bias = match &data.jpeg {
        Some(bytes) => sooc::exposure_bias(bytes),
        None => {
            let source = RawSource::new_from_shared_vec(data.raw.clone());
            let decoder = rawler::get_decoder(&source)?;
            decoder
                .raw_metadata(&source, &RawDecodeParams::default())?
                .exif
                .exposure_bias
                .and_then(|value| {
                    let value = value.n as f32 / value.d as f32;
                    value.is_finite().then_some(value)
                })
        }
    };
    Ok(bias)
}

pub fn to_working(frame: &Frame, space: WorkingSpace) -> Result<[[f32; 3]; 3]> {
    color::cam_to_working(&frame.xyz_to_cam, space)
        .ok_or(Error::Unsupported("color matrix is not 3x3"))
}

pub fn merge(mut frames: Vec<Frame>) -> Result<Merged> {
    if frames.is_empty() {
        return Err(Error::Unsupported("a photo needs at least one frame"));
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
        let planes = std::iter::once(&mut frame.camera).chain(frame.full.as_mut());
        for plane in planes {
            parallel::for_each_pixel(&mut plane.rgb, |pixel| {
                *pixel = color::apply(
                    &matrix,
                    [
                        pixel[0] * balance[0],
                        pixel[1] * balance[1],
                        pixel[2] * balance[2],
                    ],
                );
            });
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

    let (shifts, radiance) = merge_radiance(&mut frames, &exposures, reference)?;
    let radiance = upright(radiance, frames[reference].orientation);
    let radiance_max = parallel::max_of(&radiance.rgb, |pixel| {
        pixel.iter().copied().fold(0.0, f32::max)
    });

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
        self.render_with(&self.transfer, ev)
    }

    /// Renders through a transfer of the caller's choosing, so a camera look
    /// weaker than the fitted one reaches the output as well as the preview.
    pub fn render_with(&self, transfer: &Transfer, ev: f32) -> Rendered {
        render(&self.radiance, transfer, ev)
    }

    pub fn thumbnail(&self, max_dimension: usize) -> Merged {
        let (w, h) = (self.radiance.width, self.radiance.height);
        let factor = w.max(h).div_ceil(max_dimension).max(1);
        let (out_w, out_h) = (w / factor, h / factor);
        let mut rgb = Vec::with_capacity(out_w * out_h);
        let mut clipped = Vec::with_capacity(out_w * out_h);
        for by in 0..out_h {
            for bx in 0..out_w {
                let mut sum = [0.0f32; 3];
                let mut any_clipped = false;
                for dy in 0..factor {
                    for dx in 0..factor {
                        let i = (by * factor + dy) * w + bx * factor + dx;
                        for (total, &channel) in sum.iter_mut().zip(&self.radiance.rgb[i]) {
                            *total += channel;
                        }
                        any_clipped |= self.radiance.clipped[i];
                    }
                }
                let n = (factor * factor) as f32;
                rgb.push(sum.map(|s| s / n));
                clipped.push(any_clipped);
            }
        }
        Merged {
            radiance: Linear {
                width: out_w,
                height: out_h,
                rgb,
                clipped,
            },
            transfer: self.transfer.clone(),
            space: self.space,
            report: self.report.clone(),
        }
    }

    pub fn render_tone_mapped(&self, ev: f32) -> Rendered {
        let gain = (2.0f32).powf(ev);
        let white_point = (self.report.radiance_max * gain).max(1.0);
        let mut rgb8 = Vec::with_capacity(self.radiance.rgb.len() * 3);
        for pixel in &self.radiance.rgb {
            let exposed = pixel.map(|c| c * gain);
            let brightest = exposed.iter().fold(0.0f32, |m, &c| m.max(c));
            let compress = extended_reinhard_gain(brightest, white_point);
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

/// A clipped pixel's channel ratios are meaningless — each channel saturates
/// at its own ceiling — so render neutral at the brightest channel's level,
/// as the camera would.
fn neutral_at_brightest(pixel: [f32; 3]) -> [f32; 3] {
    [pixel.iter().fold(0.0f32, |m, &v| m.max(v)); 3]
}

fn neutralize_clipped(radiance: &mut Linear) {
    for (pixel, &clipped) in radiance.rgb.iter_mut().zip(&radiance.clipped) {
        if clipped {
            *pixel = neutral_at_brightest(*pixel);
        }
    }
}

fn merge_radiance(
    frames: &mut [Frame],
    exposures: &[f32],
    reference: usize,
) -> Result<(Vec<Shift>, Linear)> {
    let (width, height) = (frames[0].image().width, frames[0].image().height);
    if frames
        .iter()
        .any(|f| (f.image().width, f.image().height) != (width, height))
    {
        return Err(Error::Unsupported("bracket frames differ in size"));
    }

    if frames.len() == 1 {
        let mut radiance = frames[0]
            .full
            .take()
            .unwrap_or_else(|| frames[0].camera.clone());
        neutralize_clipped(&mut radiance);
        return Ok((vec![Shift::new(0, 0)], radiance));
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
    let frames = &*frames;
    let mut rgb = vec![[0.0f32; 3]; crop.width * crop.height];
    let mut clipped = vec![false; crop.width * crop.height];
    parallel::fill_zipped_rows(&mut rgb, &mut clipped, crop.width, |y, rgb, clipped| {
        for (x, (out_pixel, out_clipped)) in rgb.iter_mut().zip(clipped).enumerate() {
            let mut sum = [0.0f64; 3];
            let mut weight = 0.0f64;
            for (i, frame) in frames.iter().enumerate() {
                let sx = (crop.x + x) as i64 - shifts[i].x as i64;
                let sy = (crop.y + y) as i64 - shifts[i].y as i64;
                let src = sy as usize * width + sx as usize;
                if frame.image().clipped[src] {
                    continue;
                }
                let scale = (t_ref / exposures[i]) as f64;
                let w = exposures[i] as f64;
                for (total, &channel) in sum.iter_mut().zip(&frame.image().rgb[src]) {
                    *total += channel as f64 * scale * w;
                }
                weight += w;
            }
            *out_pixel = if weight > 0.0 {
                [0, 1, 2].map(|c| (sum[c] / weight) as f32)
            } else {
                let sx = (crop.x + x) as i64 - shifts[shortest].x as i64;
                let sy = (crop.y + y) as i64 - shifts[shortest].y as i64;
                let src = sy as usize * width + sx as usize;
                *out_clipped = true;
                neutral_at_brightest(frames[shortest].image().rgb[src])
                    .map(|v| v * t_ref / exposures[shortest])
            };
        }
    });

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

/// Extended Reinhard: compresses so `brightest` reaches 1.0 at `white_point`,
/// rolling recovered highlights into SDR range instead of clipping. One scalar
/// per pixel, applied to every channel, preserves hue.
fn extended_reinhard_gain(brightest: f32, white_point: f32) -> f32 {
    (1.0 + brightest / (white_point * white_point)) / (1.0 + brightest)
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_an_empty_document() {
        assert!(matches!(
            merge(Vec::new()),
            Err(Error::Unsupported("a photo needs at least one frame"))
        ));
    }

    #[test]
    fn preserves_a_single_frame_without_alignment() {
        let image = Linear {
            width: 2,
            height: 1,
            rgb: vec![[0.1, 0.2, 0.3], [0.4, 0.5, 0.6]],
            clipped: vec![false, true],
        };
        let frame = Frame {
            camera: image.clone(),
            full: None,
            sooc: Sooc {
                width: 2,
                height: 1,
                rgb8: vec![0; 6],
                space: WorkingSpace::LinearSrgb,
                exposure: Some(1.0),
                orientation: Some(1),
            },
            balance: [1.0; 3],
            xyz_to_cam: vec![1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0],
            orientation: Orientation::Normal,
        };

        let mut frames = [frame];
        let (shifts, radiance) = merge_radiance(&mut frames, &[1.0], 0).unwrap();

        assert_eq!(shifts, vec![Shift::new(0, 0)]);
        assert_eq!(radiance.width, image.width);
        assert_eq!(radiance.height, image.height);
        assert_eq!(radiance.rgb[0], image.rgb[0]);
        assert_eq!(
            radiance.rgb[1], [0.6; 3],
            "a clipped pixel renders neutral at the brightest channel's level"
        );
        assert_eq!(radiance.clipped, image.clipped);
    }
}
