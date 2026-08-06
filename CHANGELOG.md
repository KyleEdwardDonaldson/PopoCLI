# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2026-08-06

Popo no longer scrapes CENAPRED. It reads a published JSON feed instead.

This is a full rewrite of how the tool gets its data, and it changes the public
API, so it lands as 1.0.0. Version 0.2.0 was developed but never released; its
changes are folded in here.

### Fixed

* **The CLI was completely broken.** CENAPRED put Radware Bot Manager in front
  of the site, which serves an HTTP 200 challenge page to every non-browser
  client. Every command failed with `Parse("Could not find date in report")`
  because the parser was handed a challenge page rather than a report. No
  combination of headers gets past it, so per-user scraping was abandoned.
* **Historical fetches could never have worked.** `fetch_date` used a
  `?fecha=YYYY-MM-DD` query string the site does not support. Historical
  reports are a POST keyed by an opaque sequential id.
* **The chart parser never matched.** It searched for ISO `YYYY-MM-DD` inside a
  series whose rows are day first, for example `['27-04-2022', 40, '#2fc1f1']`.
* **Compound wind directions were misread.** `oestenoroeste` matched the
  shorter `noroeste` first, resolving west-northwest as north-west. Matching is
  now longest first and covered by tests.
* **Text wrapping counted bytes rather than characters**, wrapping accented
  Spanish short.

### Added

* `popo index`, showing what the archive covers.
* `--feed` and `POPO_FEED_BASE` for reading from a fork, a mirror, or a local
  directory. Local paths work fully offline.
* `ashfall_reports`, capturing the places where ashfall was reported. The
  previous scraper discarded this.
* [`docs/feed-schema.md`](docs/feed-schema.md), specifying the feed contract.
* An ingestion pipeline under `ingest/` driving real Chromium, with `latest`,
  resumable `backfill`, scheduled `extend`, `verify` and offline `parse`
  commands.
* Scheduled workflows: twice-daily ingest, a daily history drip, and a manual
  ranged backfill.

### Changed

* **Breaking.** `Scraper` is replaced by `Feed`. `fetch_latest()` becomes
  `latest()`, and `fetch_date(d)` becomes `get(d)`.
* **Breaking.** Counter fields are now `Option<u32>`. The archive spans decades
  and older reports omit metrics entirely, so `None` means "not reported",
  which is not the same as `Some(0)`.
* **Breaking.** `alert_level`, `alert_phase` and `summary_spanish` are now
  optional, because records harvested from a neighbouring day's counter window
  legitimately lack them. Such records are flagged `partial`.
* **Breaking.** `wind_direction` serialises as `"NNW"` rather than `"n-n-w"`.
* **Breaking.** `report_time` and `scraped_at` are replaced by `ingested_at`.
* SO₂ is only recorded when the measurement is contemporaneous with the report.
  CENAPRED renders one global "last reading" on every page, so the old code
  would happily stamp a 2024 reading onto a 2022 report.
* Dropped the `scraper` crate dependency. The CLI no longer parses HTML at all.
* `Cargo.lock` is now committed, and the published crate excludes the feed data
  and ingestion tooling.

### Data quality

* **Week-year chart labels are repaired.** CENAPRED formats chart labels with a
  week-based year rather than a calendar year, so on reports spanning a year
  boundary the last days of December are stamped with the following year. Left
  alone this filed real counter data up to eleven months into the future. Rows
  are now judged against the median charted day and shifted a year when that
  lands them back inside the window.
* **Lost backfill anchors no longer punch holes.** A failed anchor used to skip
  a whole 15 day window silently. Backfill now retreats one day at a time, and
  `verify` sweeps for any hole that survives.

## [0.1.0] - 2025-10-07

### Added

* Initial release.
* CLI for fetching Popocatépetl monitoring data from CENAPRED.
* Latest report, historical dates, alert status, JSON and human readable output.
* Rust library API.
* Extraction of seismic activity, tremor breakdown, alert levels, wind
  direction, SO₂ and media URLs.
* Spanish date parsing and cross-platform support.

[1.0.0]: https://github.com/KyleEdwardDonaldson/PopoCLI/releases/tag/v1.0.0
[0.1.0]: https://github.com/KyleEdwardDonaldson/PopoCLI/releases/tag/v0.1.0
