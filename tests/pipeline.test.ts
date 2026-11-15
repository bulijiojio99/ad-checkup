import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { amazonBreakeven, domesticBreakeven } from '../src/core/economics';
import { actionsCsv, csvCell, negativesCsv, aiPrompt } from '../src/core/export';
import { detectForPlatform, prepareDataset, readTable, runDiagnosis } from '../src/core/pipeline';
import type { Report, TargetInput } from '../src/core/report';
import { normalizeKey } from '../src/core/text';
import type { Cell, PlatformId, RowResult } from '../src/core/types';
import { SAMPLES, rowsToCsv, type Sample } from '../src/samples/generate';

const TODAY = new Date('2026-11-15T00:00:00Z');

function targetOf(s: Sample): TargetInput {
  if (s.amazonCosts) return { type: 'amazonCosts', costs: s.amazonCosts };
  if (s.domesticCosts) return { type: 'domesticCosts', costs: s.domesticCosts };
  return { type: 'auto' };
}

function runRows(platform: PlatformId, rows: Cell[][], s: Sample, presetId?: string) {
  const sheets = [{ name: 'x', rows, rowOffset: 0 }];
  const det = detectForPlatform(sheets, platform, presetId);
  if (!det) throw new Error('detection failed');
  const ds = prepareDataset(sheets, det, { price: s.amazonCosts?.price ?? s.domesticCosts?.price });
  const res = runDiagnosis({ platform, detection: det, dataset: ds, target: targetOf(s), productText: s.product, price: s.amazonCosts?.price ?? s.domesticCosts?.price, today: TODAY });
  if (!res.ok) throw new Error(res.error);
  return { det, ds, report: res.report };
}

function bySample(id: string) {
  const s = SAMPLES[id]!();
  return { s, ...runRows(s.platform, s.rows, s) };
}

function truthOf(s: Sample, r: RowResult) {
  return s.specs.find((sp) => normalizeKey(sp.name) === normalizeKey(r.row.term ?? r.row.name))?.truth;
}

function find(report: Report, name: string) {
  const r = report.results.find((x) => normalizeKey(x.row.name) === normalizeKey(name));
  if (!r) throw new Error(`row not found: ${name}`);
  return r;
}

describe('no profitable row is ever flagged as a confirmed loss', () => {
  it.each(Object.keys(SAMPLES))('%s', (id) => {
    const { s, report } = bySample(id);
    const falsePositives = report.results.filter((r) => r.tier === 'loss' && ['good', 'great'].includes(truthOf(s, r) ?? ''));
    expect(falsePositives.map((r) => r.row.name)).toEqual([]);
  });
});

describe('amazon search term report', () => {
  const { det, ds, report } = bySample('amazon-st');
  it('detects every column', () => {
    expect(det.preset.id).toBe('amazon-sp-search-term');
    expect(det.missing).toEqual([]);
    for (const f of ['term', 'campaign', 'adGroup', 'clicks', 'spend', 'orders', 'sales', 'date'] as const) {
      expect(det.mapping[f]).toBeDefined();
    }
  });
  it('aggregates daily rows and finds the period', () => {
    expect(ds.period).toEqual({ start: '2026-10-01', end: '2026-10-30', days: 30 });
    expect(ds.rows.length).toBeLessThan(ds.rawRowCount);
  });
  it('confirms junk terms with plenty of clicks', () => {
    for (const t of ['laptop backpack 17 inch', 'kids school backpack']) expect(find(report, t).tier).toBe('loss');
  });
  it('uses negative product targeting for ASIN search terms', () => {
    expect(find(report, 'b0c7xk2q9m').action.code).toBe('negateAsin');
  });
  it('keeps thin terms as insufficient instead of guessing', () => {
    expect(find(report, 'used hiking backpack').tier).toBe('insufficient');
  });
  it('finds wasteful roots and projects monthly savings', () => {
    expect(report.roots.map((r) => r.token)).toEqual(expect.arrayContaining(['laptop', 'kid']));
    expect(report.summary.monthlySaving).toBeCloseTo(report.summary.saving, 2);
    expect(report.summary.saving).toBeGreaterThan(0);
  });
  it('labels the target as breakeven ACoS', () => {
    expect(report.target.source).toBe('breakeven');
    expect(report.target.acos).toBeCloseTo((45.99 - 14 - 7.2 - 45.99 * 0.15) / 45.99, 10);
  });
});

describe('douyin search term report with title rows and a totals row', () => {
  const { det, ds, report } = bySample('douyin-st');
  it('finds the header below the title rows', () => {
    expect(det.headerRow).toBe(3);
    expect(det.preset.id).toBe('douyin-qianchuan-search-term');
  });
  it('excludes the totals row', () => {
    expect(ds.issues.some((i) => i.code === 'totalsExcluded')).toBe(true);
    const fileSpend = ds.rows.reduce((a, r) => a + r.spend, 0);
    expect(fileSpend).toBeCloseTo(ds.totals.spend, 1);
  });
  it('does not treat a men’s query as relevant to a women’s product', () => {
    const r = find(report, '防晒衣男');
    expect(r.relevance).toBe('partial');
    expect(r.tier).toBe('loss');
    expect(r.action.code).toBe('negate');
  });
});

describe('douyin unit report without clicks uses the spend-based test', () => {
  const { report } = bySample('douyin-unit');
  it('flags the low-ROI creatives and scales the best one', () => {
    expect(find(report, '素材E-明星同款话术').tier).toBe('loss');
    expect(find(report, '素材D-工厂直发低价').tier).toBe('loss');
    expect(find(report, '素材A-户外实测暴晒对比').tier).toBe('win');
    expect(find(report, '素材A-户外实测暴晒对比').evidence.method).toBe('poisson');
  });
});

describe('xiaohongshu engagement report', () => {
  const { det, report } = bySample('xhs-engagement');
  it('picks the engagement preset and compares with the account average', () => {
    expect(det.preset.id).toBe('xhs-unit-engagement');
    expect(report.target.source).toBe('accountAverage');
    expect(find(report, '我家猫最爱的猫爬架').tier).toBe('loss');
  });
});

describe('file round trips', () => {
  it('CSV text gives the same totals as the in-memory table', async () => {
    const s = SAMPLES['douyin-st']!();
    const direct = runRows(s.platform, s.rows, s);
    const sheets = await readTable(new TextEncoder().encode(rowsToCsv(s.rows)), s.fileName);
    const det = detectForPlatform(sheets, s.platform)!;
    const ds = prepareDataset(sheets, det);
    expect(ds.totals.spend).toBeCloseTo(direct.ds.totals.spend, 2);
    expect(ds.totals.orders).toBe(direct.ds.totals.orders);
  });
  it('XLSX workbook gives the same totals', async () => {
    const s = SAMPLES['amazon-st']!();
    const direct = runRows(s.platform, s.rows, s);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(s.rows), 'Sponsored Products');
    const bytes = new Uint8Array(XLSX.write(wb, { type: 'array', bookType: 'xlsx' }));
    const sheets = await readTable(bytes, 'report.xlsx');
    const det = detectForPlatform(sheets, 'amazon')!;
    const ds = prepareDataset(sheets, det);
    expect(ds.totals.spend).toBeCloseTo(direct.ds.totals.spend, 2);
    expect(ds.totals.clicks).toBe(direct.ds.totals.clicks);
  });
});

describe('data quality guards', () => {
  const base = [
    ['Campaign Name', 'Ad Group Name', 'Customer Search Term', 'Impressions', 'Clicks', 'Spend', '7 Day Total Orders (#)', '7 Day Total Sales', 'Currency'],
    ['C1', 'G1', 'red shoes', 1000, 50, 40, 5, 200, 'USD'],
    ['C1', 'G1', 'blue shoes', 800, 30, 25, 1, 40, 'USD'],
    ['C1', 'G2', 'green shoes', 900, 20, 15, 0, 0, 'USD'],
  ];
  it('removes an unlabeled totals row whose numbers equal the sum of the others', () => {
    const rows = [...base, ['', '', '', 2700, 100, 80, 6, 240, 'USD']];
    const sheets = [{ name: 'x', rows, rowOffset: 0 }];
    const det = detectForPlatform(sheets, 'amazon')!;
    const ds = prepareDataset(sheets, det);
    expect(ds.totals.spend).toBe(80);
    expect(ds.rows.length).toBe(3);
  });
  it('analyses one currency at a time and warns', () => {
    const rows = [...base, ['C9', 'G9', 'rote schuhe', 500, 10, 9, 0, 0, 'EUR']];
    const sheets = [{ name: 'x', rows, rowOffset: 0 }];
    const det = detectForPlatform(sheets, 'amazon')!;
    const ds = prepareDataset(sheets, det);
    expect(ds.currency).toBe('USD');
    expect(ds.issues.some((i) => i.code === 'multiCurrency')).toBe(true);
    expect(ds.rows.length).toBe(3);
  });
  it('refuses to guess orders without a price', () => {
    const rows = base.map((r) => [r[0], r[1], r[2], r[3], r[4], r[5], r[7]]);
    const sheets = [{ name: 'x', rows, rowOffset: 0 }];
    const det = detectForPlatform(sheets, 'amazon')!;
    expect(prepareDataset(sheets, det).issues.some((i) => i.code === 'needOrders')).toBe(true);
    const withPrice = prepareDataset(sheets, det, { price: 40 });
    expect(withPrice.rows[0]!.orders).toBe(5);
    expect(withPrice.rows[0]!.ordersEstimated).toBe(true);
  });
});

describe('breakeven formulas', () => {
  it('amazon', () => {
    const r = amazonBreakeven({ price: 30, productCost: 12, fbaFee: 6, referralPct: 15 });
    expect(r.ok && r.value.acos).toBeCloseTo(7.5 / 30, 12);
  });
  it('domestic with returns', () => {
    const r = domesticBreakeven({ price: 89, productCost: 28, shipping: 4, platformPct: 5, returnRatePct: 35 });
    const profit = 0.65 * (89 - 28 - 4 - 4.45) - 0.35 * 4;
    expect(r.ok && r.value.roi).toBeCloseTo(89 / profit, 10);
  });
  it('rejects a product that loses money before ads', () => {
    expect(amazonBreakeven({ price: 10, productCost: 8, fbaFee: 4, referralPct: 15 }).ok).toBe(false);
  });
});

describe('exports', () => {
  const { s, report } = bySample('amazon-st');
  it('writes CSV with BOM and neutralises formulas', () => {
    expect(actionsCsv(report).startsWith('﻿')).toBe(true);
    expect(csvCell('=HYPERLINK("http://x")')).toBe(`"'=HYPERLINK(""http://x"")"`);
    expect(csvCell(-12.5)).toBe('-12.5');
  });
  it('lists only negation actions in the negatives file', () => {
    const csv = negativesCsv(report);
    expect(csv).toContain('laptop backpack 17 inch');
    expect(csv).not.toContain('hiking backpack women');
  });
  it('builds an AI prompt containing only zero-order candidates', () => {
    const p = aiPrompt(report, s.product);
    expect(p).toContain('kids school backpack');
    expect(p).not.toContain('2. hiking backpack（');
  });
});
