//! Merges an exposure bracket into a single HDR image while preserving the
//! camera's own rendering.
//!
//! Given a raw file and its paired straight-out-of-camera JPEG, the camera's
//! rendering is a measurable function: the raw is scene-linear sensor data and
//! the JPEG is that same data rendered. Recovering that function lets the merged
//! radiance be rendered the way the camera would have, with more dynamic range
//! than any single frame in the bracket.
