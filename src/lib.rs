//! Post-processing built on your JPEGs.
//!
//! Given a raw file and its paired straight-out-of-camera JPEG, the camera's
//! rendering is a measurable function: the raw is scene-linear sensor data and
//! the JPEG is that same data rendered. Recovering that function lets anything
//! computed from the raw — merged HDR radiance first — be rendered the way the
//! camera would have rendered it.

pub mod bracket;
mod cache;
pub mod color;
pub mod composite;
pub mod decode;
pub mod error;
pub mod export;
pub mod fit;
pub mod grade;
pub mod hdr;
pub mod light;
pub mod preview;
pub mod scope;
#[cfg(feature = "wasm")]
mod wasm;

pub use bracket::{FrameData, MergeReport, Merged, Rendered};
pub use color::WorkingSpace;
pub use composite::{DevelopedTileCompositor, DevelopedTileRegion, LocalAdjustment, MaskPlane};
pub use error::{Error, Result};
pub use fit::transfer::{Report, Transfer};
pub use grade::{ColorSettings, ColorTransform};
pub use hdr::UltraHdr;
pub use light::{LightSettings, LightTransform};
pub use preview::Preview;
pub use scope::ImageScope;

#[cfg(all(feature = "wasm-threads", target_arch = "wasm32"))]
pub use wasm_bindgen_rayon::init_thread_pool;

pub fn measure(data: &FrameData) -> Result<(Transfer, Report)> {
    let mut frame = bracket::load(data)?;
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

pub fn merge(frames: &[FrameData]) -> Result<Merged> {
    bracket::merge(
        frames
            .iter()
            .map(bracket::load_full)
            .collect::<Result<_>>()?,
    )
}

pub fn merge_preview(frames: &[FrameData]) -> Result<Merged> {
    bracket::merge(frames.iter().map(bracket::load).collect::<Result<_>>()?)
}
