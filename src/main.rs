use chrono::NaiveDate;
use clap::{Parser, Subcommand};
use popo_cli::{Result, Scraper};

#[derive(Parser)]
#[command(name = "popo")]
#[command(about = "Popocatépetl volcano monitoring CLI", long_about = None)]
#[command(version)]
struct Cli {
    #[command(subcommand)]
    command: Option<Commands>,
}

#[derive(Subcommand)]
enum Commands {
    /// Fetch the latest volcano report (human-readable format)
    Latest,

    /// Fetch the latest report in JSON format
    Json,

    /// Show detailed information about the current alert status
    Alert,

    /// Fetch a report for a specific date (YYYY-MM-DD format)
    Get {
        /// Date in YYYY-MM-DD format (e.g., 2022-03-22)
        date: String,

        /// Output as JSON instead of human-readable
        #[arg(long)]
        json: bool,
    },
}

fn main() -> Result<()> {
    let cli = Cli::parse();
    let scraper = Scraper::new();

    match cli.command {
        Some(Commands::Json) | None => {
            // Default to JSON if no command specified
            let report = scraper.fetch_latest()?;
            let json = serde_json::to_string_pretty(&report)
                .map_err(|e| popo_cli::PopoError::Parse(e.to_string()))?;
            println!("{}", json);
        }
        Some(Commands::Latest) => {
            let report = scraper.fetch_latest()?;
            print_human_readable(&report);
        }
        Some(Commands::Alert) => {
            let report = scraper.fetch_latest()?;
            print_alert_info(&report);
        }
        Some(Commands::Get { date, json }) => {
            let parsed_date = NaiveDate::parse_from_str(&date, "%Y-%m-%d")
                .map_err(|_| popo_cli::PopoError::Parse(
                    format!("Invalid date format '{}'. Use YYYY-MM-DD (e.g., 2022-03-22)", date)
                ))?;

            let report = scraper.fetch_date(parsed_date)?;

            if json {
                let json = serde_json::to_string_pretty(&report)
                    .map_err(|e| popo_cli::PopoError::Parse(e.to_string()))?;
                println!("{}", json);
            } else {
                print_human_readable(&report);
            }
        }
    }

    Ok(())
}

fn print_human_readable(report: &popo_cli::VolcanoReport) {
    println!("╔═══════════════════════════════════════════════════════════════╗");
    println!("║          POPOCATÉPETL VOLCANO MONITORING REPORT              ║");
    println!("╚═══════════════════════════════════════════════════════════════╝");
    println!();
    println!("📅 Report Date: {}", report.date);
    println!("🕐 Report Time: {}", report.report_time.format("%Y-%m-%d %H:%M:%S UTC"));
    println!();

    println!("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    println!("  SEISMIC ACTIVITY (Last 24 Hours)");
    println!("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    println!();
    println!("  💨 Exhalations:              {}", report.exhalations);
    println!("  💥 Explosions:                {}", report.explosions);
    println!("  🌍 Volcanotectonic events:    {}", report.volcanotectonic_events);
    println!();
    println!("  ⏱️  Total tremor:              {} minutes", report.tremor_minutes_total);
    if let Some(hf) = report.tremor_high_frequency_minutes {
        println!("     └─ High frequency:        {} minutes", hf);
    }
    if let Some(h) = report.tremor_harmonic_minutes {
        println!("     └─ Harmonic:              {} minutes", h);
    }
    println!();

    println!("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    println!("  ALERT STATUS");
    println!("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    println!();
    let alert_symbol = match report.alert_level {
        popo_cli::AlertLevel::Green => "🟢",
        popo_cli::AlertLevel::Yellow => "🟡",
        popo_cli::AlertLevel::Orange => "🟠",
        popo_cli::AlertLevel::Red => "🔴",
    };
    println!("  {} Alert Level: {:?}", alert_symbol, report.alert_level);
    println!("  📋 Phase: {}", report.alert_phase);
    println!();

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
    println!("  🔗 {}", report.source_url);
    println!("  ⏰ Scraped: {}", report.scraped_at.format("%Y-%m-%d %H:%M:%S UTC"));
    println!();
}

fn print_alert_info(report: &popo_cli::VolcanoReport) {
    let (emoji, color_desc) = match report.alert_level {
        popo_cli::AlertLevel::Green => ("🟢", "GREEN"),
        popo_cli::AlertLevel::Yellow => ("🟡", "YELLOW"),
        popo_cli::AlertLevel::Orange => ("🟠", "ORANGE"),
        popo_cli::AlertLevel::Red => ("🔴", "RED"),
    };

    println!();
    println!("╔═══════════════════════════════════════════════════════════════╗");
    println!("║                    ALERT STATUS DETAILS                      ║");
    println!("╚═══════════════════════════════════════════════════════════════╝");
    println!();
    println!("  {} Current Alert: {} - {}", emoji, color_desc, report.alert_phase);
    println!("  📅 As of: {}", report.date);
    println!();

    // Print summary paragraphs
    println!("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    println!("  SUMMARY (Spanish)");
    println!("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    println!();
    for paragraph in report.summary_spanish.split("\n\n") {
        let wrapped = textwrap::wrap(paragraph, 63);
        for line in wrapped {
            println!("  {}", line);
        }
        println!();
    }
}

fn textwrap_wrap(text: &str, width: usize) -> Vec<String> {
    let mut result = Vec::new();
    let mut current_line = String::new();

    for word in text.split_whitespace() {
        if current_line.is_empty() {
            current_line = word.to_string();
        } else if current_line.len() + word.len() + 1 <= width {
            current_line.push(' ');
            current_line.push_str(word);
        } else {
            result.push(current_line);
            current_line = word.to_string();
        }
    }

    if !current_line.is_empty() {
        result.push(current_line);
    }

    result
}

mod textwrap {
    pub fn wrap(text: &str, width: usize) -> Vec<String> {
        super::textwrap_wrap(text, width)
    }
}
