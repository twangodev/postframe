use rawler::rawimage::BlackLevel;
use rawler::{RawImage, RawImageData};

use crate::error::{Error, Result};

#[derive(Clone)]
pub struct Linear {
    pub width: usize,
    pub height: usize,
    pub rgb: Vec<[f32; 3]>,
    pub clipped: Vec<bool>,
}

pub const CLIP_FRACTION: f32 = 0.99;

struct CfaView<'a> {
    data: &'a [u16],
    stride: usize,
    origin: (usize, usize),
    size: (usize, usize),
    black: [f32; 4],
    white: f32,
}

impl CfaView<'_> {
    fn quad_index(x: usize, y: usize) -> usize {
        (y % 2) * 2 + x % 2
    }

    fn normalized(&self, x: usize, y: usize) -> f32 {
        let q = Self::quad_index(x, y);
        let code = self.data[(self.origin.1 + y) * self.stride + self.origin.0 + x];
        (code as f32 - self.black[q]) / (self.white - self.black[q])
    }

    fn is_clipped(&self, x: usize, y: usize) -> bool {
        let q = Self::quad_index(x, y);
        let code = self.data[(self.origin.1 + y) * self.stride + self.origin.0 + x];
        code as f32 >= self.black[q] + CLIP_FRACTION * (self.white - self.black[q])
    }
}

fn view(raw: &RawImage) -> Result<CfaView<'_>> {
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
    Ok(CfaView {
        data,
        stride: raw.width,
        origin: (crop.p.x, crop.p.y),
        size: (crop.width() & !1, crop.height() & !1),
        black: quad_black(&raw.blacklevel)?,
        white: raw
            .whitelevel
            .0
            .first()
            .copied()
            .ok_or(Error::Unsupported("raw carries no white level"))? as f32,
    })
}

pub fn from_raw(raw: &RawImage) -> Result<Linear> {
    let v = view(raw)?;
    Ok(bin_rggb(
        v.data, v.stride, v.origin, v.size, v.black, v.white,
    ))
}

pub fn demosaic_full(raw: &RawImage) -> Result<Linear> {
    let v = view(raw)?;
    let (width, height) = v.size;

    let mut mosaic = vec![0.0f32; width * height];
    for y in 0..height {
        for x in 0..width {
            mosaic[y * width + x] = v.normalized(x, y);
        }
    }
    let mut planar = vec![0.0f32; 3 * width * height];
    demosaic::demosaic(
        &mosaic,
        width,
        height,
        &demosaic::CfaPattern::bayer_rggb(),
        demosaic::Algorithm::Mhc,
        &mut planar,
    )
    .map_err(|e| Error::Encode(e.to_string()))?;

    let (r, gb) = planar.split_at(width * height);
    let (g, b) = gb.split_at(width * height);
    let mut rgb = Vec::with_capacity(width * height);
    for y in 0..height {
        for x in 0..width {
            let i = y * width + x;
            rgb.push(clamp_interpolated(
                [r[i], g[i], b[i]],
                &mosaic,
                width,
                height,
                x,
                y,
            ));
        }
    }

    let mut clipped = Vec::with_capacity(width * height);
    for y in 0..height {
        let qy = y & !1;
        for x in 0..width {
            let qx = x & !1;
            clipped.push(
                v.is_clipped(qx, qy)
                    || v.is_clipped(qx + 1, qy)
                    || v.is_clipped(qx, qy + 1)
                    || v.is_clipped(qx + 1, qy + 1),
            );
        }
    }

    Ok(Linear {
        width,
        height,
        rgb,
        clipped,
    })
}

const CROSS: [(isize, isize); 4] = [(-1, 0), (1, 0), (0, -1), (0, 1)];
const DIAGONAL: [(isize, isize); 4] = [(-1, -1), (1, -1), (-1, 1), (1, 1)];
const HORIZONTAL: [(isize, isize); 2] = [(-1, 0), (1, 0)];
const VERTICAL: [(isize, isize); 2] = [(0, -1), (0, 1)];

fn clamp_interpolated(
    rgb: [f32; 3],
    mosaic: &[f32],
    width: usize,
    height: usize,
    x: usize,
    y: usize,
) -> [f32; 3] {
    let clamp = |channel: f32, offsets: &[(isize, isize)]| {
        let mut lo = f32::INFINITY;
        let mut hi = f32::NEG_INFINITY;
        for &(dx, dy) in offsets {
            let sample =
                mosaic[reflect(y as isize + dy, height) * width + reflect(x as isize + dx, width)];
            lo = lo.min(sample);
            hi = hi.max(sample);
        }
        channel.clamp(lo, hi)
    };
    let [r, g, b] = rgb;
    match (y % 2, x % 2) {
        (0, 0) => [r, clamp(g, &CROSS), clamp(b, &DIAGONAL)],
        (1, 1) => [clamp(r, &DIAGONAL), clamp(g, &CROSS), b],
        (0, 1) => [clamp(r, &HORIZONTAL), g, clamp(b, &VERTICAL)],
        _ => [clamp(r, &VERTICAL), g, clamp(b, &HORIZONTAL)],
    }
}

fn reflect(i: isize, len: usize) -> usize {
    let last = len as isize - 1;
    (if i < 0 {
        -i
    } else if i > last {
        2 * last - i
    } else {
        i
    }) as usize
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

    fn rggb_mosaic() -> Vec<f32> {
        vec![
            0.50, 0.20, 0.50, 0.30, 0.10, 0.60, 0.40, 0.60, 0.50, 0.25, 0.50, 0.35, 0.15, 0.60,
            0.45, 0.60,
        ]
    }

    #[test]
    fn clamps_interpolated_channels_to_measured_neighbors() {
        let clamped = clamp_interpolated([0.9, 2.0, -0.2], &rggb_mosaic(), 4, 4, 2, 2);
        assert_eq!(clamped[0], 0.9);
        assert_eq!(clamped[1], 0.45);
        assert_eq!(clamped[2], 0.6);
    }

    #[test]
    fn keeps_values_already_inside_the_neighbor_range() {
        let clamped = clamp_interpolated([0.9, 0.3, 0.6], &rggb_mosaic(), 4, 4, 2, 2);
        assert_eq!(clamped[1], 0.3);
        assert_eq!(clamped[2], 0.6);
    }

    #[test]
    fn reflects_at_borders_onto_same_color_sites() {
        let clamped = clamp_interpolated([0.5, 1.0, 1.0], &rggb_mosaic(), 4, 4, 0, 0);
        assert_eq!(clamped[1], 0.2);
        assert_eq!(clamped[2], 0.6);
    }

    #[test]
    fn green_sites_clamp_red_and_blue_along_their_rows() {
        let clamped = clamp_interpolated([2.0, 0.2, -1.0], &rggb_mosaic(), 4, 4, 1, 0);
        assert_eq!(clamped[0], 0.5);
        assert_eq!(clamped[1], 0.2);
        assert_eq!(clamped[2], 0.6);
    }
}
