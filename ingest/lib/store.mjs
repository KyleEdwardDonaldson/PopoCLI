/**
 * Deterministic on-disk feed storage.
 *
 * Files are written with a stable key order, two-space indent and a trailing
 * newline, and are only rewritten when something other than the ingestion
 * timestamp changed. That keeps the daily commit diff empty on a no-op run.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { REPORT_KEY_ORDER, SCHEMA_VERSION } from './parser.mjs';
import { isValidIsoDate, rfc3339 } from './dates.mjs';

export const REPORT_IGNORED_KEYS = ['ingested_at'];
export const INDEX_IGNORED_KEYS = ['updated_at'];

export const INDEX_KEY_ORDER = [
  'schema_version',
  'updated_at',
  'earliest',
  'latest',
  'count',
  'dates',
];

/** Stable JSON text: 2-space indent, trailing newline, LF line endings. */
export function stringifyJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

/** Re-key an object into a fixed order, dropping keys that are absent. */
export function orderKeys(value, order) {
  const out = {};
  for (const key of order) {
    if (Object.hasOwn(value, key)) out[key] = value[key];
  }
  for (const key of Object.keys(value)) {
    if (!Object.hasOwn(out, key)) out[key] = value[key];
  }
  return out;
}

export function reportPath(dataDir, date) {
  if (!isValidIsoDate(date)) throw new TypeError(`invalid report date: ${date}`);
  return path.join(dataDir, 'reports', date.slice(0, 4), `${date}.json`);
}

export function latestPath(dataDir) {
  return path.join(dataDir, 'latest.json');
}

export function indexPath(dataDir) {
  return path.join(dataDir, 'index.json');
}

async function readJsonIfPresent(file) {
  try {
    const text = await fs.readFile(file, 'utf8');
    return { text, value: JSON.parse(text) };
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    if (error instanceof SyntaxError) return { text: null, value: null, corrupt: true };
    throw error;
  }
}

function withoutKeys(value, keys) {
  const clone = { ...value };
  for (const key of keys) delete clone[key];
  return clone;
}

/**
 * Write `value` to `file` unless the only difference from what is already there
 * is one of `ignoreKeys` (i.e. the ingestion timestamp).
 *
 * @returns {Promise<'created'|'updated'|'unchanged'>}
 */
export async function writeIfChanged(file, value, { ignoreKeys = [], dryRun = false } = {}) {
  const existing = await readJsonIfPresent(file);

  if (existing && !existing.corrupt && existing.value && typeof existing.value === 'object') {
    const sameContent =
      JSON.stringify(withoutKeys(value, ignoreKeys))
      === JSON.stringify(withoutKeys(existing.value, ignoreKeys));

    if (sameContent) {
      // Keep the stored timestamps so an unchanged report produces no diff, but
      // still normalise formatting if the file was written differently.
      const preserved = {};
      for (const [key, entry] of Object.entries(value)) {
        preserved[key] = ignoreKeys.includes(key) && Object.hasOwn(existing.value, key)
          ? existing.value[key]
          : entry;
      }
      const text = stringifyJson(preserved);
      if (text === existing.text) return 'unchanged';
      if (!dryRun) await writeFileAtomic(file, text);
      return 'updated';
    }
  }

  if (!dryRun) await writeFileAtomic(file, stringifyJson(value));
  return existing && !existing.corrupt ? 'updated' : 'created';
}

async function writeFileAtomic(file, text) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, text, 'utf8');
}

export async function readReport(dataDir, date) {
  const found = await readJsonIfPresent(reportPath(dataDir, date));
  return found && !found.corrupt ? found.value : null;
}

export function isPartial(report) {
  return Boolean(report && report.partial === true);
}

/**
 * Decide what should end up on disk for a date.
 *
 * Rules:
 *  - a full report always wins over a partial (counters-only) record;
 *  - a partial never downgrades an existing full report;
 *  - two partials merge, with non-null incoming counters winning.
 *
 * @returns {{report: object, action: 'write'|'skip'}}
 */
export function mergeReport(existing, incoming) {
  if (!existing) return { report: incoming, action: 'write' };

  if (isPartial(incoming)) {
    if (!isPartial(existing)) return { report: existing, action: 'skip' };
    const merged = { ...existing };
    for (const [key, value] of Object.entries(incoming)) {
      if (key === 'ingested_at') continue;
      if (value === null || value === undefined) continue;
      if (Array.isArray(value) && value.length === 0 && Array.isArray(merged[key])) continue;
      merged[key] = value;
    }
    merged.ingested_at = incoming.ingested_at ?? existing.ingested_at;
    return { report: orderKeys(merged, REPORT_KEY_ORDER), action: 'write' };
  }

  return { report: incoming, action: 'write' };
}

/**
 * Persist one report, honouring the merge rules.
 *
 * @returns {Promise<'created'|'updated'|'unchanged'|'skipped'>}
 */
export async function saveReport(dataDir, incoming, { dryRun = false, force = false } = {}) {
  const file = reportPath(dataDir, incoming.date);
  const existing = force ? null : await readReport(dataDir, incoming.date);
  const { report, action } = mergeReport(existing, incoming);
  if (action === 'skip') return 'skipped';
  return writeIfChanged(file, orderKeys(report, REPORT_KEY_ORDER), {
    ignoreKeys: REPORT_IGNORED_KEYS,
    dryRun,
  });
}

/** Every report date on disk, ascending. */
export async function listReportDates(dataDir) {
  const root = path.join(dataDir, 'reports');
  let years;
  try {
    years = await fs.readdir(root, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }

  const dates = [];
  for (const year of years) {
    if (!year.isDirectory() || !/^\d{4}$/.test(year.name)) continue;
    const files = await fs.readdir(path.join(root, year.name));
    for (const file of files) {
      if (!file.endsWith('.json')) continue;
      const date = file.slice(0, -5);
      if (isValidIsoDate(date) && date.startsWith(year.name)) dates.push(date);
    }
  }
  return dates.sort();
}

/** The newest non-partial report on disk, or null. */
export async function findLatestFullReport(dataDir) {
  const dates = (await listReportDates(dataDir)).reverse();
  for (const date of dates) {
    const report = await readReport(dataDir, date);
    if (report && !isPartial(report)) return report;
  }
  return null;
}

export function buildIndex(dates, updatedAt = rfc3339()) {
  const sorted = [...dates].sort();
  return {
    schema_version: SCHEMA_VERSION,
    updated_at: updatedAt,
    earliest: sorted[0] ?? null,
    latest: sorted[sorted.length - 1] ?? null,
    count: sorted.length,
    dates: sorted,
  };
}

/** Rebuild `data/index.json` from what is actually on disk. */
export async function writeIndex(dataDir, { dryRun = false, updatedAt = rfc3339() } = {}) {
  const dates = await listReportDates(dataDir);
  const index = buildIndex(dates, updatedAt);
  const status = await writeIfChanged(indexPath(dataDir), index, {
    ignoreKeys: INDEX_IGNORED_KEYS,
    dryRun,
  });
  return { index, status };
}

/** Point `data/latest.json` at the newest full report on disk. */
export async function writeLatest(dataDir, { dryRun = false } = {}) {
  const report = await findLatestFullReport(dataDir);
  if (!report) return { report: null, status: 'unchanged' };
  const status = await writeIfChanged(
    latestPath(dataDir),
    orderKeys(report, REPORT_KEY_ORDER),
    { ignoreKeys: REPORT_IGNORED_KEYS, dryRun },
  );
  return { report, status };
}
