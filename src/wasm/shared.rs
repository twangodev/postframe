use wasm_bindgen::prelude::*;

use crate::DevelopSettings;

pub(super) fn err(error: crate::Error) -> JsError {
    JsError::new(&error.to_string())
}

pub(super) fn encode_jpeg(rgb8: &[u8], width: usize, height: usize) -> Result<Vec<u8>, JsError> {
    let mut bytes = Vec::new();
    jpeg_encoder::Encoder::new(&mut bytes, 90)
        .encode(
            rgb8,
            width as u16,
            height as u16,
            jpeg_encoder::ColorType::Rgb,
        )
        .map_err(|e| JsError::new(&e.to_string()))?;
    Ok(bytes)
}

pub(super) fn develop_settings(settings: JsValue) -> Result<DevelopSettings, JsError> {
    serde_wasm_bindgen::from_value::<DevelopSettings>(settings)
        .map_err(|error| JsError::new(&error.to_string()))?
        .validated()
        .map_err(err)
}
