use wasm_bindgen::prelude::*;

use super::shared::err;

#[wasm_bindgen]
pub fn encode_export_jpeg(
    rgba: Vec<u8>,
    width: u32,
    height: u32,
    quality: u8,
    original: Option<Vec<u8>>,
) -> Result<Vec<u8>, JsError> {
    let (width, height) = (width as usize, height as usize);
    match original {
        Some(original) => {
            crate::export::jpeg_with_metadata(&rgba, width, height, quality, &original)
        }
        None => crate::export::jpeg(&rgba, width, height, quality),
    }
    .map_err(err)
}
