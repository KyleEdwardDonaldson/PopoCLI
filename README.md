<div align="center">

# 🌋 Popo CLI

**Popocatépetl volcano monitoring, in your terminal.**

Daily seismic counts, alert level, wind direction and ashfall reports for Mexico's
most closely watched volcano, straight from [CENAPRED](https://www.cenapred.unam.mx)'s
official monitoring programme.

[![Rust](https://img.shields.io/badge/rust-1.70+-orange.svg)](https://www.rust-lang.org)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Feed](https://img.shields.io/badge/feed-JSON-brightgreen.svg)](data/latest.json)

</div>

---

```console
$ popo latest

╔═══════════════════════════════════════════════════════════════╗
║          POPOCATÉPETL VOLCANO MONITORING REPORT               ║
╚═══════════════════════════════════════════════════════════════╝

📅 Report Date: 2026-08-05

  💨 Exhalations:               44
  💥 Explosions:                0
  🌍 Volcanotectonic events:    0
  ⏱️  Total tremor:              0 minutes

  🟡 Alert Level: Yellow
  📋 Phase: AMARILLO FASE 2
  🧭 Wind Direction: W
```

## Why this exists

CENAPRED publishes an excellent daily report. It is also a JavaScript-rendered
page sitting behind Radware Bot Manager, which serves any non-browser client an
HTTP 200 challenge page instead of the data. Tools that scrape it do not fail
loudly; they quietly parse a challenge page into nothing.

So `popo` does not scrape. A scheduled job ingests the official reports once,
centrally, using a real browser, and publishes plain JSON. The CLI is a thin,
fast client over that feed. You get a single HTTP GET against static JSON, and
CENAPRED gets one polite visitor a day instead of one per user.

## Install

```bash
cargo install popo-cli
```

Or from source:

```bash
git clone https://github.com/KyleEdwardDonaldson/PopoCLI.git
cd PopoCLI
cargo install --path . --locked
```

## Use it

| Command | What it does |
| --- | --- |
| `popo latest` | Most recent report, human readable |
| `popo json` | Most recent report as JSON (also the default with no command) |
| `popo alert` | Current alert level with the full Spanish narrative |
| `popo get 2022-03-22` | Any historical date, add `--json` for machine output |
| `popo index` | What the archive covers |

```bash
popo latest
popo get 2022-03-22 --json | jq '.exhalations'
popo index
```

### Point it somewhere else

Read from a fork, a mirror, or a directory on disk. Local paths work entirely
offline, which makes the CLI usable in air gapped environments if you sync the
feed yourself.

```bash
popo --feed ./data latest
POPO_FEED_BASE=https://example.com/data popo latest
```

## What you get

Each report carries the day's monitoring summary:

**Seismic activity**
Exhalations, explosions, volcanotectonic earthquakes, and tremor minutes broken
down into high frequency and harmonic where CENAPRED reports them.

**Alert status**
The *semáforo de alerta volcánica* as a normalised level (`GREEN`, `YELLOW`,
`ORANGE`, `RED`) plus the raw Spanish phase, for example `AMARILLO FASE 2`.

**Conditions and impact**
Plume wind direction on a 16 point compass, sulphur dioxide emission rate, and
the places where ashfall was actually reported.

**Media and provenance**
Webcam stills and video from the monitoring stations, the source URL, and the
ingestion timestamp.

### Three things worth knowing about the data

> **`null` is not zero.**
> Counter fields are `Option<u32>`. Across an archive spanning decades, "not
> reported" and "reported as zero" are different facts, and conflating them
> would quietly invent data.

> **Sulphur dioxide is sparse on purpose.**
> CENAPRED renders a single global "last reading" on every page, including
> pages for reports years older than the reading itself. The ingester only
> records SO₂ when the measurement is contemporaneous with the report. A
> historical report showing no SO₂ is being honest, not incomplete.

> **Some days carry counters only.**
> Each report page embeds a 15 day window of counter series, so backfilling one
> page yields real counts for 15 days. The narrative and alert status, though,
> describe only that page's own day. Rather than copy them across, the other
> days are flagged `"partial": true` with `null` for what is genuinely unknown.
> The CLI says so plainly rather than rendering a hollow report.

Full field semantics live in [`docs/feed-schema.md`](docs/feed-schema.md).

## As a library

```toml
[dependencies]
popo-cli = "1.0"
```

```rust
use chrono::NaiveDate;
use popo_cli::{Feed, Result};

fn main() -> Result<()> {
    let feed = Feed::new();

    let today = feed.latest()?;
    println!("{:?} / {:?}", today.alert_level, today.exhalations);

    let date = NaiveDate::from_ymd_opt(2022, 3, 22).unwrap();
    let historical = feed.get(date)?;
    println!("tremor: {:?} minutes", historical.tremor_minutes_total);

    let index = feed.index()?;
    println!("{} reports, {} to {}", index.count, index.earliest, index.latest);

    Ok(())
}
```

## From other languages

`popo json` writes clean JSON to stdout, so any language can use it:

```python
import json, subprocess
data = json.loads(subprocess.run(["popo", "json"], capture_output=True, text=True).stdout)
print(data["alert_level"])
```

```javascript
const { execSync } = require("child_process");
const data = JSON.parse(execSync("popo json").toString());
console.log(data.alert_level);
```

Or skip the binary entirely and read the feed directly:

```bash
curl -s https://raw.githubusercontent.com/KyleEdwardDonaldson/PopoCLI/main/data/latest.json
```

## Architecture

Two halves, deliberately separated. Only the left half ever talks to CENAPRED.

```
        CENAPRED  (behind Radware Bot Manager)
             │
             │   ingest/  real Chromium, on a schedule in CI
             ▼
        data/*.json  committed to this repo
             │
             │   plain HTTPS GET, no WAF, no HTML parsing
             ▼
         popo CLI
```

The ingester loads the official report page in a real browser and reads the
counter series out of the inline Google Charts data. Those rows are day first
(`['27-04-2022', 40, '#2fc1f1']`), which is the detail that broke the original
scraper: parsed as ISO, they never match.

## Running the ingester

Only needed if you publish a feed yourself. It runs automatically in CI.

```bash
cd ingest
npm ci
npx playwright install --with-deps chromium
npm test                        # offline parser tests

node index.mjs latest           # ingest today's report
node index.mjs backfill --from 2022-01-01 --to 2022-12-31
node index.mjs extend           # walk one chunk further back
node index.mjs verify           # sweep for missing days (offline)
node index.mjs verify --refill  # and fetch whatever is missing
node index.mjs parse page.html  # parse saved HTML offline
```

Three things are load bearing and easy to break:

1. **Chromium must be the full build, running headed.** Radware challenges
   `chromium-headless-shell` and escalates plain headless mode straight to a
   CAPTCHA. On a headless box, prefix with `xvfb-run -a`.
2. **Never reload a page that is mid challenge.** Radware swaps the real content
   in underneath. Re-navigating escalates to a CAPTCHA that retrying cannot
   clear.
3. **Rate limits are real.** Roughly 170 requests in an hour is enough to get
   throttled, which is why deep history is fetched by `extend` as a slow daily
   drip rather than in a burst. Please keep it polite. This is a public service
   run by a disaster prevention agency.

`verify` exists because a lost backfill anchor is invisible: the feed still
looks healthy, `index.json` is still self consistent, and only a day by day
sweep reveals the hole. It exits `3` on unclosed gaps so it can gate CI.

### Workflows

| Workflow | Trigger | Job |
| --- | --- | --- |
| `ingest.yml` | Twice daily | Fetch today's report, gap check as a canary |
| `extend.yml` | Daily | Walk the archive one chunk further back, self limiting |
| `backfill.yml` | Manual | Fetch an explicit date range, then refill any gaps |

## Development

```bash
cargo test              # offline, uses fixture feeds
cargo test -- --ignored # also exercises the live feed
cargo clippy --all-targets
cargo fmt
```

Tests cover feed reads, Spanish alert and wind parsing with longest match first,
absent counters staying distinct from zero, schema version rejection, and
malformed JSON handling. The ingester has its own suite covering chart parsing,
the SO₂ suppression rule, week year date repair, challenge detection and gap
finding, all without network access.

## Contributing

Issues and pull requests are welcome. Please run `cargo test`, `cargo clippy`
and `npm test --prefix ingest` before opening a PR, and keep changes to the
feed format additive so existing clients keep working. Breaking changes need a
`schema_version` bump and a note in [`docs/feed-schema.md`](docs/feed-schema.md).

## Acknowledgements

* **CENAPRED**, the Centro Nacional de Prevención de Desastres, for publishing
  this monitoring data openly.
* **UNAM**, the Universidad Nacional Autónoma de México, for the collaborative
  monitoring programme behind it.

## Disclaimer

This project redistributes publicly available data published by CENAPRED. It is
not affiliated with, endorsed by, or supported by CENAPRED or UNAM. Data is
ingested on a schedule, so a report here can lag the official one.

**For official volcanic alerts and safety guidance, always go directly to
[CENAPRED](https://www.gob.mx/cenapred) and follow the instructions of local
civil protection authorities.** Nothing here should be relied on for safety
decisions.

## License

MIT. See [LICENSE](LICENSE).

<div align="center">
<sub>Built with 🦀 Rust, for volcano science.</sub>
</div>
