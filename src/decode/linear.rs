use rawler::rawimage::BlackLevel;
use rawler::{RawImage, RawImageData};

use crate::error::{Error, Result};

pub struct Linear {
    pub width: usize,
    pub height: usize,
    pub rgb: Vec<[f32; 3]>,
    pub clipped: Vec<bool>,
}

pub const CLIP_FRACTION: f32 = 0.99;

pub fn from_raw(raw: &RawImage) -> Result<Linear> {
    let RawImageData::Integer(data) = &raw.data else {
        return Err(Error::Unsupported("floating point raw data"));
    };
    if raw.cpp != 1 || raw.camera.cfa.name != "RGGB" {
        return Err(Error::Unsupported("only RGGB bayer sensors are supported"));
    }
    let crop = raw
        .crop_area
        .ok_or(Error::Unsupported("raw carries no crop area"))?;
    if crop.p.x % 2 != 0 || crop.p.y % 2 != 0 {
        return Err(Error::Unsupported("crop origin breaks the RGGB phase"));
    }
    let black = quad_black(&raw.blacklevel)?;
    let white = raw
        .whitelevel
        .0
        .first()
        .copied()
        .ok_or(Error::Unsupported("raw carries no white level"))? as f32;
    Ok(bin_rggb(
        data,
        raw.width,
        (crop.p.x, crop.p.y),
        (crop.width() & !1, crop.height() & !1),
        black,
        white,
    ))
}

fn quad_black(black: &BlackLevel) -> Result<[f32; 4]> {
    let levels = black.levels.iter().map(|l| l.as_f32()).collect::<Vec<_>>();
    match (black.cpp, black.width, black.height, levels.len()) {
        (1, 2, 2, 4) => Ok([levels[0], levels[1], levels[2], levels[3]]),
        (1, 1, 1, 1) => Ok([levels[0]; 4]),
        _ => Err(Error::Unsupported("unexpected black level layout")),
    }
}

pub fn bin_rggb(
    data: &[u16],
    stride: usize,
    (x0, y0): (usize, usize),
    (width, height): (usize, usize),
    black: [f32; 4],
    white: f32,
) -> Linear {
    let (out_w, out_h) = (width / 2, height / 2);
    let mut rgb = Vec::with_capacity(out_w * out_h);
    let mut clipped = Vec::with_capacity(out_w * out_h);
    let norm = |q: usize, code: u16| (code as f32 - black[q]) / (white - black[q]);
    let clip = |q: usize, code: u16| code as f32 >= black[q] + CLIP_FRACTION * (white - black[q]);
    for by in 0..out_h {
        let top = (y0 + 2 * by) * stride + x0;
        for bx in 0..out_w {
            let i = top + 2 * bx;
            let quad = [data[i], data[i + 1], data[i + stride], data[i + stride + 1]];
            rgb.push([
                norm(0, quad[0]),
                (norm(1, quad[1]) + norm(2, quad[2])) / 2.0,
                norm(3, quad[3]),
            ]);
            clipped.push((0..4).any(|q| clip(q, quad[q])));
        }
    }
    Linear {
        width: out_w,
        height: out_h,
        rgb,
        clipped,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bins_quads_preserving_negatives_and_flagging_hidden_clips() {
        let stride = 6;
        let mut data = vec![0u16; stride * 4];
        let quad = |d: &mut [u16], x: usize, y: usize, v: [u16; 4]| {
            d[y * stride + x] = v[0];
            d[y * stride + x + 1] = v[1];
            d[(y + 1) * stride + x] = v[2];
            d[(y + 1) * stride + x + 1] = v[3];
        };
        quad(&mut data, 2, 0, [164, 264, 364, 464]);
        quad(&mut data, 4, 0, [32, 164, 164, 164]);
        quad(&mut data, 2, 2, [164, 1060, 64, 164]);

        let out = bin_rggb(&data, stride, (2, 0), (4, 4), [64.0; 4], 1064.0);

        assert_eq!((out.width, out.height), (2, 2));
        assert_eq!(out.rgb[0], [0.1, 0.25, 0.4]);
        assert!(out.rgb[1][0] < 0.0);
        assert!(!out.clipped[0] && !out.clipped[1]);
        assert!(out.clipped[2], "one clipped green must flag the whole quad");
        assert_eq!(out.rgb[2][1], (0.996 + 0.0) / 2.0);
    }
}
