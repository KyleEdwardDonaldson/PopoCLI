use crate::error::{PopoError, Result};
use crate::models::{FeedIndex, VolcanoReport, SCHEMA_VERSION};
use chrono::NaiveDate;
use serde::de::DeserializeOwned;

/// Where the published JSON lives by default.
///
/// The CLI deliberately does not talk to CENAPRED. That site sits behind a bot
/// manager which serves an HTTP 200 challenge page to every non-browser client,
/// so per-user scraping cannot work. Ingestion happens once, centrally, and
/// this feed is the result. See `docs/feed-schema.md`.
pub const DEFAULT_FEED_BASE: &str =
    "https://raw.githubusercontent.com/KyleEdwardDonaldson/PopoCLI/main/data";

/// Environment variable used to point the CLI at a different feed: a fork, a
/// local mirror, or a directory on disk.
pub const FEED_BASE_ENV: &str = "POPO_FEED_BASE";

pub struct Feed {
    client: reqwest::blocking::Client,
    base: String,
}

impl Feed {
    /// Build a client against the default feed, or whatever `POPO_FEED_BASE`
    /// points at.
    pub fn new() -> Self {
        let base = std::env::var(FEED_BASE_ENV).unwrap_or_else(|_| DEFAULT_FEED_BASE.to_string());
        Self::with_base(base)
    }

    /// Build a client against a specific feed. The base may be an HTTP(S) URL
    /// or a filesystem path holding the same layout.
    pub fn with_base(base: impl Into<String>) -> Self {
        let client = reqwest::blocking::Client::builder()
            .user_agent(concat!("popo-cli/", env!("CARGO_PKG_VERSION")))
            .timeout(std::time::Duration::from_secs(30))
            .build()
            .expect("failed to build HTTP client");

        Self {
            client,
            base: base.into().trim_end_matches(['/', '\\']).to_string(),
        }
    }

    pub fn base(&self) -> &str {
        &self.base
    }

    /// The most recently published report.
    pub fn latest(&self) -> Result<VolcanoReport> {
        let report: VolcanoReport = self.fetch("latest.json", None)?;
        check_schema(report.schema_version)?;
        Ok(report)
    }

    /// The report for a specific day.
    pub fn get(&self, date: NaiveDate) -> Result<VolcanoReport> {
        let path = format!("reports/{}/{}.json", date.format("%Y"), date);
        let report: VolcanoReport = self.fetch(&path, Some(date))?;
        check_schema(report.schema_version)?;
        Ok(report)
    }

    /// Everything the feed currently carries.
    pub fn index(&self) -> Result<FeedIndex> {
        let index: FeedIndex = self.fetch("index.json", None)?;
        check_schema(index.schema_version)?;
        Ok(index)
    }

    fn fetch<T: DeserializeOwned>(&self, path: &str, date: Option<NaiveDate>) -> Result<T> {
        let body = if self.is_remote() {
            self.fetch_http(path, date)?
        } else {
            self.read_local(path, date)?
        };

        serde_json::from_str(&body).map_err(|e| {
            PopoError::Parse(format!("feed returned malformed JSON for {}: {}", path, e))
        })
    }

    fn is_remote(&self) -> bool {
        self.base.starts_with("http://") || self.base.starts_with("https://")
    }

    fn fetch_http(&self, path: &str, date: Option<NaiveDate>) -> Result<String> {
        let url = format!("{}/{}", self.base, path);
        let response = self.client.get(&url).send()?;
        let status = response.status();

        if status == reqwest::StatusCode::NOT_FOUND {
            return Err(match date {
                Some(date) => PopoError::NotFound(date),
                None => PopoError::Feed(format!(
                    "{} is missing from the feed. The feed may not be published yet.",
                    path
                )),
            });
        }

        if !status.is_success() {
            return Err(PopoError::Feed(format!(
                "feed request to {} failed with HTTP {}",
                url, status
            )));
        }

        Ok(response.text()?)
    }

    fn read_local(&self, path: &str, date: Option<NaiveDate>) -> Result<String> {
        let full = std::path::Path::new(&self.base).join(path);
        match std::fs::read_to_string(&full) {
            Ok(body) => Ok(body),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Err(match date {
                Some(date) => PopoError::NotFound(date),
                None => PopoError::LocalFeed {
                    path: full.display().to_string(),
                    source: e,
                },
            }),
            Err(e) => Err(PopoError::LocalFeed {
                path: full.display().to_string(),
                source: e,
            }),
        }
    }
}

impl Default for Feed {
    fn default() -> Self {
        Self::new()
    }
}

fn check_schema(found: u32) -> Result<()> {
    if found > SCHEMA_VERSION {
        return Err(PopoError::UnsupportedSchema {
            found,
            supported: SCHEMA_VERSION,
        });
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn write_fixture(dir: &std::path::Path) {
        fs::create_dir_all(dir.join("reports/2026")).unwrap();
        let report = r#"{
            "schema_version": 1,
            "date": "2026-08-04",
            "exhalations": 160,
            "volcanotectonic_events": 0,
            "tremor_minutes_total": 0,
            "explosions": 0,
            "alert_level": "YELLOW",
            "alert_phase": "AMARILLO FASE 2",
            "wind_direction": "W",
            "summary_spanish": "Se detectaron 160 exhalaciones.",
            "ashfall_reports": [],
            "image_urls": [],
            "video_urls": [],
            "source_url": "https://www.cenapred.unam.mx/",
            "ingested_at": "2026-08-05T17:04:00Z"
        }"#;
        fs::write(dir.join("latest.json"), report).unwrap();
        fs::write(dir.join("reports/2026/2026-08-04.json"), report).unwrap();
    }

    fn temp_dir(name: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("popo-feed-test-{}", name));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn reads_latest_from_local_feed() {
        let dir = temp_dir("latest");
        write_fixture(&dir);

        let feed = Feed::with_base(dir.to_str().unwrap());
        let report = feed.latest().unwrap();

        assert_eq!(report.exhalations, Some(160));
        assert_eq!(report.date, NaiveDate::from_ymd_opt(2026, 8, 4).unwrap());
    }

    #[test]
    fn reads_specific_date_from_local_feed() {
        let dir = temp_dir("bydate");
        write_fixture(&dir);

        let feed = Feed::with_base(dir.to_str().unwrap());
        let date = NaiveDate::from_ymd_opt(2026, 8, 4).unwrap();
        assert_eq!(feed.get(date).unwrap().date, date);
    }

    #[test]
    fn missing_date_reports_not_found() {
        let dir = temp_dir("missing");
        write_fixture(&dir);

        let feed = Feed::with_base(dir.to_str().unwrap());
        let absent = NaiveDate::from_ymd_opt(1998, 1, 1).unwrap();

        match feed.get(absent) {
            Err(PopoError::NotFound(d)) => assert_eq!(d, absent),
            other => panic!("expected NotFound, got {:?}", other.map(|r| r.date)),
        }
    }

    /// A feed published by a newer ingester must not be silently misread.
    #[test]
    fn rejects_newer_schema_version() {
        let dir = temp_dir("schema");
        fs::create_dir_all(&dir).unwrap();
        fs::write(
            dir.join("latest.json"),
            r#"{
                "schema_version": 99,
                "date": "2026-08-04",
                "alert_level": "YELLOW",
                "alert_phase": "AMARILLO FASE 2",
                "ingested_at": "2026-08-05T17:04:00Z"
            }"#,
        )
        .unwrap();

        let feed = Feed::with_base(dir.to_str().unwrap());
        match feed.latest() {
            Err(PopoError::UnsupportedSchema { found, supported }) => {
                assert_eq!(found, 99);
                assert_eq!(supported, SCHEMA_VERSION);
            }
            other => panic!(
                "expected UnsupportedSchema, got {:?}",
                other.map(|r| r.date)
            ),
        }
    }

    #[test]
    fn malformed_json_is_a_parse_error() {
        let dir = temp_dir("malformed");
        fs::write(dir.join("latest.json"), "not json at all").unwrap();

        let feed = Feed::with_base(dir.to_str().unwrap());
        assert!(matches!(feed.latest(), Err(PopoError::Parse(_))));
    }

    #[test]
    fn base_url_trailing_slash_is_normalized() {
        assert_eq!(
            Feed::with_base("https://example.com/data/").base(),
            "https://example.com/data"
        );
    }
}
