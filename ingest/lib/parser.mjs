/**
 * Pure parsing for CENAPRED Popocatepetl report pages.
 *
 * Nothing in this module touches the network or the filesystem: it takes an
 * HTML string and returns plain data, so it is fully unit-testable against
 * saved fixtures.
 *
 * Contract: `docs/feed-schema.md`.
 */

import * as cheerio from 'cheerio';
import { diffDays, isoFromParts, isValidIsoDate, maxIso, minIso } from './dates.mjs';

export const SCHEMA_VERSION = 1;
export const BASE_URL = 'https://www.cenapred.unam.mx';

/** How close an SO2 reading must be to the report date before we may attribute it. */
export const SO2_MAX_AGE_DAYS = 7;

/**
 * Google Charts series names, exactly as CENAPRED writes them (accents matter),
 * mapped to feed field names.
 */
export const SERIES_COLUMNS = Object.freeze({
  'Exhalaciones': 'exhalations',
  'Volcanotectónicos': 'volcanotectonic_events',
  'Minutos de tremor': 'tremor_minutes_total',
  'Explosiones': 'explosions',
});

export const COUNTER_FIELDS = Object.freeze([
  'exhalations',
  'volcanotectonic_events',
  'tremor_minutes_total',
  'explosions',
]);

/** Key order for an emitted Report. Deterministic output depends on this. */
export const REPORT_KEY_ORDER = Object.freeze([
  'schema_version',
  'date',
  'exhalations',
  'volcanotectonic_events',
  'tremor_minutes_total',
  'tremor_high_frequency_minutes',
  'tremor_harmonic_minutes',
  'explosions',
  'so2_emissions_tons_per_day',
  'so2_measurement_date',
  'alert_level',
  'alert_phase',
  'wind_direction',
  'summary_spanish',
  'ashfall_reports',
  'image_urls',
  'video_urls',
  'source_url',
  'ingested_at',
  // Additive, non-schema field. Present and `true` only on counter-only records
  // harvested from another day's 15-day chart window.
  'partial',
]);

export class ChallengeError extends Error {
  constructor(reason, context = {}) {
    super(`blocked by CENAPRED bot protection: ${reason}`);
    this.name = 'ChallengeError';
    this.reason = reason;
    this.context = context;
  }
}

export class NotAReportError extends Error {
  constructor(message, context = {}) {
    super(message);
    this.name = 'NotAReportError';
    this.context = context;
  }
}

// ---------------------------------------------------------------------------
// Text normalisation
// ---------------------------------------------------------------------------

const COMBINING_MARKS_RE = /[\u0300-\u036f]/g;
const UNICODE_SPACE_RE = /[\u00a0\u1680\u2000-\u200a\u202f\u205f\u3000]/g;

const NAMED_ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  aacute: 'á', eacute: 'é', iacute: 'í', oacute: 'ó',
  uacute: 'ú', uuml: 'ü',
  Aacute: 'Á', Eacute: 'É', Iacute: 'Í', Oacute: 'Ó',
  Uacute: 'Ú', Uuml: 'Ü',
  ntilde: 'ñ', Ntilde: 'Ñ',
  deg: '°', ordm: 'º', ordf: 'ª', middot: '·',
  laquo: '«', raquo: '»', hellip: '…',
  mdash: '—', ndash: '–',
  lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”',
};

/**
 * Decode the HTML entities we plausibly meet. Needed because `<script>` bodies
 * are raw text: an HTML parser will not decode `Volcanotect&oacute;nicos` for us.
 */
export function decodeEntities(input) {
  const text = input ?? '';
  if (typeof text !== 'string' || !text.includes('&')) return String(text);
  return text.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z][a-zA-Z0-9]*);/g, (match, body) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X'
        ? Number.parseInt(body.slice(2), 16)
        : Number.parseInt(body.slice(1), 10);
      if (Number.isFinite(code) && code > 0 && code <= 0x10ffff) {
        try {
          return String.fromCodePoint(code);
        } catch {
          return match;
        }
      }
      return match;
    }
    return Object.hasOwn(NAMED_ENTITIES, body) ? NAMED_ENTITIES[body] : match;
  });
}

export function stripAccents(input) {
  return String(input ?? '').normalize('NFD').replace(COMBINING_MARKS_RE, '');
}

/** Collapse whitespace runs (including nbsp) while preserving paragraph breaks. */
export function normalizeWhitespace(input) {
  return String(input ?? '')
    .replace(/\r\n?/g, '\n')
    .replace(UNICODE_SPACE_RE, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Lowercase, accent-free, whitespace-collapsed — for tolerant keyword matching. */
export function foldText(input) {
  return stripAccents(decodeEntities(input ?? ''))
    .replace(UNICODE_SPACE_RE, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/**
 * Accent-free lowercase copy that keeps the same string indices as the input, so
 * offsets found in the folded text can be used to slice the original.
 */
export function foldPreservingOffsets(input) {
  let out = '';
  for (const ch of String(input ?? '')) {
    if (ch.length !== 1) {
      out += ch;
      continue;
    }
    const folded = ch.normalize('NFD').replace(COMBINING_MARKS_RE, '').toLowerCase();
    out += folded.length === 1 ? folded : ch.toLowerCase().slice(0, 1) || ch;
  }
  return out;
}

const SERIES_BY_FOLDED_NAME = new Map(
  Object.entries(SERIES_COLUMNS).map(([name, field]) => [foldText(name), field]),
);

// ---------------------------------------------------------------------------
// Challenge / block detection
// ---------------------------------------------------------------------------

const BLOCKED_TITLES = new Set([
  'radware page',
  'radware captcha page',
  'challenge validation',
  'unauthorized request blocked',
]);

/**
 * Blocks a human would have to clear by hand. Radware escalates to these when it
 * is re-navigated while a silent challenge is pending, or when an IP has made too
 * many automated requests. Waiting or retrying only deepens the rate limit.
 */
const HARD_BLOCK_TITLES = new Set([
  'radware captcha page',
  'unauthorized request blocked',
]);

/** True when the page is an interactive block that retrying cannot clear. */
export function isHardBlock(title) {
  return HARD_BLOCK_TITLES.has(foldText(title));
}

const BLOCKED_URL_HOSTS = ['validate.perfdrive.com', 'perfdrive.com'];

const BLOCKED_BODY_MARKERS = [
  'validate.perfdrive.com',
  'unauthorized request blocked',
  'radware bot manager',
  'challenge validation',
  'botmanager_challenge',
  'perfdrive.com',
];

/**
 * Decide whether a response is a Radware challenge/block rather than a report.
 *
 * @returns {{blocked: boolean, reason: string|null}}
 */
export function detectChallenge({
  html = '', url = '', title = '', status = 200, redirectChain = [],
} = {}) {
  for (const candidate of [url, ...(redirectChain ?? [])].filter(Boolean)) {
    const lower = String(candidate).toLowerCase();
    for (const host of BLOCKED_URL_HOSTS) {
      if (lower.includes(host)) {
        return { blocked: true, reason: `redirected to ${host} (${candidate})` };
      }
    }
  }

  if (BLOCKED_TITLES.has(foldText(title))) {
    return { blocked: true, reason: `challenge page title "${String(title).trim()}"` };
  }

  // Body markers only convict a page that shows no sign of being the real site.
  // Radware injects its sensor into pages it lets through as well, so a page
  // carrying CENAPRED's own content must never be rejected for mentioning
  // perfdrive. A served challenge page contains no volcano content at all — that
  // is the discriminator, confirmed against a live challenge response.
  const foldedBody = foldText(String(html ?? '').slice(0, 400_000));
  if (!foldedBody.includes('popocat')) {
    for (const marker of BLOCKED_BODY_MARKERS) {
      if (foldedBody.includes(marker)) {
        return { blocked: true, reason: `bot-protection marker "${marker}" in response body` };
      }
    }

    if (status === 403 || status === 429) {
      return { blocked: true, reason: `HTTP ${status}` };
    }
  }

  return { blocked: false, reason: null };
}

/**
 * Cheap sanity check that a page really is a Popocatepetl report, so "no report
 * for this id" can be told apart from "we were blocked".
 */
export function looksLikeReportPage(html) {
  const folded = foldText(html);
  if (!folded.includes('popocat')) return false;
  return (
    folded.includes('addcolumn')
    || folded.includes('semaforo de alerta')
    || folded.includes('exhalacion')
  );
}

// ---------------------------------------------------------------------------
// Google Charts series
// ---------------------------------------------------------------------------

const ADD_COLUMN_ANY_RE = /addColumn\s*\(/g;
const ADD_COLUMN_NUMBER_RE = /addColumn\s*\(\s*(['"])number\1\s*,\s*(['"])([^'"]*)\2\s*\)/g;
const ADD_ROWS_RE = /addRows?\s*\(/g;
const ISO_LOOKING_ROW_RE = /\[\s*(['"])\d{4}-\d{1,2}-\d{1,2}\1\s*,/;

/** Return the text between an opening bracket and its match, or null. */
function sliceBalanced(text, openIndex, open = '[', close = ']') {
  if (text[openIndex] !== open) return null;
  let depth = 0;
  let quote = null;
  for (let i = openIndex; i < text.length; i += 1) {
    const ch = text[i];
    if (quote) {
      if (ch === '\\') i += 1;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      continue;
    }
    if (ch === open) depth += 1;
    else if (ch === close) {
      depth -= 1;
      if (depth === 0) return text.slice(openIndex + 1, i);
    }
  }
  return null;
}

/**
 * Parse CENAPRED's chart date labels. They are **day-first** (`DD-MM-YYYY`);
 * reading them as ISO is the bug that corrupted the previous implementation.
 */
export function parseDayFirstDate(label) {
  const m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/.exec(String(label ?? '').trim());
  if (!m) return null;
  const [, day, month, year] = m;
  return isoFromParts(Number(year), Number(month), Number(day));
}

/**
 * Parse one chart row body (the text inside `[ ... ]`).
 *
 * @returns {{date: string|null, values: Array<number|null>, raw: string}}
 */
export function parseChartRow(inner) {
  // Collapse `{v: 40, f: '40'}` style cells down to their value.
  const flattened = String(inner ?? '').replace(
    /\{[^{}]*?\bv\s*:\s*(-?\d+(?:\.\d+)?)[^{}]*\}/g,
    (_m, value) => value,
  );

  const tokens = [];
  const tokenRe = /'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)"|(-?\d+(?:\.\d+)?)|\bnull\b/g;
  let m;
  while ((m = tokenRe.exec(flattened)) !== null) {
    if (m[1] !== undefined) tokens.push({ kind: 'string', value: m[1] });
    else if (m[2] !== undefined) tokens.push({ kind: 'string', value: m[2] });
    else if (m[3] !== undefined) tokens.push({ kind: 'number', value: Number(m[3]) });
    else tokens.push({ kind: 'null', value: null });
  }

  const first = tokens[0];
  const date = first && first.kind === 'string' ? parseDayFirstDate(first.value) : null;
  const values = tokens
    .slice(1)
    .filter((t) => t.kind === 'number' || t.kind === 'null')
    .map((t) => t.value);

  return { date, values, raw: String(inner ?? '') };
}

/**
 * Extract every counter series embedded in a report page.
 *
 * Each report page carries a ~15-day window of all four series, which is what
 * makes a backfill cost roughly one request per fifteen days.
 *
 * @returns {{series: Record<string, Record<string, number|null>>, columnsSeen: string[], warnings: string[]}}
 */
export function parseSeries(html) {
  const text = decodeEntities(String(html ?? ''));
  const warnings = [];
  const columnsSeen = [];
  const series = Object.fromEntries(COUNTER_FIELDS.map((f) => [f, {}]));

  // Locate every addRows(...) / addRow(...) block. The number columns declared
  // since the previous block describe that block's value ordering.
  const blocks = [];
  ADD_ROWS_RE.lastIndex = 0;
  let rowsMatch;
  while ((rowsMatch = ADD_ROWS_RE.exec(text)) !== null) {
    const afterParen = rowsMatch.index + rowsMatch[0].length;
    const openIndex = text.slice(afterParen).search(/\S/) === -1
      ? -1
      : afterParen + text.slice(afterParen).search(/\S/);
    if (openIndex === -1 || text[openIndex] !== '[') continue; // e.g. addRows(someVar)
    const body = sliceBalanced(text, openIndex);
    if (body === null) {
      warnings.push('unbalanced addRows([...]) block; skipped');
      continue;
    }
    blocks.push({ declStart: rowsMatch.index, body });
  }

  let previousEnd = 0;
  let inheritedFields = null;
  for (const block of blocks) {
    const declarations = text.slice(previousEnd, block.declStart);
    previousEnd = block.declStart;

    ADD_COLUMN_ANY_RE.lastIndex = 0;
    const declaresColumns = ADD_COLUMN_ANY_RE.test(declarations);

    let fields;
    if (declaresColumns) {
      fields = [];
      ADD_COLUMN_NUMBER_RE.lastIndex = 0;
      let colMatch;
      while ((colMatch = ADD_COLUMN_NUMBER_RE.exec(declarations)) !== null) {
        const rawName = colMatch[3];
        columnsSeen.push(rawName);
        fields.push(SERIES_BY_FOLDED_NAME.get(foldText(rawName)) ?? null);
      }
      inheritedFields = fields.some(Boolean) ? fields : null;
    } else {
      // A bare addRow(...) continuing the previous chart's DataTable.
      fields = inheritedFields;
    }

    if (!fields || !fields.some(Boolean)) continue;

    // Rows are flat arrays inside the block body. `addRow([...])` passes a
    // single row, in which case the body *is* the row.
    const rowBodies = [];
    if (block.body.includes('[')) {
      const rowRe = /\[([^[\]]*)\]/g;
      let rowMatch;
      while ((rowMatch = rowRe.exec(block.body)) !== null) rowBodies.push(rowMatch[1]);
    } else {
      rowBodies.push(block.body);
    }

    let badDates = 0;
    for (const rowBody of rowBodies) {
      const row = parseChartRow(rowBody);
      if (!row.date) {
        badDates += 1;
        continue;
      }
      row.values.forEach((value, index) => {
        const field = fields[index];
        if (!field) return;
        if (value !== null && (!Number.isFinite(value) || value < 0)) return;
        series[field][row.date] = value === null ? null : Math.round(value);
      });
    }

    if (rowBodies.length > 0 && badDates === rowBodies.length) {
      const label = fields.filter(Boolean).join(', ');
      warnings.push(
        ISO_LOOKING_ROW_RE.test(block.body)
          ? `chart rows for [${label}] look ISO-formatted (YYYY-MM-DD); parser expects `
            + 'day-first DD-MM-YYYY — the upstream format may have changed'
          : `chart rows for [${label}] had no recognisable DD-MM-YYYY labels`,
      );
    }
  }

  const missing = COUNTER_FIELDS.filter((f) => Object.keys(series[f]).length === 0);
  if (missing.length) warnings.push(`no chart data found for: ${missing.join(', ')}`);

  return { series, columnsSeen, warnings };
}

/** Union of every date any series covers, ascending. */
export function coveredDatesOf(series) {
  const set = new Set();
  for (const field of COUNTER_FIELDS) {
    for (const date of Object.keys(series?.[field] ?? {})) set.add(date);
  }
  return [...set].sort();
}

export function countersFor(series, date) {
  const out = {};
  for (const field of COUNTER_FIELDS) {
    const value = series?.[field]?.[date];
    out[field] = value === undefined ? null : value;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Spanish dates
// ---------------------------------------------------------------------------

export const SPANISH_MONTHS = Object.freeze({
  enero: 1, ene: 1,
  febrero: 2, feb: 2,
  marzo: 3, mar: 3,
  abril: 4, abr: 4,
  mayo: 5, may: 5,
  junio: 6, jun: 6,
  julio: 7, jul: 7,
  agosto: 8, ago: 8,
  septiembre: 9, setiembre: 9, sep: 9, sept: 9,
  octubre: 10, oct: 10,
  noviembre: 11, nov: 11,
  diciembre: 12, dic: 12,
});

export function parseSpanishMonth(name) {
  return SPANISH_MONTHS[foldText(name).replace(/\.$/, '')] ?? null;
}

const SPANISH_DATE_SOURCE =
  '(\\d{1,2})\\s*(?:de\\s+)?([a-záéíóúñ]{3,12})\\.?\\s*(?:de[l]?\\s+)?(\\d{4})';

/** Parse `06 de Octubre de 2025` / `10 octubre 2024` into an ISO date. */
export function parseSpanishDate(text) {
  const m = new RegExp(SPANISH_DATE_SOURCE, 'i').exec(
    normalizeWhitespace(decodeEntities(text ?? '')),
  );
  if (!m) return null;
  const month = parseSpanishMonth(m[2]);
  return month ? isoFromParts(Number(m[3]), month, Number(m[1])) : null;
}

function findSpanishDates(text) {
  const out = [];
  const source = normalizeWhitespace(decodeEntities(text ?? ''));
  const re = new RegExp(SPANISH_DATE_SOURCE, 'gi');
  let m;
  while ((m = re.exec(source)) !== null) {
    const month = parseSpanishMonth(m[2]);
    if (!month) continue;
    const iso = isoFromParts(Number(m[3]), month, Number(m[1]));
    if (iso) out.push({ date: iso, index: m.index, text: m[0] });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Alert level
// ---------------------------------------------------------------------------

const ALERT_LEVELS = Object.freeze({
  verde: 'GREEN',
  amarillo: 'YELLOW',
  naranja: 'ORANGE',
  rojo: 'RED',
});

const ALERT_PHRASE_RE = /\b(VERDE|AMARILLO|NARANJA|ROJO)\b(\s+FASE\s+[0-9IVXivx]+)?/i;

export function mapAlertLevel(spanish) {
  const folded = foldText(spanish);
  for (const [word, code] of Object.entries(ALERT_LEVELS)) {
    if (new RegExp(`\\b${word}\\b`).test(folded)) return code;
  }
  return null;
}

/**
 * Pull the alert colour and the raw Spanish phrase out of the narrative.
 *
 * Anchors on the "Semáforo de Alerta Volcánica ... se encuentra en X" sentence so
 * a legend listing every colour cannot win.
 *
 * @returns {{alert_level: string|null, alert_phase: string|null}}
 */
export function parseAlert(text) {
  const source = normalizeWhitespace(decodeEntities(text ?? ''));
  const folded = foldPreservingOffsets(source);

  const windows = [];
  const semaforo = folded.indexOf('semaforo de alerta');
  if (semaforo !== -1) {
    const encuentra = folded.indexOf('se encuentra en', semaforo);
    if (encuentra !== -1 && encuentra - semaforo < 400) {
      windows.push(source.slice(encuentra, encuentra + 200));
    }
    windows.push(source.slice(semaforo, semaforo + 400));
  }
  const anyEncuentra = folded.indexOf('se encuentra en');
  if (anyEncuentra !== -1) windows.push(source.slice(anyEncuentra, anyEncuentra + 200));
  windows.push(source);

  for (const window of windows) {
    const m = ALERT_PHRASE_RE.exec(window);
    if (!m) continue;
    const phrase = normalizeWhitespace(m[0]).replace(/[.,;:]+$/, '').toUpperCase();
    const level = mapAlertLevel(m[1]);
    if (level) return { alert_level: level, alert_phase: phrase };
  }

  return { alert_level: null, alert_phase: null };
}

// ---------------------------------------------------------------------------
// Wind direction
// ---------------------------------------------------------------------------

/**
 * Spanish compass names -> 16-point codes. Keys are accent-free, lowercase and
 * space-free; lookup tries an exact match first, then the longest substring, so
 * `oestenoroeste` can never be swallowed by `noroeste`.
 */
const WIND_DIRECTIONS = Object.freeze({
  norte: 'N',
  nornoreste: 'NNE', nortenoreste: 'NNE', nornordeste: 'NNE', nortenordeste: 'NNE',
  noreste: 'NE', nordeste: 'NE',
  estenoreste: 'ENE', estenordeste: 'ENE',
  este: 'E', oriente: 'E',
  estesureste: 'ESE', estesudeste: 'ESE',
  sureste: 'SE', sudeste: 'SE',
  sursureste: 'SSE', sursudeste: 'SSE',
  sur: 'S',
  sursuroeste: 'SSW', sursudoeste: 'SSW',
  suroeste: 'SW', sudoeste: 'SW',
  oestesuroeste: 'WSW', oestesudoeste: 'WSW',
  oeste: 'W', poniente: 'W', occidente: 'W',
  oestenoroeste: 'WNW',
  noroeste: 'NW',
  nornoroeste: 'NNW', nortenoroeste: 'NNW',
});

const WIND_KEYS_BY_LENGTH = Object.keys(WIND_DIRECTIONS).sort((a, b) => b.length - a.length);

const WIND_STOPWORDS_RE =
  /\b(?:hacia|con|direccion|del|de|la|el|los|las|al|un|una|es|fue|era|rumbo|viento|vientos|predominante|predominantes|dominante|aproximadamente)\b/g;

export function mapWindDirection(spanish) {
  if (spanish == null) return null;
  const compact = foldText(spanish).replace(WIND_STOPWORDS_RE, ' ').replace(/[^a-z]/g, '');
  if (!compact) return null;
  if (Object.hasOwn(WIND_DIRECTIONS, compact)) return WIND_DIRECTIONS[compact];
  for (const key of WIND_KEYS_BY_LENGTH) {
    if (compact.includes(key)) return WIND_DIRECTIONS[key];
  }
  return null;
}

const WIND_PATTERNS = [
  /direcci[oó]n\s+del\s+viento\s*(?:es|fue|:|;|-)?\s*([^.,;:\n()]{2,50})/i,
  /direcci[oó]n\s+de\s+los\s+vientos\s*(?:es|fue|:|;|-)?\s*([^.,;:\n()]{2,50})/i,
  /viento[s]?\s+(?:con\s+)?direcci[oó]n\s+(?:al?\s+|hacia\s+(?:el\s+)?)?([^.,;:\n()]{2,50})/i,
  /(?:se\s+dispersaban?|se\s+dirig[ií]an?)\s+(?:con\s+direcci[oó]n\s+|hacia\s+(?:el\s+)?)([^.,;:\n()]{2,50})/i,
];

/** @returns {string|null} 16-point compass code */
export function parseWindDirection(text) {
  const source = normalizeWhitespace(decodeEntities(text ?? ''));
  for (const pattern of WIND_PATTERNS) {
    const m = pattern.exec(source);
    if (!m) continue;
    const code = mapWindDirection(m[1]);
    if (code) return code;
  }
  return null;
}

// ---------------------------------------------------------------------------
// SO2
// ---------------------------------------------------------------------------

const SO2_AMOUNT_RE = /(\d[\d.,\u00a0 ]{0,15}?)\s*toneladas\s+por\s+d[ií]a/i;
const SO2_LAST_READING_RE = new RegExp(
  `[uú]ltima\\s+lectura\\s*:?\\s*${SPANISH_DATE_SOURCE}`,
  'i',
);

/** Turn a Spanish-formatted number into a JS number. */
export function parseSpanishNumber(raw) {
  const s = String(raw ?? '').replace(/[\s\u00a0]/g, '');
  if (!s) return null;
  let normalized;
  if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) normalized = s.replace(/,/g, '');
  else if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(s)) normalized = s.replace(/\./g, '').replace(',', '.');
  else if (/^\d+,\d+$/.test(s)) normalized = s.replace(',', '.');
  else normalized = s.replace(/,/g, '');
  const value = Number.parseFloat(normalized);
  return Number.isFinite(value) ? value : null;
}

/**
 * Read the raw SO2 block. Returns what the page *says*; freshness is enforced
 * separately by {@link applySo2Window}.
 *
 * @returns {{tons: number|null, date: string|null}}
 */
export function parseSo2(text) {
  const source = normalizeWhitespace(decodeEntities(text ?? ''));
  const amount = SO2_AMOUNT_RE.exec(source);
  if (!amount) return { tons: null, date: null };

  const tons = parseSpanishNumber(amount[1]);
  if (tons === null) return { tons: null, date: null };

  // Look for the measurement date on either side of the amount: some layouts
  // write "... Última lectura: 10 octubre 2024", others write
  // "El 10 octubre 2024 se midieron N toneladas por día".
  const start = Math.max(0, amount.index - 300);
  const window = source.slice(start, amount.index + amount[0].length + 300);

  const lastReading = SO2_LAST_READING_RE.exec(window);
  if (lastReading) {
    const month = parseSpanishMonth(lastReading[2]);
    const iso = month ? isoFromParts(Number(lastReading[3]), month, Number(lastReading[1])) : null;
    if (iso) return { tons, date: iso };
  }

  const amountIndexInWindow = amount.index - start;
  const candidates = findSpanishDates(window);
  if (candidates.length) {
    candidates.sort(
      (a, b) => Math.abs(a.index - amountIndexInWindow) - Math.abs(b.index - amountIndexInWindow),
    );
    return { tons, date: candidates[0].date };
  }

  return { tons, date: null };
}

/**
 * Enforce the schema's 7-day rule.
 *
 * CENAPRED renders one global "last reading" on *every* page, including reports
 * from years before the reading was taken. Attributing it to an old report would
 * fabricate data, so anything outside the window — or any reading whose date we
 * cannot establish — is dropped entirely.
 *
 * @returns {{so2_emissions_tons_per_day: number|null, so2_measurement_date: string|null, suppressed: string|null}}
 */
export function applySo2Window(so2, reportDate, maxAgeDays = SO2_MAX_AGE_DAYS) {
  const empty = { so2_emissions_tons_per_day: null, so2_measurement_date: null };
  if (!so2 || so2.tons === null || so2.tons === undefined) {
    return { ...empty, suppressed: null };
  }
  if (!so2.date) {
    return { ...empty, suppressed: 'SO2 reading has no parseable measurement date; dropped' };
  }
  if (!isValidIsoDate(reportDate)) {
    return { ...empty, suppressed: 'report date unknown; SO2 reading dropped' };
  }
  const age = Math.abs(diffDays(so2.date, reportDate));
  if (age > maxAgeDays) {
    return {
      ...empty,
      suppressed:
        `SO2 reading dated ${so2.date} is ${age} days from report date ${reportDate} `
        + `(limit ${maxAgeDays}); dropped per feed schema`,
    };
  }
  return {
    so2_emissions_tons_per_day: so2.tons,
    so2_measurement_date: so2.date,
    suppressed: null,
  };
}

// ---------------------------------------------------------------------------
// Tremor breakdown
// ---------------------------------------------------------------------------

const TREMOR_HIGH_FREQ_RE = /(\d+)\s*minutos?\s+(?:fueron\s+)?(?:de\s+)?alta\s+frecuencia/i;
const TREMOR_HARMONIC_RE =
  /(\d+)\s*minutos?\s+(?:fueron\s+)?(?:de\s+)?(?:tremor\s+)?arm[oó]nico/i;

/** @returns {{tremor_high_frequency_minutes: number|null, tremor_harmonic_minutes: number|null}} */
export function parseTremorBreakdown(text) {
  const source = normalizeWhitespace(decodeEntities(text ?? ''));
  const high = TREMOR_HIGH_FREQ_RE.exec(source);
  const harmonic = TREMOR_HARMONIC_RE.exec(source);
  return {
    tremor_high_frequency_minutes: high ? Number(high[1]) : null,
    tremor_harmonic_minutes: harmonic ? Number(harmonic[1]) : null,
  };
}

// ---------------------------------------------------------------------------
// Narrative
// ---------------------------------------------------------------------------

const NARRATIVE_SIGNAL_RE =
  /exhalacion|tremor|ceniza|crater|sismo|explosi|volcan|emision|fumarol|incandescen|monitoreo|cenacom|semaforo|visibilidad|desgasific|magma|vapor de agua|columna|alerta/;

const CHROME_SELECTOR = [
  'script', 'style', 'noscript', 'template', 'nav', 'header', 'footer',
  'form', 'select', 'option', 'button', 'iframe', 'svg',
  '.menu', '#menu', '.navbar', '.nav', '.breadcrumb', '.breadcrumbs',
  '.footer', '.header', '.sidebar', '#sidebar', '.pagination',
].join(', ');

function loadCleanDocument(html) {
  const $ = cheerio.load(String(html ?? ''));
  $(CHROME_SELECTOR).remove();
  return $;
}

/** Whole-page visible text with site chrome stripped. */
export function extractPageText(html) {
  const $ = loadCleanDocument(html);
  return normalizeWhitespace($('body').text() || $.root().text());
}

/** Extract candidate prose blocks from the page. */
export function extractTextBlocks(html) {
  const $ = loadCleanDocument(html);
  const blocks = [];

  $('p, li, td, div').each((_i, node) => {
    const el = $(node);
    if (el.find('p, div, li, table, ul, ol, td').length > 0) return; // not a leaf block
    // Source-formatting line breaks inside one block are just whitespace; only
    // the gaps *between* blocks are real paragraph breaks.
    const text = normalizeWhitespace(el.text()).replace(/\s+/g, ' ').trim();
    if (!text || text.length < 25) return;
    // Skip navigation-ish blocks that are mostly anchor text.
    if (normalizeWhitespace(el.find('a').text()).length > text.length * 0.6) return;
    if (blocks.some((existing) => existing === text || existing.includes(text))) return;
    blocks.push(text);
  });

  return blocks;
}

/** Join the report's prose into `summary_spanish`, preserving paragraph breaks. */
export function parseSummary(html) {
  const blocks = extractTextBlocks(html);
  const relevant = blocks.filter((b) => NARRATIVE_SIGNAL_RE.test(foldText(b)));
  const chosen = relevant.length
    ? relevant
    : [...blocks].sort((a, b) => b.length - a.length).slice(0, 3);
  return chosen.join('\n\n').trim();
}

// ---------------------------------------------------------------------------
// Ashfall
// ---------------------------------------------------------------------------

const ASHFALL_PLACE_PREFIX_RE = new RegExp(
  '^(?:los\\s+municipios\\s+de|el\\s+municipio\\s+de|las\\s+localidades\\s+de'
  + '|la\\s+localidad\\s+de|las\\s+alcald[ií]as\\s+de|la\\s+alcald[ií]a\\s+de'
  + '|las\\s+poblaciones\\s+de|la\\s+poblaci[oó]n\\s+de|las\\s+comunidades\\s+de'
  + '|la\\s+zona\\s+de)\\s+',
  'i',
);

const ASHFALL_NEGATION_RE = /\b(?:no|sin)\s+(?:se\s+)?(?:report|registr|observ|present|hubo|tuvo|ha\s+)/;

/**
 * Place names with reported ashfall.
 *
 * Deliberately conservative: the span after "caída de ceniza en" is kept whole
 * unless it is separated by `;` / `y en` / `así como en`, because a single place
 * routinely embeds a comma ("Atlautla, Estado de México").
 */
export function parseAshfall(text) {
  const source = normalizeWhitespace(decodeEntities(text ?? ''));
  const folded = foldPreservingOffsets(source);
  const results = [];
  const markerRe = /ca[ií]da\s+de\s+ceniza\s+(?:en|sobre)\s+/g;

  markerRe.lastIndex = 0;
  let m;
  while ((m = markerRe.exec(folded)) !== null) {
    // Only the sentence the phrase sits in may veto it.
    const sentenceStart = Math.max(
      folded.lastIndexOf('. ', m.index),
      folded.lastIndexOf('\n', m.index),
      -1,
    ) + 1;
    const preceding = folded.slice(sentenceStart, m.index);
    if (ASHFALL_NEGATION_RE.test(preceding) || /\bsin\s*$/.test(preceding)) continue;

    const tail = source.slice(m.index + m[0].length);
    const endMatch = /\.(?:\s|$)|\n/.exec(tail);
    const span = (endMatch ? tail.slice(0, endMatch.index) : tail).trim().replace(/\.$/, '');
    if (!span) continue;

    for (const piece of span.split(/\s*;\s*|\s+as[ií]\s+como\s+en\s+|\s+y\s+en\s+/i)) {
      const place = piece
        .trim()
        .replace(ASHFALL_PLACE_PREFIX_RE, '')
        .replace(/[,;:]\s*$/, '')
        .trim();
      if (place && place.length <= 160 && !results.includes(place)) results.push(place);
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// Media
// ---------------------------------------------------------------------------

const MEDIA_RE = /\/media\/([A-Za-z0-9._\-/]*?\.(?:jpe?g|png|gif|webp|bmp|mp4|webm|mov|m4v|ogv))/gi;

const MEDIA_CHROME_RE =
  /(?:logo|banner|icon|icono|escudo|sprite|header|footer|encabezado|fondo|background|placeholder|avatar)/i;

const VIDEO_EXT_RE = /\.(?:mp4|webm|mov|m4v|ogv)$/i;

/** @returns {{image_urls: string[], video_urls: string[]}} */
export function parseMedia(html, baseUrl = BASE_URL) {
  const text = decodeEntities(String(html ?? ''));
  const image_urls = [];
  const video_urls = [];
  const seen = new Set();

  MEDIA_RE.lastIndex = 0;
  let m;
  while ((m = MEDIA_RE.exec(text)) !== null) {
    const relative = m[1].replace(/^\/+/, '');
    if (!relative || relative.includes('..')) continue;
    const basename = relative.split('/').pop();
    if (MEDIA_CHROME_RE.test(basename)) continue;
    const url = `${baseUrl}/media/${relative}`;
    if (seen.has(url)) continue;
    seen.add(url);
    (VIDEO_EXT_RE.test(basename) ? video_urls : image_urls).push(url);
  }

  return { image_urls, video_urls };
}

// ---------------------------------------------------------------------------
// Report date
// ---------------------------------------------------------------------------

const NUMERIC_DATE_RE = /\b(\d{1,2})[-/](\d{1,2})[-/](\d{4})\b/;

/**
 * Work out which day the page's own report covers.
 *
 * Headings win; otherwise the newest date in the chart window is used, since the
 * window ends on the report day.
 */
export function parseReportDate(html, series = null) {
  const $ = loadCleanDocument(html);

  const headings = [];
  $('h1, h2, h3, h4, h5, h6, caption, legend, .titulo, .title').each((_i, node) => {
    const text = normalizeWhitespace($(node).text());
    if (text) headings.push(text);
  });

  for (const heading of headings) {
    if (/[uú]ltima\s+lectura/i.test(heading)) continue;
    const iso = parseSpanishDate(heading);
    if (iso) return { date: iso, source: 'heading' };
    const numeric = NUMERIC_DATE_RE.exec(heading);
    if (numeric) {
      const dayFirst = isoFromParts(Number(numeric[3]), Number(numeric[2]), Number(numeric[1]));
      if (dayFirst) return { date: dayFirst, source: 'heading-numeric' };
    }
  }

  // "Reporte del 5 de agosto de 2026" anywhere in the body.
  const body = normalizeWhitespace($('body').text() || $.root().text());
  const reportPhrase = new RegExp(
    `reporte[^.\\n]{0,40}?\\b(${SPANISH_DATE_SOURCE})`,
    'i',
  ).exec(body);
  if (reportPhrase) {
    const iso = parseSpanishDate(reportPhrase[1]);
    if (iso) return { date: iso, source: 'reporte-phrase' };
  }

  if (series) {
    const latest = maxIso(coveredDatesOf(series));
    if (latest) return { date: latest, source: 'chart-window' };
  }

  return { date: null, source: null };
}

// ---------------------------------------------------------------------------
// Report assembly
// ---------------------------------------------------------------------------

/** Build a Report object with the schema's exact key order. */
export function buildReport(fields) {
  const out = {};
  for (const key of REPORT_KEY_ORDER) {
    if (key === 'partial') {
      if (fields.partial === true) out.partial = true;
      continue;
    }
    out[key] = Object.hasOwn(fields, key) && fields[key] !== undefined ? fields[key] : null;
  }
  return out;
}

/**
 * Parse a full report page.
 *
 * @param {string} html raw page HTML
 * @param {{sourceUrl?: string, ingestedAt?: string, expectedDate?: string|null}} options
 */
export function parseReportPage(html, { sourceUrl, ingestedAt, expectedDate = null } = {}) {
  const raw = String(html ?? '');
  const warnings = [];

  const challenge = detectChallenge({ html: raw });
  if (challenge.blocked) throw new ChallengeError(challenge.reason, { sourceUrl });
  if (!looksLikeReportPage(raw)) {
    throw new NotAReportError('page does not look like a Popocatepetl report', { sourceUrl });
  }

  const { series, warnings: seriesWarnings } = parseSeries(raw);
  warnings.push(...seriesWarnings);

  const { date: reportDate, source: dateSource } = parseReportDate(raw, series);
  if (!reportDate) {
    throw new NotAReportError('could not determine the report date', { sourceUrl });
  }

  const coveredDates = coveredDatesOf(series);
  const windowLatest = maxIso(coveredDates);
  const windowEarliest = minIso(coveredDates);
  if (windowLatest && windowLatest !== reportDate && dateSource !== 'chart-window') {
    warnings.push(
      `report date ${reportDate} (from ${dateSource}) is not the newest charted day ${windowLatest}`,
    );
  }
  if (expectedDate && expectedDate !== reportDate) {
    warnings.push(`expected the report for ${expectedDate} but the page reports ${reportDate}`);
  }

  const summary = parseSummary(raw);
  if (!summary) warnings.push('no narrative text found on the page');
  const pageText = extractPageText(raw);
  const detailText = summary || pageText;

  // Prefer the narrative, but fall back to the whole page: CENAPRED renders the
  // SO2 figure and the alert banner outside the prose on some layouts.
  const so2Narrative = parseSo2(detailText);
  const so2Raw = so2Narrative.tons === null ? parseSo2(pageText) : so2Narrative;
  const so2 = applySo2Window(so2Raw, reportDate);
  if (so2.suppressed) warnings.push(so2.suppressed);

  const alertNarrative = parseAlert(detailText);
  const alert = alertNarrative.alert_level ? alertNarrative : parseAlert(pageText);
  if (!alert.alert_level) warnings.push('no alert level found on the page');

  const wind = parseWindDirection(detailText) ?? parseWindDirection(pageText);

  const counters = countersFor(series, reportDate);
  for (const field of COUNTER_FIELDS) {
    if (counters[field] === null) {
      warnings.push(`chart series has no value for ${field} on the report date ${reportDate}`);
    }
  }

  const details = {
    ...parseTremorBreakdown(detailText),
    alert_level: alert.alert_level,
    alert_phase: alert.alert_phase,
    wind_direction: wind,
    summary_spanish: summary,
    ashfall_reports: parseAshfall(detailText),
    ...parseMedia(raw),
    so2_emissions_tons_per_day: so2.so2_emissions_tons_per_day,
    so2_measurement_date: so2.so2_measurement_date,
  };

  const report = buildReport({
    schema_version: SCHEMA_VERSION,
    date: reportDate,
    ...counters,
    ...details,
    source_url: sourceUrl ?? null,
    ingested_at: ingestedAt ?? null,
  });

  // Every other day in the embedded window: counters only. Report-level detail
  // (narrative, alert, wind, SO2, media) belongs to `reportDate` alone and is
  // never copied across, so these records are flagged `partial`.
  const partialReports = coveredDates
    .filter((date) => date !== reportDate)
    .map((date) =>
      buildReport({
        schema_version: SCHEMA_VERSION,
        date,
        ...countersFor(series, date),
        ashfall_reports: [],
        image_urls: [],
        video_urls: [],
        source_url: sourceUrl ?? null,
        ingested_at: ingestedAt ?? null,
        partial: true,
      }),
    );

  return {
    reportDate,
    dateSource,
    report,
    partialReports,
    coveredDates,
    windowEarliest,
    windowLatest,
    series,
    details,
    warnings,
  };
}
