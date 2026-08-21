use ultrahdr_rs::{Encoder, GainMapMetadata};

use crate::bracket::Merged;
use crate::color::WorkingSpace;
use crate::error::{Error, Result};
use crate::fit::transfer::Transfer;
use crate::light::srgb_to_linear;

pub struct UltraHdr {
    pub bytes: Vec<u8>,
    pub boost_stops: f32,
}

const OFFSET: f32 = 1.0 / 64.0;
const BASE_QUALITY: u8 = 92;
const MAP_QUALITY: u8 = 90;
const MIN_MEANINGFUL_STOPS: f32 = 0.05;

pub fn encode(merged: &Merged, transfer: &Transfer) -> Result<UltraHdr> {
    if merged.space != WorkingSpace::LinearSrgb {
        return Err(Error::Unsupported(
            "ultra hdr output requires an sRGB bracket",
        ));
    }
    let base = merged.render_with(transfer, 0.0);
    let (width, height) = (base.width, base.height);

    let gains: Vec<f32> = merged
        .radiance
        .rgb
        .iter()
        .zip(base.rgb8.as_chunks::<3>().0)
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

    let bytes = container(base_jpeg, map_jpeg, boost_stops)?;
    Ok(UltraHdr { bytes, boost_stops })
}

fn container(base_jpeg: Vec<u8>, map_jpeg: Vec<u8>, boost_stops: f32) -> Result<Vec<u8>> {
    let mut metadata = GainMapMetadata::default();
    metadata.gain_map_max = [boost_stops as f64; 3];
    metadata.alternate_hdr_headroom = boost_stops as f64;

    let mut encoder = Encoder::new();
    encoder
        .set_base_jpeg(base_jpeg)
        .set_gainmap_jpeg(map_jpeg, metadata);
    encoder
        .encode_from_jpegs()
        .map_err(|e| Error::Encode(e.to_string()))
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
