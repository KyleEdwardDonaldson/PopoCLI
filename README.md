# 🌋 Popo CLI

> **Popocatépetl Volcano Monitoring CLI & Library**

A fast, reliable command-line tool and Rust library for fetching real-time volcanic activity data from Mexico's [CENAPRED](https://www.cenapred.unam.mx) monitoring system for Popocatépetl volcano.

[![Rust](https://img.shields.io/badge/rust-1.70+-orange.svg)](https://www.rust-lang.org)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

## ✨ Features

- 🚀 **Fast & Efficient** - Written in Rust, blazingly fast scraping with minimal resource usage
- 📊 **Rich Data** - Comprehensive volcanic activity metrics from official CENAPRED reports
- 📅 **Historical Data** - Access reports from any date (format: YYYY-MM-DD)
- 🎨 **Multiple Output Formats** - Human-readable terminal output or JSON for programmatic use
- 🔄 **Easy Integration** - Use as a CLI tool or Rust library in your own projects
- 🌍 **Cross-Platform** - Works on Linux, macOS, and Windows
- 📦 **Zero-Cost Distribution** - No servers to maintain, runs entirely on your machine

## 📥 Installation

### From Source

```bash
git clone https://github.com/KyleEdwardDonaldson/PopoCLI.git
cd PopoCLI
cargo install --path .
```

### Using Cargo (coming soon)

```bash
cargo install popo-cli
```

## 🚀 Quick Start

### CLI Usage

Fetch the latest volcano report (human-readable):
```bash
popo latest
```

Get data in JSON format:
```bash
popo json
```

Show detailed alert information:
```bash
popo alert
```

Fetch a specific historical date:
```bash
# Human-readable format
popo get 2022-03-22

# JSON format
popo get 2022-03-22 --json
```

### As a Library

Add to your `Cargo.toml`:
```toml
[dependencies]
popo-cli = "0.1.0"
```

Use in your Rust code:
```rust
use popo_cli::{Scraper, Result};
use chrono::NaiveDate;

fn main() -> Result<()> {
    let scraper = Scraper::new();

    // Fetch latest report
    let report = scraper.fetch_latest()?;
    println!("Alert Level: {:?}", report.alert_level);
    println!("Exhalations (24h): {}", report.exhalations);

    // Fetch historical date
    let date = NaiveDate::from_ymd_opt(2022, 3, 22).unwrap();
    let historical = scraper.fetch_date(date)?;
    println!("Historical tremor: {}", historical.tremor_minutes_total);

    Ok(())
}
```

### From Other Languages

Since `popo` outputs clean JSON, you can easily use it from any language:

**Python:**
```python
import subprocess
import json

result = subprocess.run(['popo', 'json'], capture_output=True, text=True)
data = json.loads(result.stdout)
print(f"Alert Level: {data['alert_level']}")
```

**Node.js:**
```javascript
const { execSync } = require('child_process');
const data = JSON.parse(execSync('popo json').toString());
console.log(`Alert Level: ${data.alert_level}`);
```

**Go:**
```go
cmd := exec.Command("popo", "json")
output, _ := cmd.Output()
var data map[string]interface{}
json.Unmarshal(output, &data)
```

## 📊 Data Points

Each report includes:

### Seismic Activity (Last 24 Hours)
- **Exhalations** - Low-intensity volcanic gas emissions
- **Explosions** - Violent eruption events
- **Volcanotectonic Events** - Earthquake-like events from magma movement
- **Tremor Minutes** - Continuous volcanic tremor duration
  - High-frequency tremor breakdown
  - Harmonic tremor breakdown

### Alert Status
- **Alert Level** - Green, Yellow, Orange, or Red
- **Alert Phase** - Detailed phase information (e.g., "AMARILLO FASE 2")

### Environmental Data
- **Wind Direction** - 16-point compass direction of volcanic plume
- **SO₂ Emissions** - Sulfur dioxide emission rate (tons/day)

### Media & Sources
- **Images** - Webcam images from volcano monitoring stations
- **Videos** - Time-lapse or event videos
- **Source URL** - Direct link to CENAPRED report
- **Timestamps** - Report date and scrape time

## 📋 Example Output

### Human-Readable Format (`popo latest`)

```
╔═══════════════════════════════════════════════════════════════╗
║          POPOCATÉPETL VOLCANO MONITORING REPORT              ║
╚═══════════════════════════════════════════════════════════════╝

📅 Report Date: 2025-10-06
🕐 Report Time: 2025-10-07 01:27:20 UTC

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  SEISMIC ACTIVITY (Last 24 Hours)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  💨 Exhalations:              15
  💥 Explosions:                0
  🌍 Volcanotectonic events:    0

  ⏱️  Total tremor:              53 minutes
     └─ High frequency:        39 minutes
     └─ Harmonic:              14 minutes

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  ALERT STATUS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  🟡 Alert Level: Yellow
  📋 Phase: AMARILLO - FASE 2
```

### JSON Format (`popo json`)

```json
{
  "date": "2025-10-06",
  "exhalations": 15,
  "volcanotectonic_events": 0,
  "tremor_minutes_total": 53,
  "tremor_high_frequency_minutes": 39,
  "tremor_harmonic_minutes": 14,
  "explosions": 0,
  "alert_level": "YELLOW",
  "alert_phase": "AMARILLO - FASE 2",
  "wind_direction": "n-n-w",
  "so2_emissions_tons_per_day": 2603.0,
  "image_urls": ["https://www.cenapred.unam.mx/media/..."],
  "video_urls": ["https://www.cenapred.unam.mx/media/..."]
}
```

## 🏗️ Architecture

### Technology Stack
- **Rust** - High-performance systems programming language
- **reqwest** - HTTP client for fetching reports
- **scraper** - HTML parsing with CSS selectors
- **clap** - Command-line argument parsing
- **serde** - Serialization/deserialization framework
- **chrono** - Date and time handling

### How It Works

1. **Fetches** the latest report from CENAPRED's technical report system
2. **Parses** HTML content including JavaScript-generated Google Charts data
3. **Extracts** structured data using CSS selectors and regex patterns
4. **Validates** and transforms data into type-safe Rust structures
5. **Outputs** in requested format (human-readable or JSON)

The scraper is resilient to:
- Multiple HTML formats (handles both static tables and JS-rendered charts)
- Various date formats (Spanish long-form and ISO dates)
- Missing optional fields (graceful degradation)
- Network issues (proper error handling with retry logic)

## 🧪 Development

### Running Tests

```bash
cargo test
```

All tests include:
- Unit tests for date parsing (Spanish months, multiple formats)
- Wind direction parsing (16 compass directions in Spanish)
- Alert level extraction
- HTML fixture parsing
- Live scraping integration test

### Building

```bash
cargo build --release
```

The optimized binary will be in `target/release/popo`.

## 🗺️ Roadmap

- [x] Historical date queries (`popo get 2022-03-22`)
- [ ] SQLite storage for historical data tracking
- [ ] Date range queries (`popo range --from 2025-01-01 --to 2025-01-31`)
- [ ] CSV/Excel export functionality
- [ ] Notification system for alert level changes
- [ ] Historical data visualization
- [ ] GitHub Actions for daily data archival
- [ ] Multi-volcano support (if other Mexican volcanoes share the format)

## 🤝 Contributing

Contributions welcome! This is an open-source project to provide better access to volcanic monitoring data.

### Development Setup

1. Fork and clone the repository
2. Make your changes
3. Run tests: `cargo test`
4. Format code: `cargo fmt`
5. Check lints: `cargo clippy`
6. Submit a pull request

## 📄 License

MIT License - see [LICENSE](LICENSE) for details

## 🙏 Acknowledgments

- **CENAPRED (Centro Nacional de Prevención de Desastres)** - For providing public volcanic monitoring data
- **UNAM (Universidad Nacional Autónoma de México)** - For collaborative volcano monitoring
- The Rust community for excellent libraries and tooling

## ⚠️ Disclaimer

This tool scrapes publicly available data from CENAPRED's website. It is not affiliated with or endorsed by CENAPRED or UNAM. For official volcanic alerts and safety information, always refer directly to [CENAPRED's official sources](https://www.gob.mx/cenapred).

**Safety First:** Volcano monitoring data should be used for informational purposes only. Always follow official evacuation orders and safety guidelines from local authorities.

## 📞 Contact

- **Author:** Kyle Edward Donaldson
- **Repository:** https://github.com/KyleEdwardDonaldson/PopoCLI
- **Issues:** https://github.com/KyleEdwardDonaldson/PopoCLI/issues

---

Made with 🦀 Rust and ❤️ for volcano science
