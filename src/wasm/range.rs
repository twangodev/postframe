use wasm_bindgen::prelude::*;

use super::shared::{err, from_value};
use crate::range::{ColorRange, LuminanceRange, color_range_alpha, luminance_range_alpha};

/// One alpha byte per pixel: how far each RGBA pixel's luma falls inside a luminance range.
#[wasm_bindgen]
pub fn luminance_range_mask(
    rgba: Vec<u8>,
    width: u32,
    height: u32,
    range: JsValue,
) -> Result<Vec<u8>, JsError> {
    let range = from_value::<LuminanceRange>(range)?
        .validated()
        .map_err(err)?;
    luminance_range_alpha(&rgba, width as usize, height as usize, &range).map_err(err)
}

/// One alpha byte per pixel: how far each RGBA pixel's hue and chroma fall inside a colour range.
#[wasm_bindgen]
pub fn color_range_mask(
    rgba: Vec<u8>,
    width: u32,
    height: u32,
    range: JsValue,
) -> Result<Vec<u8>, JsError> {
    let range = from_value::<ColorRange>(range)?.validated().map_err(err)?;
    color_range_alpha(&rgba, width as usize, height as usize, &range).map_err(err)
}
