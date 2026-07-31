use std::io::Cursor;

use rawler::formats::tiff::IFD;
use rawler::formats::tiff::reader::{GenericTiffReader, TiffReader};
use rawler::tags::{ExifTag, TiffCommonTag};
use zune_jpeg::JpegDecoder;
use zune_jpeg::zune_core::bytestream::ZCursor;
use zune_jpeg::zune_core::colorspace::ColorSpace;
use zune_jpeg::zune_core::options::DecoderOptions;

use crate::color::WorkingSpace;
use crate::error::{Error, Result};

pub struct Sooc {
    pub width: usize,
    pub height: usize,
    pub rgb8: Vec<u8>,
    pub space: WorkingSpace,
}

pub fn decode(jpeg: &[u8]) -> Result<Sooc> {
    let options = DecoderOptions::default().jpeg_set_out_colorspace(ColorSpace::RGB);
    let mut decoder = JpegDecoder::new_with_options(ZCursor::new(jpeg), options);
    decoder.decode_headers()?;
    let info = decoder
        .info()
        .ok_or(Error::Unsupported("jpeg reports no dimensions"))?;
    let size = decoder
        .output_buffer_size()
        .ok_or(Error::Unsupported("jpeg reports no buffer size"))?;
    let mut rgb8 = vec![0; size];
    decoder.decode_into(&mut rgb8)?;
    let space = decoder
        .exif()
        .and_then(|tiff| working_space(tiff))
        .unwrap_or(WorkingSpace::LinearSrgb);
    Ok(Sooc {
        width: info.width as usize,
        height: info.height as usize,
        rgb8,
        space,
    })
}

const EXIF_ADOBE_RGB: u16 = 2;
const EXIF_SRGB: u16 = 1;
const INTEROP_ADOBE_RGB: &str = "R03";

fn working_space(exif_tiff: &[u8]) -> Option<WorkingSpace> {
    let mut cursor = Cursor::new(exif_tiff);
    let tiff = GenericTiffReader::new(&mut cursor, 0, 0, None, &[]).ok()?;
    let exif = tiff
        .root_ifd()
        .sub_ifds()
        .get(&(TiffCommonTag::ExifIFDPointer as u16))?
        .first()?;
    match exif.get_entry(ExifTag::ColorSpace)?.value.force_u16(0) {
        EXIF_SRGB => Some(WorkingSpace::LinearSrgb),
        EXIF_ADOBE_RGB => Some(WorkingSpace::LinearAdobeRgb),
        _ => interop_space(exif_tiff, exif),
    }
}

fn interop_space(exif_tiff: &[u8], exif: &IFD) -> Option<WorkingSpace> {
    let offset = exif.get_entry(ExifTag::InteropOffset)?.value.force_u32(0);
    let mut cursor = Cursor::new(exif_tiff);
    let interop = IFD::new(&mut cursor, offset, exif.base, exif.corr, exif.endian, &[]).ok()?;
    let index = interop
        .get_entry(ExifTag::InteropIndex)?
        .value
        .as_string()?
        .clone();
    match index.trim_end_matches('\0') {
        INTEROP_ADOBE_RGB => Some(WorkingSpace::LinearAdobeRgb),
        _ => Some(WorkingSpace::LinearSrgb),
    }
}
