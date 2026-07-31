//! Merges an exposure bracket into a single HDR image while preserving the
//! camera's own rendering.
//!
//! Given a raw file and its paired straight-out-of-camera JPEG, the camera's
//! rendering is a measurable function: the raw is scene-linear sensor data and
//! the JPEG is that same data rendered. Recovering that function lets the merged
//! radiance be rendered the way the camera would have, with more dynamic range
//! than any single frame in the bracket.

pub mod color;
pub mod decode;
pub mod error;
pub mod fit;

pub use color::WorkingSpace;
pub use error::{Error, Result};
pub use fit::transfer::{Report, Transfer};

use std::path::Path;

use rawler::RawImage;
use rawler::decoders::RawDecodeParams;
use rawler::imgop::xyz::Illuminant;
use rawler::rawsource::RawSource;

pub fn measure(raf: &Path, sooc_jpeg: Option<&Path>) -> Result<(Transfer, Report)> {
    let source = RawSource::new(raf)?;
    let external = sooc_jpeg.map(std::fs::read).transpose()?;
    let jpeg = match &external {
        Some(bytes) => bytes.as_slice(),
        None => embedded_jpeg(&source, raf)?,
    };
    let sooc = decode::sooc::decode(jpeg)?;

    let raw = rawler::decode(&source, &RawDecodeParams::default())?;
    let mut linear = decode::linear::from_raw(&raw)?;

    let matrix = camera_to_working(&raw, sooc.space)?;
    let balance = white_balance(&raw)?;
    for pixel in &mut linear.rgb {
        *pixel = color::apply(
            &matrix,
            [
                pixel[0] * balance[0],
                pixel[1] * balance[1],
                pixel[2] * balance[2],
            ],
        );
    }

    let pairing = fit::pair::pair(&linear, &sooc)?;
    fit::transfer::measure(&pairing, sooc.space)
}

fn embedded_jpeg<'a>(source: &'a RawSource, raf: &Path) -> Result<&'a [u8]> {
    let file_len = std::fs::metadata(raf)?.len();
    let (offset, len) =
        decode::raf::jpeg_extent(source.subview(0, decode::raf::HEADER_LEN)?, file_len)?;
    Ok(source.subview(offset, len)?)
}

fn camera_to_working(raw: &RawImage, space: WorkingSpace) -> Result<[[f32; 3]; 3]> {
    let matrix = raw
        .color_matrix
        .get(&Illuminant::D65)
        .or_else(|| raw.color_matrix.values().next())
        .ok_or(Error::Unsupported("raw carries no color matrix"))?;
    color::cam_to_working(matrix, space).ok_or(Error::Unsupported("color matrix is not 3x3"))
}

fn white_balance(raw: &RawImage) -> Result<[f32; 3]> {
    let [r, g, b, _] = raw.wb_coeffs;
    if [r, g, b].iter().any(|c| !c.is_finite()) {
        return Err(Error::Unsupported("raw carries no white balance"));
    }
    Ok([r, g, b])
}
