use wasm_bindgen::prelude::*;

use super::shared::{develop_settings, err};
use crate::{
    DevelopTransform, DevelopedTileCompositor as CoreDevelopedTileCompositor, DevelopedTileRegion,
    LocalAdjustment, MaskPlane,
};

#[wasm_bindgen]
pub struct DisplayTransform {
    develop: DevelopTransform,
}

#[wasm_bindgen]
impl DisplayTransform {
    #[wasm_bindgen(constructor)]
    pub fn new(settings: JsValue) -> Result<DisplayTransform, JsError> {
        Ok(Self {
            develop: DevelopTransform::new(develop_settings(settings)?).map_err(err)?,
        })
    }

    pub fn apply_rgba(&self, rgba: Vec<u8>) -> Result<Vec<u8>, JsError> {
        self.develop.apply_display_rgba8(&rgba).map_err(err)
    }

    #[wasm_bindgen(getter)]
    pub fn luminance_lut(&self) -> Vec<f32> {
        self.develop.luminance_lut().to_vec()
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
    pub fn new(
        mask: Vec<u8>,
        mask_width: u32,
        mask_height: u32,
        settings: JsValue,
    ) -> Result<DevelopedTileCompositor, JsError> {
        let mask = MaskPlane::new(mask_width as usize, mask_height as usize, mask).map_err(err)?;
        let settings = develop_settings(settings)?;
        Ok(Self {
            compositor: CoreDevelopedTileCompositor,
            adjustment: LocalAdjustment::new(mask, settings.light, settings.color).map_err(err)?,
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
