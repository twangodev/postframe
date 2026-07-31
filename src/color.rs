use rawler::imgop::matrix::{multiply, normalize, pseudo_inverse, transform_1d};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum WorkingSpace {
    LinearSrgb,
    LinearAdobeRgb,
}

const SRGB_TO_XYZ_D65: [[f32; 3]; 3] = [
    [0.4124564, 0.3575761, 0.1804375],
    [0.2126729, 0.7151522, 0.0721750],
    [0.0193339, 0.119_192, 0.9503041],
];

const ADOBE_RGB_TO_XYZ_D65: [[f32; 3]; 3] = [
    [0.5767309, 0.185_554, 0.1881852],
    [0.2973769, 0.6273491, 0.0752741],
    [0.0270343, 0.0706872, 0.9911085],
];

impl WorkingSpace {
    fn to_xyz_d65(self) -> [[f32; 3]; 3] {
        match self {
            Self::LinearSrgb => SRGB_TO_XYZ_D65,
            Self::LinearAdobeRgb => ADOBE_RGB_TO_XYZ_D65,
        }
    }
}

pub fn cam_to_working(xyz_to_cam: &[f32], space: WorkingSpace) -> Option<[[f32; 3]; 3]> {
    let xyz_to_cam: [[f32; 3]; 3] = transform_1d(xyz_to_cam)?;
    let rgb_to_cam = normalize(multiply(&xyz_to_cam, &space.to_xyz_d65()));
    Some(pseudo_inverse(rgb_to_cam))
}

pub fn apply(m: &[[f32; 3]; 3], [r, g, b]: [f32; 3]) -> [f32; 3] {
    [
        m[0][0] * r + m[0][1] * g + m[0][2] * b,
        m[1][0] * r + m[1][1] * g + m[1][2] * b,
        m[2][0] * r + m[2][1] * g + m[2][2] * b,
    ]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn neutral_camera_rgb_stays_neutral() {
        let any_xyz_to_cam = [0.9, 0.1, 0.0, 0.05, 0.8, 0.15, 0.0, 0.2, 0.7];
        for space in [WorkingSpace::LinearSrgb, WorkingSpace::LinearAdobeRgb] {
            let m = cam_to_working(&any_xyz_to_cam, space).unwrap();
            for channel in apply(&m, [1.0, 1.0, 1.0]) {
                assert!((channel - 1.0).abs() < 1e-5);
            }
        }
    }

    #[test]
    fn rejects_non_3x3_matrices() {
        assert!(cam_to_working(&[0.0; 12], WorkingSpace::LinearSrgb).is_none());
    }
}
