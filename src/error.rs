use thiserror::Error;

#[derive(Debug, Error)]
pub enum PopoError {
    #[error("Network error: {0}")]
    Network(#[from] reqwest::Error),

    #[error("No report found for date {0}")]
    NotFound(chrono::NaiveDate),

    #[error("Failed to parse report: {0}")]
    Parse(String),

    #[error("Failed to select element: {0}")]
    Selector(String),
}

pub type Result<T> = std::result::Result<T, PopoError>;
