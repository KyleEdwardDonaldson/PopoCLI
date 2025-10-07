use chrono::NaiveDate;
use popo_cli::Scraper;

/// Integration tests for historical date fetching
/// These tests make real HTTP requests to CENAPRED's website
/// to verify that historical data retrieval works correctly

#[test]
fn test_fetch_march_2022() {
    let scraper = Scraper::new();
    let date = NaiveDate::from_ymd_opt(2022, 3, 22).unwrap();

    let result = scraper.fetch_date(date);
    assert!(result.is_ok(), "Failed to fetch March 22, 2022: {:?}", result.err());

    let report = result.unwrap();
    assert_eq!(report.date, date, "Date mismatch");
    assert_eq!(report.exhalations, 26, "Expected 26 exhalations on 2022-03-22");
    assert_eq!(report.tremor_minutes_total, 234, "Expected 234 tremor minutes on 2022-03-22");
}

#[test]
fn test_fetch_january_2023() {
    let scraper = Scraper::new();
    let date = NaiveDate::from_ymd_opt(2023, 1, 15).unwrap();

    let result = scraper.fetch_date(date);
    assert!(result.is_ok(), "Failed to fetch January 15, 2023: {:?}", result.err());

    let report = result.unwrap();
    assert_eq!(report.date, date, "Date mismatch");
    // Verify we got the expected data structure
    assert!(report.exhalations < 1000, "Exhalations should be a reasonable number");
    assert!(report.tremor_minutes_total < 2000, "Tremor minutes should be reasonable (< 24h)");
}

#[test]
fn test_fetch_june_2023() {
    let scraper = Scraper::new();
    let date = NaiveDate::from_ymd_opt(2023, 6, 10).unwrap();

    let result = scraper.fetch_date(date);
    assert!(result.is_ok(), "Failed to fetch June 10, 2023: {:?}", result.err());

    let report = result.unwrap();
    assert_eq!(report.date, date, "Date mismatch");
    // Verify data is within reasonable bounds
    assert!(report.exhalations < 1000, "Exhalations should be reasonable");
}

#[test]
fn test_fetch_september_2024() {
    let scraper = Scraper::new();
    let date = NaiveDate::from_ymd_opt(2024, 9, 15).unwrap();

    let result = scraper.fetch_date(date);
    assert!(result.is_ok(), "Failed to fetch September 15, 2024: {:?}", result.err());

    let report = result.unwrap();
    assert_eq!(report.date, date, "Date mismatch");
    assert!(report.exhalations < 1000, "Exhalations should be reasonable");
}

#[test]
fn test_fetch_october_2024() {
    let scraper = Scraper::new();
    let date = NaiveDate::from_ymd_opt(2024, 10, 1).unwrap();

    let result = scraper.fetch_date(date);
    assert!(result.is_ok(), "Failed to fetch October 1, 2024: {:?}", result.err());

    let report = result.unwrap();
    assert_eq!(report.date, date, "Date mismatch");
    assert!(report.exhalations < 1000, "Exhalations should be reasonable");
}

#[test]
fn test_fetch_validates_correct_date() {
    let scraper = Scraper::new();
    let date = NaiveDate::from_ymd_opt(2023, 4, 20).unwrap();

    let result = scraper.fetch_date(date);
    assert!(result.is_ok(), "Failed to fetch April 20, 2023: {:?}", result.err());

    let report = result.unwrap();
    // The key test: verify the report date matches what we requested
    assert_eq!(
        report.date, date,
        "Report should match requested date exactly"
    );
}

#[test]
fn test_fetch_has_alert_level() {
    let scraper = Scraper::new();
    let date = NaiveDate::from_ymd_opt(2023, 7, 10).unwrap();

    let result = scraper.fetch_date(date);
    assert!(result.is_ok(), "Failed to fetch July 10, 2023: {:?}", result.err());

    let report = result.unwrap();
    // Historical reports should always have alert level data
    assert!(!report.alert_phase.is_empty(), "Should have alert phase");
}

#[test]
fn test_fetch_different_years() {
    let scraper = Scraper::new();

    // Test one date from each year 2022-2024
    let dates = vec![
        NaiveDate::from_ymd_opt(2022, 5, 10).unwrap(),
        NaiveDate::from_ymd_opt(2023, 5, 10).unwrap(),
        NaiveDate::from_ymd_opt(2024, 5, 10).unwrap(),
    ];

    for date in dates {
        let result = scraper.fetch_date(date);
        assert!(
            result.is_ok(),
            "Failed to fetch {}: {:?}",
            date,
            result.err()
        );

        let report = result.unwrap();
        assert_eq!(report.date, date, "Date mismatch for {}", date);
    }
}
