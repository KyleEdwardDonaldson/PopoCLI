pub mod error;
pub mod models;
pub mod scraper;

pub use error::{PopoError, Result};
pub use models::{AlertLevel, VolcanoReport, WindDirection};
pub use scraper::Scraper;
