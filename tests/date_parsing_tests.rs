use chrono::NaiveDate;
use popo_cli::Scraper;

/// Integration tests for date parsing across various months and years (2022-2025)
/// Tests random months to ensure the Spanish date parser works correctly

#[test]
fn test_parse_date_january_2022() {
    let result = Scraper::parse_spanish_date("15 de Enero de 2022").unwrap();
    assert_eq!(result, NaiveDate::from_ymd_opt(2022, 1, 15).unwrap());
}

#[test]
fn test_parse_date_march_2022() {
    let result = Scraper::parse_spanish_date("22 de Marzo de 2022").unwrap();
    assert_eq!(result, NaiveDate::from_ymd_opt(2022, 3, 22).unwrap());
}

#[test]
fn test_parse_date_june_2022() {
    let result = Scraper::parse_spanish_date("08 de Junio de 2022").unwrap();
    assert_eq!(result, NaiveDate::from_ymd_opt(2022, 6, 8).unwrap());
}

#[test]
fn test_parse_date_september_2022() {
    let result = Scraper::parse_spanish_date("30 de Septiembre de 2022").unwrap();
    assert_eq!(result, NaiveDate::from_ymd_opt(2022, 9, 30).unwrap());
}

#[test]
fn test_parse_date_december_2022() {
    let result = Scraper::parse_spanish_date("25 de Diciembre de 2022").unwrap();
    assert_eq!(result, NaiveDate::from_ymd_opt(2022, 12, 25).unwrap());
}

#[test]
fn test_parse_date_february_2023() {
    let result = Scraper::parse_spanish_date("14 de Febrero de 2023").unwrap();
    assert_eq!(result, NaiveDate::from_ymd_opt(2023, 2, 14).unwrap());
}

#[test]
fn test_parse_date_april_2023() {
    let result = Scraper::parse_spanish_date("17 de Abril de 2023").unwrap();
    assert_eq!(result, NaiveDate::from_ymd_opt(2023, 4, 17).unwrap());
}

#[test]
fn test_parse_date_july_2023() {
    let result = Scraper::parse_spanish_date("04 de Julio de 2023").unwrap();
    assert_eq!(result, NaiveDate::from_ymd_opt(2023, 7, 4).unwrap());
}

#[test]
fn test_parse_date_october_2023() {
    let result = Scraper::parse_spanish_date("12 de Octubre de 2023").unwrap();
    assert_eq!(result, NaiveDate::from_ymd_opt(2023, 10, 12).unwrap());
}

#[test]
fn test_parse_date_november_2023() {
    let result = Scraper::parse_spanish_date("28 de Noviembre de 2023").unwrap();
    assert_eq!(result, NaiveDate::from_ymd_opt(2023, 11, 28).unwrap());
}

#[test]
fn test_parse_date_january_2024() {
    let result = Scraper::parse_spanish_date("01 de Enero de 2024").unwrap();
    assert_eq!(result, NaiveDate::from_ymd_opt(2024, 1, 1).unwrap());
}

#[test]
fn test_parse_date_march_2024() {
    let result = Scraper::parse_spanish_date("18 de Marzo de 2024").unwrap();
    assert_eq!(result, NaiveDate::from_ymd_opt(2024, 3, 18).unwrap());
}

#[test]
fn test_parse_date_may_2024() {
    let result = Scraper::parse_spanish_date("05 de Mayo de 2024").unwrap();
    assert_eq!(result, NaiveDate::from_ymd_opt(2024, 5, 5).unwrap());
}

#[test]
fn test_parse_date_august_2024() {
    let result = Scraper::parse_spanish_date("21 de Agosto de 2024").unwrap();
    assert_eq!(result, NaiveDate::from_ymd_opt(2024, 8, 21).unwrap());
}

#[test]
fn test_parse_date_september_2024() {
    let result = Scraper::parse_spanish_date("15 de Septiembre de 2024").unwrap();
    assert_eq!(result, NaiveDate::from_ymd_opt(2024, 9, 15).unwrap());
}

#[test]
fn test_parse_date_december_2024() {
    let result = Scraper::parse_spanish_date("31 de Diciembre de 2024").unwrap();
    assert_eq!(result, NaiveDate::from_ymd_opt(2024, 12, 31).unwrap());
}

#[test]
fn test_parse_date_february_2025() {
    let result = Scraper::parse_spanish_date("10 de Febrero de 2025").unwrap();
    assert_eq!(result, NaiveDate::from_ymd_opt(2025, 2, 10).unwrap());
}

#[test]
fn test_parse_date_april_2025() {
    let result = Scraper::parse_spanish_date("25 de Abril de 2025").unwrap();
    assert_eq!(result, NaiveDate::from_ymd_opt(2025, 4, 25).unwrap());
}

#[test]
fn test_parse_date_june_2025() {
    let result = Scraper::parse_spanish_date("19 de Junio de 2025").unwrap();
    assert_eq!(result, NaiveDate::from_ymd_opt(2025, 6, 19).unwrap());
}

#[test]
fn test_parse_date_august_2025() {
    let result = Scraper::parse_spanish_date("07 de Agosto de 2025").unwrap();
    assert_eq!(result, NaiveDate::from_ymd_opt(2025, 8, 7).unwrap());
}

#[test]
fn test_parse_date_october_2025() {
    let result = Scraper::parse_spanish_date("06 de Octubre de 2025").unwrap();
    assert_eq!(result, NaiveDate::from_ymd_opt(2025, 10, 6).unwrap());
}

// Test all 12 months in lowercase to ensure case-insensitivity
#[test]
fn test_parse_date_lowercase_months() {
    assert_eq!(
        Scraper::parse_spanish_date("05 de enero de 2024").unwrap(),
        NaiveDate::from_ymd_opt(2024, 1, 5).unwrap()
    );
    assert_eq!(
        Scraper::parse_spanish_date("12 de febrero de 2024").unwrap(),
        NaiveDate::from_ymd_opt(2024, 2, 12).unwrap()
    );
    assert_eq!(
        Scraper::parse_spanish_date("20 de marzo de 2024").unwrap(),
        NaiveDate::from_ymd_opt(2024, 3, 20).unwrap()
    );
    assert_eq!(
        Scraper::parse_spanish_date("15 de abril de 2024").unwrap(),
        NaiveDate::from_ymd_opt(2024, 4, 15).unwrap()
    );
    assert_eq!(
        Scraper::parse_spanish_date("01 de mayo de 2024").unwrap(),
        NaiveDate::from_ymd_opt(2024, 5, 1).unwrap()
    );
    assert_eq!(
        Scraper::parse_spanish_date("30 de junio de 2024").unwrap(),
        NaiveDate::from_ymd_opt(2024, 6, 30).unwrap()
    );
    assert_eq!(
        Scraper::parse_spanish_date("14 de julio de 2024").unwrap(),
        NaiveDate::from_ymd_opt(2024, 7, 14).unwrap()
    );
    assert_eq!(
        Scraper::parse_spanish_date("28 de agosto de 2024").unwrap(),
        NaiveDate::from_ymd_opt(2024, 8, 28).unwrap()
    );
    assert_eq!(
        Scraper::parse_spanish_date("09 de septiembre de 2024").unwrap(),
        NaiveDate::from_ymd_opt(2024, 9, 9).unwrap()
    );
    assert_eq!(
        Scraper::parse_spanish_date("18 de octubre de 2024").unwrap(),
        NaiveDate::from_ymd_opt(2024, 10, 18).unwrap()
    );
    assert_eq!(
        Scraper::parse_spanish_date("22 de noviembre de 2024").unwrap(),
        NaiveDate::from_ymd_opt(2024, 11, 22).unwrap()
    );
    assert_eq!(
        Scraper::parse_spanish_date("25 de diciembre de 2024").unwrap(),
        NaiveDate::from_ymd_opt(2024, 12, 25).unwrap()
    );
}

// Test edge cases - first and last day of months
#[test]
fn test_parse_date_edge_cases() {
    // First day of month
    assert_eq!(
        Scraper::parse_spanish_date("01 de Enero de 2023").unwrap(),
        NaiveDate::from_ymd_opt(2023, 1, 1).unwrap()
    );

    // Last day of January
    assert_eq!(
        Scraper::parse_spanish_date("31 de Enero de 2023").unwrap(),
        NaiveDate::from_ymd_opt(2023, 1, 31).unwrap()
    );

    // February leap year
    assert_eq!(
        Scraper::parse_spanish_date("29 de Febrero de 2024").unwrap(),
        NaiveDate::from_ymd_opt(2024, 2, 29).unwrap()
    );

    // February non-leap year
    assert_eq!(
        Scraper::parse_spanish_date("28 de Febrero de 2023").unwrap(),
        NaiveDate::from_ymd_opt(2023, 2, 28).unwrap()
    );

    // Last day of year
    assert_eq!(
        Scraper::parse_spanish_date("31 de Diciembre de 2023").unwrap(),
        NaiveDate::from_ymd_opt(2023, 12, 31).unwrap()
    );
}

// Test mixed case months
#[test]
fn test_parse_date_mixed_case() {
    assert_eq!(
        Scraper::parse_spanish_date("15 de ENERO de 2024").unwrap(),
        NaiveDate::from_ymd_opt(2024, 1, 15).unwrap()
    );
    assert_eq!(
        Scraper::parse_spanish_date("20 de MaRzO de 2024").unwrap(),
        NaiveDate::from_ymd_opt(2024, 3, 20).unwrap()
    );
}

// Test single digit days (without leading zero)
#[test]
fn test_parse_date_single_digit_day() {
    assert_eq!(
        Scraper::parse_spanish_date("5 de Mayo de 2024").unwrap(),
        NaiveDate::from_ymd_opt(2024, 5, 5).unwrap()
    );
    assert_eq!(
        Scraper::parse_spanish_date("9 de Septiembre de 2023").unwrap(),
        NaiveDate::from_ymd_opt(2023, 9, 9).unwrap()
    );
}

// Test capitalized first letter (common Spanish format)
#[test]
fn test_parse_date_capitalized() {
    assert_eq!(
        Scraper::parse_spanish_date("15 de Enero de 2024").unwrap(),
        NaiveDate::from_ymd_opt(2024, 1, 15).unwrap()
    );
    assert_eq!(
        Scraper::parse_spanish_date("20 de Octubre de 2024").unwrap(),
        NaiveDate::from_ymd_opt(2024, 10, 20).unwrap()
    );
}

// Test year boundaries
#[test]
fn test_parse_date_year_boundaries() {
    // Start of 2022
    assert_eq!(
        Scraper::parse_spanish_date("01 de Enero de 2022").unwrap(),
        NaiveDate::from_ymd_opt(2022, 1, 1).unwrap()
    );

    // End of 2022
    assert_eq!(
        Scraper::parse_spanish_date("31 de Diciembre de 2022").unwrap(),
        NaiveDate::from_ymd_opt(2022, 12, 31).unwrap()
    );

    // Start of 2025
    assert_eq!(
        Scraper::parse_spanish_date("01 de Enero de 2025").unwrap(),
        NaiveDate::from_ymd_opt(2025, 1, 1).unwrap()
    );
}
