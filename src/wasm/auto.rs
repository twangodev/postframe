use wasm_bindgen::prelude::*;

use super::shared::err;
use crate::light::decode_srgb;

/// The temperature and tint that neutralise an encoded sRGB colour, or nothing
/// when a channel is empty.
#[wasm_bindgen]
pub fn neutralizing_balance(red: f32, green: f32, blue: f32) -> Option<Vec<f32>> {
    crate::auto::neutralizing_balance([red, green, blue].map(decode_srgb))
        .map(|(temperature, tint)| vec![temperature, tint])
}

/// The grey-world temperature and tint for an encoded RGBA image.
#[wasm_bindgen]
pub fn auto_white_balance(rgba: Vec<u8>, width: u32, height: u32) -> Result<Vec<f32>, JsError> {
    crate::auto::auto_white_balance(&rgba, width as usize, height as usize)
        .map(|(temperature, tint)| vec![temperature, tint])
        .map_err(err)
}

/// Light settings that bring an encoded RGBA image's tones to their targets.
#[wasm_bindgen]
pub fn auto_tone(rgba: Vec<u8>, width: u32, height: u32) -> Result<JsValue, JsError> {
    let light = crate::auto::auto_tone(&rgba, width as usize, height as usize).map_err(err)?;
    serde_wasm_bindgen::to_value(&light).map_err(|error| JsError::new(&error.to_string()))
}
