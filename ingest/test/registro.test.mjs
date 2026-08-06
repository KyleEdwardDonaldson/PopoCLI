import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  historicalFormFields,
  historicalSourceUrl,
  ID_ANCHOR,
  idDrift,
  idForDate,
  LATEST_URL,
} from '../lib/registro.mjs';
import {
  addDays,
  diffDays,
  eachDay,
  findGaps,
  isoFromParts,
  isValidIsoDate,
  rfc3339,
} from '../lib/dates.mjs';

describe('id_registro mapping', () => {
  it('reproduces the verified anchor', () => {
    assert.equal(idForDate(ID_ANCHOR.date), ID_ANCHOR.id);
    assert.equal(idForDate('2026-08-05'), 10565);
  });

  it('moves one id per day', () => {
    assert.equal(idForDate('2026-08-04'), 10564);
    assert.equal(idForDate('2026-08-06'), 10566);
    assert.equal(idForDate('2026-07-22'), 10565 - 14);
  });

  it('applies an accumulated correction', () => {
    assert.equal(idForDate('2026-08-05', 7), 10572);
    assert.equal(idForDate('2026-08-05', -7), 10558);
  });

  it('derives the correction needed when the id sequence has a gap', () => {
    // We asked for 2024-06-01 but the page came back reporting 2024-05-29,
    // i.e. the real id for our target sits 3 higher than the naive guess.
    const wanted = '2024-06-01';
    const returned = '2024-05-29';
    const guess = idForDate(wanted);
    const correction = idDrift(returned, wanted);
    assert.equal(correction, 3);
    assert.equal(idForDate(wanted, correction), guess + 3);
  });

  it('derives a negative correction when the page runs ahead', () => {
    assert.equal(idDrift('2024-06-04', '2024-06-01'), -3);
  });

  it('builds the documented POST form', () => {
    assert.deepEqual(historicalFormFields(9004, '2022-04-27'), {
      tipoProceso: 'detallesReporteVolcan',
      id_registro: '9004',
      caso_reporte: '0',
      fecha: '2022-04-27',
    });
  });

  it('records a reconstructible source URL', () => {
    assert.equal(
      historicalSourceUrl(9004, '2022-04-27'),
      'https://www.cenapred.unam.mx/reportesVolcanesMX/Procesos'
      + '?tipoProceso=detallesReporteVolcan&id_registro=9004&caso_reporte=0&fecha=2022-04-27',
    );
    assert.equal(
      LATEST_URL,
      'https://www.cenapred.unam.mx/reportesVolcanesMX/Procesos?tipoProceso=detallesUltimoReporteVolcan',
    );
  });
});

describe('date helpers', () => {
  it('adds days across month, year and leap-day boundaries', () => {
    assert.equal(addDays('2026-08-05', 1), '2026-08-06');
    assert.equal(addDays('2026-08-31', 1), '2026-09-01');
    assert.equal(addDays('2026-01-01', -1), '2025-12-31');
    assert.equal(addDays('2024-02-28', 1), '2024-02-29');
    assert.equal(addDays('2023-02-28', 1), '2023-03-01');
    assert.equal(addDays('2026-08-05', -14), '2026-07-22');
  });

  it('measures whole days regardless of host timezone', () => {
    assert.equal(diffDays('2026-08-04', '2026-08-05'), 1);
    assert.equal(diffDays('2026-08-05', '2026-08-04'), -1);
    assert.equal(diffDays('2026-08-05', '2026-08-05'), 0);
    assert.equal(diffDays('2024-02-28', '2024-03-01'), 2); // leap year
    assert.equal(diffDays('2023-02-28', '2023-03-01'), 1);
  });

  it('rejects dates that do not exist', () => {
    assert.equal(isoFromParts(2023, 2, 29), null);
    assert.equal(isoFromParts(2023, 13, 1), null);
    assert.equal(isoFromParts(2023, 4, 31), null);
    assert.equal(isoFromParts(2024, 2, 29), '2024-02-29');
    assert.equal(isValidIsoDate('2023-02-29'), false);
    assert.equal(isValidIsoDate('2023-2-01'), false);
    assert.equal(isValidIsoDate('2023-02-01'), true);
  });

  it('enumerates an inclusive range', () => {
    assert.deepEqual(eachDay('2026-08-03', '2026-08-05'), ['2026-08-03', '2026-08-04', '2026-08-05']);
    assert.deepEqual(eachDay('2026-08-05', '2026-08-05'), ['2026-08-05']);
  });

  it('emits RFC 3339 UTC without milliseconds', () => {
    assert.equal(rfc3339(new Date('2026-08-05T17:04:00.123Z')), '2026-08-05T17:04:00Z');
    assert.match(rfc3339(), /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
  });
});

describe('findGaps', () => {
  it('returns nothing for a contiguous run', () => {
    assert.deepEqual(findGaps(eachDay('2024-01-01', '2024-01-10')), []);
  });

  // The failure this exists to catch: a backfill anchor dies and takes a whole
  // 15-day window with it, leaving a hole nothing else notices. Observed live
  // as 2023-11-16..2023-11-30.
  it('finds a lost backfill window', () => {
    const dates = [
      ...eachDay('2023-11-01', '2023-11-15'),
      ...eachDay('2023-12-01', '2023-12-10'),
    ];
    assert.deepEqual(findGaps(dates), [
      {
        after: '2023-11-15',
        before: '2023-12-01',
        from: '2023-11-16',
        to: '2023-11-30',
        days: 15,
      },
    ]);
  });

  it('finds several gaps, ascending', () => {
    const dates = ['2024-01-01', '2024-01-03', '2024-01-04', '2024-01-08'];
    const gaps = findGaps(dates);
    assert.equal(gaps.length, 2);
    assert.deepEqual(gaps.map((g) => [g.from, g.to, g.days]), [
      ['2024-01-02', '2024-01-02', 1],
      ['2024-01-05', '2024-01-07', 3],
    ]);
  });

  it('tolerates unsorted input, duplicates and junk', () => {
    const dates = ['2024-01-04', '2024-01-01', '2024-01-01', 'not-a-date', '2024-01-05'];
    assert.deepEqual(findGaps(dates).map((g) => [g.from, g.to]), [['2024-01-02', '2024-01-03']]);
  });

  it('handles fewer than two dates', () => {
    assert.deepEqual(findGaps([]), []);
    assert.deepEqual(findGaps(['2024-01-01']), []);
  });

  it('spans a year boundary', () => {
    const dates = ['2023-12-30', '2024-01-03'];
    assert.deepEqual(findGaps(dates), [
      { after: '2023-12-30', before: '2024-01-03', from: '2023-12-31', to: '2024-01-02', days: 3 },
    ]);
  });
});
