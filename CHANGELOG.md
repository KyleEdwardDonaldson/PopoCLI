# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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

[0.1.0]: https://github.com/KyleEdwardDonaldson/PopoCLI/releases/tag/v0.1.0
