use chrono::{DateTime, NaiveDate, Utc};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct VolcanoReport {
    pub date: NaiveDate,
    pub report_time: DateTime<Utc>,

    // Seismic activity
    pub exhalations: u32,
    pub volcanotectonic_events: u32,
    pub tremor_minutes_total: u32,
    pub tremor_high_frequency_minutes: Option<u32>,
    pub tremor_harmonic_minutes: Option<u32>,
    pub explosions: u32,

    // Emissions
    pub so2_emissions_tons_per_day: Option<f64>,
    pub so2_measurement_date: Option<NaiveDate>,

    // Alert status
    pub alert_level: AlertLevel,
    pub alert_phase: String, // "AMARILLO FASE 2"

    // Environmental
    pub wind_direction: Option<WindDirection>,

    // Narrative
    pub summary_spanish: String,

    // Media
    pub image_urls: Vec<String>,
    pub video_urls: Vec<String>,

    // Metadata
    pub source_url: String,
    pub scraped_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
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
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
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
    pub fn from_spanish(text: &str) -> Option<Self> {
        let normalized = text.to_lowercase().replace([' ', '-'], "");

        // Try compound directions first (more specific)
        if normalized.contains("nortenoroeste") || normalized.contains("nornoroeste") {
            return Some(WindDirection::NNW);
        }
        if normalized.contains("noroeste") {
            return Some(WindDirection::NW);
        }
        if normalized.contains("oestenoroeste") || normalized.contains("oestennoroeste") {
            return Some(WindDirection::WNW);
        }
        if normalized.contains("oestesuroeste") || normalized.contains("oestessuroeste") {
            return Some(WindDirection::WSW);
        }
        if normalized.contains("suroeste") {
            return Some(WindDirection::SW);
        }
        if normalized.contains("sursuroeste") || normalized.contains("surssuroeste") {
            return Some(WindDirection::SSW);
        }
        if normalized.contains("sursureste") || normalized.contains("surssureste") {
            return Some(WindDirection::SSE);
        }
        if normalized.contains("sureste") {
            return Some(WindDirection::SE);
        }
        if normalized.contains("estesureste") || normalized.contains("estessureste") {
            return Some(WindDirection::ESE);
        }
        if normalized.contains("estenoreste") {
            return Some(WindDirection::ENE);
        }
        if normalized.contains("noreste") {
            return Some(WindDirection::NE);
        }
        if normalized.contains("nortenoreste") || normalized.contains("nornoreste") {
            return Some(WindDirection::NNE);
        }

        // Try cardinal directions last (less specific)
        if normalized.contains("norte") {
            return Some(WindDirection::N);
        }
        if normalized.contains("oeste") || normalized.contains("oeste") {
            return Some(WindDirection::W);
        }
        if normalized.contains("sur") {
            return Some(WindDirection::S);
        }
        if normalized.contains("este") {
            return Some(WindDirection::E);
        }

        None
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
        assert_eq!(
            AlertLevel::from_spanish("VERDE"),
            Some(AlertLevel::Green)
        );
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
    }

    #[test]
    fn test_volcano_report_serialization() {
        let report = VolcanoReport {
            date: NaiveDate::from_ymd_opt(2025, 10, 6).unwrap(),
            report_time: Utc::now(),
            exhalations: 15,
            volcanotectonic_events: 0,
            tremor_minutes_total: 53,
            tremor_high_frequency_minutes: Some(39),
            tremor_harmonic_minutes: Some(14),
            explosions: 0,
            so2_emissions_tons_per_day: Some(2603.0),
            so2_measurement_date: Some(NaiveDate::from_ymd_opt(2024, 10, 10).unwrap()),
            alert_level: AlertLevel::Yellow,
            alert_phase: "AMARILLO FASE 2".to_string(),
            wind_direction: Some(WindDirection::NNW),
            summary_spanish: "Test summary".to_string(),
            image_urls: vec!["https://example.com/img.jpg".to_string()],
            video_urls: vec!["https://example.com/vid.mp4".to_string()],
            source_url: "https://www.cenapred.unam.mx/...".to_string(),
            scraped_at: Utc::now(),
        };

        let json = serde_json::to_string_pretty(&report).unwrap();
        assert!(json.contains("\"exhalations\": 15"));
        assert!(json.contains("\"alert_level\": \"YELLOW\""));
    }
}
