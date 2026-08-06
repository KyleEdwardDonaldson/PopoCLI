/**
 * Real-Chromium fetching for cenapred.unam.mx.
 *
 * A genuine browser is mandatory: the site sits behind Radware Bot Manager, and
 * plain HTTP clients receive an HTTP 200 challenge page or a 302 to
 * validate.perfdrive.com.
 *
 * Three details here are load-bearing, each established by observing the live
 * site (see the notes on `open()` and `#settle()`):
 *
 *  1. `channel: 'chromium'` — Playwright's default for `headless: true` is
 *     `chromium-headless-shell`, a stripped-down binary that Radware challenges.
 *  2. Headed rendering — the headless shell and plain headless mode are detected;
 *     a headed real-Chromium window passes. CI runs this under `xvfb-run`.
 *  3. Wait in place, never reload — the challenge swaps the page's own content in
 *     after a few seconds. Re-navigating while it is pending escalates Radware
 *     from its silent JS challenge to an interactive CAPTCHA, which no amount of
 *     retrying will clear.
 */

import { chromium } from 'playwright';
import { ChallengeError, detectChallenge, isHardBlock } from './parser.mjs';
import {
  historicalFormFields,
  historicalSourceUrl,
  LATEST_URL,
  PROCESOS_URL,
} from './registro.mjs';

// `id_registro` mapping lives in registro.mjs so it is testable without a browser.
export {
  BASE_URL,
  historicalSourceUrl,
  ID_ANCHOR,
  idDrift,
  idForDate,
  LATEST_URL,
  PROCESOS_URL,
} from './registro.mjs';

/** Videos are never needed and are the only genuinely heavy asset on a report page. */
const DEFAULT_BLOCKED_RESOURCES = new Set(['media']);
const AGGRESSIVE_BLOCKED_RESOURCES = new Set(['media', 'image', 'font']);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class CenapredSession {
  #browser = null;

  #context = null;

  #page = null;

  #warmed = false;

  constructor(options = {}) {
    // Headed by default: headless Chromium is challenged, headed is not.
    this.headless = options.headless ?? false;
    this.timeoutMs = options.timeoutMs ?? 60_000;
    // How long to let a silent JS challenge resolve itself in place.
    this.challengeTimeoutMs = options.challengeTimeoutMs ?? 45_000;
    this.pollIntervalMs = options.pollIntervalMs ?? 1_500;
    this.loadAssets = options.loadAssets ?? false;
    this.blockAssets = options.blockAssets ?? false;
    this.log = options.log ?? (() => {});
  }

  static async launch(options = {}) {
    const session = new CenapredSession(options);
    await session.open();
    return session;
  }

  async open() {
    this.#browser = await chromium.launch({
      // Selects the real Chromium build rather than `chromium-headless-shell`.
      channel: 'chromium',
      headless: this.headless,
      args: [
        '--disable-blink-features=AutomationControlled',
        '--disable-dev-shm-usage',
      ],
    });
    await this.#createContext();
  }

  async #createContext() {
    const base = {
      locale: 'es-MX',
      timezoneId: 'America/Mexico_City',
      viewport: { width: 1366, height: 900 },
      extraHTTPHeaders: {
        'Accept-Language': 'es-MX,es;q=0.9,en;q=0.8',
        'Upgrade-Insecure-Requests': '1',
      },
    };

    // Playwright's headless UA advertises "HeadlessChrome", which is a loud bot
    // signal. Read the real UA once and strip the marker.
    let context = await this.#browser.newContext(base);
    let page = await context.newPage();
    const defaultUserAgent = await page.evaluate(() => navigator.userAgent);
    if (defaultUserAgent.includes('Headless')) {
      await context.close();
      context = await this.#browser.newContext({
        ...base,
        userAgent: defaultUserAgent.replace(/HeadlessChrome/g, 'Chrome').replace(/Headless/g, ''),
      });
      page = await context.newPage();
    }

    if (!this.loadAssets) {
      const blocked = this.blockAssets ? AGGRESSIVE_BLOCKED_RESOURCES : DEFAULT_BLOCKED_RESOURCES;
      await context.route('**/*', (route) => {
        if (blocked.has(route.request().resourceType())) route.abort();
        else route.continue();
      });
    }

    context.setDefaultNavigationTimeout(this.timeoutMs);
    context.setDefaultTimeout(this.timeoutMs);

    this.#context = context;
    this.#page = page;
    this.#warmed = false;
  }

  /**
   * Throw away all browser state. Used only as a last resort: the challenge
   * cookies earned by a successful pass are worth keeping.
   */
  async reset() {
    if (this.#context) {
      await this.#context.close().catch(() => {});
      this.#context = null;
      this.#page = null;
    }
    await this.#createContext();
  }

  async close() {
    await this.#context?.close().catch(() => {});
    await this.#browser?.close().catch(() => {});
    this.#context = null;
    this.#page = null;
    this.#browser = null;
  }

  get page() {
    if (!this.#page) throw new Error('session is not open');
    return this.#page;
  }

  /**
   * Wait for the current navigation to become a real page.
   *
   * Radware's silent challenge serves its own HTML first and then swaps the real
   * content in from JavaScript, so we poll the live DOM rather than reloading.
   */
  async #settle(response) {
    const page = this.page;
    const status = response?.status() ?? 0;

    const redirectChain = [];
    for (let r = response?.request()?.redirectedFrom(); r; r = r.redirectedFrom()) {
      redirectChain.push(r.url());
    }

    // Best-effort: gives the challenge script a chance to fire before we poll.
    try {
      await page.waitForLoadState('networkidle', { timeout: 10_000 });
    } catch {
      /* the challenge page long-polls, so networkidle often never arrives */
    }

    const deadline = Date.now() + this.challengeTimeoutMs;
    let verdict = { blocked: false, reason: null };
    let snapshot = null;
    let announced = false;

    for (;;) {
      snapshot = {
        html: await page.content(),
        title: await page.title(),
        url: page.url(),
      };
      verdict = detectChallenge({ ...snapshot, status, redirectChain });
      if (!verdict.blocked) return { ...snapshot, status };

      if (isHardBlock(snapshot.title)) {
        throw new ChallengeError(
          `interactive block: "${snapshot.title.trim()}" — this IP is rate limited; `
          + 'retrying now would only deepen it',
          { ...snapshot, status, hard: true },
        );
      }

      if (Date.now() >= deadline) break;

      if (!announced) {
        announced = true;
        this.log(`bot-protection challenge served; waiting in place for it to clear (${verdict.reason})`);
      }
      await page.waitForTimeout(this.pollIntervalMs);
    }

    throw new ChallengeError(
      `${verdict.reason} (still challenged after ${Math.round(this.challengeTimeoutMs / 1000)}s)`,
      { ...snapshot, status, hard: false },
    );
  }

  /** Ensure we have visited the site at least once, so cookies exist for POSTs. */
  async #warmUp() {
    if (this.#warmed) return;
    const response = await this.page.goto(LATEST_URL, { waitUntil: 'domcontentloaded' });
    await this.#settle(response);
    this.#warmed = true;
  }

  /** GET the "latest report" page. */
  async fetchLatest() {
    const response = await this.page.goto(LATEST_URL, { waitUntil: 'domcontentloaded' });
    const captured = await this.#settle(response);
    this.#warmed = true;
    return { ...captured, sourceUrl: LATEST_URL };
  }

  /**
   * POST the historical-report form for an opaque `id_registro`.
   *
   * Submitted as a real DOM form so the navigation carries the browser's cookies,
   * headers and challenge state exactly as a click would.
   */
  async fetchById(id, dateHint = '') {
    await this.#warmUp();
    const page = this.page;
    const fields = historicalFormFields(id, dateHint);

    const [response] = await Promise.all([
      page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: this.timeoutMs }),
      page.evaluate(({ action, values }) => {
        const form = document.createElement('form');
        form.method = 'POST';
        form.action = action;
        for (const [name, value] of Object.entries(values)) {
          const input = document.createElement('input');
          input.type = 'hidden';
          input.name = name;
          input.value = value;
          form.appendChild(input);
        }
        (document.body ?? document.documentElement).appendChild(form);
        form.submit();
      }, { action: PROCESOS_URL, values: fields }),
    ]);

    const captured = await this.#settle(response);
    return { ...captured, sourceUrl: historicalSourceUrl(id, dateHint) };
  }
}

/**
 * Run a fetch with backoff.
 *
 * A soft challenge is retried, with the session's cookies kept — they are what
 * eventually gets us through — and only the last attempt starts from a clean
 * browser. An interactive block (CAPTCHA / "Unauthorized Request Blocked") is
 * never retried: the IP is rate limited and hammering it makes things worse.
 */
export async function withChallengeRetry(
  session,
  fn,
  { attempts = 3, baseDelayMs = 10_000, log = () => {} } = {},
) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      if (error instanceof ChallengeError && error.context?.hard) {
        log('interactive block encountered; abandoning this run rather than escalating');
        break;
      }

      const retryable = error instanceof ChallengeError
        || /timeout|net::|Navigation|Target closed/i.test(error.message ?? '');
      if (!retryable || attempt === attempts) break;

      const delay = baseDelayMs * attempt;
      log(`attempt ${attempt}/${attempts} failed (${error.message}); retrying in ${Math.round(delay / 1000)}s`);
      await sleep(delay);

      // Keep cookies for early retries; only start clean as a last resort.
      if (attempt === attempts - 1) {
        log('starting from a clean browser profile for the final attempt');
        await session.reset();
      }
    }
  }
  throw lastError;
}

export { sleep };
