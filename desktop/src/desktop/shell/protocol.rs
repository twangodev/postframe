use super::super::{AssetKind, DesktopError, DesktopState, Result, parse_range};
use std::fs::File;
use std::io::{Read, Seek, SeekFrom};

pub fn protocol_response(
    request: &tauri::http::Request<Vec<u8>>,
    state: &DesktopState,
) -> tauri::http::Response<Vec<u8>> {
    match read_protocol_asset(request, state) {
        Ok(response) => response,
        Err(error) => tauri::http::Response::builder()
            .status(404)
            .header("Cross-Origin-Resource-Policy", "cross-origin")
            .body(error.to_string().into_bytes())
            .expect("valid protocol response"),
    }
}

fn read_protocol_asset(
    request: &tauri::http::Request<Vec<u8>>,
    state: &DesktopState,
) -> Result<tauri::http::Response<Vec<u8>>> {
    let segments = request
        .uri()
        .path()
        .split('/')
        .filter(|segment| !segment.is_empty())
        .collect::<Vec<_>>();
    if segments.len() != 2 {
        return Err(DesktopError::Invalid("Invalid asset URL".into()));
    }
    let path = state.asset_path(segments[0].parse::<AssetKind>()?, segments[1])?;
    let mut file = File::open(&path)?;
    let size = file.metadata()?.len();
    let range = request
        .headers()
        .get("range")
        .and_then(|value| value.to_str().ok())
        .and_then(|value| parse_range(value, size));
    let (start, end, status) =
        range
            .map(|(start, end)| (start, end, 206))
            .unwrap_or((0, size.saturating_sub(1), 200));
    let length = if size == 0 { 0 } else { end - start + 1 };
    file.seek(SeekFrom::Start(start))?;
    let mut bytes = vec![0; length as usize];
    file.read_exact(&mut bytes)?;
    let mut response = tauri::http::Response::builder()
        .status(status)
        .header(
            "Content-Type",
            mime_guess::from_path(&path)
                .first_or_octet_stream()
                .as_ref(),
        )
        .header("Content-Length", length)
        .header("Accept-Ranges", "bytes")
        .header("Access-Control-Allow-Origin", "*")
        .header("Cross-Origin-Resource-Policy", "cross-origin");
    if status == 206 {
        response = response.header("Content-Range", format!("bytes {start}-{end}/{size}"));
    }
    response
        .body(bytes)
        .map_err(|error| DesktopError::Invalid(error.to_string()))
}
