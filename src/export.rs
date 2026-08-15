//! Final-render encoding for exported photographs.

use crate::{Error, Result};

const MAX_JPEG_DIMENSION: usize = u16::MAX as usize;

pub fn jpeg(rgba: &[u8], width: usize, height: usize, quality: u8) -> Result<Vec<u8>> {
    if !(1..=100).contains(&quality) {
        return Err(Error::Unsupported("jpeg quality must be between 1 and 100"));
    }
    if width == 0 || height == 0 {
        return Err(Error::Unsupported("jpeg dimensions must be non-zero"));
    }
    if width > MAX_JPEG_DIMENSION || height > MAX_JPEG_DIMENSION {
        return Err(Error::Unsupported(
            "jpeg dimensions exceed the format limit",
        ));
    }
    if rgba.len() != width * height * 4 {
        return Err(Error::Unsupported("RGBA buffer size mismatch"));
    }
    let mut bytes = Vec::new();
    jpeg_encoder::Encoder::new(&mut bytes, quality)
        .encode(
            rgba,
            width as u16,
            height as u16,
            jpeg_encoder::ColorType::Rgba,
        )
        .map_err(|e| Error::Encode(e.to_string()))?;
    Ok(bytes)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn encodes_rgba_pixels_as_jpeg() {
        let rgba = [
            255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 255, 255,
        ];
        let bytes = jpeg(&rgba, 2, 2, 90).unwrap();
        assert_eq!(bytes[..2], [0xFF, 0xD8]);
        assert_eq!(bytes[bytes.len() - 2..], [0xFF, 0xD9]);
    }

    #[test]
    fn rejects_invalid_quality() {
        let rgba = [0; 4];
        assert!(jpeg(&rgba, 1, 1, 0).is_err());
        assert!(jpeg(&rgba, 1, 1, 101).is_err());
    }

    #[test]
    fn rejects_mismatched_dimensions() {
        assert!(jpeg(&[0; 4], 0, 1, 90).is_err());
        assert!(jpeg(&[0; 4], 2, 2, 90).is_err());
        assert!(jpeg(&[0; 8], 70_000, 1, 90).is_err());
    }
}
