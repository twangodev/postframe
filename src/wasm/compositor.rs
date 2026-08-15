use wasm_bindgen::prelude::*;

use super::shared::{err, light_settings};
use crate::{
    ColorSettings, DevelopedTileCompositor as CoreDevelopedTileCompositor, DevelopedTileRegion,
    LightTransform, LocalAdjustment, MaskPlane,
};

#[wasm_bindgen]
pub struct DisplayTransform {
    light: LightTransform,
}

#[wasm_bindgen]
impl DisplayTransform {
    #[wasm_bindgen(constructor)]
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        exposure: f32,
        contrast: f32,
        highlights: f32,
        shadows: f32,
        whites: f32,
        blacks: f32,
    ) -> Result<DisplayTransform, JsError> {
        Ok(Self {
            light: LightTransform::new(light_settings(
                exposure, contrast, highlights, shadows, whites, blacks,
            ))
            .map_err(err)?,
        })
    }

    pub fn apply_rgba(&self, rgba: Vec<u8>) -> Result<Vec<u8>, JsError> {
        self.light.apply_display_rgba8(&rgba).map_err(err)
    }

    #[wasm_bindgen(getter)]
    pub fn luminance_lut(&self) -> Vec<f32> {
        self.light.luminance_lut().to_vec()
    }
}

#[wasm_bindgen]
pub struct DevelopedTileCompositor {
    compositor: CoreDevelopedTileCompositor,
    adjustment: LocalAdjustment,
}

#[wasm_bindgen]
impl DevelopedTileCompositor {
    #[wasm_bindgen(constructor)]
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        mask: Vec<u8>,
        mask_width: u32,
        mask_height: u32,
        exposure: f32,
        contrast: f32,
        highlights: f32,
        shadows: f32,
        whites: f32,
        blacks: f32,
        temperature: f32,
        tint: f32,
        vibrance: f32,
        saturation: f32,
    ) -> Result<DevelopedTileCompositor, JsError> {
        let mask = MaskPlane::new(mask_width as usize, mask_height as usize, mask).map_err(err)?;
        let light = light_settings(exposure, contrast, highlights, shadows, whites, blacks);
        let color = ColorSettings {
            temperature,
            tint,
            vibrance,
            saturation,
        };
        Ok(Self {
            compositor: CoreDevelopedTileCompositor,
            adjustment: LocalAdjustment::new(mask, light, color).map_err(err)?,
        })
    }

    #[allow(clippy::too_many_arguments)]
    pub fn composite_rgba(
        &self,
        rgba: Vec<u8>,
        tile_width: u32,
        tile_height: u32,
        image_width: u32,
        image_height: u32,
        x: u32,
        y: u32,
        width: u32,
        height: u32,
    ) -> Result<Vec<u8>, JsError> {
        self.compositor
            .composite(
                &rgba,
                tile_width as usize,
                tile_height as usize,
                DevelopedTileRegion {
                    image_width: image_width as usize,
                    image_height: image_height as usize,
                    x: x as usize,
                    y: y as usize,
                    width: width as usize,
                    height: height as usize,
                },
                std::slice::from_ref(&self.adjustment),
            )
            .map_err(err)
    }
}
