/**
 * Date helpers. Every date in this project is an ISO `YYYY-MM-DD` string.
 * All arithmetic is done in UTC so the host timezone can never shift a day.
 */

const MS_PER_DAY = 86_400_000;

export const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function pad(n, width = 2) {
  return String(Math.abs(n)).padStart(width, '0');
}

/** Build an ISO date from numeric parts, returning null when the date is not real. */
export function isoFromParts(year, month, day) {
  const y = Number(year);
  const m = Number(month);
  const d = Number(day);
  if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d)) return null;
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return `${pad(y, 4)}-${pad(m)}-${pad(d)}`;
}

export function isValidIsoDate(value) {
  if (typeof value !== 'string' || !ISO_DATE_RE.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  return isoFromParts(y, m, d) === value;
}

function toUtcMillis(iso) {
  if (!isValidIsoDate(iso)) throw new TypeError(`not an ISO date: ${JSON.stringify(iso)}`);
  const [y, m, d] = iso.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

export function addDays(iso, days) {
  const dt = new Date(toUtcMillis(iso) + days * MS_PER_DAY);
  return isoFromParts(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
}

/**
 * Shift an ISO date by whole years, keeping month and day.
 * Returns null when the result is not a real date (29 February).
 */
export function shiftYear(iso, years) {
  if (!isValidIsoDate(iso)) return null;
  const [y, m, d] = iso.split('-').map(Number);
  return isoFromParts(y + years, m, d);
}

/** Whole days from `a` to `b` (positive when `b` is later). */
export function diffDays(a, b) {
  return Math.round((toUtcMillis(b) - toUtcMillis(a)) / MS_PER_DAY);
}

export function compareIso(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function minIso(dates) {
  return dates.length ? dates.reduce((acc, d) => (d < acc ? d : acc)) : null;
}

export function maxIso(dates) {
  return dates.length ? dates.reduce((acc, d) => (d > acc ? d : acc)) : null;
}

/** Inclusive range of ISO dates, ascending. */
export function eachDay(from, to) {
  const out = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

/**
 * Missing runs inside a daily sequence of ISO dates.
 *
 * The archive is meant to be one report per day, so any jump larger than a day
 * is a hole — usually an anchor that failed mid-backfill. Returns one entry per
 * hole, ascending, with the inclusive range of dates that are absent.
 */
export function findGaps(dates) {
  const sorted = [...new Set(dates)].filter(isValidIsoDate).sort();
  const gaps = [];
  for (let i = 0; i < sorted.length - 1; i += 1) {
    const span = diffDays(sorted[i], sorted[i + 1]);
    if (span <= 1) continue;
    gaps.push({
      after: sorted[i],
      before: sorted[i + 1],
      from: addDays(sorted[i], 1),
      to: addDays(sorted[i + 1], -1),
      days: span - 1,
    });
  }
  return gaps;
}

/** RFC 3339 UTC timestamp with second precision, e.g. `2026-08-05T17:04:00Z`. */
export function rfc3339(date = new Date()) {
  return date.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/** Today's date in a given IANA timezone (defaults to the volcano's local time). */
export function todayIso(timeZone = 'America/Mexico_City', now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const get = (type) => parts.find((p) => p.type === type)?.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}
