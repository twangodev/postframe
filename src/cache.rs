use crate::color::WorkingSpace;
use crate::decode::linear::Linear;
use crate::fit::transfer::{Curve, Report, Transfer};
use crate::{Error, MergeReport, Merged, Result};

const MAGIC: &[u8; 8] = b"POSTFRM\0";
const VERSION: u32 = 1;

impl Merged {
    pub fn to_cache_bytes(&self) -> Vec<u8> {
        let mut writer = Writer::with_capacity(self.radiance.rgb.len() * 13);
        writer.bytes(MAGIC);
        writer.u32(VERSION);
        writer.usize(self.radiance.width);
        writer.usize(self.radiance.height);
        writer.space(self.space);
        writer.rgb(&self.radiance.rgb);
        writer.bools(&self.radiance.clipped);
        writer.matrix(self.transfer.mix);
        for channel in &self.transfer.channels {
            writer.f32s(&channel.knots_log2);
            writer.f32s(&channel.coded);
        }
        writer.f32(self.report.radiance_max);
        writer.f32s(&self.report.exposures);
        writer.usize(self.report.shifts.len());
        for &(x, y) in &self.report.shifts {
            writer.i32(x);
            writer.i32(y);
        }
        writer.report(&self.report.fit);
        writer.finish()
    }

    pub fn from_cache_bytes(bytes: &[u8]) -> Result<Self> {
        let mut reader = Reader::new(bytes);
        if reader.take(MAGIC.len())? != MAGIC {
            return Err(Error::Cache("header mismatch"));
        }
        if reader.u32()? != VERSION {
            return Err(Error::Cache("unsupported version"));
        }
        let width = reader.usize()?;
        let height = reader.usize()?;
        let pixels = width
            .checked_mul(height)
            .ok_or(Error::Cache("dimensions overflow"))?;
        let space = reader.space()?;
        let rgb = reader.rgb(pixels)?;
        let clipped = reader.bools(pixels)?;
        let mix = reader.matrix()?;
        let mut channels = Vec::with_capacity(3);
        for _ in 0..3 {
            let knots_log2 = reader.f32s()?;
            let coded = reader.f32s()?;
            if knots_log2.len() < 2 || knots_log2.len() != coded.len() {
                return Err(Error::Cache("transfer curve shape mismatch"));
            }
            channels.push(Curve { knots_log2, coded });
        }
        let radiance_max = reader.f32()?;
        let exposures = reader.f32s()?;
        let shifts = (0..reader.usize()?)
            .map(|_| Ok((reader.i32()?, reader.i32()?)))
            .collect::<Result<Vec<_>>>()?;
        let fit = reader.report()?;
        reader.finish()?;
        let channels: [Curve; 3] = channels
            .try_into()
            .map_err(|_| Error::Cache("transfer channel count mismatch"))?;
        Ok(Self {
            radiance: Linear {
                width,
                height,
                rgb,
                clipped,
            },
            transfer: Transfer { mix, channels },
            space,
            report: MergeReport {
                fit,
                exposures,
                shifts,
                radiance_max,
            },
        })
    }
}

struct Writer {
    bytes: Vec<u8>,
}

impl Writer {
    fn with_capacity(capacity: usize) -> Self {
        Self {
            bytes: Vec::with_capacity(capacity),
        }
    }

    fn finish(self) -> Vec<u8> {
        self.bytes
    }

    fn bytes(&mut self, value: &[u8]) {
        self.bytes.extend_from_slice(value);
    }

    fn u32(&mut self, value: u32) {
        self.bytes(&value.to_le_bytes());
    }

    fn i32(&mut self, value: i32) {
        self.bytes(&value.to_le_bytes());
    }

    fn usize(&mut self, value: usize) {
        self.bytes(&(value as u64).to_le_bytes());
    }

    fn f32(&mut self, value: f32) {
        self.bytes(&value.to_le_bytes());
    }

    fn f32s(&mut self, values: &[f32]) {
        self.usize(values.len());
        #[cfg(target_endian = "little")]
        self.bytes(bytemuck::cast_slice(values));
        #[cfg(target_endian = "big")]
        for &value in values {
            self.f32(value);
        }
    }

    fn rgb(&mut self, values: &[[f32; 3]]) {
        self.usize(values.len());
        #[cfg(target_endian = "little")]
        self.bytes(bytemuck::cast_slice(values));
        #[cfg(target_endian = "big")]
        for value in values.iter().flatten() {
            self.f32(*value);
        }
    }

    fn bools(&mut self, values: &[bool]) {
        self.usize(values.len());
        for start in (0..values.len()).step_by(8) {
            let mut packed = 0;
            for index in 0..8.min(values.len() - start) {
                packed |= u8::from(values[start + index]) << index;
            }
            self.bytes.push(packed);
        }
    }

    fn matrix(&mut self, value: [[f32; 3]; 3]) {
        for channel in value.into_iter().flatten() {
            self.f32(channel);
        }
    }

    fn space(&mut self, value: WorkingSpace) {
        self.u32(match value {
            WorkingSpace::LinearSrgb => 0,
            WorkingSpace::LinearAdobeRgb => 1,
        });
    }

    fn report(&mut self, report: &Report) {
        self.space(report.space);
        self.usize(report.accepted);
        self.usize(report.rejected);
        for values in [report.rms, report.flat_rms, report.grad_corr] {
            for value in values {
                self.f32(value);
            }
        }
    }
}

struct Reader<'a> {
    bytes: &'a [u8],
    position: usize,
}

impl<'a> Reader<'a> {
    fn new(bytes: &'a [u8]) -> Self {
        Self { bytes, position: 0 }
    }

    fn finish(self) -> Result<()> {
        if self.position == self.bytes.len() {
            Ok(())
        } else {
            Err(Error::Cache("trailing data"))
        }
    }

    fn take(&mut self, length: usize) -> Result<&'a [u8]> {
        let end = self
            .position
            .checked_add(length)
            .ok_or(Error::Cache("length overflow"))?;
        let value = self
            .bytes
            .get(self.position..end)
            .ok_or(Error::Cache("truncated data"))?;
        self.position = end;
        Ok(value)
    }

    fn u32(&mut self) -> Result<u32> {
        Ok(u32::from_le_bytes(
            self.take(4)?.try_into().map_err(|_| Error::Cache("u32"))?,
        ))
    }

    fn i32(&mut self) -> Result<i32> {
        Ok(i32::from_le_bytes(
            self.take(4)?.try_into().map_err(|_| Error::Cache("i32"))?,
        ))
    }

    fn usize(&mut self) -> Result<usize> {
        usize::try_from(u64::from_le_bytes(
            self.take(8)?.try_into().map_err(|_| Error::Cache("u64"))?,
        ))
        .map_err(|_| Error::Cache("length does not fit this platform"))
    }

    fn f32(&mut self) -> Result<f32> {
        Ok(f32::from_le_bytes(
            self.take(4)?.try_into().map_err(|_| Error::Cache("f32"))?,
        ))
    }

    fn f32s(&mut self) -> Result<Vec<f32>> {
        let count = self.usize()?;
        let bytes = self.take(
            count
                .checked_mul(std::mem::size_of::<f32>())
                .ok_or(Error::Cache("float data overflow"))?,
        )?;
        #[cfg(target_endian = "little")]
        return Ok(bytemuck::pod_collect_to_vec(bytes));
        #[cfg(target_endian = "big")]
        bytes
            .as_chunks::<4>()
            .0
            .iter()
            .map(|chunk| {
                Ok(f32::from_le_bytes(
                    chunk.try_into().map_err(|_| Error::Cache("f32"))?,
                ))
            })
            .collect()
    }

    fn rgb(&mut self, expected: usize) -> Result<Vec<[f32; 3]>> {
        let count = self.usize()?;
        if count != expected {
            return Err(Error::Cache("pixel count mismatch"));
        }
        let bytes = self.take(
            count
                .checked_mul(std::mem::size_of::<[f32; 3]>())
                .ok_or(Error::Cache("pixel data overflow"))?,
        )?;
        #[cfg(target_endian = "little")]
        return Ok(bytemuck::pod_collect_to_vec(bytes));
        #[cfg(target_endian = "big")]
        bytes
            .as_chunks::<12>()
            .0
            .iter()
            .map(|pixel| {
                Ok([
                    f32::from_le_bytes(pixel[0..4].try_into().unwrap()),
                    f32::from_le_bytes(pixel[4..8].try_into().unwrap()),
                    f32::from_le_bytes(pixel[8..12].try_into().unwrap()),
                ])
            })
            .collect()
    }

    fn bools(&mut self, expected: usize) -> Result<Vec<bool>> {
        let count = self.usize()?;
        if count != expected {
            return Err(Error::Cache("clip count mismatch"));
        }
        let packed = self.take(count.div_ceil(8))?;
        Ok((0..count)
            .map(|index| packed[index / 8] & (1 << (index % 8)) != 0)
            .collect())
    }

    fn matrix(&mut self) -> Result<[[f32; 3]; 3]> {
        let mut matrix = [[0.0; 3]; 3];
        for value in matrix.iter_mut().flatten() {
            *value = self.f32()?;
        }
        Ok(matrix)
    }

    fn space(&mut self) -> Result<WorkingSpace> {
        match self.u32()? {
            0 => Ok(WorkingSpace::LinearSrgb),
            1 => Ok(WorkingSpace::LinearAdobeRgb),
            _ => Err(Error::Cache("working space")),
        }
    }

    fn report(&mut self) -> Result<Report> {
        Ok(Report {
            space: self.space()?,
            accepted: self.usize()?,
            rejected: self.usize()?,
            rms: [self.f32()?, self.f32()?, self.f32()?],
            flat_rms: [self.f32()?, self.f32()?, self.f32()?],
            grad_corr: [self.f32()?, self.f32()?, self.f32()?],
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trips_a_merged_render_cache() {
        let curve = Curve {
            knots_log2: vec![-2.0, 2.0],
            coded: vec![0.0, 255.0],
        };
        let merged = Merged {
            radiance: Linear {
                width: 3,
                height: 1,
                rgb: vec![[0.1, 0.2, 0.3], [1.0, 2.0, 3.0], [4.0, 5.0, 6.0]],
                clipped: vec![false, true, false],
            },
            transfer: Transfer {
                mix: [[1.0, 0.0, 0.0], [0.0, 1.0, 0.0], [0.0, 0.0, 1.0]],
                channels: [curve.clone(), curve.clone(), curve],
            },
            space: WorkingSpace::LinearSrgb,
            report: MergeReport {
                fit: Report {
                    space: WorkingSpace::LinearSrgb,
                    accepted: 12,
                    rejected: 2,
                    rms: [1.0, 2.0, 3.0],
                    flat_rms: [4.0, 5.0, 6.0],
                    grad_corr: [0.1, 0.2, 0.3],
                },
                exposures: vec![0.01, 0.02],
                shifts: vec![(0, 0), (2, -1)],
                radiance_max: 6.0,
            },
        };

        let restored = Merged::from_cache_bytes(&merged.to_cache_bytes()).unwrap();

        assert_eq!(restored.radiance.width, merged.radiance.width);
        assert_eq!(restored.radiance.height, merged.radiance.height);
        assert_eq!(restored.radiance.rgb, merged.radiance.rgb);
        assert_eq!(restored.radiance.clipped, merged.radiance.clipped);
        assert_eq!(restored.report.exposures, merged.report.exposures);
        assert_eq!(restored.report.shifts, merged.report.shifts);
        assert_eq!(
            restored.transfer.eval([1.0; 3]),
            merged.transfer.eval([1.0; 3])
        );
    }

    #[test]
    fn rejects_truncated_and_version_mismatched_caches() {
        assert!(Merged::from_cache_bytes(b"short").is_err());
        let mut header = MAGIC.to_vec();
        header.extend_from_slice(&(VERSION + 1).to_le_bytes());
        assert!(Merged::from_cache_bytes(&header).is_err());
    }
}
