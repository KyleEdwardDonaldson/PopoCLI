use chrono::{DateTime, NaiveDate, Utc};
use serde::{Deserialize, Serialize};

/// Schema version this build understands. See `docs/feed-schema.md`.
pub const SCHEMA_VERSION: u32 = 1;

/// A single daily report, as published by the feed.
///
/// Counter fields are `Option` because the archive spans ~26 years and older
/// windows occasionally omit a day entirely. A day that is present with no
/// activity is `Some(0)`; `None` means "not reported", not "zero".
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct VolcanoReport {
    #[serde(default = "default_schema_version")]
    pub schema_version: u32,

    pub date: NaiveDate,

    // Seismic activity
    #[serde(default)]
    pub exhalations: Option<u32>,
    #[serde(default)]
    pub volcanotectonic_events: Option<u32>,
    #[serde(default)]
    pub tremor_minutes_total: Option<u32>,
    #[serde(default)]
    pub tremor_high_frequency_minutes: Option<u32>,
    #[serde(default)]
    pub tremor_harmonic_minutes: Option<u32>,
    #[serde(default)]
    pub explosions: Option<u32>,

    // Emissions. Only populated when the measurement is contemporaneous with
    // `date`; CENAPRED renders one global "last reading" on every page,
    // including pages for reports years older than the reading itself.
    #[serde(default)]
    pub so2_emissions_tons_per_day: Option<f64>,
    #[serde(default)]
    pub so2_measurement_date: Option<NaiveDate>,

    // Alert status. Absent on `partial` records: one page embeds a 15-day
    // window of counters, but the alert describes only that page's own day.
    #[serde(default)]
    pub alert_level: Option<AlertLevel>,
    #[serde(default)]
    pub alert_phase: Option<String>,

    // Environmental
    #[serde(default)]
    pub wind_direction: Option<WindDirection>,

    // Narrative
    #[serde(default)]
    pub summary_spanish: Option<String>,
    #[serde(default)]
    pub ashfall_reports: Vec<String>,

    // Media
    #[serde(default)]
    pub image_urls: Vec<String>,
    #[serde(default)]
    pub video_urls: Vec<String>,

    // Provenance
    #[serde(default)]
    pub source_url: Option<String>,
    #[serde(default)]
    pub ingested_at: Option<DateTime<Utc>>,

    /// True when this record carries counters only, harvested from another
    /// day's chart window. Report-level detail is absent by design rather than
    /// missing, and is never copied across from the neighbouring report.
    #[serde(default)]
    pub partial: bool,
}

impl VolcanoReport {
    /// Whether this record carries report-level detail (alert, narrative,
    /// wind, media) as opposed to counters alone.
    pub fn is_full(&self) -> bool {
        !self.partial
    }
}

fn default_schema_version() -> u32 {
    SCHEMA_VERSION
}

/// Listing of everything the feed currently carries.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct FeedIndex {
    #[serde(default = "default_schema_version")]
    pub schema_version: u32,
    pub updated_at: DateTime<Utc>,
    pub earliest: NaiveDate,
    pub latest: NaiveDate,
    pub count: usize,
    #[serde(default)]
    pub dates: Vec<NaiveDate>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "UPPERCASE")]
pub enum AlertLevel {
    Green,
    Yellow,
    Orange,
    Red,
}

impl AlertLevel {
    pub fn from_spanish(text: &str) -> Option<Self> {
        let text_lower = text.to_lowercase();
        if text_lower.contains("verde") {
            Some(AlertLevel::Green)
        } else if text_lower.contains("amarillo") {
            Some(AlertLevel::Yellow)
        } else if text_lower.contains("naranja") {
            Some(AlertLevel::Orange)
        } else if text_lower.contains("rojo") {
            Some(AlertLevel::Red)
        } else {
            None
        }
    }

    /// Coloured indicator for terminal output.
    pub fn emoji(self) -> &'static str {
        match self {
            AlertLevel::Green => "🟢",
            AlertLevel::Yellow => "🟡",
            AlertLevel::Orange => "🟠",
            AlertLevel::Red => "🔴",
        }
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "UPPERCASE")]
pub enum WindDirection {
    N,
    NNE,
    NE,
    ENE,
    E,
    ESE,
    SE,
    SSE,
    S,
    SSW,
    SW,
    WSW,
    W,
    WNW,
    NW,
    NNW,
}

impl WindDirection {
    /// Map CENAPRED's Spanish compass wording onto a 16-point code.
    ///
    /// Matching is ordered longest-first: `oestenoroeste` contains `noroeste`,
    /// so a shortest-first scan silently resolves WNW as NW.
    pub fn from_spanish(text: &str) -> Option<Self> {
        let normalized = text.to_lowercase().replace([' ', '-', '_'], "");

        const PATTERNS: &[(&str, WindDirection)] = &[
            // Three-part (most specific)
            ("nornoroeste", WindDirection::NNW),
            ("nortenoroeste", WindDirection::NNW),
            ("nornoreste", WindDirection::NNE),
            ("nortenoreste", WindDirection::NNE),
            ("oestenoroeste", WindDirection::WNW),
            ("oestesuroeste", WindDirection::WSW),
            ("estesureste", WindDirection::ESE),
            ("estenoreste", WindDirection::ENE),
            ("sursuroeste", WindDirection::SSW),
            ("sursureste", WindDirection::SSE),
            // Two-part
            ("noroeste", WindDirection::NW),
            ("suroeste", WindDirection::SW),
            ("sureste", WindDirection::SE),
            ("noreste", WindDirection::NE),
            // Cardinal (least specific)
            ("norte", WindDirection::N),
            ("oeste", WindDirection::W),
            ("este", WindDirection::E),
            ("sur", WindDirection::S),
        ];

        PATTERNS
            .iter()
            .find(|(pattern, _)| normalized.contains(pattern))
            .map(|(_, dir)| *dir)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_alert_level_from_spanish() {
        assert_eq!(
            AlertLevel::from_spanish("Amarillo Fase 2"),
            Some(AlertLevel::Yellow)
        );
        assert_eq!(AlertLevel::from_spanish("VERDE"), Some(AlertLevel::Green));
        assert_eq!(AlertLevel::from_spanish("rojo"), Some(AlertLevel::Red));
        assert_eq!(
            AlertLevel::from_spanish("NARANJA"),
            Some(AlertLevel::Orange)
        );
        assert_eq!(AlertLevel::from_spanish("unknown"), None);
    }

    #[test]
    fn test_wind_direction_from_spanish() {
        assert_eq!(
            WindDirection::from_spanish("norte-noroeste"),
            Some(WindDirection::NNW)
        );
        assert_eq!(
            WindDirection::from_spanish("NORESTE"),
            Some(WindDirection::NE)
        );
        assert_eq!(WindDirection::from_spanish("sur"), Some(WindDirection::S));
        assert_eq!(
            WindDirection::from_spanish("oeste-suroeste"),
            Some(WindDirection::WSW)
        );
        // Live wording seen on the report page.
        assert_eq!(
            WindDirection::from_spanish("Dirección del viento SURESTE"),
            Some(WindDirection::SE)
        );
        assert_eq!(WindDirection::from_spanish("OESTE"), Some(WindDirection::W));
    }

    /// Compound directions must not be swallowed by their shorter substrings.
    #[test]
    fn test_wind_direction_prefers_most_specific() {
        assert_eq!(
            WindDirection::from_spanish("oeste noroeste"),
            Some(WindDirection::WNW)
        );
        assert_eq!(
            WindDirection::from_spanish("sur suroeste"),
            Some(WindDirection::SSW)
        );
        assert_eq!(
            WindDirection::from_spanish("norte noreste"),
            Some(WindDirection::NNE)
        );
        assert_eq!(
            WindDirection::from_spanish("este sureste"),
            Some(WindDirection::ESE)
        );
    }

    #[test]
    fn test_wind_direction_serializes_uppercase() {
        let json = serde_json::to_string(&WindDirection::NNW).unwrap();
        assert_eq!(json, "\"NNW\"");
        let parsed: WindDirection = serde_json::from_str("\"W\"").unwrap();
        assert_eq!(parsed, WindDirection::W);
    }

    #[test]
    fn test_report_deserializes_from_feed_json() {
        let json = r#"{
            "schema_version": 1,
            "date": "2026-08-04",
            "exhalations": 160,
            "volcanotectonic_events": 0,
            "tremor_minutes_total": 0,
            "tremor_high_frequency_minutes": null,
            "tremor_harmonic_minutes": null,
            "explosions": 0,
            "so2_emissions_tons_per_day": null,
            "so2_measurement_date": null,
            "alert_level": "YELLOW",
            "alert_phase": "AMARILLO FASE 2",
            "wind_direction": "W",
            "summary_spanish": "Se detectaron 160 exhalaciones.",
            "ashfall_reports": ["Atlautla, Estado de México"],
            "image_urls": [],
            "video_urls": [],
            "source_url": "https://www.cenapred.unam.mx/",
            "ingested_at": "2026-08-05T17:04:00Z",
            "a_field_from_the_future": 42
        }"#;

        let report: VolcanoReport = serde_json::from_str(json).unwrap();
        assert_eq!(report.exhalations, Some(160));
        assert_eq!(report.explosions, Some(0));
        assert_eq!(report.alert_level, Some(AlertLevel::Yellow));
        assert_eq!(report.wind_direction, Some(WindDirection::W));
        assert_eq!(report.so2_emissions_tons_per_day, None);
        assert_eq!(report.ashfall_reports, vec!["Atlautla, Estado de México"]);
        assert!(report.is_full());
    }

    /// Backfill harvests a 15-day counter window from a single page. The other
    /// 14 days get counters only; report-level detail is explicitly `null`
    /// rather than copied across from a neighbouring day.
    #[test]
    fn test_partial_record_deserializes() {
        let json = r#"{
            "schema_version": 1,
            "date": "2022-04-13",
            "exhalations": 22,
            "volcanotectonic_events": 0,
            "tremor_minutes_total": 0,
            "tremor_high_frequency_minutes": null,
            "tremor_harmonic_minutes": null,
            "explosions": 0,
            "so2_emissions_tons_per_day": null,
            "so2_measurement_date": null,
            "alert_level": null,
            "alert_phase": null,
            "wind_direction": null,
            "summary_spanish": null,
            "ashfall_reports": [],
            "image_urls": [],
            "video_urls": [],
            "source_url": "https://www.cenapred.unam.mx/",
            "ingested_at": "2026-08-06T00:00:00Z",
            "partial": true
        }"#;

        let report: VolcanoReport = serde_json::from_str(json).unwrap();
        assert!(report.partial);
        assert!(!report.is_full());
        assert_eq!(report.exhalations, Some(22));
        assert_eq!(report.alert_level, None);
        assert_eq!(report.alert_phase, None);
        assert_eq!(report.summary_spanish, None);
    }

    /// A missing counter is distinct from a zero counter.
    #[test]
    fn test_absent_counter_is_none_not_zero() {
        let json = r#"{
            "date": "2001-01-05",
            "alert_level": "YELLOW",
            "alert_phase": "AMARILLO FASE 2",
            "ingested_at": "2026-08-05T17:04:00Z"
        }"#;
        let report: VolcanoReport = serde_json::from_str(json).unwrap();
        assert_eq!(report.exhalations, None);
        assert_eq!(report.tremor_minutes_total, None);
        assert!(report.image_urls.is_empty());
        assert_eq!(report.schema_version, SCHEMA_VERSION);
        // Absent `partial` means a full report, not a partial one.
        assert!(report.is_full());
    }
}
