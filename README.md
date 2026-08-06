# 🌋 Popo CLI

> **Popocatépetl Volcano Monitoring CLI & Library**

A fast, reliable command-line tool and Rust library for volcanic activity data from Mexico's [CENAPRED](https://www.cenapred.unam.mx) monitoring system for Popocatépetl volcano.

[![Rust](https://img.shields.io/badge/rust-1.70+-orange.svg)](https://www.rust-lang.org)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

## ✨ Features

- 🚀 **Fast** - One HTTP GET against a static JSON feed. No HTML parsing at runtime
- 📊 **Rich Data** - Comprehensive volcanic activity metrics from official CENAPRED reports
- 📅 **Historical Data** - Reports by date, back to the start of the archive
- 🎨 **Multiple Output Formats** - Human-readable terminal output or JSON for programmatic use
- 🔄 **Easy Integration** - Use as a CLI tool or Rust library in your own projects
- 🌍 **Cross-Platform** - Works on Linux, macOS, and Windows
- 🛡️ **Doesn't scrape** - Ingestion happens once, centrally; your machine just reads JSON

## 🌐 Where the data comes from

`popo` does **not** scrape CENAPRED. That site sits behind a bot manager which
serves an HTTP 200 challenge page to every non-browser client, so per-user
scraping cannot work — it silently returns a page that looks fine and parses to
nothing.

Instead, a scheduled job ingests the official reports once with a real browser
and publishes plain JSON to this repository. The CLI is a thin client over that
feed, which means it is fast, stable, and never has to fight a WAF.

Point it somewhere else — a fork, a mirror, or a local directory — with
`--feed` or `POPO_FEED_BASE`:

```bash
popo --feed ./data latest
POPO_FEED_BASE=https://example.com/data popo latest
```

The feed layout and field semantics are specified in
[`docs/feed-schema.md`](docs/feed-schema.md).

## 📥 Installation

### From Source

```bash
git clone https://github.com/KyleEdwardDonaldson/PopoCLI.git
cd PopoCLI
cargo install --path .
```

### Using Cargo

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

See what the archive covers:
```bash
popo index
```

### As a Library

Add to your `Cargo.toml`:
```toml
[dependencies]
popo-cli = "0.2.0"
```

Use in your Rust code:
```rust
use popo_cli::{Feed, Result};
use chrono::NaiveDate;

fn main() -> Result<()> {
    let feed = Feed::new();

    // Latest report
    let report = feed.latest()?;
    println!("Alert Level: {:?}", report.alert_level);
    println!("Exhalations (24h): {:?}", report.exhalations);

    // A specific date
    let date = NaiveDate::from_ymd_opt(2022, 3, 22).unwrap();
    let historical = feed.get(date)?;
    println!("Historical tremor: {:?}", historical.tremor_minutes_total);

    // What's available
    let index = feed.index()?;
    println!("{} reports, {} to {}", index.count, index.earliest, index.latest);

    Ok(())
}
```

Counter fields are `Option<u32>`. The archive spans decades, and older reports
sometimes omit a metric entirely — `None` means "not reported", which is not
the same as `Some(0)`.

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
- **Ashfall Reports** - Places where ashfall was reported

### Media & Sources
- **Images** - Webcam images from volcano monitoring stations
- **Videos** - Time-lapse or event videos
- **Source URL** - Direct link to CENAPRED report
- **Timestamps** - Report date and ingestion time

> **A note on SO₂.** CENAPRED renders a single "last reading" on every report
> page, including pages for reports years older than the reading itself. The
> ingester only records SO₂ when the measurement is contemporaneous with the
> report; otherwise the field is `null`. A historical report showing no SO₂ is
> reporting honestly, not missing data.

## 📋 Example Output

### Human-Readable Format (`popo latest`)

```
╔═══════════════════════════════════════════════════════════════╗
║          POPOCATÉPETL VOLCANO MONITORING REPORT              ║
╚═══════════════════════════════════════════════════════════════╝

📅 Report Date: 2025-10-06

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  SEISMIC ACTIVITY (Last 24 Hours)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  💨 Exhalations:               15
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
  "schema_version": 1,
  "date": "2025-10-06",
  "exhalations": 15,
  "volcanotectonic_events": 0,
  "tremor_minutes_total": 53,
  "tremor_high_frequency_minutes": 39,
  "tremor_harmonic_minutes": 14,
  "explosions": 0,
  "so2_emissions_tons_per_day": null,
  "so2_measurement_date": null,
  "alert_level": "YELLOW",
  "alert_phase": "AMARILLO FASE 2",
  "wind_direction": "NNW",
  "ashfall_reports": ["Atlautla, Estado de México"],
  "image_urls": ["https://www.cenapred.unam.mx/media/..."],
  "video_urls": ["https://www.cenapred.unam.mx/media/..."],
  "ingested_at": "2025-10-07T01:27:20Z"
}
```

## 🏗️ Architecture

Two halves, deliberately separated:

```
CENAPRED (behind a bot manager)
      │
      │  ingest/ — real browser, runs on a schedule in CI
      ▼
  data/*.json  — committed to this repo
      │
      │  plain HTTPS GET
      ▼
   popo CLI    — no HTML parsing, no WAF
```

### Technology Stack
- **Rust** - CLI and library
- **reqwest** - HTTP client for reading the feed
- **clap** - Command-line argument parsing
- **serde** - Serialization/deserialization framework
- **chrono** - Date and time handling
- **Playwright** - drives a real browser in the ingest job only

### How It Works

1. A scheduled job loads the official report page in a real browser
2. It parses the report, including the inline Google Charts series that carry
   the counter metrics (rows are `['DD-MM-YYYY', value, colour]` — day-first)
3. It writes one JSON file per day plus `latest.json` and `index.json`
4. The CLI fetches that JSON and renders it

Each report page embeds a ~15-day window of every counter series, so a full
historical backfill costs roughly one request per 15 days rather than one per
day.

## 🧪 Development

### Running Tests

```bash
cargo test              # offline; uses fixture feeds
cargo test -- --ignored # also hits the live feed
```

Tests cover:
- Feed reads for latest, by-date, and index
- Wind direction parsing (16 compass directions in Spanish, longest-match first)
- Alert level extraction
- Absent counters staying distinct from zero
- Schema-version rejection and malformed-JSON handling

### Building

```bash
cargo build --release
```

The optimized binary will be in `target/release/popo`.

### Running the ingester

Only needed if you are publishing a feed yourself. It runs automatically in CI.

```bash
cd ingest
npm ci
npx playwright install --with-deps chromium
npm test                        # offline parser tests

node index.mjs latest           # ingest today's report
node index.mjs backfill --from 2022-01-01 --to 2022-12-31
node index.mjs parse page.html  # parse saved HTML offline
```

Two things are load-bearing and easy to break:

- Chromium must be the **full** build running **headed**. Radware challenges
  `chromium-headless-shell` and escalates plain headless mode straight to a
  CAPTCHA. On a headless box, prefix with `xvfb-run -a`.
- Never reload a page that is mid-challenge. Radware swaps the real content in
  underneath; re-navigating escalates to a CAPTCHA that retrying cannot clear.

Backfill is resumable (it skips dates already on disk) and rate-limited
(`--delay-ms`, default 1000). Please keep it polite — this is a public service
run by a disaster-prevention agency.

## 🗺️ Roadmap

- [x] Historical date queries (`popo get 2022-03-22`)
- [x] GitHub Actions for daily data archival
- [x] Published JSON feed, so the CLI no longer scrapes
- [ ] Complete historical backfill of the archive
- [ ] Date range queries (`popo range --from 2025-01-01 --to 2025-01-31`)
- [ ] CSV/Excel export functionality
- [ ] Notification system for alert level changes
- [ ] Historical data visualization
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

This tool redistributes publicly available data published by CENAPRED. It is not affiliated with or endorsed by CENAPRED or UNAM. Data is ingested on a schedule, so a report here may lag the official one. For official volcanic alerts and safety information, always refer directly to [CENAPRED's official sources](https://www.gob.mx/cenapred).

**Safety First:** Volcano monitoring data should be used for informational purposes only. Always follow official evacuation orders and safety guidelines from local authorities.

## 📞 Contact

- **Author:** Kyle Edward Donaldson
- **Repository:** https://github.com/KyleEdwardDonaldson/PopoCLI
- **Issues:** https://github.com/KyleEdwardDonaldson/PopoCLI/issues

---

Made with 🦀 Rust and ❤️ for volcano science
