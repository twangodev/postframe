//! Merges an exposure bracket into a single HDR image while preserving the
//! camera's own rendering.
//!
//! Given a raw file and its paired straight-out-of-camera JPEG, the camera's
//! rendering is a measurable function: the raw is scene-linear sensor data and
//! the JPEG is that same data rendered. Recovering that function lets the merged
//! radiance be rendered the way the camera would have, with more dynamic range
//! than any single frame in the bracket.

pub mod bracket;
pub mod color;
pub mod decode;
pub mod error;
pub mod fit;

pub use bracket::{MergeReport, Rendered};
pub use color::WorkingSpace;
pub use error::{Error, Result};
pub use fit::transfer::{Report, Transfer};

use std::path::Path;

pub fn measure(raf: &Path, sooc_jpeg: Option<&Path>) -> Result<(Transfer, Report)> {
    let mut frame = bracket::load(raf, sooc_jpeg)?;
    let matrix = bracket::to_working(&frame, frame.sooc.space)?;
    let balance = frame.balance;
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
    let pairing = fit::pair::pair(&frame.camera, &frame.sooc)?;
    fit::transfer::measure(&pairing, frame.sooc.space)
}

pub fn merge(pairs: &[(&Path, Option<&Path>)], ev: f32) -> Result<(Rendered, MergeReport)> {
    let frames = pairs
        .iter()
        .map(|(raf, jpeg)| bracket::load(raf, *jpeg))
        .collect::<Result<Vec<_>>>()?;
    bracket::merge(frames, ev)
}
