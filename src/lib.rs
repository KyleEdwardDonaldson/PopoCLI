//! Popocatépetl volcano monitoring, as a CLI and a library.
//!
//! Data comes from a published JSON feed rather than by scraping CENAPRED
//! directly — see [`feed`] and `docs/feed-schema.md` for why.

pub mod error;
pub mod feed;
pub mod models;

pub use error::{PopoError, Result};
pub use feed::{Feed, DEFAULT_FEED_BASE, FEED_BASE_ENV};
pub use models::{AlertLevel, FeedIndex, VolcanoReport, WindDirection, SCHEMA_VERSION};
