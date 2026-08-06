import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';

import {
  buildIndex,
  findLatestFullReport,
  isPartial,
  mergeReport,
  orderKeys,
  readReport,
  reportPath,
  saveReport,
  stringifyJson,
  writeIfChanged,
  writeIndex,
  writeLatest,
} from '../lib/store.mjs';
import { buildReport, REPORT_KEY_ORDER } from '../lib/parser.mjs';

let dataDir;

before(async () => {
  dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'popo-store-'));
});

after(async () => {
  await fs.rm(dataDir, { recursive: true, force: true });
});

const full = (date, overrides = {}) => buildReport({
  schema_version: 1,
  date,
  exhalations: 10,
  volcanotectonic_events: 0,
  tremor_minutes_total: 0,
  explosions: 0,
  alert_level: 'YELLOW',
  alert_phase: 'AMARILLO FASE 2',
  summary_spanish: 'Se detectaron 10 exhalaciones.',
  ashfall_reports: [],
  image_urls: [],
  video_urls: [],
  source_url: 'https://example.invalid/',
  ingested_at: '2026-08-05T00:00:00Z',
  ...overrides,
});

const partial = (date, overrides = {}) => buildReport({
  schema_version: 1,
  date,
  exhalations: 5,
  volcanotectonic_events: 0,
  tremor_minutes_total: 0,
  explosions: 0,
  ashfall_reports: [],
  image_urls: [],
  video_urls: [],
  source_url: 'https://example.invalid/',
  ingested_at: '2026-08-05T00:00:00Z',
  partial: true,
  ...overrides,
});

describe('deterministic serialisation', () => {
  it('uses 2-space indent and a trailing newline', () => {
    const text = stringifyJson({ a: 1, b: [2] });
    assert.equal(text, '{\n  "a": 1,\n  "b": [\n    2\n  ]\n}\n');
  });

  it('emits keys in the schema order regardless of insertion order', () => {
    const scrambled = { ingested_at: 'z', date: '2026-08-05', schema_version: 1 };
    assert.deepEqual(
      Object.keys(orderKeys(scrambled, REPORT_KEY_ORDER)),
      ['schema_version', 'date', 'ingested_at'],
    );
  });

  it('produces byte-identical output for identical input', () => {
    assert.equal(stringifyJson(full('2026-08-05')), stringifyJson(full('2026-08-05')));
  });
});

describe('writeIfChanged', () => {
  it('creates, then reports unchanged, then updates', async () => {
    const file = path.join(dataDir, 'scratch', 'thing.json');
    assert.equal(await writeIfChanged(file, { a: 1, ingested_at: 'T1' }, { ignoreKeys: ['ingested_at'] }), 'created');
    assert.equal(await writeIfChanged(file, { a: 1, ingested_at: 'T1' }, { ignoreKeys: ['ingested_at'] }), 'unchanged');
    assert.equal(await writeIfChanged(file, { a: 2, ingested_at: 'T2' }, { ignoreKeys: ['ingested_at'] }), 'updated');
  });

  it('ignores a changed timestamp so a no-op run leaves a clean diff', async () => {
    const file = path.join(dataDir, 'scratch', 'stamped.json');
    await writeIfChanged(file, { a: 1, ingested_at: 'T1' }, { ignoreKeys: ['ingested_at'] });
    const before = await fs.readFile(file, 'utf8');
    const status = await writeIfChanged(file, { a: 1, ingested_at: 'T9' }, { ignoreKeys: ['ingested_at'] });
    assert.equal(status, 'unchanged');
    assert.equal(await fs.readFile(file, 'utf8'), before);
  });

  it('writes nothing when dryRun is set', async () => {
    const file = path.join(dataDir, 'scratch', 'dry.json');
    await writeIfChanged(file, { a: 1 }, { dryRun: true });
    await assert.rejects(fs.readFile(file, 'utf8'), { code: 'ENOENT' });
  });
});

describe('merge rules', () => {
  it('lets a full report replace a partial one', () => {
    const { report, action } = mergeReport(partial('2026-08-01'), full('2026-08-01'));
    assert.equal(action, 'write');
    assert.equal(isPartial(report), false);
    assert.equal(report.exhalations, 10);
  });

  it('never lets a partial downgrade a full report', () => {
    const { report, action } = mergeReport(full('2026-08-01'), partial('2026-08-01'));
    assert.equal(action, 'skip');
    assert.equal(report.exhalations, 10);
    assert.equal(isPartial(report), false);
  });

  it('merges two partials, preferring non-null incoming counters', () => {
    const existing = partial('2026-08-01', { exhalations: 5, tremor_minutes_total: null });
    const incoming = partial('2026-08-01', { exhalations: 7, tremor_minutes_total: 30 });
    const { report } = mergeReport(existing, incoming);
    assert.equal(report.exhalations, 7);
    assert.equal(report.tremor_minutes_total, 30);
    assert.equal(report.partial, true);
  });
});

describe('saveReport / index / latest', () => {
  it('writes reports under data/reports/<YYYY>/<date>.json', async () => {
    assert.equal(await saveReport(dataDir, full('2026-08-05')), 'created');
    assert.equal(await saveReport(dataDir, partial('2026-08-04')), 'created');
    assert.equal(await saveReport(dataDir, partial('2025-12-31')), 'created');

    const file = reportPath(dataDir, '2026-08-05');
    assert.ok(file.endsWith(path.join('reports', '2026', '2026-08-05.json')));
    assert.equal((await readReport(dataDir, '2026-08-05')).exhalations, 10);
  });

  it('is idempotent', async () => {
    assert.equal(await saveReport(dataDir, full('2026-08-05')), 'unchanged');
  });

  it('refuses to overwrite a full report with a partial', async () => {
    assert.equal(await saveReport(dataDir, partial('2026-08-05')), 'skipped');
    assert.equal((await readReport(dataDir, '2026-08-05')).exhalations, 10);
  });

  it('builds an index over every date on disk', async () => {
    const { index } = await writeIndex(dataDir);
    assert.equal(index.schema_version, 1);
    assert.equal(index.earliest, '2025-12-31');
    assert.equal(index.latest, '2026-08-05');
    assert.equal(index.count, 3);
    assert.deepEqual(index.dates, ['2025-12-31', '2026-08-04', '2026-08-05']);
  });

  it('points latest.json at the newest *full* report, never a partial', async () => {
    await saveReport(dataDir, partial('2026-08-06'));
    const latest = await findLatestFullReport(dataDir);
    assert.equal(latest.date, '2026-08-05');

    const written = await writeLatest(dataDir);
    assert.equal(written.report.date, '2026-08-05');
    const onDisk = JSON.parse(await fs.readFile(path.join(dataDir, 'latest.json'), 'utf8'));
    assert.equal(onDisk.date, '2026-08-05');
    assert.ok(!Object.hasOwn(onDisk, 'partial'));
  });

  it('sorts index dates and handles an empty feed', () => {
    const index = buildIndex(['2026-01-02', '2020-05-05'], 'T');
    assert.deepEqual(index.dates, ['2020-05-05', '2026-01-02']);
    assert.equal(buildIndex([], 'T').count, 0);
    assert.equal(buildIndex([], 'T').earliest, null);
  });
});
