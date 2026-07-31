pub type Result<T> = std::result::Result<T, Error>;

#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error(transparent)]
    Io(#[from] std::io::Error),
    #[error("raw decode failed: {0}")]
    Raw(#[from] rawler::RawlerError),
    #[error("jpeg decode failed: {0}")]
    Jpeg(#[from] zune_jpeg::errors::DecodeErrors),
    #[error("{0}")]
    Unsupported(&'static str),
}
