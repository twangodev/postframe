use wasm_bindgen::prelude::*;

use super::shared::err;

#[wasm_bindgen]
pub fn encode_export_jpeg(
    rgba: Vec<u8>,
    width: u32,
    height: u32,
    quality: u8,
) -> Result<Vec<u8>, JsError> {
    crate::export::jpeg(&rgba, width as usize, height as usize, quality).map_err(err)
}
