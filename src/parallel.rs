//! Pixel-loop drivers that run serially by default and fan out across the
//! rayon pool under the `parallel` feature. Every caller shares one loop body
//! with both modes, so the schedules differ only here.

#[cfg(feature = "parallel")]
use rayon::prelude::*;

pub(crate) fn for_each_pixel<T: Send>(pixels: &mut [T], apply: impl Fn(&mut T) + Send + Sync) {
    #[cfg(feature = "parallel")]
    pixels.par_iter_mut().for_each(apply);
    #[cfg(not(feature = "parallel"))]
    for pixel in pixels {
        apply(pixel);
    }
}

pub(crate) fn map_pixels<T, U, const N: usize>(
    pixels: &[T],
    map: impl Fn(&T) -> [U; N] + Send + Sync,
) -> Vec<U>
where
    T: Sync,
    U: Send + Copy + Default,
{
    let mut mapped = vec![U::default(); pixels.len() * N];
    #[cfg(feature = "parallel")]
    mapped
        .par_chunks_exact_mut(N)
        .zip(pixels)
        .for_each(|(slot, pixel)| slot.copy_from_slice(&map(pixel)));
    #[cfg(not(feature = "parallel"))]
    for (slot, pixel) in mapped.chunks_exact_mut(N).zip(pixels) {
        slot.copy_from_slice(&map(pixel));
    }
    mapped
}

pub(crate) fn map_indexed_pixels<T, U, const N: usize>(
    pixels: &[T],
    map: impl Fn(usize, &T) -> [U; N] + Send + Sync,
) -> Vec<U>
where
    T: Sync,
    U: Send + Copy + Default,
{
    let mut mapped = vec![U::default(); pixels.len() * N];
    #[cfg(feature = "parallel")]
    mapped
        .par_chunks_exact_mut(N)
        .zip(pixels)
        .enumerate()
        .for_each(|(index, (slot, pixel))| slot.copy_from_slice(&map(index, pixel)));
    #[cfg(not(feature = "parallel"))]
    for (index, (slot, pixel)) in mapped.chunks_exact_mut(N).zip(pixels).enumerate() {
        slot.copy_from_slice(&map(index, pixel));
    }
    mapped
}

pub(crate) fn fill_rows<T: Send>(
    buffer: &mut [T],
    width: usize,
    fill: impl Fn(usize, &mut [T]) + Send + Sync,
) {
    #[cfg(feature = "parallel")]
    buffer
        .par_chunks_mut(width.max(1))
        .enumerate()
        .for_each(|(y, row)| fill(y, row));
    #[cfg(not(feature = "parallel"))]
    for (y, row) in buffer.chunks_mut(width.max(1)).enumerate() {
        fill(y, row);
    }
}

pub(crate) fn fill_zipped_rows<A: Send, B: Send>(
    a: &mut [A],
    b: &mut [B],
    width: usize,
    fill: impl Fn(usize, &mut [A], &mut [B]) + Send + Sync,
) {
    let width = width.max(1);
    #[cfg(feature = "parallel")]
    a.par_chunks_mut(width)
        .zip(b.par_chunks_mut(width))
        .enumerate()
        .for_each(|(y, (a, b))| fill(y, a, b));
    #[cfg(not(feature = "parallel"))]
    for (y, (a, b)) in a.chunks_mut(width).zip(b.chunks_mut(width)).enumerate() {
        fill(y, a, b);
    }
}

pub(crate) fn collect_rows<T: Send>(
    height: usize,
    collect: impl Fn(usize, &mut Vec<T>) + Send + Sync,
) -> Vec<T> {
    #[cfg(feature = "parallel")]
    return (0..height)
        .into_par_iter()
        .fold(Vec::new, |mut found, y| {
            collect(y, &mut found);
            found
        })
        .reduce(Vec::new, |mut left, mut right| {
            left.append(&mut right);
            left
        });
    #[cfg(not(feature = "parallel"))]
    {
        let mut found = Vec::new();
        for y in 0..height {
            collect(y, &mut found);
        }
        found
    }
}

pub(crate) fn max_of<T: Sync>(items: &[T], value: impl Fn(&T) -> f32 + Send + Sync) -> f32 {
    #[cfg(feature = "parallel")]
    return items.par_iter().map(value).reduce(|| 0.0, f32::max);
    #[cfg(not(feature = "parallel"))]
    items.iter().map(value).fold(0.0, f32::max)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn applies_to_each_pixel_in_place() {
        let mut pixels = vec![1u32, 2, 3];
        for_each_pixel(&mut pixels, |pixel| *pixel *= 10);
        assert_eq!(pixels, [10, 20, 30]);
    }

    #[test]
    fn maps_pixels_into_flattened_runs() {
        let mapped = map_pixels(&[1u8, 2, 3], |&value| [value, value + 10]);
        assert_eq!(mapped, [1, 11, 2, 12, 3, 13]);
    }

    #[test]
    fn maps_pixels_alongside_their_index() {
        let mapped = map_indexed_pixels(&[7u8, 8, 9], |index, &value| [index as u8, value]);
        assert_eq!(mapped, [0, 7, 1, 8, 2, 9]);
    }

    #[test]
    fn fills_rows_from_their_index() {
        let mut buffer = vec![0usize; 6];
        fill_rows(&mut buffer, 3, |y, row| {
            for (x, value) in row.iter_mut().enumerate() {
                *value = y * 3 + x;
            }
        });
        assert_eq!(buffer, [0, 1, 2, 3, 4, 5]);
    }

    #[test]
    fn fills_zipped_rows_in_lockstep() {
        let mut values = vec![0usize; 4];
        let mut flags = vec![false; 4];
        fill_zipped_rows(&mut values, &mut flags, 2, |y, values, flags| {
            for (x, (value, flag)) in values.iter_mut().zip(flags).enumerate() {
                *value = y * 2 + x;
                *flag = y == 1;
            }
        });
        assert_eq!(values, [0, 1, 2, 3]);
        assert_eq!(flags, [false, false, true, true]);
    }

    #[test]
    fn collects_row_findings_in_row_order() {
        let found = collect_rows(4, |y, found| {
            if y % 2 == 0 {
                found.push(y);
            }
        });
        assert_eq!(found, [0, 2]);
    }

    #[test]
    fn max_of_folds_from_zero() {
        assert_eq!(max_of(&[0.25f32, 0.75, 0.5], |&value| value), 0.75);
        assert_eq!(max_of(&[-1.0f32, -2.0], |&value| value), 0.0);
        assert_eq!(max_of::<f32>(&[], |&value| value), 0.0);
    }
}
