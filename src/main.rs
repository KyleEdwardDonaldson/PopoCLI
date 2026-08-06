use chrono::NaiveDate;
use clap::{Parser, Subcommand};
use popo_cli::{AlertLevel, Feed, FeedIndex, PopoError, Result, VolcanoReport};

#[derive(Parser)]
#[command(name = "popo")]
#[command(about = "Popocatépetl volcano monitoring CLI", long_about = None)]
#[command(version)]
struct Cli {
    #[command(subcommand)]
    command: Option<Commands>,

    /// Read from a different feed (URL or local directory).
    /// Also settable with POPO_FEED_BASE.
    #[arg(long, global = true, value_name = "URL_OR_PATH")]
    feed: Option<String>,
}

#[derive(Subcommand)]
enum Commands {
    /// Show the latest report (human-readable)
    Latest,

    /// Show the latest report as JSON
    Json,

    /// Show the current alert status in detail
    Alert,

    /// Show the report for a specific date (YYYY-MM-DD)
    Get {
        /// Date in YYYY-MM-DD format (e.g. 2022-03-22)
        date: String,

        /// Output as JSON instead of human-readable
        #[arg(long)]
        json: bool,
    },

    /// Show what the feed covers
    Index {
        /// Output as JSON instead of human-readable
        #[arg(long)]
        json: bool,
    },
}

fn main() {
    if let Err(err) = run() {
        eprintln!("Error: {}", err);
        if let PopoError::Network(_) = err {
            eprintln!("\nThe feed could not be reached. Check your connection, or point");
            eprintln!("popo at another mirror with --feed / POPO_FEED_BASE.");
        }
        std::process::exit(1);
    }
}

fn run() -> Result<()> {
    let cli = Cli::parse();
    let feed = match &cli.feed {
        Some(base) => Feed::with_base(base.clone()),
        None => Feed::new(),
    };

    match cli.command {
        Some(Commands::Json) | None => {
            print_json(&feed.latest()?)?;
        }
        Some(Commands::Latest) => {
            print_human_readable(&feed.latest()?);
        }
        Some(Commands::Alert) => {
            print_alert_info(&feed.latest()?);
        }
        Some(Commands::Get { date, json }) => {
            let parsed_date = NaiveDate::parse_from_str(&date, "%Y-%m-%d")
                .map_err(|_| PopoError::InvalidDate(date.clone()))?;

            let report = feed.get(parsed_date)?;
            if json {
                print_json(&report)?;
            } else {
                print_human_readable(&report);
            }
        }
        Some(Commands::Index { json }) => {
            let index = feed.index()?;
            if json {
                print_json(&index)?;
            } else {
                print_index(&index);
            }
        }
    }

    Ok(())
}

fn print_json<T: serde::Serialize>(value: &T) -> Result<()> {
    let json = serde_json::to_string_pretty(value).map_err(|e| PopoError::Parse(e.to_string()))?;
    println!("{}", json);
    Ok(())
}

/// Render a counter that may legitimately be absent from the archive.
fn counter(value: Option<u32>) -> String {
    match value {
        Some(v) => v.to_string(),
        None => "not reported".to_string(),
    }
}

fn print_human_readable(report: &VolcanoReport) {
    println!("╔═══════════════════════════════════════════════════════════════╗");
    println!("║          POPOCATÉPETL VOLCANO MONITORING REPORT               ║");
    println!("╚═══════════════════════════════════════════════════════════════╝");
    println!();
    println!("📅 Report Date: {}", report.date);
    if report.partial {
        println!("ℹ️  Counters only — this day was recorded from a neighbouring");
        println!("   report's 15-day chart window, so it carries no narrative,");
        println!("   alert status, wind or media.");
    }
    println!();

    println!("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    println!("  SEISMIC ACTIVITY (Last 24 Hours)");
    println!("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    println!();
    println!(
        "  💨 Exhalations:               {}",
        counter(report.exhalations)
    );
    println!(
        "  💥 Explosions:                {}",
        counter(report.explosions)
    );
    println!(
        "  🌍 Volcanotectonic events:    {}",
        counter(report.volcanotectonic_events)
    );
    println!();
    println!(
        "  ⏱️  Total tremor:              {} minutes",
        counter(report.tremor_minutes_total)
    );
    if let Some(hf) = report.tremor_high_frequency_minutes {
        println!("     └─ High frequency:        {} minutes", hf);
    }
    if let Some(h) = report.tremor_harmonic_minutes {
        println!("     └─ Harmonic:              {} minutes", h);
    }
    println!();

    if let Some(level) = report.alert_level {
        println!("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
        println!("  ALERT STATUS");
        println!("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
        println!();
        println!("  {} Alert Level: {:?}", level.emoji(), level);
        if let Some(phase) = &report.alert_phase {
            println!("  📋 Phase: {}", phase);
        }
        println!();
    }

    if !report.ashfall_reports.is_empty() {
        println!("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
        println!("  ASHFALL REPORTED");
        println!("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
        println!();
        for place in &report.ashfall_reports {
            println!("  🌫️  {}", place);
        }
        println!();
    }

    if let Some(dir) = &report.wind_direction {
        println!("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
        println!("  ENVIRONMENTAL CONDITIONS");
        println!("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
        println!();
        println!("  🧭 Wind Direction: {:?}", dir);
        println!();
    }

    if let Some(so2) = report.so2_emissions_tons_per_day {
        println!("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
        println!("  EMISSIONS");
        println!("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
        println!();
        println!("  ☁️  SO₂ Emissions: {} tons/day", so2);
        if let Some(date) = report.so2_measurement_date {
            println!("     Measured: {}", date);
        }
        println!();
    }

    if !report.image_urls.is_empty() || !report.video_urls.is_empty() {
        println!("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
        println!("  MEDIA");
        println!("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
        println!();
        if !report.image_urls.is_empty() {
            println!("  📷 Images: {} available", report.image_urls.len());
            for (i, url) in report.image_urls.iter().take(3).enumerate() {
                println!("     {}. {}", i + 1, url);
            }
        }
        if !report.video_urls.is_empty() {
            println!("  🎥 Videos: {} available", report.video_urls.len());
            for (i, url) in report.video_urls.iter().take(3).enumerate() {
                println!("     {}. {}", i + 1, url);
            }
        }
        println!();
    }

    println!("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    println!("  SOURCE");
    println!("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    println!();
    if let Some(url) = report.source_url.as_deref().filter(|u| !u.is_empty()) {
        println!("  🔗 {}", url);
    }
    if let Some(ingested) = report.ingested_at {
        println!(
            "  ⏰ Ingested: {}",
            ingested.format("%Y-%m-%d %H:%M:%S UTC")
        );
    }
    println!();
}

fn print_alert_info(report: &VolcanoReport) {
    println!();
    println!("╔═══════════════════════════════════════════════════════════════╗");
    println!("║                    ALERT STATUS DETAILS                       ║");
    println!("╚═══════════════════════════════════════════════════════════════╝");
    println!();

    match report.alert_level {
        Some(level) => {
            let color_desc = match level {
                AlertLevel::Green => "GREEN",
                AlertLevel::Yellow => "YELLOW",
                AlertLevel::Orange => "ORANGE",
                AlertLevel::Red => "RED",
            };
            println!(
                "  {} Current Alert: {} - {}",
                level.emoji(),
                color_desc,
                report.alert_phase.as_deref().unwrap_or(color_desc)
            );
        }
        None => {
            println!("  ℹ️  No alert status published for {}.", report.date);
            println!("     This day was recorded from a neighbouring report's");
            println!("     counter window. Try a nearby date.");
        }
    }
    println!("  📅 As of: {}", report.date);
    println!();

    let Some(summary) = report.summary_spanish.as_deref().filter(|s| !s.is_empty()) else {
        return;
    };

    println!("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    println!("  SUMMARY (Spanish)");
    println!("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    println!();
    for paragraph in summary.split("\n\n") {
        for line in wrap_text(paragraph, 63) {
            println!("  {}", line);
        }
        println!();
    }
}

fn print_index(index: &FeedIndex) {
    println!();
    println!("  📚 Feed coverage");
    println!();
    println!("     Reports:  {}", index.count);
    println!("     Earliest: {}", index.earliest);
    println!("     Latest:   {}", index.latest);
    println!(
        "     Updated:  {}",
        index.updated_at.format("%Y-%m-%d %H:%M:%S UTC")
    );
    println!();
}

/// Wrap on whitespace at `width` columns, counting characters rather than
/// bytes so accented Spanish text does not wrap short.
fn wrap_text(text: &str, width: usize) -> Vec<String> {
    let mut result = Vec::new();
    let mut current_line = String::new();
    let mut current_len = 0;

    for word in text.split_whitespace() {
        let word_len = word.chars().count();
        if current_line.is_empty() {
            current_line = word.to_string();
            current_len = word_len;
        } else if current_len + word_len < width {
            current_line.push(' ');
            current_line.push_str(word);
            current_len += word_len + 1;
        } else {
            result.push(std::mem::take(&mut current_line));
            current_line = word.to_string();
            current_len = word_len;
        }
    }

    if !current_line.is_empty() {
        result.push(current_line);
    }

    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn wraps_on_word_boundaries() {
        let lines = wrap_text("uno dos tres cuatro cinco", 9);
        assert_eq!(lines, vec!["uno dos", "tres", "cuatro", "cinco"]);
    }

    /// Accented text must wrap by characters, not bytes.
    #[test]
    fn wraps_accented_text_by_chars() {
        let lines = wrap_text("ceniza volcánica ácida", 17);
        assert_eq!(lines, vec!["ceniza volcánica", "ácida"]);
    }

    #[test]
    fn counter_distinguishes_zero_from_absent() {
        assert_eq!(counter(Some(0)), "0");
        assert_eq!(counter(None), "not reported");
    }
}
