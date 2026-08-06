//! End-to-end tests against a fixture feed on disk.
//!
//! These deliberately do not touch the network. The live feed is exercised by
//! the ignored smoke test at the bottom.

use chrono::{NaiveDate, Utc};
use popo_cli::{AlertLevel, Feed, PopoError, WindDirection};
use std::fs;
use std::path::{Path, PathBuf};

fn report_json(date: &str, exhalations: &str, extra: &str) -> String {
    format!(
        r#"{{
  "schema_version": 1,
  "date": "{date}",
  "exhalations": {exhalations},
  "volcanotectonic_events": 0,
  "tremor_minutes_total": 0,
  "explosions": 0,
  "alert_level": "YELLOW",
  "alert_phase": "AMARILLO FASE 2",
  "wind_direction": "SE",
  "summary_spanish": "Se detectaron exhalaciones.",
  "ashfall_reports": [],
  "image_urls": [],
  "video_urls": [],
  "source_url": "https://www.cenapred.unam.mx/",
  "ingested_at": "2026-08-05T17:04:00Z"{extra}
}}"#
    )
}

fn build_feed(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("popo-it-{}", name));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(dir.join("reports/2026")).unwrap();
    fs::create_dir_all(dir.join("reports/2022")).unwrap();

    let latest = report_json("2026-08-04", "160", "");
    fs::write(dir.join("latest.json"), &latest).unwrap();
    fs::write(dir.join("reports/2026/2026-08-04.json"), &latest).unwrap();

    // A historical report, including an SO2 reading contemporaneous with it.
    fs::write(
        dir.join("reports/2022/2022-04-27.json"),
        report_json(
            "2022-04-27",
            "40",
            r#",
  "so2_emissions_tons_per_day": 2603.0,
  "so2_measurement_date": "2022-04-25""#,
        ),
    )
    .unwrap();

    // A counter-only record, exactly as the backfill writes the other 14 days
    // of a 15-day chart window.
    fs::write(
        dir.join("reports/2022/2022-04-13.json"),
        r#"{
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
}"#,
    )
    .unwrap();

    // An early report with genuinely missing counters.
    fs::create_dir_all(dir.join("reports/2001")).unwrap();
    fs::write(
        dir.join("reports/2001/2001-01-05.json"),
        r#"{
  "schema_version": 1,
  "date": "2001-01-05",
  "alert_level": "YELLOW",
  "alert_phase": "AMARILLO FASE 2",
  "ingested_at": "2026-08-05T17:04:00Z"
}"#,
    )
    .unwrap();

    fs::write(
        dir.join("index.json"),
        format!(
            r#"{{
  "schema_version": 1,
  "updated_at": "{}",
  "earliest": "2001-01-05",
  "latest": "2026-08-04",
  "count": 3,
  "dates": ["2001-01-05", "2022-04-27", "2026-08-04"]
}}"#,
            Utc::now().to_rfc3339()
        ),
    )
    .unwrap();

    dir
}

fn feed_at(dir: &Path) -> Feed {
    Feed::with_base(dir.to_str().unwrap())
}

#[test]
fn latest_report_round_trips() {
    let dir = build_feed("latest");
    let report = feed_at(&dir).latest().unwrap();

    assert_eq!(report.date, NaiveDate::from_ymd_opt(2026, 8, 4).unwrap());
    assert_eq!(report.exhalations, Some(160));
    assert_eq!(report.alert_level, Some(AlertLevel::Yellow));
    assert_eq!(report.wind_direction, Some(WindDirection::SE));
}

#[test]
fn historical_report_is_retrievable_by_date() {
    let dir = build_feed("historical");
    let date = NaiveDate::from_ymd_opt(2022, 4, 27).unwrap();
    let report = feed_at(&dir).get(date).unwrap();

    assert_eq!(report.date, date);
    assert_eq!(report.exhalations, Some(40));
    // Contemporaneous SO2 is kept.
    assert_eq!(report.so2_emissions_tons_per_day, Some(2603.0));
    assert_eq!(
        report.so2_measurement_date,
        Some(NaiveDate::from_ymd_opt(2022, 4, 25).unwrap())
    );
}

/// The archive reaches back ~26 years; early reports omit counters entirely.
/// That must surface as "not reported", never as zero.
#[test]
fn early_report_preserves_missing_counters() {
    let dir = build_feed("early");
    let date = NaiveDate::from_ymd_opt(2001, 1, 5).unwrap();
    let report = feed_at(&dir).get(date).unwrap();

    assert_eq!(report.exhalations, None);
    assert_eq!(report.volcanotectonic_events, None);
    assert_eq!(report.tremor_minutes_total, None);
    assert_eq!(report.so2_emissions_tons_per_day, None);
}

/// Backfill writes 14 counter-only days per request. The client must read them
/// rather than choke on the nulls, and must not present them as full reports.
#[test]
fn partial_records_are_readable_and_flagged() {
    let dir = build_feed("partial");
    let date = NaiveDate::from_ymd_opt(2022, 4, 13).unwrap();
    let report = feed_at(&dir).get(date).unwrap();

    assert!(report.partial);
    assert!(!report.is_full());
    assert_eq!(report.exhalations, Some(22));
    assert_eq!(report.alert_level, None);
    assert_eq!(report.alert_phase, None);
    assert_eq!(report.summary_spanish, None);
}

#[test]
fn absent_date_is_not_found() {
    let dir = build_feed("absent");
    let missing = NaiveDate::from_ymd_opt(2019, 5, 1).unwrap();

    match feed_at(&dir).get(missing) {
        Err(PopoError::NotFound(d)) => assert_eq!(d, missing),
        other => panic!("expected NotFound, got {:?}", other.map(|r| r.date)),
    }
}

#[test]
fn index_describes_coverage() {
    let dir = build_feed("index");
    let index = feed_at(&dir).index().unwrap();

    assert_eq!(index.count, 3);
    assert_eq!(index.earliest, NaiveDate::from_ymd_opt(2001, 1, 5).unwrap());
    assert_eq!(index.latest, NaiveDate::from_ymd_opt(2026, 8, 4).unwrap());
    assert_eq!(index.dates.len(), 3);
}

/// Live check against the published feed. Ignored by default so the suite stays
/// offline and deterministic; run with `cargo test -- --ignored`.
#[test]
#[ignore]
fn live_feed_smoke_test() {
    let report = Feed::new().latest().expect("live feed should be reachable");
    assert!(report.date.format("%Y").to_string().starts_with("20"));
}
