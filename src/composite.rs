use crate::{ColorSettings, ColorTransform, Error, LightSettings, LightTransform, Result};

#[derive(Clone, Debug, PartialEq)]
pub struct MaskPlane {
    width: usize,
    height: usize,
    alpha: Vec<u8>,
}

impl MaskPlane {
    pub fn new(width: usize, height: usize, alpha: Vec<u8>) -> Result<Self> {
        if width == 0 || height == 0 || width.checked_mul(height) != Some(alpha.len()) {
            return Err(Error::Unsupported(
                "mask dimensions do not match its pixels",
            ));
        }
        Ok(Self {
            width,
            height,
            alpha,
        })
    }

    fn sample(&self, x: f32, y: f32) -> f32 {
        let x = (x * self.width as f32 - 0.5).clamp(0.0, self.width.saturating_sub(1) as f32);
        let y = (y * self.height as f32 - 0.5).clamp(0.0, self.height.saturating_sub(1) as f32);
        let left = x.floor() as usize;
        let top = y.floor() as usize;
        let right = (left + 1).min(self.width - 1);
        let bottom = (top + 1).min(self.height - 1);
        let horizontal = x - left as f32;
        let vertical = y - top as f32;
        let top_alpha = mix(
            self.alpha[top * self.width + left] as f32,
            self.alpha[top * self.width + right] as f32,
            horizontal,
        );
        let bottom_alpha = mix(
            self.alpha[bottom * self.width + left] as f32,
            self.alpha[bottom * self.width + right] as f32,
            horizontal,
        );
        mix(top_alpha, bottom_alpha, vertical) / 255.0
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct DevelopedTileRegion {
    pub image_width: usize,
    pub image_height: usize,
    pub x: usize,
    pub y: usize,
    pub width: usize,
    pub height: usize,
}

impl DevelopedTileRegion {
    fn validate(self, tile_width: usize, tile_height: usize) -> Result<Self> {
        let valid_region = self.image_width > 0
            && self.image_height > 0
            && self.width > 0
            && self.height > 0
            && self.x < self.image_width
            && self.y < self.image_height
            && self.x.saturating_add(self.width) <= self.image_width
            && self.y.saturating_add(self.height) <= self.image_height;
        if !valid_region || tile_width == 0 || tile_height == 0 {
            return Err(Error::Unsupported("developed tile region is invalid"));
        }
        Ok(self)
    }
}

#[derive(Clone)]
pub struct LocalAdjustment {
    mask: MaskPlane,
    light: LightTransform,
    color: ColorTransform,
}

impl LocalAdjustment {
    pub fn new(mask: MaskPlane, light: LightSettings, color: ColorSettings) -> Result<Self> {
        Ok(Self {
            mask,
            light: LightTransform::new(light)?,
            color: ColorTransform::new(color)?,
        })
    }

    fn adjust_pixel(&self, pixel: [u8; 3]) -> [u8; 3] {
        self.light
            .apply_display_pixel(self.color.apply_display_pixel(pixel))
    }
}

#[derive(Default)]
pub struct DevelopedTileCompositor;

impl DevelopedTileCompositor {
    pub fn composite(
        &self,
        rgba: &[u8],
        tile_width: usize,
        tile_height: usize,
        region: DevelopedTileRegion,
        adjustments: &[LocalAdjustment],
    ) -> Result<Vec<u8>> {
        if rgba.len() != tile_width.saturating_mul(tile_height).saturating_mul(4) {
            return Err(Error::Unsupported(
                "developed tile dimensions do not match its pixels",
            ));
        }
        let region = region.validate(tile_width, tile_height)?;
        if adjustments.is_empty() {
            return Ok(rgba.to_vec());
        }

        let mut composited = rgba.to_vec();
        for adjustment in adjustments {
            for output_y in 0..tile_height {
                let image_y = region.y as f32
                    + (output_y as f32 + 0.5) * region.height as f32 / tile_height as f32;
                for output_x in 0..tile_width {
                    let image_x = region.x as f32
                        + (output_x as f32 + 0.5) * region.width as f32 / tile_width as f32;
                    let alpha = adjustment.mask.sample(
                        image_x / region.image_width as f32,
                        image_y / region.image_height as f32,
                    );
                    if alpha <= 0.0 {
                        continue;
                    }
                    let index = (output_y * tile_width + output_x) * 4;
                    let source = [
                        composited[index],
                        composited[index + 1],
                        composited[index + 2],
                    ];
                    let adjusted = adjustment.adjust_pixel(source);
                    for channel in 0..3 {
                        composited[index + channel] =
                            mix(source[channel] as f32, adjusted[channel] as f32, alpha)
                                .round()
                                .clamp(0.0, 255.0) as u8;
                    }
                }
            }
        }
        Ok(composited)
    }
}

fn mix(left: f32, right: f32, weight: f32) -> f32 {
    left + (right - left) * weight
}

#[cfg(test)]
mod tests {
    use super::*;

    fn region(width: usize, height: usize) -> DevelopedTileRegion {
        DevelopedTileRegion {
            image_width: width,
            image_height: height,
            x: 0,
            y: 0,
            width,
            height,
        }
    }

    #[test]
    fn no_adjustments_preserve_every_developed_byte() {
        let rgba = [12, 34, 56, 78, 90, 123, 210, 45];
        let output = DevelopedTileCompositor
            .composite(&rgba, 2, 1, region(2, 1), &[])
            .unwrap();
        assert_eq!(output, rgba);
    }

    #[test]
    fn applies_light_only_through_the_mask() {
        let rgba = [64, 64, 64, 255, 64, 64, 64, 255];
        let mask = MaskPlane::new(2, 1, vec![0, 255]).unwrap();
        let adjustment = LocalAdjustment::new(
            mask,
            LightSettings {
                exposure: 1.0,
                ..LightSettings::NEUTRAL
            },
            ColorSettings::NEUTRAL,
        )
        .unwrap();
        let output = DevelopedTileCompositor
            .composite(&rgba, 2, 1, region(2, 1), &[adjustment])
            .unwrap();
        assert_eq!(&output[..4], &rgba[..4]);
        assert!(output[4] > rgba[4]);
        assert_eq!(output[7], rgba[7]);
    }

    #[test]
    fn blends_soft_masks_and_ordered_adjustments() {
        let rgba = [96, 96, 96, 137];
        let mask = MaskPlane::new(1, 1, vec![128]).unwrap();
        let brighter = LocalAdjustment::new(
            mask.clone(),
            LightSettings {
                exposure: 1.0,
                ..LightSettings::NEUTRAL
            },
            ColorSettings::NEUTRAL,
        )
        .unwrap();
        let darker = LocalAdjustment::new(
            mask,
            LightSettings {
                exposure: -1.0,
                ..LightSettings::NEUTRAL
            },
            ColorSettings::NEUTRAL,
        )
        .unwrap();
        let once = DevelopedTileCompositor
            .composite(&rgba, 1, 1, region(1, 1), std::slice::from_ref(&brighter))
            .unwrap();
        let twice = DevelopedTileCompositor
            .composite(&rgba, 1, 1, region(1, 1), &[brighter, darker])
            .unwrap();
        assert!(once[0] > rgba[0]);
        assert!(twice[0] < once[0]);
        assert_eq!(twice[3], rgba[3]);
    }

    #[test]
    fn masked_color_matches_the_global_transform_under_a_full_mask() {
        let rgba = [180, 120, 60, 255, 32, 96, 200, 137, 128, 128, 128, 9];
        let color = ColorSettings {
            temperature: 60.0,
            tint: -25.0,
            vibrance: 40.0,
            saturation: 30.0,
        };
        let full = MaskPlane::new(3, 1, vec![255; 3]).unwrap();
        let adjustment = LocalAdjustment::new(full, LightSettings::NEUTRAL, color).unwrap();
        let masked = DevelopedTileCompositor
            .composite(&rgba, 3, 1, region(3, 1), &[adjustment])
            .unwrap();
        let global = ColorTransform::new(color)
            .unwrap()
            .apply_display_rgba8(&rgba)
            .unwrap();
        assert_eq!(masked, global);
    }

    #[test]
    fn color_leaves_zero_alpha_regions_untouched() {
        let rgba = [180, 120, 60, 255, 180, 120, 60, 255];
        let mask = MaskPlane::new(2, 1, vec![0, 255]).unwrap();
        let adjustment = LocalAdjustment::new(
            mask,
            LightSettings::NEUTRAL,
            ColorSettings {
                saturation: -100.0,
                ..ColorSettings::NEUTRAL
            },
        )
        .unwrap();
        let output = DevelopedTileCompositor
            .composite(&rgba, 2, 1, region(2, 1), &[adjustment])
            .unwrap();
        assert_eq!(&output[..4], &rgba[..4]);
        assert_eq!(output[4], output[5]);
        assert_eq!(output[5], output[6]);
        assert_eq!(output[7], rgba[7]);
    }

    #[test]
    fn neutral_color_reproduces_the_light_only_pipeline_exactly() {
        let rgba = [12, 200, 96, 255, 240, 16, 180, 41];
        let light = LightSettings {
            exposure: 0.75,
            contrast: 40.0,
            ..LightSettings::NEUTRAL
        };
        let full = MaskPlane::new(2, 1, vec![255; 2]).unwrap();
        let adjustment = LocalAdjustment::new(full, light, ColorSettings::NEUTRAL).unwrap();
        let masked = DevelopedTileCompositor
            .composite(&rgba, 2, 1, region(2, 1), &[adjustment])
            .unwrap();
        let light_only = LightTransform::new(light)
            .unwrap()
            .apply_display_rgba8(&rgba)
            .unwrap();
        assert_eq!(masked, light_only);
    }

    #[test]
    fn rejects_mismatched_buffers_and_masks() {
        assert!(MaskPlane::new(2, 2, vec![0; 3]).is_err());
        assert!(
            DevelopedTileCompositor
                .composite(&[0; 7], 2, 1, region(2, 1), &[])
                .is_err()
        );
    }
}
