#!/usr/bin/env node
/**
 * PopoCLI feed ingester.
 *
 * Fetches CENAPRED Popocatepetl reports with real Chromium (the site is behind
 * Radware Bot Manager, so plain HTTP clients only ever see a challenge page) and
 * publishes the static JSON feed described by `docs/feed-schema.md`.
 *
 *   node ingest/index.mjs latest
 *   node ingest/index.mjs backfill --from 2024-01-01 --to 2024-12-31
 *   node ingest/index.mjs reindex
 *   node ingest/index.mjs parse <saved.html>
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import {
  ChallengeError,
  NotAReportError,
  parseReportPage,
} from './lib/parser.mjs';
import {
  CenapredSession,
  historicalSourceUrl,
  idForDate,
  sleep,
  withChallengeRetry,
} from './lib/browser.mjs';
import {
  isPartial,
  listReportDates,
  readReport,
  saveReport,
  stringifyJson,
  writeIndex,
  writeLatest,
} from './lib/store.mjs';
import { addDays, diffDays, findGaps, isValidIsoDate, rfc3339, todayIso } from './lib/dates.mjs';

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const EXIT_OK = 0;
const EXIT_ERROR = 1;
const EXIT_BLOCKED = 2;
/** `verify` found holes in the archive that it did not close. */
const EXIT_GAPS = 3;

/** A mistake in how the command was invoked, reported without a stack trace. */
class UsageError extends Error {
  constructor(message) {
    super(message);
    this.name = 'UsageError';
  }
}

const USAGE = `PopoCLI feed ingester

Usage:
  node ingest/index.mjs latest [options]
  node ingest/index.mjs backfill --from <YYYY-MM-DD> --to <YYYY-MM-DD> [options]
  node ingest/index.mjs extend [options]
  node ingest/index.mjs verify [options]
  node ingest/index.mjs reindex [options]
  node ingest/index.mjs parse <file.html> [options]

Commands:
  latest      Ingest the most recent report. Writes data/latest.json,
              data/reports/<YYYY>/<date>.json and refreshes data/index.json.
  backfill    Walk history backwards from --to to --from. Each report page embeds
              a ~15-day window of all four counter series, so this costs roughly
              one request per fifteen days. Resumable and rate-limited.
  extend      Walk the archive one chunk further back, for use on a schedule.
              Reads the current earliest date and fetches --days before it.
              Self-limiting: once no earlier reports exist it writes
              data/.backfill-complete and later runs do nothing.
  verify      Sweep the archive for missing days and report them. With
              --refill, fetch what is missing. A lost anchor leaves a hole that
              nothing else notices, so run this after every backfill.
  reindex     Rebuild data/index.json and data/latest.json from disk. No network.
  parse       Parse a saved HTML file and print the report JSON. No network.

Options:
  --data-dir <path>     Feed directory (default: <repo>/data)
  --delay-ms <n>        Politeness delay between requests (default: 1000)
  --retries <n>         Attempts per request before giving up (default: 3)
  --timeout-ms <n>      Per-navigation timeout (default: 60000)
  --challenge-timeout-ms <n>
                        How long to let a bot-protection challenge clear itself
                        in place (default: 45000)
  --headless            Force headless Chromium. NOT recommended: Radware
                        challenges headless and lets a headed window through.
                        Chromium runs headed by default; on a machine with no
                        display, wrap the command in "xvfb-run -a".
  --block-assets        Also block images and fonts, not just video
  --load-assets         Block nothing at all (debugging)
  --dry-run             Parse and report, but write nothing
  --force               Re-fetch and overwrite even if already on disk
  --no-partials         Do not write counter-only records for the other days
                        covered by a page's chart window
  --upgrade-partials    During backfill, re-fetch dates that only have a
                        counter-only record, to turn them into full reports
  --step <n>            Fallback backfill step in days when a window cannot be
                        measured (default: 15)
  --max-consecutive-failures <n>
                        Failed anchors in a row before backfill gives up on a
                        region and skips a whole window (default: 3). Below
                        that it retreats one day at a time, so a transient
                        failure costs a day rather than fifteen.
  --days <n>            extend only: how far back to reach per run (default: 365)
  --refill              verify only: fetch the missing days it finds
  --max-gaps <n>        verify only: how many gaps to refill per run (default: 20)
  --max-requests <n>    Stop after this many network requests
  --quiet               Only print warnings and errors
  --help                Show this message

Exit codes: 0 success (including "no new report"), 1 error, 2 blocked by the WAF,
3 verify found gaps it did not close.
`;

// ---------------------------------------------------------------------------
// Arguments
// ---------------------------------------------------------------------------

export function parseArgv(argv) {
  const options = Object.create(null);
  const positionals = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--') {
      positionals.push(...argv.slice(i + 1));
      break;
    }
    if (!arg.startsWith('--')) {
      positionals.push(arg);
      continue;
    }
    const equals = arg.indexOf('=');
    if (equals !== -1) {
      options[arg.slice(2, equals)] = arg.slice(equals + 1);
      continue;
    }
    const name = arg.slice(2);
    if (name.startsWith('no-')) {
      options[name.slice(3)] = false;
      continue;
    }
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith('--')) {
      options[name] = next;
      i += 1;
    } else {
      options[name] = true;
    }
  }
  return { options, positionals };
}

const flag = (options, name, fallback = false) => {
  const value = options[name];
  if (value === undefined) return fallback;
  if (value === false || value === 'false' || value === '0') return false;
  return true;
};

const num = (options, name, fallback) => {
  const value = options[name];
  if (value === undefined || value === true || value === false) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

// ---------------------------------------------------------------------------
// Logging
// ---------------------------------------------------------------------------

function createLogger({ quiet = false } = {}) {
  const stamp = () => new Date().toISOString().slice(11, 19);
  return {
    info: (...args) => {
      if (!quiet) console.log(`[${stamp()}]`, ...args);
    },
    warn: (...args) => console.warn(`[${stamp()}] WARN`, ...args),
    error: (...args) => console.error(`[${stamp()}] ERROR`, ...args),
  };
}

async function setGithubOutput(values) {
  const file = process.env.GITHUB_OUTPUT;
  if (!file) return;
  const lines = Object.entries(values).map(([key, value]) => `${key}=${value}`);
  await fs.appendFile(file, `${lines.join('\n')}\n`, 'utf8');
}

// ---------------------------------------------------------------------------
// Shared persistence
// ---------------------------------------------------------------------------

const CHANGED_STATUSES = new Set(['created', 'updated']);

/**
 * Persist a parsed page: the full report for its own date, plus counter-only
 * records for the rest of the embedded chart window.
 */
async function persistParsedPage(parsed, { dataDir, dryRun, force, writePartials, log }) {
  const results = { created: 0, updated: 0, unchanged: 0, skipped: 0 };

  const primary = await saveReport(dataDir, parsed.report, { dryRun, force });
  results[primary] += 1;

  if (writePartials) {
    for (const partial of parsed.partialReports) {
      const status = await saveReport(dataDir, partial, { dryRun, force: false });
      results[status] += 1;
    }
  }

  for (const warning of parsed.warnings) log.warn(`${parsed.reportDate}: ${warning}`);

  return results;
}

function summarise(results) {
  return `created ${results.created}, updated ${results.updated}, `
    + `unchanged ${results.unchanged}, skipped ${results.skipped}`;
}

function addResults(target, source) {
  for (const key of Object.keys(target)) target[key] += source[key] ?? 0;
  return target;
}

function anythingChanged(results) {
  return results.created > 0 || results.updated > 0;
}

async function launchSession(options, log) {
  return CenapredSession.launch({
    // Headed by default: headless Chromium is challenged by Radware, headed is
    // not. CI supplies a virtual display via `xvfb-run`.
    headless: flag(options, 'headless', false),
    timeoutMs: num(options, 'timeout-ms', 60_000),
    challengeTimeoutMs: num(options, 'challenge-timeout-ms', 45_000),
    loadAssets: flag(options, 'load-assets', false),
    blockAssets: flag(options, 'block-assets', false),
    log: (message) => log.info(message),
  });
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

async function commandLatest(options, log) {
  const dataDir = path.resolve(options['data-dir'] ?? path.join(ROOT_DIR, 'data'));
  const dryRun = flag(options, 'dry-run', false);
  const force = flag(options, 'force', false);
  const writePartials = flag(options, 'partials', true);
  const retries = num(options, 'retries', 3);

  const session = await launchSession(options, log);
  let parsed;
  try {
    log.info('fetching the latest report page');
    const page = await withChallengeRetry(
      session,
      () => session.fetchLatest(),
      { attempts: retries, log: (m) => log.warn(m) },
    );
    parsed = parseReportPage(page.html, {
      sourceUrl: page.sourceUrl,
      ingestedAt: rfc3339(),
    });
  } finally {
    await session.close();
  }

  log.info(
    `report date ${parsed.reportDate} (chart window ${parsed.windowEarliest}..${parsed.windowLatest}, `
    + `${parsed.coveredDates.length} days)`,
  );

  const existing = await readReport(dataDir, parsed.reportDate);
  const results = await persistParsedPage(parsed, {
    dataDir, dryRun, force, writePartials, log,
  });

  const latest = await writeLatest(dataDir, { dryRun });
  const index = await writeIndex(dataDir, { dryRun });
  if (CHANGED_STATUSES.has(latest.status)) results.updated += 1;
  if (CHANGED_STATUSES.has(index.status)) results.updated += 1;

  const changed = anythingChanged(results);
  const isNewReport = !existing || isPartial(existing);

  log.info(`${summarise(results)}; index now lists ${index.index.count} dates`);
  if (!changed) {
    log.info(`no new report: ${parsed.reportDate} is already published unchanged`);
  } else if (isNewReport) {
    log.info(`published a new report for ${parsed.reportDate}`);
  } else {
    log.info(`updated the existing report for ${parsed.reportDate}`);
  }

  await setGithubOutput({
    changed: String(changed),
    date: parsed.reportDate,
    result: changed ? (isNewReport ? 'new-report' : 'updated') : 'unchanged',
  });

  return EXIT_OK;
}

async function commandBackfill(options, log) {
  const dataDir = path.resolve(options['data-dir'] ?? path.join(ROOT_DIR, 'data'));
  const from = options.from;
  const to = options.to ?? todayIso();

  if (!isValidIsoDate(from) || !isValidIsoDate(to)) {
    throw new UsageError('backfill needs --from <YYYY-MM-DD> and --to <YYYY-MM-DD>');
  }
  if (from > to) throw new UsageError(`--from ${from} is after --to ${to}`);

  const dryRun = flag(options, 'dry-run', false);
  const force = flag(options, 'force', false);
  const writePartials = flag(options, 'partials', true);
  const upgradePartials = flag(options, 'upgrade-partials', false);
  const envDelay = Number(process.env.POPO_INGEST_DELAY_MS);
  const delayMs = Math.max(
    0,
    num(options, 'delay-ms', Number.isFinite(envDelay) ? envDelay : 1000),
  );
  const fallbackStep = Math.max(1, num(options, 'step', 15));
  const maxRequests = num(options, 'max-requests', Number.POSITIVE_INFINITY);
  const retries = num(options, 'retries', 3);
  const maxIdCorrections = 3;
  // How many anchors in a row may fail before we accept the region is bad and
  // skip a whole window rather than crawling it a day at a time.
  const maxConsecutiveFailures = Math.max(1, num(options, 'max-consecutive-failures', 3));

  const onDisk = new Set(await listReportDates(dataDir));
  const totals = { created: 0, updated: 0, unchanged: 0, skipped: 0 };
  let requests = 0;
  let idCorrection = 0;
  let anchor = to;
  let blocked = null;
  let exhausted = false;
  let consecutiveFailures = 0;
  const failures = [];

  log.info(
    `backfilling ${from}..${to} (delay ${delayMs}ms, `
    + `${writePartials ? 'writing' : 'not writing'} counter-only window records)`,
  );

  const session = await launchSession(options, log);
  try {
    while (anchor >= from && !exhausted) {
      if (requests >= maxRequests) {
        log.warn(`request budget of ${maxRequests} reached; stopping at ${anchor}`);
        break;
      }

      if (!force && onDisk.has(anchor)) {
        const existing = await readReport(dataDir, anchor);
        const needsUpgrade = upgradePartials && isPartial(existing);
        if (!needsUpgrade) {
          anchor = addDays(anchor, -1);
          continue;
        }
      }

      let parsed = null;
      let usedId = null;
      for (let correction = 0; correction <= maxIdCorrections; correction += 1) {
        const id = idForDate(anchor, idCorrection);
        if (id <= 0) {
          log.warn(`derived id ${id} for ${anchor} is below the start of the archive; stopping`);
          exhausted = true;
          break;
        }
        usedId = id;

        if (requests > 0) await sleep(delayMs);
        requests += 1;
        log.info(`request ${requests}: id_registro=${id} (target ${anchor})`);

        let page;
        try {
          page = await withChallengeRetry(
            session,
            () => session.fetchById(id, anchor),
            { attempts: retries, log: (m) => log.warn(m) },
          );
        } catch (error) {
          if (error instanceof ChallengeError) throw error;
          log.warn(`id ${id} (${anchor}) failed: ${error.message}`);
          failures.push({ anchor, id, reason: error.message });
          break;
        }

        try {
          parsed = parseReportPage(page.html, {
            sourceUrl: historicalSourceUrl(id, anchor),
            ingestedAt: rfc3339(),
            expectedDate: anchor,
          });
        } catch (error) {
          if (error instanceof ChallengeError) throw error;
          if (error instanceof NotAReportError) {
            log.warn(`id ${id} did not return a report page (${error.message})`);
            failures.push({ anchor, id, reason: error.message });
            break;
          }
          throw error;
        }

        if (parsed.reportDate === anchor) break;

        const drift = diffDays(parsed.reportDate, anchor);
        log.warn(
          `id ${id} returned the report for ${parsed.reportDate}, not ${anchor} `
          + `(drift ${drift > 0 ? '+' : ''}${drift} days)`,
        );
        if (correction === maxIdCorrections) {
          log.warn(
            `giving up on aligning ${anchor}; the page will be stored under its own `
            + `date ${parsed.reportDate} and never under ${anchor}`,
          );
          break;
        }
        idCorrection += drift;
        log.info(`adjusting id offset to ${idCorrection} and retrying`);
        parsed = null;
      }

      if (!parsed) {
        // Stepping a whole window here would punch a 15-day hole in the archive
        // for what is usually a transient failure. Stepping back a single day
        // instead picks a different id whose window still overlaps almost all
        // of the one we just missed, so the cost of a blip is one day, not
        // fifteen. Only give up on the region after repeated failures.
        consecutiveFailures += 1;
        if (consecutiveFailures >= maxConsecutiveFailures) {
          log.warn(
            `${consecutiveFailures} consecutive failures around ${anchor}; `
            + `skipping a full ${fallbackStep}-day window. Run "verify --refill" afterwards.`,
          );
          anchor = addDays(anchor, -fallbackStep);
          consecutiveFailures = 0;
        } else {
          anchor = addDays(anchor, -1);
        }
        continue;
      }
      consecutiveFailures = 0;

      const results = await persistParsedPage(parsed, {
        dataDir, dryRun, force, writePartials, log,
      });
      addResults(totals, results);
      onDisk.add(parsed.reportDate);
      // Only the dates we actually persisted count as resumable progress.
      if (writePartials) for (const date of parsed.coveredDates) onDisk.add(date);

      log.info(
        `id ${usedId} -> ${parsed.reportDate}, window `
        + `${parsed.windowEarliest}..${parsed.windowLatest} (${summarise(results)})`,
      );

      // The window ends on the report day, so the next page we need is the day
      // before the window starts. Never step forward, always make progress.
      const windowStart = parsed.windowEarliest ?? parsed.reportDate;
      const next = addDays(windowStart, -1);
      anchor = next < anchor ? next : addDays(anchor, -1);
    }
  } catch (error) {
    // A block ends the run, but everything fetched so far is real data: fall
    // through so the index is rebuilt and the next run can resume.
    if (!(error instanceof ChallengeError)) throw error;
    blocked = error;
    log.error(error.message);
    log.error(`stopped at ${anchor}; work done so far is kept: re-run to resume`);
  } finally {
    await session.close();
  }

  const index = await writeIndex(dataDir, { dryRun });
  const latest = await writeLatest(dataDir, { dryRun });
  if (CHANGED_STATUSES.has(index.status)) totals.updated += 1;
  if (CHANGED_STATUSES.has(latest.status)) totals.updated += 1;

  log.info(`${requests} requests: ${summarise(totals)}`);
  log.info(`index now lists ${index.index.count} dates (${index.index.earliest}..${index.index.latest})`);
  if (failures.length) {
    log.warn(`${failures.length} anchor(s) could not be fetched:`);
    for (const failure of failures.slice(0, 20)) {
      log.warn(`  ${failure.anchor} (id ${failure.id}): ${failure.reason}`);
    }
  }

  await setGithubOutput({
    changed: String(anythingChanged(totals)),
    requests: String(requests),
    result: blocked ? 'blocked' : 'backfill',
  });

  return blocked ? EXIT_BLOCKED : EXIT_OK;
}

async function commandReindex(options, log) {
  const dataDir = path.resolve(options['data-dir'] ?? path.join(ROOT_DIR, 'data'));
  const dryRun = flag(options, 'dry-run', false);

  const index = await writeIndex(dataDir, { dryRun });
  const latest = await writeLatest(dataDir, { dryRun });

  log.info(`index: ${index.status}; ${index.index.count} dates`);
  log.info(`latest.json: ${latest.status}${latest.report ? ` (${latest.report.date})` : ' (no full report on disk)'}`);

  const changed = CHANGED_STATUSES.has(index.status) || CHANGED_STATUSES.has(latest.status);
  await setGithubOutput({ changed: String(changed), result: 'reindex' });
  return EXIT_OK;
}

/**
 * Report (and optionally close) holes in the archive.
 *
 * A backfill that loses an anchor leaves a run of missing days that nothing
 * else notices: the feed still looks healthy, the index is still internally
 * consistent, and only a date-by-date sweep reveals it. This makes that sweep
 * a first-class command so it can gate CI.
 */
async function commandVerify(options, log) {
  const dataDir = path.resolve(options['data-dir'] ?? path.join(ROOT_DIR, 'data'));
  const refill = flag(options, 'refill', false);
  const maxGaps = num(options, 'max-gaps', 20);

  const dates = await listReportDates(dataDir);
  if (dates.length === 0) {
    log.warn('no reports on disk; nothing to verify');
    await setGithubOutput({ gaps: '0', result: 'verify' });
    return EXIT_OK;
  }

  const sorted = [...dates].sort();
  const from = options.from ?? sorted[0];
  const to = options.to ?? sorted[sorted.length - 1];
  const inRange = sorted.filter((d) => d >= from && d <= to);
  let gaps = findGaps(inRange);

  log.info(`verifying ${from}..${to}: ${inRange.length} reports on disk`);
  if (gaps.length === 0) {
    log.info('no gaps: every day in range is present');
    await setGithubOutput({ gaps: '0', result: 'verify' });
    return EXIT_OK;
  }

  const totalMissing = gaps.reduce((sum, g) => sum + g.days, 0);
  log.warn(`${gaps.length} gap(s) covering ${totalMissing} missing day(s):`);
  for (const gap of gaps) log.warn(`  ${gap.from}..${gap.to} (${gap.days} day(s))`);

  if (!refill) {
    log.warn('re-run with --refill to fetch the missing days');
    await setGithubOutput({ gaps: String(gaps.length), result: 'verify' });
    return EXIT_GAPS;
  }

  const targets = gaps.slice(0, maxGaps);
  if (targets.length < gaps.length) {
    log.warn(`refilling the first ${targets.length} of ${gaps.length} gap(s); re-run for the rest`);
  }

  let blocked = false;
  for (const gap of targets) {
    log.info(`refilling ${gap.from}..${gap.to}`);
    // Anchor on the day after the gap so the window reaches back across it even
    // when the first id inside the gap is the one that failed.
    const status = await commandBackfill(
      { ...options, from: gap.from, to: gap.before, refill: false },
      log,
    );
    if (status === EXIT_BLOCKED) {
      blocked = true;
      log.error('blocked while refilling; stopping. Re-run once the block lapses.');
      break;
    }
  }

  const after = findGaps((await listReportDates(dataDir)).sort().filter((d) => d >= from && d <= to));
  gaps = after;
  await setGithubOutput({ gaps: String(gaps.length), result: 'verify-refill' });

  if (blocked) return EXIT_BLOCKED;
  if (gaps.length > 0) {
    log.warn(`${gaps.length} gap(s) remain after refilling:`);
    for (const gap of gaps) log.warn(`  ${gap.from}..${gap.to} (${gap.days} day(s))`);
    return EXIT_GAPS;
  }
  log.info('all gaps closed');
  return EXIT_OK;
}

/** Marker written once the walk runs out of upstream data. */
const COMPLETE_MARKER = '.backfill-complete';

/**
 * The next chunk to fetch when walking the archive further back.
 * Exported for testing; contains no I/O.
 */
export function extendRange(earliest, days) {
  const to = addDays(earliest, -1);
  const from = addDays(to, -(Math.max(1, days) - 1));
  return { from, to };
}

/**
 * Walk the archive one chunk further back.
 *
 * Intended for a schedule rather than a person. CENAPRED rate-limited us after
 * roughly 170 requests in an hour, so the remaining history is fetched as a
 * slow drip: one chunk per day, at a volume indistinguishable from ordinary
 * traffic. Self-limiting: once the walk runs out of upstream reports it drops
 * a marker and every later run becomes a no-op.
 */
async function commandExtend(options, log) {
  const dataDir = path.resolve(options['data-dir'] ?? path.join(ROOT_DIR, 'data'));
  const days = num(options, 'days', 365);
  const markerPath = path.join(dataDir, COMPLETE_MARKER);

  try {
    const marker = JSON.parse(await fs.readFile(markerPath, 'utf8'));
    log.info(`archive already complete back to ${marker.earliest}; nothing to do`);
    await setGithubOutput({ exhausted: 'true', gained: '0', earliest: marker.earliest, changed: 'false' });
    return EXIT_OK;
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }

  const dates = await listReportDates(dataDir);
  if (dates.length === 0) {
    throw new UsageError('extend needs an existing archive; run `latest` first');
  }

  const earliest = [...dates].sort()[0];
  const { from, to } = extendRange(earliest, days);
  log.info(`archive starts at ${earliest}; extending back over ${from}..${to}`);

  const status = await commandBackfill({ ...options, from, to }, log);

  const after = [...(await listReportDates(dataDir))].sort()[0];
  const gained = diffDays(after, earliest);
  await setGithubOutput({ earliest: after, gained: String(gained) });

  if (gained > 0) {
    log.info(`extended by ${gained} day(s); archive now starts at ${after}`);
    return status;
  }

  if (status === EXIT_BLOCKED) {
    log.warn('blocked before anything earlier could be fetched; the next run will retry');
    return status;
  }

  // Nothing earlier exists. Record it so the schedule stops asking.
  log.info(`no reports earlier than ${after}; the archive is complete`);
  await fs.writeFile(
    markerPath,
    `${JSON.stringify({ earliest: after, completed_at: rfc3339() }, null, 2)}\n`,
    'utf8',
  );
  await setGithubOutput({ exhausted: 'true' });
  return EXIT_OK;
}

async function commandParse(options, positionals, log) {
  const file = positionals[0];
  if (!file) throw new UsageError('parse needs a path to a saved HTML file');
  const html = await fs.readFile(path.resolve(file), 'utf8');
  const parsed = parseReportPage(html, {
    sourceUrl: options['source-url'] ?? `file://${path.resolve(file)}`,
    ingestedAt: rfc3339(),
    expectedDate: options.date ?? null,
  });

  for (const warning of parsed.warnings) log.warn(warning);
  process.stdout.write(stringifyJson(parsed.report));
  log.info(
    `chart window ${parsed.windowEarliest}..${parsed.windowLatest} `
    + `covers ${parsed.coveredDates.length} days`,
  );
  return EXIT_OK;
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

async function main(argv) {
  const { options, positionals } = parseArgv(argv);
  const command = positionals.shift();

  const helpRequested = flag(options, 'help', false) || command === 'help';
  if (!command || helpRequested) {
    process.stdout.write(USAGE);
    return helpRequested ? EXIT_OK : EXIT_ERROR;
  }

  const log = createLogger({ quiet: flag(options, 'quiet', false) });

  switch (command) {
    case 'latest':
      return commandLatest(options, log);
    case 'backfill':
      return commandBackfill(options, log);
    case 'reindex':
      return commandReindex(options, log);
    case 'verify':
      return commandVerify(options, log);
    case 'extend':
      return commandExtend(options, log);
    case 'parse':
      return commandParse(options, positionals, log);
    default:
      log.error(`unknown command: ${command}`);
      process.stdout.write(USAGE);
      return EXIT_ERROR;
  }
}

const isMain = process.argv[1]
  && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  main(process.argv.slice(2))
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error) => {
      const log = createLogger();
      if (error instanceof UsageError) {
        log.error(error.message);
        process.stdout.write(USAGE);
        process.exitCode = EXIT_ERROR;
        return;
      }
      if (error instanceof ChallengeError) {
        log.error(error.message);
        log.error(
          'CENAPRED served a bot-protection challenge instead of a report. Nothing '
          + 'was written. Wait for the rate limit to lapse and retry; requesting '
          + 'again straight away only deepens it.',
        );
        process.exitCode = EXIT_BLOCKED;
        return;
      }
      if (error instanceof NotAReportError) {
        log.error(`${error.message} (source: ${error.context?.sourceUrl ?? 'unknown'})`);
        process.exitCode = EXIT_ERROR;
        return;
      }
      log.error(error?.stack ?? String(error));
      process.exitCode = EXIT_ERROR;
    });
}

export { main };
