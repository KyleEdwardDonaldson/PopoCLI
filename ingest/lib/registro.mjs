/**
 * The opaque `id_registro` that CENAPRED uses to address a historical report.
 *
 * Per `docs/feed-schema.md` the id increments by one per daily report, so a date
 * offset from a known anchor gives a *starting guess*. The mapping is NOT assumed
 * to be gap-free: callers must check the date the returned page actually reports
 * and feed the drift back in as a correction.
 */

import { diffDays } from './dates.mjs';

export const BASE_URL = 'https://www.cenapred.unam.mx';
export const PROCESOS_URL = `${BASE_URL}/reportesVolcanesMX/Procesos`;
export const LATEST_URL = `${PROCESOS_URL}?tipoProceso=detallesUltimoReporteVolcan`;

/** Verified anchor: id 10565 addresses the report for 2026-08-05. */
export const ID_ANCHOR = Object.freeze({ id: 10565, date: '2026-08-05' });

/**
 * Starting-guess id for a date. Always verify the page's own date afterwards.
 *
 * @param {string} date ISO date
 * @param {number} correction accumulated drift learned from earlier fetches
 */
export function idForDate(date, correction = 0) {
  return ID_ANCHOR.id + diffDays(ID_ANCHOR.date, date) + correction;
}

/**
 * How far an id must move to get from the report it actually returned to the one
 * we wanted. Positive means the id must increase.
 */
export function idDrift(returnedDate, wantedDate) {
  return diffDays(returnedDate, wantedDate);
}

/** The form fields for the historical-report POST. */
export function historicalFormFields(id, date = '') {
  return {
    tipoProceso: 'detallesReporteVolcan',
    id_registro: String(id),
    caso_reporte: '0',
    fecha: date ?? '',
  };
}

/** Canonical, reconstructible URL recorded as `source_url` for a historical report. */
export function historicalSourceUrl(id, date) {
  return `${PROCESOS_URL}?${new URLSearchParams(historicalFormFields(id, date)).toString()}`;
}
