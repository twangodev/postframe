use wasm_bindgen::prelude::*;

use crate::LightSettings;

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

pub(super) fn light_settings(
    exposure: f32,
    contrast: f32,
    highlights: f32,
    shadows: f32,
    whites: f32,
    blacks: f32,
) -> LightSettings {
    LightSettings {
        exposure,
        contrast,
        highlights,
        shadows,
        whites,
        blacks,
    }
}
