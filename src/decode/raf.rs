use crate::error::{Error, Result};

pub const HEADER_LEN: u64 = 92;

const MAGIC: &[u8; 8] = b"FUJIFILM";
const JPEG_OFFSET_AT: usize = 84;
const JPEG_LEN_AT: usize = 88;

pub fn jpeg_extent(header: &[u8], file_len: u64) -> Result<(u64, u64)> {
    if header.len() < HEADER_LEN as usize || &header[..MAGIC.len()] != MAGIC {
        return Err(Error::Unsupported("not a RAF file"));
    }
    let field = |at: usize| u32::from_be_bytes(header[at..at + 4].try_into().unwrap()) as u64;
    let (offset, len) = (field(JPEG_OFFSET_AT), field(JPEG_LEN_AT));
    if offset == 0 || len == 0 || offset + len > file_len {
        return Err(Error::Unsupported("RAF header holds no embedded jpeg"));
    }
    Ok((offset, len))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn header(offset: u32, len: u32) -> Vec<u8> {
        let mut h = vec![0; HEADER_LEN as usize];
        h[..8].copy_from_slice(MAGIC);
        h[JPEG_OFFSET_AT..JPEG_OFFSET_AT + 4].copy_from_slice(&offset.to_be_bytes());
        h[JPEG_LEN_AT..JPEG_LEN_AT + 4].copy_from_slice(&len.to_be_bytes());
        h
    }

    #[test]
    fn reads_offset_and_length() {
        assert_eq!(jpeg_extent(&header(148, 1000), 2000).unwrap(), (148, 1000));
    }

    #[test]
    fn rejects_wrong_magic_and_out_of_bounds() {
        assert!(jpeg_extent(&[0u8; 92], 2000).is_err());
        assert!(jpeg_extent(&header(148, 1000), 500).is_err());
        assert!(jpeg_extent(&header(0, 0), 2000).is_err());
    }
}
