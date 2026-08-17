use wasm_bindgen::prelude::*;

use super::shared::{develop_settings, err, tile_region, vignette_frame};
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
    pub fn new(settings: JsValue, crop: JsValue) -> Result<DisplayTransform, JsError> {
        Ok(Self {
            develop: DevelopTransform::framed(develop_settings(settings)?, vignette_frame(crop)?)
                .map_err(err)?,
        })
    }

    pub fn apply_rgba(&self, rgba: Vec<u8>, width: u32, height: u32) -> Result<Vec<u8>, JsError> {
        let (width, height) = (width as usize, height as usize);
        self.develop
            .apply_display_rgba8_at(
                &rgba,
                (width, height),
                DevelopedTileRegion {
                    image_width: width,
                    image_height: height,
                    x: 0,
                    y: 0,
                    width,
                    height,
                },
            )
            .map_err(err)
    }

    /// Develop one tile of a display document, told where in the image it sits.
    pub fn apply_tile_rgba(
        &self,
        rgba: Vec<u8>,
        tile_width: u32,
        tile_height: u32,
        region: JsValue,
    ) -> Result<Vec<u8>, JsError> {
        self.develop
            .apply_display_rgba8_at(
                &rgba,
                (tile_width as usize, tile_height as usize),
                tile_region(region)?,
            )
            .map_err(err)
    }

    #[wasm_bindgen(getter)]
    pub fn luminance_lut(&self) -> Vec<f32> {
        self.develop.luminance_lut().to_vec()
    }

    /// The red, green and blue curves back to back, empty while all three are
    /// the identity.
    #[wasm_bindgen(getter)]
    pub fn channel_luts(&self) -> Vec<f32> {
        self.develop
            .channel_luts()
            .map(|luts| luts.concat())
            .unwrap_or_default()
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
