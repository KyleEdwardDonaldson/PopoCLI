use crate::error::{PopoError, Result};
use crate::models::{AlertLevel, VolcanoReport, WindDirection};
use chrono::{Datelike, NaiveDate, Utc};
use scraper::{Html, Selector};

const BASE_URL: &str = "https://www.cenapred.unam.mx";
const REPORT_URL: &str = "https://www.cenapred.unam.mx/reportesVolcanesMX/Procesos?tipoProceso=detallesUltimoReporteVolcan";

pub struct Scraper {
    client: reqwest::blocking::Client,
}

impl Scraper {
    pub fn new() -> Self {
        let client = reqwest::blocking::Client::builder()
            .user_agent("popo-cli/0.1.0 (+https://github.com/KyleEdwardDonaldson/popo-cli)")
            .timeout(std::time::Duration::from_secs(30))
            .build()
            .expect("Failed to create HTTP client");

        Self { client }
    }

    pub fn fetch_latest(&self) -> Result<VolcanoReport> {
        let html = self.client.get(REPORT_URL).send()?.text()?;
        self.parse_report(&html)
    }

    pub fn fetch_date(&self, date: NaiveDate) -> Result<VolcanoReport> {
        // URL pattern: https://www.cenapred.unam.mx/reportesVolcanesMX/Procesos?fecha=YYYY-MM-DD
        let url = format!(
            "https://www.cenapred.unam.mx/reportesVolcanesMX/Procesos?fecha={}",
            date.format("%Y-%m-%d")
        );

        let response = self.client.get(&url).send()?;
        let html = response.text()?;
        let report = self.parse_report(&html)?;

        // Verify the date matches what we requested
        if report.date == date {
            Ok(report)
        } else {
            Err(PopoError::Parse(format!(
                "Report date mismatch: requested {}, got {}",
                date, report.date
            )))
        }
    }

    pub fn parse_report(&self, html: &str) -> Result<VolcanoReport> {
        let document = Html::parse_document(html);

        // Extract date from heading
        let date = Self::extract_date(&document)?;

        // Extract data from tables
        let exhalations = Self::extract_from_table(&document, "Exhalaciones", &date)?;
        let volcanotectonic_events = Self::extract_from_table(&document, "Volcanotectónicos", &date)?;
        let tremor_minutes_total = Self::extract_from_table(&document, "Minutos de tremor", &date)?;
        let explosions = Self::extract_from_table(&document, "Explosiones", &date)?;

        // Extract tremor breakdown from summary text
        let (tremor_high_freq, tremor_harmonic) = Self::extract_tremor_breakdown(&document);

        // Extract alert level and phase
        let (alert_level, alert_phase) = Self::extract_alert_info(&document)?;

        // Extract wind direction
        let wind_direction = Self::extract_wind_direction(&document);

        // Extract SO2 data
        let (so2_emissions, so2_date) = Self::extract_so2_data(&document);

        // Extract summary text
        let summary_spanish = Self::extract_summary(&document)?;

        // Extract media URLs
        let image_urls = Self::extract_image_urls(&document);
        let video_urls = Self::extract_video_urls(&document);

        Ok(VolcanoReport {
            date,
            report_time: Utc::now(),
            exhalations,
            volcanotectonic_events,
            tremor_minutes_total,
            tremor_high_frequency_minutes: tremor_high_freq,
            tremor_harmonic_minutes: tremor_harmonic,
            explosions,
            so2_emissions_tons_per_day: so2_emissions,
            so2_measurement_date: so2_date,
            alert_level,
            alert_phase,
            wind_direction,
            summary_spanish,
            image_urls,
            video_urls,
            source_url: REPORT_URL.to_string(),
            scraped_at: Utc::now(),
        })
    }

    fn extract_date(document: &Html) -> Result<NaiveDate> {
        let selector = Selector::parse("h4").unwrap();

        for element in document.select(&selector) {
            let text = element.text().collect::<String>();
            let trimmed = text.trim();

            // Try parsing "06 de Octubre de 2025" format
            if trimmed.contains("de") && trimmed.contains("de 20") {
                if let Ok(date) = Self::parse_spanish_date(trimmed) {
                    return Ok(date);
                }
            }

            // Try parsing ISO date format "2025-10-06"
            // Look for YYYY-MM-DD pattern in the text
            for part in trimmed.split(|c: char| c.is_whitespace() || c == '\u{00A0}') {
                if part.len() >= 10 {
                    let potential_date = &part[..part.len().min(10)];
                    if potential_date.chars().filter(|&c| c == '-').count() == 2 {
                        if let Ok(date) = NaiveDate::parse_from_str(potential_date, "%Y-%m-%d") {
                            return Ok(date);
                        }
                    }
                }
            }
        }

        Err(PopoError::Parse("Could not find date in report".to_string()))
    }

    pub fn parse_spanish_date(text: &str) -> Result<NaiveDate> {
        let parts: Vec<&str> = text.split_whitespace().collect();
        if parts.len() < 5 {
            return Err(PopoError::Parse(format!("Invalid date format: {}", text)));
        }

        let day: u32 = parts[0].parse()
            .map_err(|_| PopoError::Parse(format!("Invalid day: {}", parts[0])))?;

        let month = match parts[2].to_lowercase().as_str() {
            "enero" => 1,
            "febrero" => 2,
            "marzo" => 3,
            "abril" => 4,
            "mayo" => 5,
            "junio" => 6,
            "julio" => 7,
            "agosto" => 8,
            "septiembre" => 9,
            "octubre" => 10,
            "noviembre" => 11,
            "diciembre" => 12,
            _ => return Err(PopoError::Parse(format!("Invalid month: {}", parts[2]))),
        };

        let year: i32 = parts[4].parse()
            .map_err(|_| PopoError::Parse(format!("Invalid year: {}", parts[4])))?;

        NaiveDate::from_ymd_opt(year, month, day)
            .ok_or_else(|| PopoError::Parse(format!("Invalid date: {}-{}-{}", year, month, day)))
    }

    fn extract_from_table(document: &Html, table_name: &str, date: &NaiveDate) -> Result<u32> {
        let date_str = format!("{:02}-{:02}-{}", date.day(), date.month(), date.year());

        // First try HTML tables (for test fixtures)
        let table_selector = Selector::parse("table").unwrap();
        let row_selector = Selector::parse("tr").unwrap();
        let cell_selector = Selector::parse("td").unwrap();

        for table in document.select(&table_selector) {
            let header_text = table.text().collect::<String>();

            if header_text.contains(table_name) {
                // Find the row with our date
                for row in table.select(&row_selector) {
                    let cells: Vec<_> = row.select(&cell_selector).collect();

                    if cells.len() >= 2 {
                        let date_cell = cells[0].text().collect::<String>();

                        if date_cell.trim() == date_str {
                            let value_cell = cells[1].text().collect::<String>();
                            let value: u32 = value_cell.trim().parse()
                                .map_err(|_| PopoError::Parse(format!("Invalid value for {}: {}", table_name, value_cell)))?;
                            return Ok(value);
                        }
                    }
                }
            }
        }

        // Try parsing JavaScript data (for live site with Google Charts)
        let script_selector = Selector::parse("script").unwrap();
        for script in document.select(&script_selector) {
            let script_text = script.text().collect::<String>();

            let column_pattern = format!("addColumn('number', '{}')", table_name);
            if let Some(column_pos) = script_text.find(&column_pattern) {
                // Look for data.addRows([ ... ]) pattern AFTER the column definition
                let after_column = &script_text[column_pos..];
                if let Some(rows_start) = after_column.find("data.addRows([") {
                    let after_rows_start = &after_column[rows_start + 14..];
                    if let Some(rows_end) = after_rows_start.find("]);") {
                        let data_section = &after_rows_start[..rows_end];

                        // Parse each row: ['YYYY-MM-DD...', value, color]
                        // Look for a line that starts with the target date
                        let target_date_prefix = format!("'{}-{:02}-{:02}", date.year(), date.month(), date.day());
                        for line in data_section.lines() {
                            let trimmed = line.trim();
                            if trimmed.starts_with('[') && trimmed.contains(&target_date_prefix) {
                                // Extract the value (second element in array)
                                // Format: ['2025-10-06...', 15, '#color']
                                let parts: Vec<&str> = trimmed.split(',').collect();
                                if parts.len() >= 2 {
                                    let value_str = parts[1].trim();
                                    if let Ok(value) = value_str.parse::<u32>() {
                                        return Ok(value);
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }

        Err(PopoError::Parse(format!("Could not find {} data for date {}", table_name, date_str)))
    }

    fn extract_tremor_breakdown(document: &Html) -> (Option<u32>, Option<u32>) {
        let p_selector = Selector::parse("p").unwrap();

        for element in document.select(&p_selector) {
            let text = element.text().collect::<String>();

            // Look for pattern like "39 minutos fueron de alta frecuencia y 14 minutos de armónico"
            if text.contains("alta frecuencia") && text.contains("armónico") {
                let high_freq = Self::extract_number_before(&text, "minutos fueron de alta frecuencia");
                let harmonic = Self::extract_number_before(&text, "minutos de armónico");
                return (high_freq, harmonic);
            }
        }

        (None, None)
    }

    pub fn extract_number_before(text: &str, marker: &str) -> Option<u32> {
        if let Some(pos) = text.find(marker) {
            let before = &text[..pos];
            let words: Vec<&str> = before.split_whitespace().collect();
            if let Some(last_word) = words.last() {
                if let Ok(num) = last_word.parse::<u32>() {
                    return Some(num);
                }
            }
        }
        None
    }

    fn extract_alert_info(document: &Html) -> Result<(AlertLevel, String)> {
        let selector = Selector::parse("p, h4").unwrap();

        for element in document.select(&selector) {
            let text = element.text().collect::<String>();

            if text.contains("AMARILLO") || text.contains("VERDE") ||
               text.contains("ROJO") || text.contains("NARANJA") {
                if let Some(level) = AlertLevel::from_spanish(&text) {
                    let phase = text.trim().to_string();
                    return Ok((level, phase));
                }
            }
        }

        Err(PopoError::Parse("Could not find alert level".to_string()))
    }

    fn extract_wind_direction(document: &Html) -> Option<WindDirection> {
        let p_selector = Selector::parse("p").unwrap();

        for element in document.select(&p_selector) {
            let text = element.text().collect::<String>();

            if text.to_lowercase().contains("dirección") || text.to_lowercase().contains("direccion") {
                // Look for direction keywords
                if let Some(dir) = WindDirection::from_spanish(&text) {
                    return Some(dir);
                }
            }
        }

        // Also check div elements which might contain wind direction
        let div_selector = Selector::parse("div").unwrap();
        for element in document.select(&div_selector) {
            let text = element.text().collect::<String>();

            // Look in elements that might contain direction info
            if (text.contains("viento") || text.contains("Viento")) && text.len() < 100 {
                if let Some(dir) = WindDirection::from_spanish(&text) {
                    return Some(dir);
                }
            }
        }

        None
    }

    fn extract_so2_data(document: &Html) -> (Option<f64>, Option<NaiveDate>) {
        let selector = Selector::parse("div, p").unwrap();

        for element in document.select(&selector) {
            let text = element.text().collect::<String>();

            if text.contains("toneladas por día") && text.contains("bióxido de azufre") {
                // Extract number before "toneladas por día"
                if let Some(emissions) = Self::extract_so2_value(&text) {
                    let date = Self::extract_so2_date(&text);
                    return (Some(emissions), date);
                }
            }
        }

        (None, None)
    }

    fn extract_so2_value(text: &str) -> Option<f64> {
        let words: Vec<&str> = text.split_whitespace().collect();
        for (i, word) in words.iter().enumerate() {
            if *word == "toneladas" && i > 0 {
                if let Ok(val) = words[i - 1].parse::<f64>() {
                    return Some(val);
                }
            }
        }
        None
    }

    fn extract_so2_date(text: &str) -> Option<NaiveDate> {
        // Look for date pattern like "10 octubre 2024"
        let words: Vec<&str> = text.split_whitespace().collect();

        for i in 0..words.len().saturating_sub(2) {
            if let Ok(day) = words[i].parse::<u32>() {
                if let Some(month) = Self::parse_spanish_month(words[i + 1]) {
                    if let Ok(year) = words[i + 2].parse::<i32>() {
                        if let Some(date) = NaiveDate::from_ymd_opt(year, month, day) {
                            return Some(date);
                        }
                    }
                }
            }
        }

        None
    }

    pub fn parse_spanish_month(text: &str) -> Option<u32> {
        match text.to_lowercase().as_str() {
            "enero" => Some(1),
            "febrero" => Some(2),
            "marzo" => Some(3),
            "abril" => Some(4),
            "mayo" => Some(5),
            "junio" => Some(6),
            "julio" => Some(7),
            "agosto" => Some(8),
            "septiembre" => Some(9),
            "octubre" => Some(10),
            "noviembre" => Some(11),
            "diciembre" => Some(12),
            _ => None,
        }
    }

    fn extract_summary(document: &Html) -> Result<String> {
        let selector = Selector::parse("p").unwrap();
        let mut summary_parts = Vec::new();

        for element in document.select(&selector) {
            let text = element.text().collect::<String>().trim().to_string();

            if text.contains("exhalaciones") || text.contains("tremor") ||
               text.contains("actividad") {
                if !text.is_empty() && text.len() > 20 {
                    summary_parts.push(text);
                    if summary_parts.len() >= 3 {
                        break;
                    }
                }
            }
        }

        if summary_parts.is_empty() {
            // If no summary found with strict criteria, try to find any paragraph with substantial text
            for element in document.select(&selector) {
                let text = element.text().collect::<String>().trim().to_string();
                if !text.is_empty() && text.len() > 50 {
                    summary_parts.push(text);
                    if summary_parts.len() >= 3 {
                        break;
                    }
                }
            }
        }

        if summary_parts.is_empty() {
            Ok("No summary available".to_string())
        } else {
            Ok(summary_parts.join("\n\n"))
        }
    }

    fn extract_image_urls(document: &Html) -> Vec<String> {
        let selector = Selector::parse("a[href*='/media/']").unwrap();
        let mut urls = Vec::new();

        for element in document.select(&selector) {
            if let Some(href) = element.value().attr("href") {
                if href.ends_with(".jpg") || href.ends_with(".png") {
                    let full_url = if href.starts_with("http") {
                        href.to_string()
                    } else {
                        format!("{}{}", BASE_URL, href)
                    };
                    urls.push(full_url);
                }
            }
        }

        urls
    }

    fn extract_video_urls(document: &Html) -> Vec<String> {
        let selector = Selector::parse("a[href*='/media/']").unwrap();
        let mut urls = Vec::new();

        for element in document.select(&selector) {
            if let Some(href) = element.value().attr("href") {
                if href.ends_with(".mp4") || href.ends_with(".webm") {
                    let full_url = if href.starts_with("http") {
                        href.to_string()
                    } else {
                        format!("{}{}", BASE_URL, href)
                    };
                    urls.push(full_url);
                }
            }
        }

        urls
    }
}

impl Default for Scraper {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_spanish_date() {
        let result = Scraper::parse_spanish_date("06 de Octubre de 2025").unwrap();
        assert_eq!(result, NaiveDate::from_ymd_opt(2025, 10, 6).unwrap());

        let result = Scraper::parse_spanish_date("15 de Enero de 2024").unwrap();
        assert_eq!(result, NaiveDate::from_ymd_opt(2024, 1, 15).unwrap());
    }

    #[test]
    fn test_parse_report_with_fixture() {
        let html = include_str!("../tests/fixtures/minimal_report.html");
        let scraper = Scraper::new();

        let report = scraper.parse_report(html).unwrap();

        assert_eq!(report.date, NaiveDate::from_ymd_opt(2025, 10, 6).unwrap());
        assert_eq!(report.exhalations, 15);
        assert_eq!(report.volcanotectonic_events, 0);
        assert_eq!(report.tremor_minutes_total, 53);
        assert_eq!(report.explosions, 0);
        assert_eq!(report.alert_level, AlertLevel::Yellow);
        assert!(report.alert_phase.contains("AMARILLO"));

        // Check tremor breakdown
        assert_eq!(report.tremor_high_frequency_minutes, Some(39));
        assert_eq!(report.tremor_harmonic_minutes, Some(14));

        // Check SO2
        assert_eq!(report.so2_emissions_tons_per_day, Some(2603.0));

        // Check that we got some summary text
        assert!(!report.summary_spanish.is_empty());
        assert!(report.summary_spanish.contains("exhalaciones"));
    }

    #[test]
    fn test_extract_number_before() {
        let text = "se registraron 39 minutos fueron de alta frecuencia";
        let result = Scraper::extract_number_before(text, "minutos fueron de alta frecuencia");
        assert_eq!(result, Some(39));
    }

    #[test]
    fn test_parse_spanish_month() {
        assert_eq!(Scraper::parse_spanish_month("enero"), Some(1));
        assert_eq!(Scraper::parse_spanish_month("octubre"), Some(10));
        assert_eq!(Scraper::parse_spanish_month("diciembre"), Some(12));
        assert_eq!(Scraper::parse_spanish_month("invalid"), None);
    }
}
