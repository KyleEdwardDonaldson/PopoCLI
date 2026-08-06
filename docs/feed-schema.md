# Popo feed schema (v1)

The CLI no longer scrapes CENAPRED. A scheduled job ingests the official
reports once, centrally, and publishes plain JSON to this repository. The CLI
is a thin client over that JSON.

## Why

`cenapred.unam.mx` sits behind Radware Bot Manager. Any plain HTTP client gets
an HTTP 200 challenge page instead of the report, so per-user scraping cannot
work. Ingesting once with a real browser and publishing JSON means users call a
real endpoint that is fast, stable, and never sees the WAF.

## Endpoints

Served as static files from the repository (raw.githubusercontent.com):

| Path | Contents |
| --- | --- |
| `data/latest.json` | Most recent report (a `Report` object) |
| `data/reports/<YYYY>/<YYYY-MM-DD>.json` | One `Report` per day |
| `data/index.json` | `Index` object listing available dates |

## `Report`

```json
{
  "schema_version": 1,
  "date": "2026-08-04",
  "exhalations": 160,
  "volcanotectonic_events": 0,
  "tremor_minutes_total": 0,
  "tremor_high_frequency_minutes": null,
  "tremor_harmonic_minutes": null,
  "explosions": 0,
  "so2_emissions_tons_per_day": null,
  "so2_measurement_date": null,
  "alert_level": "YELLOW",
  "alert_phase": "AMARILLO FASE 2",
  "wind_direction": "W",
  "summary_spanish": "Se detectaron 160 exhalaciones...",
  "ashfall_reports": ["Atlautla, Estado de México"],
  "image_urls": ["https://www.cenapred.unam.mx/media/p05082601.jpeg"],
  "video_urls": ["https://www.cenapred.unam.mx/media/v05082601.mp4"],
  "source_url": "https://www.cenapred.unam.mx/reportesVolcanesMX/...",
  "ingested_at": "2026-08-05T17:04:00Z",
  "partial": false
}
```

### Full and partial records

A single report page embeds a ~15-day window of counter series, so ingesting one
page yields counters for 15 days. Those counters are real data for every day in
the window, but the report-level detail on that page (narrative, alert status,
wind, SO2, media) describes **only that page's own date**.

Copying that detail across the other 14 days would fabricate it. Instead those
days are written as **counter-only records** with `"partial": true` and `null`
for every field the window does not actually cover:

```json
{
  "schema_version": 1,
  "date": "2022-04-13",
  "exhalations": 22,
  "volcanotectonic_events": 0,
  "tremor_minutes_total": 0,
  "explosions": 0,
  "alert_level": null,
  "alert_phase": null,
  "wind_direction": null,
  "summary_spanish": null,
  "ashfall_reports": [],
  "image_urls": [],
  "video_urls": [],
  "ingested_at": "2026-08-06T00:00:00Z",
  "partial": true
}
```

Rules:

- `partial` defaults to `false` when absent; such a record is a full report.
- On a partial, `alert_level`, `alert_phase` and `summary_spanish` are `null`.
  **Clients must treat these three as nullable**, not merely omissible. They
  are present-and-null, so a "default on missing field" strategy is not enough.
- A full report always supersedes a partial for the same date; a partial never
  downgrades a full report already on disk.
- `data/latest.json` is **always** a full report, never a partial.
- `data/index.json` lists partial and full dates alike.

### Field rules

- `date`: ISO `YYYY-MM-DD`, the day the report covers. Primary key.
- Counters (`exhalations`, `volcanotectonic_events`, `tremor_minutes_total`,
  `explosions`): non-negative integers. Sourced from the report page's inline
  Google Charts series, whose rows are `['DD-MM-YYYY', value, '#color']`
  (**day-first**, not ISO). Use `null` only when the series genuinely omits the
  day; a day present with no activity is `0`, not `null`.
- `tremor_high_frequency_minutes` and `tremor_harmonic_minutes`: parsed from the
  narrative when present, otherwise `null`. They are a breakdown of
  `tremor_minutes_total` and need not sum to it.
- `so2_emissions_tons_per_day` and `so2_measurement_date`: **not historical.**
  CENAPRED renders one global "last reading" on every page, including pages for
  reports years older than the reading. Emit these **only** when the parsed
  measurement date is within 7 days of `date`; otherwise both are `null`.
  Never attribute a current reading to an older report.
- `alert_level`: one of `GREEN`, `YELLOW`, `ORANGE`, `RED`, mapped from
  `VERDE` / `AMARILLO` / `NARANJA` / `ROJO`. `null` on partial records.
- `alert_phase`: the raw Spanish phrase, for example `"AMARILLO FASE 2"`. `null` on
  partial records.
- `wind_direction`: normalised 16-point compass code (`N`, `NNE`, ... `NW`),
  mapped from Spanish (`NORTE`, `NORESTE`, `ESTE`, `SURESTE`, `SUR`,
  `SUROESTE`, `OESTE`, `NOROESTE`). `null` if absent.
- `summary_spanish`: narrative text, newlines preserved. Never empty for a full
  report; `null` on partial records.
- `ashfall_reports`: place names with reported ashfall, `[]` when none.
- `image_urls` and `video_urls`: absolute URLs.
- `ingested_at`: RFC 3339 UTC timestamp of ingestion.

Unknown fields must be ignored by clients so the schema can grow additively.
Any breaking change increments `schema_version`.

## `Index`

```json
{
  "schema_version": 1,
  "updated_at": "2026-08-05T17:04:00Z",
  "earliest": "2000-06-15",
  "latest": "2026-08-04",
  "count": 9412,
  "dates": ["2000-06-15", "..."]
}
```

## Upstream notes

Facts established by inspecting the live site. They constrain the ingester.

- **Latest report page** (`GET`):
  `/reportesVolcanesMX/Procesos?tipoProceso=detallesUltimoReporteVolcan`
- **Historical report** (`POST` to `/reportesVolcanesMX/Procesos`), form-encoded:
  `tipoProceso=detallesReporteVolcan`, `id_registro=<int>`, `caso_reporte=0`,
  `fecha=YYYY-MM-DD`. `id_registro` is an opaque sequential id that increments
  by one per daily report (10565 = 2026-08-05); it is authoritative, and
  `fecha` alone will not select a report.
- **Each report page embeds a ~15-day window** of all four counter series, so a
  full backfill needs roughly one request per 15 days, not one per day.
- **Official PDF** (`GET`, date-addressable, no opaque id):
  `/WSReporteVolcan/servicio/popocatepetl/generaPDF?anio=YYYY&mes=MM&dia=DD`.
  Returns an iText-generated text PDF (~2 pages). Coverage begins in **2000**;
  earlier dates and days with no report return HTTP 500 with a JSON body.
  The PDF carries the narrative, exhalation count, alert phase, ashfall and
  media *labels*, but **not** wind direction, SO2, or the counter series.
- Requests must come from a real browser; rate-limit politely (~1 req/sec) and
  treat HTTP 302 to `validate.perfdrive.com` as "blocked", not "not found".
