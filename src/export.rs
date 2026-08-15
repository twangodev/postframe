//! Final-render encoding for exported photographs.

use std::io::Cursor;
use std::sync::Arc;

use img_parts::jpeg::Jpeg;
use img_parts::{Bytes, ImageEXIF, ImageICC};
use rawler::decoders::{RawDecodeParams, RawMetadata};
use rawler::formats::tiff::{DirectoryWriter, TiffWriter};
use rawler::rawsource::RawSource;
use rawler::tags::{ExifTag, TiffCommonTag};

use crate::{Error, Result};

const MAX_JPEG_DIMENSION: usize = u16::MAX as usize;
const JPEG_SOI: [u8; 2] = [0xFF, 0xD8];
const TIFF_MAGIC: u16 = 42;
const TIFF_HEADER_LEN: usize = 8;
const ORIENTATION_TAG: u16 = 0x0112;
const TIFF_SHORT: u16 = 3;
const UPRIGHT: u16 = 1;

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

/// Encode the export and splice in the original photograph's metadata.
/// Absent or unreadable metadata degrades to a bare export; only encoding
/// itself can fail.
pub fn jpeg_with_metadata(
    rgba: &[u8],
    width: usize,
    height: usize,
    quality: u8,
    original: &[u8],
) -> Result<Vec<u8>> {
    let encoded = jpeg(rgba, width, height, quality)?;
    Ok(MetadataSegments::from_original(original).spliced_into(encoded))
}

/// The metadata an export carries over from its original: the EXIF payload
/// with its orientation forced upright, because exports render pixels
/// already upright, and the reassembled ICC profile.
#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub struct MetadataSegments {
    pub exif: Option<Vec<u8>>,
    pub icc: Option<Vec<u8>>,
}

impl MetadataSegments {
    pub fn from_original(original: &[u8]) -> Self {
        if original.starts_with(&JPEG_SOI) {
            Self::from_jpeg(original)
        } else {
            Self::from_raw(original)
        }
    }

    pub fn from_jpeg(original: &[u8]) -> Self {
        let Ok(parsed) = Jpeg::from_bytes(Bytes::copy_from_slice(original)) else {
            return Self::default();
        };
        Self {
            exif: parsed.exif().and_then(|exif| upright_exif(exif.to_vec())),
            icc: parsed.icc_profile().map(|profile| profile.to_vec()),
        }
    }

    pub fn from_raw(original: &[u8]) -> Self {
        Self {
            exif: raw_exif(original),
            icc: None,
        }
    }

    pub fn spliced_into(self, encoded: Vec<u8>) -> Vec<u8> {
        if self.exif.is_none() && self.icc.is_none() {
            return encoded;
        }
        let encoded = Bytes::from(encoded);
        let Ok(mut export) = Jpeg::from_bytes(encoded.clone()) else {
            return encoded.to_vec();
        };
        if let Some(exif) = self.exif {
            export.set_exif(Some(exif.into()));
        }
        if let Some(profile) = self.icc {
            export.set_icc_profile(Some(profile.into()));
        }
        export.encoder().bytes().to_vec()
    }
}

fn upright_exif(mut exif: Vec<u8>) -> Option<Vec<u8>> {
    let order = ByteOrder::of(&exif)?;
    if order.u16(&exif, 2)? != TIFF_MAGIC {
        return None;
    }
    let ifd = order.u32(&exif, 4)? as usize;
    if ifd < TIFF_HEADER_LEN {
        return None;
    }
    let entries = order.u16(&exif, ifd)? as usize;
    for index in 0..entries {
        let entry = ifd.checked_add(2 + index * 12)?;
        if order.u16(&exif, entry)? != ORIENTATION_TAG {
            continue;
        }
        if order.u16(&exif, entry + 2)? != TIFF_SHORT || order.u32(&exif, entry + 4)? != 1 {
            return None;
        }
        order.put_u16(&mut exif, entry + 8, UPRIGHT)?;
        break;
    }
    Some(exif)
}

fn raw_exif(original: &[u8]) -> Option<Vec<u8>> {
    let source = RawSource::new_from_shared_vec(Arc::new(original.to_vec()));
    let decoder = rawler::get_decoder(&source).ok()?;
    let metadata = decoder
        .raw_metadata(&source, &RawDecodeParams::default())
        .ok()?;
    upright_exif_tiff(&metadata).ok()
}

fn upright_exif_tiff(metadata: &RawMetadata) -> rawler::formats::tiff::Result<Vec<u8>> {
    let mut payload = Vec::new();
    let mut tiff = TiffWriter::new(Cursor::new(&mut payload))?;
    let mut root = DirectoryWriter::new();
    let mut exif = DirectoryWriter::new();
    metadata.write_exif_tags(&mut tiff, &mut root, &mut exif)?;
    root.remove_tag(ExifTag::Orientation);
    root.add_tag(ExifTag::Orientation, UPRIGHT);
    if !metadata.make.trim().is_empty() {
        root.add_tag(TiffCommonTag::Make, metadata.make.as_str());
    }
    if !metadata.model.trim().is_empty() {
        root.add_tag(TiffCommonTag::Model, metadata.model.as_str());
    }
    if !exif.is_empty() {
        let offset = exif.build(&mut tiff)?;
        root.add_tag(TiffCommonTag::ExifIFDPointer, offset);
    }
    tiff.build(root)?;
    Ok(payload)
}

#[derive(Clone, Copy)]
enum ByteOrder {
    Little,
    Big,
}

impl ByteOrder {
    fn of(exif: &[u8]) -> Option<Self> {
        match exif.get(..2)? {
            b"II" => Some(Self::Little),
            b"MM" => Some(Self::Big),
            _ => None,
        }
    }

    fn u16(self, bytes: &[u8], at: usize) -> Option<u16> {
        let raw = bytes.get(at..at.checked_add(2)?)?.try_into().ok()?;
        Some(match self {
            Self::Little => u16::from_le_bytes(raw),
            Self::Big => u16::from_be_bytes(raw),
        })
    }

    fn u32(self, bytes: &[u8], at: usize) -> Option<u32> {
        let raw = bytes.get(at..at.checked_add(4)?)?.try_into().ok()?;
        Some(match self {
            Self::Little => u32::from_le_bytes(raw),
            Self::Big => u32::from_be_bytes(raw),
        })
    }

    fn put_u16(self, bytes: &mut [u8], at: usize, value: u16) -> Option<()> {
        let target = bytes.get_mut(at..at.checked_add(2)?)?;
        target.copy_from_slice(&match self {
            Self::Little => value.to_le_bytes(),
            Self::Big => value.to_be_bytes(),
        });
        Some(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use img_parts::jpeg::markers;

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

    struct TiffFixture {
        little: bool,
        bytes: Vec<u8>,
    }

    impl TiffFixture {
        fn new(little: bool) -> Self {
            let mut fixture = TiffFixture {
                little,
                bytes: if little {
                    b"II".to_vec()
                } else {
                    b"MM".to_vec()
                },
            };
            fixture.u16(TIFF_MAGIC);
            fixture.u32(TIFF_HEADER_LEN as u32);
            fixture
        }

        fn u16(&mut self, value: u16) {
            self.bytes.extend(if self.little {
                value.to_le_bytes()
            } else {
                value.to_be_bytes()
            });
        }

        fn u32(&mut self, value: u32) {
            self.bytes.extend(if self.little {
                value.to_le_bytes()
            } else {
                value.to_be_bytes()
            });
        }

        fn short_entries(mut self, tags: &[(u16, u16)]) -> Vec<u8> {
            self.u16(tags.len() as u16);
            for &(tag, value) in tags {
                self.u16(tag);
                self.u16(TIFF_SHORT);
                self.u32(1);
                self.u16(value);
                self.u16(0);
            }
            self.u32(0);
            self.bytes
        }
    }

    fn exif_payload(little: bool, orientation: Option<u16>) -> Vec<u8> {
        let resolution_unit = (0x0128, 2);
        match orientation {
            Some(value) => {
                TiffFixture::new(little).short_entries(&[resolution_unit, (ORIENTATION_TAG, value)])
            }
            None => TiffFixture::new(little).short_entries(&[resolution_unit]),
        }
    }

    fn read_orientation(payload: &[u8]) -> Option<u16> {
        let order = ByteOrder::of(payload)?;
        let ifd = order.u32(payload, 4)? as usize;
        let entries = order.u16(payload, ifd)? as usize;
        (0..entries)
            .map(|index| ifd + 2 + index * 12)
            .find(|&entry| order.u16(payload, entry) == Some(ORIENTATION_TAG))
            .and_then(|entry| order.u16(payload, entry + 8))
    }

    fn export_pixels() -> [u8; 16] {
        [
            255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 255, 255,
        ]
    }

    fn original_with(exif: Option<Vec<u8>>, icc: Option<Vec<u8>>) -> Vec<u8> {
        let plain = jpeg(&export_pixels(), 2, 2, 90).unwrap();
        let mut original = Jpeg::from_bytes(plain.into()).unwrap();
        original.set_exif(exif.map(Into::into));
        original.set_icc_profile(icc.map(Into::into));
        original.encoder().bytes().to_vec()
    }

    #[test]
    fn neutralizes_orientation_in_both_byte_orders() {
        for little in [true, false] {
            let patched = upright_exif(exif_payload(little, Some(6))).unwrap();
            assert_eq!(read_orientation(&patched), Some(UPRIGHT));
        }
    }

    #[test]
    fn keeps_exif_without_an_orientation_tag_unchanged() {
        let payload = exif_payload(true, None);
        assert_eq!(upright_exif(payload.clone()), Some(payload));
    }

    #[test]
    fn drops_exif_that_does_not_parse() {
        assert_eq!(upright_exif(b"not a tiff header".to_vec()), None);
        let truncated = exif_payload(true, Some(6))[..14].to_vec();
        assert_eq!(upright_exif(truncated), None);
    }

    #[test]
    fn extracts_and_splices_exif_and_multichunk_icc() {
        let profile = vec![0xAB; 200_000];
        let original = original_with(Some(exif_payload(true, Some(8))), Some(profile.clone()));
        let parsed = Jpeg::from_bytes(original.clone().into()).unwrap();
        assert!(parsed.segments_by_marker(markers::APP2).count() > 1);

        let segments = MetadataSegments::from_original(&original);
        assert_eq!(read_orientation(segments.exif.as_ref().unwrap()), Some(1));
        assert_eq!(segments.icc.as_deref(), Some(profile.as_slice()));

        let export = jpeg_with_metadata(&export_pixels(), 2, 2, 90, &original).unwrap();
        let reparsed = Jpeg::from_bytes(export.into()).unwrap();
        assert_eq!(reparsed.exif().as_deref(), segments.exif.as_deref());
        assert_eq!(reparsed.icc_profile().as_deref(), Some(profile.as_slice()));
    }

    #[test]
    fn corrupt_exif_degrades_to_icc_only() {
        let profile = vec![0x11; 64];
        let original = original_with(Some(b"garbage".to_vec()), Some(profile.clone()));
        let export = jpeg_with_metadata(&export_pixels(), 2, 2, 90, &original).unwrap();
        let reparsed = Jpeg::from_bytes(export.into()).unwrap();
        assert_eq!(reparsed.exif(), None);
        assert_eq!(reparsed.icc_profile().as_deref(), Some(profile.as_slice()));
    }

    #[test]
    fn unreadable_originals_degrade_to_a_bare_export() {
        let bare = jpeg(&export_pixels(), 2, 2, 90).unwrap();
        for original in [&b"not an image"[..], &[0xFF, 0xD8, 0xFF]] {
            assert_eq!(
                jpeg_with_metadata(&export_pixels(), 2, 2, 90, original).unwrap(),
                bare
            );
        }
    }

    #[test]
    fn metadata_free_originals_leave_the_export_bare() {
        let bare = jpeg(&export_pixels(), 2, 2, 90).unwrap();
        let original = original_with(None, None);
        assert_eq!(
            jpeg_with_metadata(&export_pixels(), 2, 2, 90, &original).unwrap(),
            bare
        );
    }

    #[test]
    fn synthesizes_upright_exif_from_raw_metadata() {
        let metadata = RawMetadata {
            exif: rawler::exif::Exif {
                orientation: Some(6),
                iso_speed: Some(400),
                lens_model: Some("XF 35mm".into()),
                ..Default::default()
            },
            model: "X-T5".into(),
            make: "Fujifilm".into(),
            lens: None,
            unique_image_id: None,
            rating: None,
        };
        let payload = upright_exif_tiff(&metadata).unwrap();
        assert_eq!(read_orientation(&payload), Some(UPRIGHT));
        assert_eq!(upright_exif(payload.clone()), Some(payload));
    }
}
