use crate::{Error, Result};

pub const HISTOGRAM_BINS: usize = 256;
pub const HISTOGRAM_CHANNELS: usize = 4;
pub const WAVEFORM_CHANNELS: usize = 3;
pub const WAVEFORM_WIDTH: usize = 512;
pub const WAVEFORM_HEIGHT: usize = 256;

const SAMPLE_TARGET: usize = 750_000;

#[derive(Clone, Debug)]
pub struct ImageScope {
    histogram: Vec<u32>,
    waveform: Vec<u16>,
    sample_count: usize,
}

impl ImageScope {
    pub fn analyze(rgb8: &[u8], width: usize, height: usize) -> Result<Self> {
        let pixel_count = width
            .checked_mul(height)
            .ok_or(Error::Unsupported("scope dimensions overflow"))?;
        let expected = pixel_count
            .checked_mul(3)
            .ok_or(Error::Unsupported("scope dimensions overflow"))?;
        if width == 0 || height == 0 || rgb8.len() != expected {
            return Err(Error::Unsupported("scope buffer size mismatch"));
        }

        let stride = ((pixel_count as f64 / SAMPLE_TARGET as f64).sqrt().ceil() as usize).max(1);
        let mut histogram = vec![0; HISTOGRAM_CHANNELS * HISTOGRAM_BINS];
        let mut waveform = vec![0u16; WAVEFORM_CHANNELS * WAVEFORM_WIDTH * WAVEFORM_HEIGHT];
        let mut sample_count = 0;

        for y in (0..height).step_by(stride) {
            for x in (0..width).step_by(stride) {
                let offset = (y * width + x) * 3;
                let red = rgb8[offset];
                let green = rgb8[offset + 1];
                let blue = rgb8[offset + 2];
                let luma = ((54 * red as u16 + 183 * green as u16 + 19 * blue as u16) >> 8) as u8;
                let scope_x = x * WAVEFORM_WIDTH / width;

                for (channel, value) in [red, green, blue, luma].into_iter().enumerate() {
                    histogram[channel * HISTOGRAM_BINS + value as usize] += 1;
                }

                for (channel, value) in [red, green, blue].into_iter().enumerate() {
                    let scope_y = WAVEFORM_HEIGHT
                        - 1
                        - value as usize * (WAVEFORM_HEIGHT - 1) / (HISTOGRAM_BINS - 1);
                    let index = channel * WAVEFORM_WIDTH * WAVEFORM_HEIGHT
                        + scope_y * WAVEFORM_WIDTH
                        + scope_x;
                    waveform[index] = waveform[index].saturating_add(1);
                }
                sample_count += 1;
            }
        }

        Ok(Self {
            histogram,
            waveform,
            sample_count,
        })
    }

    pub fn histogram(&self) -> &[u32] {
        &self.histogram
    }

    pub fn waveform(&self) -> &[u16] {
        &self.waveform
    }

    pub fn sample_count(&self) -> usize {
        self.sample_count
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn measures_tonal_distribution_and_spatial_density() {
        let scope = ImageScope::analyze(&[0, 0, 0, 255, 255, 255], 2, 1).unwrap();

        for channel in 0..HISTOGRAM_CHANNELS {
            let histogram =
                &scope.histogram[channel * HISTOGRAM_BINS..(channel + 1) * HISTOGRAM_BINS];
            assert_eq!(histogram[0], 1);
            assert_eq!(histogram[255], 1);
            assert_eq!(histogram.iter().sum::<u32>(), 2);
        }

        for channel in 0..WAVEFORM_CHANNELS {
            let waveform = &scope.waveform[channel * WAVEFORM_WIDTH * WAVEFORM_HEIGHT
                ..(channel + 1) * WAVEFORM_WIDTH * WAVEFORM_HEIGHT];
            assert_eq!(
                waveform.iter().map(|&value| value as usize).sum::<usize>(),
                2
            );
        }
        assert_eq!(scope.sample_count, 2);
    }

    #[test]
    fn rejects_mismatched_buffers() {
        assert!(ImageScope::analyze(&[0, 0, 0], 2, 1).is_err());
        assert!(ImageScope::analyze(&[], 0, 0).is_err());
    }
}
