# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.0] - 2026-08-05

Popo no longer scrapes CENAPRED. It reads a published JSON feed instead.

### Fixed
- **The CLI was completely broken.** CENAPRED put Radware Bot Manager in front
  of the site, which serves an HTTP 200 challenge page to every non-browser
  client. Every command failed with `Parse("Could not find date in report")`
  because the parser was being handed a challenge page. No amount of header
  tuning gets past it, so per-user scraping was abandoned.
- Historical fetches used a `?fecha=YYYY-MM-DD` query string that the site does
  not support. Historical reports are a POST keyed by an opaque sequential id,
  so `popo get <date>` could never have worked against the live site.
- The chart-data parser searched for ISO `YYYY-MM-DD` inside a series whose rows
  are day-first (`['27-04-2022', 40, '#2fc1f1']`), so it never matched.
- Compound wind directions were misread: `oestenoroeste` matched the shorter
  `noroeste` first and resolved WNW as NW. Matching is now longest-first.
- Text wrapping counted bytes rather than characters, wrapping accented Spanish
  short.

### Added
- `popo index` — show what the archive covers.
- `--feed` flag and `POPO_FEED_BASE` env var to read from a fork, a mirror, or a
  local directory. Local paths work offline.
- `ashfall_reports` field, which the previous scraper discarded.
- `docs/feed-schema.md` specifying the feed contract.
- Scheduled ingestion job that publishes the feed.

### Changed
- **Breaking:** `Scraper` is replaced by `Feed`. `fetch_latest()` → `latest()`,
  `fetch_date(d)` → `get(d)`.
- **Breaking:** counter fields are now `Option<u32>`. The archive spans decades
  and older reports omit metrics entirely; `None` means "not reported", which is
  not the same as `Some(0)`.
- **Breaking:** `wind_direction` serializes as `"NNW"` rather than `"n-n-w"`.
- **Breaking:** `report_time` and `scraped_at` are replaced by `ingested_at`.
- SO₂ is only recorded when the measurement is contemporaneous with the report.
  CENAPRED renders one global "last reading" on every page, so the old code
  would happily stamp a 2024 reading onto a 2022 report.
- Dropped the `scraper` crate dependency.

## [0.1.0] - 2025-10-07

### Added
- Initial release of popo-cli
- CLI tool for fetching Popocatépetl volcano monitoring data from CENAPRED
- Support for latest report fetching (`popo latest`, `popo json`)
- Historical date queries (`popo get YYYY-MM-DD`)
- Alert status display (`popo alert`)
- JSON and human-readable output formats
- Rust library API for programmatic access
- Comprehensive data extraction:
  - Seismic activity (exhalations, explosions, volcanotectonic events)
  - Tremor minutes (total, high-frequency, harmonic)
  - Alert levels and phases
  - Wind direction (16-point compass)
  - SO₂ emissions data
  - Media URLs (images and videos)
- Spanish date parsing for all 12 months
- Cross-platform support (Linux, macOS, Windows)
- Complete test suite (42 tests):
  - Unit tests for parsing logic
  - Date parsing tests (27 tests)
  - Historical fetch integration tests (8 tests)

### Technical Details
- Built with Rust 2021 edition
- Uses reqwest for HTTP requests
- HTML parsing with scraper crate
- CLI powered by clap
- Serde for JSON serialization

[0.2.0]: https://github.com/KyleEdwardDonaldson/PopoCLI/releases/tag/v0.2.0
[0.1.0]: https://github.com/KyleEdwardDonaldson/PopoCLI/releases/tag/v0.1.0
