pub const LUMINANCE_WEIGHTS: [f32; 3] = [0.2126, 0.7152, 0.0722];

pub fn luminance([red, green, blue]: [f32; 3]) -> f32 {
    LUMINANCE_WEIGHTS[0] * red + LUMINANCE_WEIGHTS[1] * green + LUMINANCE_WEIGHTS[2] * blue
}

pub fn chroma_fraction(linear: [f32; 3]) -> f32 {
    let (maximum, minimum) = extremes(linear);
    if maximum <= 0.0 {
        return 0.0;
    }
    ((maximum - minimum) / maximum).clamp(0.0, 1.0)
}

pub fn hue_degrees(linear: [f32; 3]) -> f32 {
    let (maximum, minimum) = extremes(linear);
    let chroma = maximum - minimum;
    if chroma <= 0.0 {
        return 0.0;
    }
    let [red, green, blue] = linear;
    let sextant = if maximum == red {
        (green - blue) / chroma
    } else if maximum == green {
        (blue - red) / chroma + 2.0
    } else {
        (red - green) / chroma + 4.0
    };
    (sextant * 60.0).rem_euclid(360.0)
}

pub fn with_hue_shift(linear: [f32; 3], degrees: f32) -> [f32; 3] {
    let (maximum, minimum) = extremes(linear);
    if degrees == 0.0 || maximum <= minimum {
        return linear;
    }
    from_hue(
        hue_degrees(linear) + degrees,
        (maximum - minimum) / maximum,
        maximum,
    )
}

pub fn scale_saturation(linear: [f32; 3], scale: f32) -> [f32; 3] {
    let (maximum, minimum) = extremes(linear);
    if scale == 1.0 || maximum <= minimum {
        return linear;
    }
    let luminance = luminance(linear);
    linear.map(|channel| (luminance + (channel - luminance) * scale).max(0.0))
}

pub fn scale_luminance(linear: [f32; 3], scale: f32) -> [f32; 3] {
    if scale == 1.0 {
        return linear;
    }
    linear.map(|channel| (channel * scale).max(0.0))
}

/// The fully saturated color at `degrees`, scaled so its brightest channel is
/// `value` and its chroma fraction is `saturation`.
pub fn from_hue(degrees: f32, saturation: f32, value: f32) -> [f32; 3] {
    let position = degrees.rem_euclid(360.0) / 60.0;
    let chroma = value * saturation.clamp(0.0, 1.0);
    let ramp = chroma * (1.0 - (position % 2.0 - 1.0).abs());
    let sextant = match position as usize {
        0 => [chroma, ramp, 0.0],
        1 => [ramp, chroma, 0.0],
        2 => [0.0, chroma, ramp],
        3 => [0.0, ramp, chroma],
        4 => [ramp, 0.0, chroma],
        _ => [chroma, 0.0, ramp],
    };
    sextant.map(|channel| channel + value - chroma)
}

fn extremes(linear: [f32; 3]) -> (f32, f32) {
    (
        linear.into_iter().fold(f32::NEG_INFINITY, f32::max),
        linear.into_iter().fold(f32::INFINITY, f32::min),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    const GRAY: [f32; 3] = [0.36, 0.36, 0.36];
    const EARTH: [f32; 3] = [0.6, 0.2, 0.1];

    #[test]
    fn primaries_sit_at_their_wheel_positions() {
        assert_eq!(hue_degrees([1.0, 0.0, 0.0]), 0.0);
        assert_eq!(hue_degrees([0.0, 1.0, 0.0]), 120.0);
        assert_eq!(hue_degrees([0.0, 0.0, 1.0]), 240.0);
        assert_eq!(hue_degrees([1.0, 1.0, 0.0]), 60.0);
        assert_eq!(hue_degrees([0.0, 1.0, 1.0]), 180.0);
        assert_eq!(hue_degrees([1.0, 0.0, 1.0]), 300.0);
    }

    #[test]
    fn chroma_spans_gray_to_a_saturated_primary() {
        assert_eq!(chroma_fraction(GRAY), 0.0);
        assert_eq!(chroma_fraction([0.0, 0.0, 0.0]), 0.0);
        assert_eq!(chroma_fraction([1.0, 0.0, 0.0]), 1.0);
        assert!((chroma_fraction([0.8, 0.4, 0.4]) - 0.5).abs() < 1e-6);
    }

    #[test]
    fn grayscale_has_no_hue_to_move() {
        assert_eq!(with_hue_shift(GRAY, 45.0), GRAY);
        assert_eq!(scale_saturation(GRAY, 0.0), GRAY);
        assert_eq!(scale_saturation(GRAY, 2.0), GRAY);
    }

    #[test]
    fn hue_shifts_rotate_the_wheel_and_wrap() {
        assert_eq!(hue_degrees(with_hue_shift([1.0, 0.0, 0.0], 120.0)), 120.0);
        assert_eq!(hue_degrees(with_hue_shift([1.0, 0.0, 0.0], -30.0)), 330.0);
        assert!((hue_degrees(with_hue_shift(EARTH, 360.0)) - hue_degrees(EARTH)).abs() < 1e-3);
    }

    #[test]
    fn saturation_reaches_gray_at_zero_and_keeps_luminance() {
        let desaturated = scale_saturation(EARTH, 0.0);
        assert_eq!(desaturated[0], desaturated[1]);
        assert_eq!(desaturated[1], desaturated[2]);
        assert!((luminance(desaturated) - luminance(EARTH)).abs() < 1e-6);
    }

    #[test]
    fn luminance_scaling_keeps_hue_and_saturation() {
        let brightened = scale_luminance(EARTH, 1.5);
        assert!((hue_degrees(brightened) - hue_degrees(EARTH)).abs() < 1e-3);
        assert!((chroma_fraction(brightened) - chroma_fraction(EARTH)).abs() < 1e-6);
        assert!((luminance(brightened) - 1.5 * luminance(EARTH)).abs() < 1e-6);
    }

    #[test]
    fn hues_round_trip_through_their_saturated_color() {
        for degrees in (0..360).step_by(7) {
            let color = from_hue(degrees as f32, 1.0, 1.0);
            assert!((hue_degrees(color) - degrees as f32).abs() < 1e-3);
            assert_eq!(chroma_fraction(color), 1.0);
        }
    }
}
