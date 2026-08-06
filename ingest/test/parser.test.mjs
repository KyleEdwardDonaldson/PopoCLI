import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

import {
  ChallengeError,
  NotAReportError,
  applySo2Window,
  buildReport,
  countersFor,
  coveredDatesOf,
  detectChallenge,
  isHardBlock,
  looksLikeReportPage,
  mapAlertLevel,
  mapWindDirection,
  parseAlert,
  reconcileSeriesDates,
  parseAshfall,
  parseChartRow,
  parseDayFirstDate,
  parseMedia,
  parseReportDate,
  parseReportPage,
  parseSeries,
  parseSo2,
  parseSpanishDate,
  parseSpanishNumber,
  parseTremorBreakdown,
  parseWindDirection,
  REPORT_KEY_ORDER,
} from '../lib/parser.mjs';

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');
const fixture = (name) => fs.readFileSync(path.join(FIXTURES, name), 'utf8');

const LATEST_HTML = fixture('latest-report-2026-08-05.html');
const HISTORICAL_HTML = fixture('historical-report-2022-04-27.html');
const ENTITY_HTML = fixture('entity-encoded-columns.html');

// ---------------------------------------------------------------------------

describe('day-first chart rows', () => {
  it('reads DD-MM-YYYY, never ISO', () => {
    // The verified upstream sample row.
    assert.deepEqual(parseChartRow("'27-04-2022', 40, '#2fc1f1'"), {
      date: '2022-04-27',
      values: [40],
      raw: "'27-04-2022', 40, '#2fc1f1'",
    });
  });

  it('does not mistake an unambiguous day-first date for month-first', () => {
    // 05-08-2026 is 5 August, not 8 May. Reading it as ISO was the old bug.
    assert.equal(parseDayFirstDate('05-08-2026'), '2026-08-05');
    assert.equal(parseDayFirstDate('12-01-2024'), '2024-01-12');
  });

  it('rejects labels whose month component cannot be a month', () => {
    assert.equal(parseDayFirstDate('27-13-2022'), null);
    assert.equal(parseDayFirstDate('2022-04-27'), null);
    assert.equal(parseDayFirstDate('31-02-2022'), null);
  });

  it('keeps zero values as 0 and explicit nulls as null', () => {
    assert.deepEqual(parseChartRow("'01-05-2024', 0, '#fff'").values, [0]);
    assert.deepEqual(parseChartRow("'01-05-2024', null, '#fff'").values, [null]);
  });

  it('unwraps {v: n, f: "n"} cells', () => {
    assert.deepEqual(parseChartRow("'01-05-2024', {v: 7, f: '7'}, '#fff'").values, [7]);
  });
});

describe('parseSeries', () => {
  it('binds each series to its preceding accented addColumn name', () => {
    const { series } = parseSeries(LATEST_HTML);
    assert.equal(series.exhalations['2026-08-05'], 160);
    assert.equal(series.exhalations['2026-07-22'], 118);
    assert.equal(series.volcanotectonic_events['2026-08-05'], 0);
    assert.equal(series.tremor_minutes_total['2026-08-05'], 53);
    assert.equal(series.explosions['2026-07-28'], 1);
  });

  it('exposes the whole ~15-day window, which is what makes backfill cheap', () => {
    const { series } = parseSeries(LATEST_HTML);
    const dates = coveredDatesOf(series);
    assert.equal(dates.length, 15);
    assert.equal(dates[0], '2026-07-22');
    assert.equal(dates.at(-1), '2026-08-05');
  });

  it('matches the exact accented column names', () => {
    const { columnsSeen } = parseSeries(LATEST_HTML);
    assert.deepEqual(columnsSeen, [
      'Exhalaciones',
      'Volcanotectónicos',
      'Minutos de tremor',
      'Explosiones',
    ]);
  });

  it('decodes entity-encoded column names and follows repeated addRow() calls', () => {
    const { series } = parseSeries(ENTITY_HTML);
    assert.equal(series.volcanotectonic_events['2023-03-14'], 3);
    assert.equal(series.volcanotectonic_events['2023-03-15'], 5);
  });

  it('warns rather than mis-dating when rows look ISO-formatted', () => {
    const html = `<script>
      data.addColumn('number', 'Exhalaciones');
      data.addRows([['2022-04-27', 40, '#2fc1f1']]);
    </script>`;
    const { series, warnings } = parseSeries(html);
    assert.deepEqual(series.exhalations, {});
    assert.ok(warnings.some((w) => w.includes('ISO-formatted')), warnings.join(' | '));
  });

  it('reports a day with no activity as 0, and an absent day as null', () => {
    const { series } = parseSeries(LATEST_HTML);
    assert.equal(countersFor(series, '2026-08-05').explosions, 0);
    assert.equal(countersFor(series, '1999-01-01').explosions, null);
  });
});

// ---------------------------------------------------------------------------

describe('SO2 7-day suppression', () => {
  it('reads the amount and the "Última lectura" date', () => {
    assert.deepEqual(
      parseSo2('2603 toneladas por día. Última lectura: 10 octubre 2024'),
      { tons: 2603, date: '2024-10-10' },
    );
  });

  it('reads the older "El <date> se midieron N toneladas" phrasing', () => {
    assert.deepEqual(
      parseSo2('El 10 octubre 2024 se midieron 2603.0 toneladas por día de bióxido de azufre.'),
      { tons: 2603, date: '2024-10-10' },
    );
  });

  it('keeps a reading taken within 7 days of the report', () => {
    const result = applySo2Window({ tons: 2154, date: '2026-08-03' }, '2026-08-05');
    assert.equal(result.so2_emissions_tons_per_day, 2154);
    assert.equal(result.so2_measurement_date, '2026-08-03');
    assert.equal(result.suppressed, null);
  });

  it('keeps a reading exactly 7 days old and drops one at 8 days', () => {
    assert.equal(
      applySo2Window({ tons: 100, date: '2026-07-29' }, '2026-08-05').so2_emissions_tons_per_day,
      100,
    );
    assert.equal(
      applySo2Window({ tons: 100, date: '2026-07-28' }, '2026-08-05').so2_emissions_tons_per_day,
      null,
    );
  });

  it('drops a reading whose date cannot be established', () => {
    const result = applySo2Window({ tons: 2603, date: null }, '2022-04-27');
    assert.equal(result.so2_emissions_tons_per_day, null);
    assert.match(result.suppressed, /no parseable measurement date/);
  });

  it('never attributes the current global reading to a years-old report', () => {
    // The live site really does render this reading on a 2022 page.
    const parsed = parseReportPage(HISTORICAL_HTML, {
      sourceUrl: 'https://example.invalid/2022',
      ingestedAt: '2026-08-05T00:00:00Z',
    });
    assert.equal(parsed.reportDate, '2022-04-27');
    assert.equal(parsed.report.so2_emissions_tons_per_day, null);
    assert.equal(parsed.report.so2_measurement_date, null);
    assert.ok(
      parsed.warnings.some((w) => w.includes('897 days')),
      `expected a suppression warning, got: ${parsed.warnings.join(' | ')}`,
    );
  });

  it('emits a fresh reading on the current report', () => {
    const parsed = parseReportPage(LATEST_HTML, {
      sourceUrl: 'https://example.invalid/latest',
      ingestedAt: '2026-08-05T00:00:00Z',
    });
    assert.equal(parsed.report.so2_emissions_tons_per_day, 2154);
    assert.equal(parsed.report.so2_measurement_date, '2026-08-03');
  });

  it('parses Spanish number formats', () => {
    assert.equal(parseSpanishNumber('2603'), 2603);
    assert.equal(parseSpanishNumber('2,603'), 2603);
    assert.equal(parseSpanishNumber('2603.5'), 2603.5);
    assert.equal(parseSpanishNumber('2603,5'), 2603.5);
    assert.equal(parseSpanishNumber('12,345'), 12345);
  });
});

// ---------------------------------------------------------------------------

describe('alert level', () => {
  it('maps the four Spanish colours', () => {
    assert.equal(mapAlertLevel('VERDE'), 'GREEN');
    assert.equal(mapAlertLevel('AMARILLO FASE 2'), 'YELLOW');
    assert.equal(mapAlertLevel('NARANJA FASE 1'), 'ORANGE');
    assert.equal(mapAlertLevel('ROJO'), 'RED');
    assert.equal(mapAlertLevel('azul'), null);
  });

  it('reads the verified upstream sentence', () => {
    assert.deepEqual(
      parseAlert('El Semáforo de Alerta Volcánica del Popocatépetl se encuentra en AMARILLO FASE 2'),
      { alert_level: 'YELLOW', alert_phase: 'AMARILLO FASE 2' },
    );
  });

  it('is not fooled by a legend that lists every colour first', () => {
    const text = 'Niveles del semáforo: VERDE, AMARILLO, NARANJA, ROJO.\n'
      + 'El Semáforo de Alerta Volcánica del Popocatépetl se encuentra en NARANJA FASE 1.';
    assert.deepEqual(parseAlert(text), {
      alert_level: 'ORANGE',
      alert_phase: 'NARANJA FASE 1',
    });
  });

  it('keeps the raw Spanish phrase and strips trailing punctuation', () => {
    const { alert_phase: phase } = parseAlert('... se encuentra en AMARILLO FASE 3.');
    assert.equal(phase, 'AMARILLO FASE 3');
  });
});

// ---------------------------------------------------------------------------

describe('wind direction', () => {
  it('maps the eight cardinal and intercardinal Spanish names', () => {
    assert.equal(mapWindDirection('NORTE'), 'N');
    assert.equal(mapWindDirection('NORESTE'), 'NE');
    assert.equal(mapWindDirection('ESTE'), 'E');
    assert.equal(mapWindDirection('SURESTE'), 'SE');
    assert.equal(mapWindDirection('SUR'), 'S');
    assert.equal(mapWindDirection('SUROESTE'), 'SW');
    assert.equal(mapWindDirection('OESTE'), 'W');
    assert.equal(mapWindDirection('NOROESTE'), 'NW');
  });

  it('maps the secondary intercardinals without letting a shorter name win', () => {
    // "oestenoroeste" contains "noroeste"; longest-match ordering must prevail.
    assert.equal(mapWindDirection('OESTE NOROESTE'), 'WNW');
    assert.equal(mapWindDirection('NORTE NOROESTE'), 'NNW');
    assert.equal(mapWindDirection('OESTE SUROESTE'), 'WSW');
    assert.equal(mapWindDirection('SUR SUROESTE'), 'SSW');
    assert.equal(mapWindDirection('ESTE SURESTE'), 'ESE');
    assert.equal(mapWindDirection('SUR SURESTE'), 'SSE');
    assert.equal(mapWindDirection('ESTE NORESTE'), 'ENE');
    assert.equal(mapWindDirection('NORTE NORESTE'), 'NNE');
  });

  it('tolerates accents, case, hyphens and articles', () => {
    assert.equal(mapWindDirection('sur-sureste'), 'SSE');
    assert.equal(mapWindDirection('hacia el Noroeste'), 'NW');
    assert.equal(mapWindDirection('con dirección al sureste'), 'SE');
    assert.equal(mapWindDirection('no es una dirección'), null);
  });

  it('reads the verified upstream sentence', () => {
    assert.equal(parseWindDirection('Dirección del viento SURESTE'), 'SE');
  });

  it('reads alternative phrasings', () => {
    assert.equal(
      parseWindDirection('los gases se dispersaban con dirección nor-noroeste.'),
      'NNW',
    );
    assert.equal(parseWindDirection('Sin información de viento.'), null);
  });
});

// ---------------------------------------------------------------------------

describe('challenge detection', () => {
  it('flags a 302 to validate.perfdrive.com', () => {
    const verdict = detectChallenge({
      html: '<html></html>',
      url: 'https://validate.perfdrive.com/?ssa=abc',
      status: 200,
    });
    assert.equal(verdict.blocked, true);
    assert.match(verdict.reason, /perfdrive/);
  });

  it('flags a perfdrive hop anywhere in the redirect chain', () => {
    const verdict = detectChallenge({
      html: '<html></html>',
      url: 'https://www.cenapred.unam.mx/',
      redirectChain: ['https://validate.perfdrive.com/?ssa=abc'],
    });
    assert.equal(verdict.blocked, true);
  });

  it('flags each known challenge page title', () => {
    for (const [name, title] of [
      ['challenge-radware.html', 'Radware Page'],
      ['challenge-unauthorized.html', 'Unauthorized Request Blocked'],
      ['challenge-validation.html', 'Challenge Validation'],
      ['challenge-captcha.html', 'Radware Captcha Page'],
    ]) {
      const verdict = detectChallenge({ html: fixture(name), title, status: 200 });
      assert.equal(verdict.blocked, true, `${title} should be blocked`);
    }
  });

  it('separates interactive blocks, which retrying cannot clear', () => {
    // Radware escalates to these when re-navigated mid-challenge, or when an IP
    // has made too many automated requests.
    assert.equal(isHardBlock('Radware Captcha Page'), true);
    assert.equal(isHardBlock('Unauthorized Request Blocked'), true);
    // The silent JS challenge does clear itself if you wait in place.
    assert.equal(isHardBlock('Radware Page'), false);
    assert.equal(isHardBlock('Reporte Volcán'), false);
    assert.equal(isHardBlock(undefined), false);
  });

  it('flags a challenge whose title looks innocent', () => {
    const verdict = detectChallenge({
      html: fixture('challenge-body-marker.html'),
      title: 'CENAPRED',
      status: 200,
    });
    assert.equal(verdict.blocked, true);
    assert.match(verdict.reason, /body/);
  });

  it('lets a real report through even when Radware has injected its sensor', () => {
    // Radware adds its script to pages it permits, not just to challenges. A page
    // that actually carries the report must never be rejected for mentioning it.
    const withSensor = LATEST_HTML.replace(
      '</head>',
      '<script>ssConf("cu", "validate.perfdrive.com, ssc");</script></head>',
    );
    assert.equal(looksLikeReportPage(withSensor), true);
    assert.equal(
      detectChallenge({ html: withSensor, url: 'https://www.cenapred.unam.mx/x', title: 'Reporte Volcán' }).blocked,
      false,
    );
    // ...but the same marker on a page with no volcano content at all is a block.
    assert.equal(detectChallenge({ html: fixture('challenge-body-marker.html') }).blocked, true);
  });

  it('calls a CENAPRED page with no report "not a report", not "blocked"', () => {
    // Radware's sensor is injected site-wide, so an id_registro that simply has
    // no report must not be mistaken for a block — backfill has to tell them
    // apart to keep walking history.
    const emptyPage = '<html><head><title>Reporte Volcán</title>'
      + '<script>ssConf("cu", "validate.perfdrive.com, ssc");</script></head>'
      + '<body><h1>Volcán Popocatépetl</h1><p>No hay reporte para la fecha indicada.</p></body></html>';
    assert.equal(detectChallenge({ html: emptyPage }).blocked, false);
    assert.equal(looksLikeReportPage(emptyPage), false);
    assert.throws(() => parseReportPage(emptyPage, {}), NotAReportError);
  });

  it('does not flag a real report page', () => {
    assert.deepEqual(
      detectChallenge({ html: LATEST_HTML, url: 'https://www.cenapred.unam.mx/x', title: 'CENAPRED' }),
      { blocked: false, reason: null },
    );
    assert.equal(looksLikeReportPage(LATEST_HTML), true);
  });

  it('never yields a report from a challenge page', () => {
    for (const name of [
      'challenge-radware.html',
      'challenge-unauthorized.html',
      'challenge-validation.html',
      'challenge-body-marker.html',
      // Its only tell is the <title>, which parseReportPage cannot see; the
      // "does this even look like a report" guard must still stop it.
      'challenge-captcha.html',
    ]) {
      assert.throws(
        () => parseReportPage(fixture(name), { sourceUrl: 'x', ingestedAt: 'y' }),
        (error) => error instanceof ChallengeError || error instanceof NotAReportError,
        `${name} must not parse into a report`,
      );
    }
  });

  it('tells "not a report" apart from "blocked"', () => {
    assert.throws(
      () => parseReportPage('<html><body><p>Página no encontrada</p></body></html>', {}),
      NotAReportError,
    );
    assert.throws(
      () => parseReportPage(fixture('challenge-validation.html'), {}),
      ChallengeError,
    );
  });
});

// ---------------------------------------------------------------------------

describe('narrative details', () => {
  it('parses the tremor breakdown', () => {
    assert.deepEqual(
      parseTremorBreakdown('se registraron 53 minutos de tremor, 39 minutos fueron de alta frecuencia y 14 minutos de armónico'),
      { tremor_high_frequency_minutes: 39, tremor_harmonic_minutes: 14 },
    );
    assert.deepEqual(parseTremorBreakdown('sin tremor'), {
      tremor_high_frequency_minutes: null,
      tremor_harmonic_minutes: null,
    });
  });

  it('extracts an ashfall place, keeping an embedded comma intact', () => {
    assert.deepEqual(
      parseAshfall(
        'el Centro Nacional de Comunicaciones y Operación de Protección Civil (Cenacom), '
        + 'reportó ligera caída de ceniza en Atlautla, Estado de México.',
      ),
      ['Atlautla, Estado de México'],
    );
  });

  it('splits several ashfall reports', () => {
    assert.deepEqual(
      parseAshfall('se reportó caída de ceniza en Ozumba, Estado de México; Tetela del Volcán, Morelos.'),
      ['Ozumba, Estado de México', 'Tetela del Volcán, Morelos'],
    );
  });

  it('strips a municipality preamble', () => {
    assert.deepEqual(
      parseAshfall('reportó caída de ceniza en los municipios de Atlautla y Ecatzingo, Estado de México.'),
      ['Atlautla y Ecatzingo, Estado de México'],
    );
  });

  it('returns [] when ashfall is explicitly denied', () => {
    assert.deepEqual(parseAshfall('No se reportó caída de ceniza en poblaciones cercanas.'), []);
    assert.deepEqual(
      parseAshfall('El volcán no presentó explosiones. Se reportó caída de ceniza en Amecameca.'),
      ['Amecameca'],
    );
  });

  it('splits media by extension and skips site chrome', () => {
    const media = parseMedia(LATEST_HTML);
    assert.deepEqual(media.image_urls, ['https://www.cenapred.unam.mx/media/p05082601.jpeg']);
    assert.deepEqual(media.video_urls, ['https://www.cenapred.unam.mx/media/v05082601.mp4']);
    assert.ok(!JSON.stringify(media).includes('logo_cenapred'));
  });

  it('finds the report date from the Spanish heading', () => {
    assert.deepEqual(parseReportDate(LATEST_HTML), { date: '2026-08-05', source: 'heading' });
    assert.equal(parseSpanishDate('06 de Octubre de 2025'), '2025-10-06');
    assert.equal(parseSpanishDate('10 octubre 2024'), '2024-10-10');
    assert.equal(parseSpanishDate('5 de agosto del 2026'), '2026-08-05');
  });
});

// ---------------------------------------------------------------------------

describe('parseReportPage', () => {
  const parsed = parseReportPage(LATEST_HTML, {
    sourceUrl: 'https://www.cenapred.unam.mx/reportesVolcanesMX/Procesos?tipoProceso=detallesUltimoReporteVolcan',
    ingestedAt: '2026-08-05T17:04:00Z',
  });

  it('produces a schema-shaped report in a stable key order', () => {
    assert.deepEqual(
      Object.keys(parsed.report),
      REPORT_KEY_ORDER.filter((k) => k !== 'partial'),
    );
    assert.equal(parsed.report.schema_version, 1);
    assert.equal(parsed.report.ingested_at, '2026-08-05T17:04:00Z');
  });

  it('fills every counter for the report date', () => {
    assert.equal(parsed.report.date, '2026-08-05');
    assert.equal(parsed.report.exhalations, 160);
    assert.equal(parsed.report.volcanotectonic_events, 0);
    assert.equal(parsed.report.tremor_minutes_total, 53);
    assert.equal(parsed.report.explosions, 0);
    assert.equal(parsed.report.tremor_high_frequency_minutes, 39);
    assert.equal(parsed.report.tremor_harmonic_minutes, 14);
  });

  it('fills the narrative fields', () => {
    assert.equal(parsed.report.alert_level, 'YELLOW');
    assert.equal(parsed.report.alert_phase, 'AMARILLO FASE 2');
    assert.equal(parsed.report.wind_direction, 'SE');
    assert.deepEqual(parsed.report.ashfall_reports, ['Atlautla, Estado de México']);
    assert.match(parsed.report.summary_spanish, /se detectaron 160 exhalaciones/);
    assert.ok(parsed.report.summary_spanish.length > 100);
  });

  it('emits counter-only records for the rest of the chart window', () => {
    assert.equal(parsed.partialReports.length, 14);
    const first = parsed.partialReports[0];
    assert.equal(first.date, '2026-07-22');
    assert.equal(first.exhalations, 118);
    assert.equal(first.partial, true);
    // Report-level detail belongs to the report's own day and must not leak.
    assert.equal(first.alert_level, null);
    assert.equal(first.summary_spanish, null);
    assert.equal(first.so2_emissions_tons_per_day, null);
    assert.deepEqual(first.image_urls, []);
  });

  it('warns when the page reports a different date than expected', () => {
    const drifted = parseReportPage(LATEST_HTML, {
      sourceUrl: 'x',
      ingestedAt: 'y',
      expectedDate: '2026-08-04',
    });
    assert.ok(
      drifted.warnings.some((w) => w.includes('2026-08-04') && w.includes('2026-08-05')),
      drifted.warnings.join(' | '),
    );
    // ...and still files the report under the date the page actually reports.
    assert.equal(drifted.report.date, '2026-08-05');
  });
});

describe('buildReport', () => {
  it('defaults missing fields to null and omits `partial` unless true', () => {
    const report = buildReport({ date: '2026-08-05' });
    assert.equal(report.exhalations, null);
    assert.ok(!Object.hasOwn(report, 'partial'));
    assert.equal(buildReport({ date: '2026-08-05', partial: true }).partial, true);
  });
});

describe('reconcileSeriesDates', () => {
  const emptySeries = () => ({
    exhalations: {},
    volcanotectonic_events: {},
    tremor_minutes_total: {},
    explosions: {},
  });

  // CENAPRED stamps late-December rows with the *next* year, because their
  // formatter uses a week-year (Java `YYYY`) rather than a calendar year.
  // Observed live on the 2026-01-08 report: its window ran 2025-12-25..
  // 2026-01-08, but 29-31 December were charted as 2026, filing real counter
  // data almost a year into the future.
  it('repairs late-December rows carrying next year', () => {
    const series = emptySeries();
    series.exhalations = {
      '2025-12-25': 5,
      '2025-12-26': 6,
      '2025-12-27': 7,
      '2025-12-28': 8,
      '2026-12-29': 38,
      '2026-12-30': 16,
      '2026-12-31': 13,
      '2026-01-01': 9,
      '2026-01-02': 10,
    };

    const { series: fixed, warnings } = reconcileSeriesDates(series);

    assert.equal(fixed.exhalations['2025-12-29'], 38);
    assert.equal(fixed.exhalations['2025-12-30'], 16);
    assert.equal(fixed.exhalations['2025-12-31'], 13);
    assert.equal(fixed.exhalations['2026-12-29'], undefined);
    assert.equal(fixed.exhalations['2026-12-31'], undefined);
    // Correctly labelled rows are untouched.
    assert.equal(fixed.exhalations['2025-12-25'], 5);
    assert.equal(fixed.exhalations['2026-01-02'], 10);
    assert.ok(warnings.some((w) => /week-year/.test(w)));
  });

  it('leaves an ordinary window alone', () => {
    const series = emptySeries();
    series.exhalations = { '2026-07-07': 1, '2026-07-08': 2, '2026-07-09': 3 };
    const { series: fixed, warnings } = reconcileSeriesDates(series);
    assert.deepEqual(fixed.exhalations, series.exhalations);
    assert.deepEqual(warnings, []);
  });

  it('drops a row no year shift can explain', () => {
    const series = emptySeries();
    series.exhalations = {
      '2026-07-07': 1,
      '2026-07-08': 2,
      '2026-07-09': 3,
      '2019-03-04': 99,
    };
    const { series: fixed, warnings } = reconcileSeriesDates(series);
    assert.equal(fixed.exhalations['2019-03-04'], undefined);
    assert.equal(Object.keys(fixed.exhalations).length, 3);
    assert.ok(warnings.some((w) => /implausibly dated/.test(w)));
  });

  // The report date can be derived from the newest charted day, so a row a
  // year in the future must be repaired before that derivation runs.
  it('keeps a week-year row from becoming the report date', () => {
    const series = emptySeries();
    series.exhalations = {
      '2025-12-27': 7,
      '2025-12-28': 8,
      '2026-12-29': 38,
      '2026-01-01': 9,
    };
    const { series: fixed } = reconcileSeriesDates(series);
    assert.equal(coveredDatesOf(fixed).at(-1), '2026-01-01');
  });
});
