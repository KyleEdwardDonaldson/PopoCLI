use thiserror::Error;

#[derive(Debug, Error)]
pub enum PopoError {
    #[error("Network error: {0}")]
    Network(#[from] reqwest::Error),

    #[error("No report published for {0}")]
    NotFound(chrono::NaiveDate),

    #[error("Failed to parse report: {0}")]
    Parse(String),

    #[error("Invalid date '{0}'. Use YYYY-MM-DD (e.g. 2022-03-22)")]
    InvalidDate(String),

    #[error("Feed error: {0}")]
    Feed(String),

    #[error(
        "This feed uses schema version {found}, but this build of popo understands \
         version {supported}. Upgrade with `cargo install popo-cli --force`."
    )]
    UnsupportedSchema { found: u32, supported: u32 },

    #[error("Failed to read local feed at {path}: {source}")]
    LocalFeed {
        path: String,
        #[source]
        source: std::io::Error,
    },
}

pub type Result<T> = std::result::Result<T, PopoError>;
