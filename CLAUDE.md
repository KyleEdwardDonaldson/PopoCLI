# Project context

Popocatépetl volcano monitoring. A Rust CLI and library (`src/`) that reads a
static JSON feed (`data/`), produced by a Node and Playwright ingester
(`ingest/`) running on a schedule in GitHub Actions.

The single most important thing to understand: **the CLI never talks to
CENAPRED.** If you find yourself adding an HTTP call to `cenapred.unam.mx` in
`src/`, stop. That is the bug this architecture exists to fix.

## Hard-won constraints

These were established by direct inspection of the live site. Breaking any of
them silently corrupts data or gets the ingester blocked.

**CENAPRED sits behind Radware Bot Manager.** Plain HTTP clients receive an
HTTP 200 challenge page, not a report, so the failure looks like a parse error
rather than a network error. No combination of headers or user agents gets
through. Only a real browser does.

**Chromium must be the full build, running headed.** Playwright's default
headless mode uses `chromium-headless-shell`, which Radware challenges, and
plain headless escalates straight to a CAPTCHA. Use `channel: 'chromium'` with
`headless: false`, and `xvfb-run -a` on a machine with no display.

**Never reload a page that is mid challenge.** Radware swaps the real content in
underneath. Re-navigating escalates a silent challenge into an interactive
CAPTCHA that retrying cannot clear. Poll the live DOM instead.

**Rate limits are real.** Roughly 170 requests inside an hour was enough to get
throttled. Deep history is therefore fetched by `extend` as a daily drip, not in
a burst. Keep `--delay-ms` at 1500 or more. This is a public service run by a
disaster prevention agency.

**Chart rows are day first.** `['27-04-2022', 40, '#2fc1f1']`. Parsing them as
ISO is exactly the bug that broke the original scraper: it silently matches
nothing.

**Chart labels carry a week-based year, not a calendar year.** On reports
spanning a year boundary, the last days of December are stamped with the
following year, so real counter data lands up to eleven months in the future.
`reconcileSeriesDates` repairs this by judging rows against the median charted
day. The number of affected days depends on which weekday 1 January falls on,
and can legitimately be zero.

**SO₂ is not historical.** CENAPRED renders one global "last reading" on every
page, including pages for reports years older than the reading. Only record it
when the measurement is within 7 days of the report date. Getting this wrong
fabricates data.

**Historical reports are a POST keyed by an opaque id**, not a date query
string. `id_registro` increments by one per daily report, but the sequence has
gaps, so always verify the date the page actually reports and correct the offset
rather than trusting the arithmetic.

## Data model gotchas

`None` is not zero. Counter fields are `Option<u32>` because "not reported" and
"reported as zero" are different facts across a multi-decade archive.

Records flagged `partial` carry counters only. One page embeds a 15 day counter
window, but its narrative and alert status describe only that page's own day.
Copying them across would fabricate 14 days of alert history, so those fields
are `null` and the record is marked. `alert_level`, `alert_phase` and
`summary_spanish` are therefore present-and-null, which a "default on missing
field" deserialiser will not handle.

## Working here

```bash
cargo test                        # offline, fixture feeds
cargo clippy --all-targets
npm test --prefix ingest          # offline, no network needed

node ingest/index.mjs parse <saved.html>   # fastest way to check parser changes
node ingest/index.mjs verify              # sweep the archive for holes
```

Always run `verify` after any backfill. A lost anchor leaves a hole that nothing
else notices: the feed still looks healthy and `index.json` is still self
consistent.

The feed contract is [`docs/feed-schema.md`](docs/feed-schema.md). Keep changes
additive; anything breaking needs a `schema_version` bump.

## House style

No em dashes or en dashes anywhere, in prose, comments or commit messages. Use a
comma, colon, semicolon, or parentheses instead. Do not substitute a hyphen.
