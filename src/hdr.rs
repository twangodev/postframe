use std::ffi::c_void;

use ultrahdr::sys;

use crate::bracket::Merged;
use crate::color::WorkingSpace;
use crate::error::{Error, Result};

pub struct UltraHdr {
    pub bytes: Vec<u8>,
    pub boost_stops: f32,
}

const OFFSET: f32 = 1.0 / 64.0;
const BASE_QUALITY: u8 = 92;
const MAP_QUALITY: u8 = 90;
const MIN_MEANINGFUL_STOPS: f32 = 0.05;

pub fn encode(merged: &Merged) -> Result<UltraHdr> {
    if merged.space != WorkingSpace::LinearSrgb {
        return Err(Error::Unsupported(
            "ultra hdr output requires an sRGB bracket",
        ));
    }
    let base = merged.render(0.0);
    let (width, height) = (base.width, base.height);

    let gains: Vec<f32> = merged
        .radiance
        .rgb
        .iter()
        .zip(base.rgb8.chunks_exact(3))
        .map(|(radiance, coded)| {
            let luma = luma_709([
                srgb_to_linear(coded[0]),
                srgb_to_linear(coded[1]),
                srgb_to_linear(coded[2]),
            ]);
            let boost = radiance.iter().fold(1.0f32, |m, &c| m.max(c));
            ((luma * boost + OFFSET) / (luma + OFFSET)).log2()
        })
        .collect();

    let boost_stops = gains.iter().copied().fold(0.0f32, f32::max);
    if boost_stops < MIN_MEANINGFUL_STOPS {
        return Err(Error::Unsupported(
            "bracket holds no highlights beyond SDR white",
        ));
    }
    let map: Vec<u8> = gains
        .iter()
        .map(|g| ((g / boost_stops).clamp(0.0, 1.0) * 255.0).round() as u8)
        .collect();

    let mut base_jpeg = Vec::new();
    jpeg_encoder::Encoder::new(&mut base_jpeg, BASE_QUALITY)
        .encode(
            &base.rgb8,
            width as u16,
            height as u16,
            jpeg_encoder::ColorType::Rgb,
        )
        .map_err(|e| Error::Encode(e.to_string()))?;
    let mut map_jpeg = Vec::new();
    jpeg_encoder::Encoder::new(&mut map_jpeg, MAP_QUALITY)
        .encode(
            &map,
            width as u16,
            height as u16,
            jpeg_encoder::ColorType::Luma,
        )
        .map_err(|e| Error::Encode(e.to_string()))?;

    let bytes = container(&mut base_jpeg, &mut map_jpeg, boost_stops)?;
    Ok(UltraHdr { bytes, boost_stops })
}

fn container(base_jpeg: &mut [u8], map_jpeg: &mut [u8], boost_stops: f32) -> Result<Vec<u8>> {
    let max_boost = (2.0f32).powf(boost_stops);
    let mut meta = sys::uhdr_gainmap_metadata {
        max_content_boost: [max_boost; 3],
        min_content_boost: [1.0; 3],
        gamma: [1.0; 3],
        offset_sdr: [OFFSET; 3],
        offset_hdr: [OFFSET; 3],
        hdr_capacity_min: 1.0,
        hdr_capacity_max: max_boost,
        use_base_cg: 1,
    };

    unsafe {
        let encoder = Guard(sys::uhdr_create_encoder());
        if encoder.0.is_null() {
            return Err(Error::Encode("uhdr encoder allocation failed".into()));
        }

        let mut base = sys::uhdr_compressed_image {
            data: base_jpeg.as_mut_ptr() as *mut c_void,
            data_sz: base_jpeg.len(),
            capacity: base_jpeg.len(),
            cg: sys::uhdr_color_gamut::UHDR_CG_BT_709,
            ct: sys::uhdr_color_transfer::UHDR_CT_SRGB,
            range: sys::uhdr_color_range::UHDR_CR_FULL_RANGE,
        };
        check(sys::uhdr_enc_set_compressed_image(
            encoder.0,
            &mut base,
            sys::uhdr_img_label::UHDR_BASE_IMG,
        ))?;

        let mut map = sys::uhdr_compressed_image {
            data: map_jpeg.as_mut_ptr() as *mut c_void,
            data_sz: map_jpeg.len(),
            capacity: map_jpeg.len(),
            cg: sys::uhdr_color_gamut::UHDR_CG_UNSPECIFIED,
            ct: sys::uhdr_color_transfer::UHDR_CT_UNSPECIFIED,
            range: sys::uhdr_color_range::UHDR_CR_UNSPECIFIED,
        };
        check(sys::uhdr_enc_set_gainmap_image(
            encoder.0, &mut map, &mut meta,
        ))?;
        check(sys::uhdr_encode(encoder.0))?;

        let stream = sys::uhdr_get_encoded_stream(encoder.0);
        if stream.is_null() {
            return Err(Error::Encode("uhdr returned no stream".into()));
        }
        Ok(std::slice::from_raw_parts((*stream).data as *const u8, (*stream).data_sz).to_vec())
    }
}

struct Guard(*mut sys::uhdr_codec_private);

impl Drop for Guard {
    fn drop(&mut self) {
        unsafe { sys::uhdr_release_encoder(self.0) }
    }
}

fn check(status: sys::uhdr_error_info) -> Result<()> {
    if status.error_code == sys::uhdr_codec_err::UHDR_CODEC_OK {
        return Ok(());
    }
    let detail = if status.has_detail != 0 {
        unsafe { std::ffi::CStr::from_ptr(status.detail.as_ptr()) }
            .to_string_lossy()
            .into_owned()
    } else {
        format!("{:?}", status.error_code)
    };
    Err(Error::Encode(detail))
}

fn srgb_to_linear(coded: u8) -> f32 {
    let c = coded as f32 / 255.0;
    if c <= 0.04045 {
        c / 12.92
    } else {
        ((c + 0.055) / 1.055).powf(2.4)
    }
}

fn luma_709([r, g, b]: [f32; 3]) -> f32 {
    0.2126 * r + 0.7152 * g + 0.0722 * b
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unclipped_pixels_carry_no_gain() {
        let luma = luma_709([0.2, 0.2, 0.2]);
        let gain = ((luma * 1.0 + OFFSET) / (luma + OFFSET)).log2();
        assert_eq!(gain, 0.0);
    }

    #[test]
    fn reconstruction_recovers_the_true_boost() {
        let luma = 0.95;
        let boost = 15.0f32;
        let gain = ((luma * boost + OFFSET) / (luma + OFFSET)).log2();
        let reconstructed = ((luma + OFFSET) * (2.0f32).powf(gain) - OFFSET) / luma;
        assert!((reconstructed - boost).abs() / boost < 1e-4);
    }
}
