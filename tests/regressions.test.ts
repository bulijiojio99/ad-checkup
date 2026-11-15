/**
 * 独立代码审查发现的问题的回归测试。每个用例都对应一个会让卖家得到错误结论的真实场景。
 */
import { describe, expect, it } from 'vitest';
import { analyzeRows, type Target } from '../src/core/analyze';
import { negativesCsv } from '../src/core/export';
import { parseDate } from '../src/core/numbers';
import { detectForPlatform, prepareDataset, runDiagnosis } from '../src/core/pipeline';
import { computeTotals } from '../src/core/records';
import type { TargetInput } from '../src/core/report';
import type { Cell, Dataset, PlatformId, Row } from '../src/core/types';
import { mulberry32 } from '../src/samples/generate';

const TODAY = new Date('2026-12-15T00:00:00Z');

function run(platform: PlatformId, rows: Cell[][], target: TargetInput, opts: { product?: string; price?: number } = {}) {
  const sheets = [{ name: 'x', rows, rowOffset: 0 }];
  const det = detectForPlatform(sheets, platform);
  if (!det) throw new Error('detection failed');
  const ds = prepareDataset(sheets, det, { price: opts.price, today: TODAY });
  const res = runDiagnosis({ platform, detection: det, dataset: ds, target, productText: opts.product, price: opts.price, today: TODAY });
  if (!res.ok) throw new Error(res.error);
  return { det, ds, report: res.report };
}

const find = (report: { results: { row: Row; tier: string; action: { code: string; text: string } }[] }, name: string) => {
  const r = report.results.find((x) => x.row.name === name);
  if (!r) throw new Error(`missing ${name}`);
  return r;
};

const AMZ_HEADER = ['Campaign Name', 'Ad Group Name', 'Customer Search Term', 'Clicks', 'Spend', '7 Day Total Orders (#)', '7 Day Total Sales'];

describe('H1 net-GMV columns do not loosen the breakeven line', () => {
  it('a plan losing ¥9 per order stays a loss when the column is 净成交金额', () => {
    const costs = { price: 89, productCost: 28, shipping: 4, platformPct: 5, returnRatePct: 35 };
    const rows: Cell[][] = [
      ['计划名称', '整体消耗', '整体成交订单数', '净成交金额'],
      ['计划A', 8400, 200, 16910],
      ['计划B', 3000, 100, 8900],
      ['计划C', 2000, 70, 6230],
    ];
    const { report } = run('douyin', rows, { type: 'domesticCosts', costs });
    expect(report.target.label).toContain('2.72');
    expect(find(report, '计划A').tier).toBe('loss');
  });
});

describe('H2 the loss test respects the row’s own order value and sample size', () => {
  const accessories: Cell[][] = Array.from({ length: 12 }, (_, i) => ['Acc', 'Acc', `accessory ${i}`, 40, 40, 1, 40]);
  it('a premium term already under target ACoS is never a loss', () => {
    const rows: Cell[][] = [AMZ_HEADER, ...accessories, ['Premium', 'Premium', 'premium leather backpack', 120, 120, 2, 500]];
    const { report } = run('amazon', rows, { type: 'acos', value: 0.3 });
    const r = find(report, 'premium leather backpack');
    expect(r.tier).not.toBe('loss');
    expect(r.tier).not.toBe('suspect');
  });
  it('one expensive click with no order is not enough to condemn a term', () => {
    const rows: Cell[][] = [
      AMZ_HEADER,
      ...accessories,
      ['Premium', 'Premium', 'premium backpack', 30, 60, 4, 1000],
      ['Premium', 'Premium', 'italian leather backpack', 1, 14, 0, 0],
      ['Acc', 'Acc', 'expensive click', 1, 30, 0, 0],
    ];
    const { report } = run('amazon', rows, { type: 'acos', value: 0.3 });
    expect(find(report, 'italian leather backpack').tier).toBe('insufficient');
    expect(find(report, 'expensive click').tier).toBe('insufficient');
    expect(report.summary.saving).toBe(0);
  });
});

describe('M3 totals rows', () => {
  it('keeps search terms that merely start with “total” or “sum”', () => {
    const rows: Cell[][] = [
      AMZ_HEADER,
      ['C', 'G', 'total gym accessories', 150, 180, 0, 0],
      ['C', 'G', 'sum 41 shirt', 30, 30, 1, 40],
      ['C', 'G', 'total-body resistance bands', 40, 30, 2, 80],
      ['C', 'G', 'resistance bands', 200, 250, 20, 800],
    ];
    const { ds } = run('amazon', rows, { type: 'acos', value: 0.3 });
    expect(ds.rows.map((r) => r.name)).toEqual(expect.arrayContaining(['total gym accessories', 'sum 41 shirt', 'total-body resistance bands']));
    expect(ds.totals.spend).toBe(490);
  });
  it('drops a “合计” row whose other cells are placeholders, even if sums do not match', () => {
    const rows: Cell[][] = [
      ['日期', '搜索词', '计划名称', '点击次数', '消耗', '成交订单数', '成交金额'],
      ['2026-11-01', '防晒衣女', '计划1', 1000, 1900, 76, 6764],
      ['2026-11-01', '冰丝防晒衣', '计划1', 900, 1900, 60, 5340],
      ['合计', '-', '-', 1900, 3800, 135, 12104],
    ];
    const { ds } = run('douyin', rows, { type: 'roi', value: 2.5 });
    expect(ds.totals.spend).toBe(3800);
    expect(ds.rows.length).toBe(2);
    expect(ds.issues.some((i) => i.code === 'totalsExcluded')).toBe(true);
  });
});

describe('M4 keyword-only reports', () => {
  it('pauses a zero-order keyword instead of “negating” it', () => {
    const rows: Cell[][] = [
      ['关键词', '计划名称', '点击次数', '消耗', '成交订单数', '成交金额'],
      ['防晒衣', '计划1', 400, 800, 0, 0],
      ['冰丝防晒衣', '计划1', 600, 900, 40, 3560],
      ['防晒衣女', '计划1', 500, 800, 30, 2670],
    ];
    const { report } = run('douyin', rows, { type: 'roi', value: 2.5 });
    const r = find(report, '防晒衣');
    expect(r.tier).toBe('loss');
    expect(r.action.code).toBe('pauseKeyword');
    expect(negativesCsv(report)).not.toContain('防晒衣,');
  });
});

describe('M5 clustered engagements are not over-flagged', () => {
  function simulate(seed: number, sizes: number[]) {
    const rng = mulberry32(seed);
    const rows: Row[] = [];
    for (let i = 0; i < 30; i++) {
      const clicks = 200 + Math.floor(rng() * 1800);
      let eng = 0;
      let spend = 0;
      for (let c = 0; c < clicks; c++) {
        spend += 0.6 * (0.8 + rng() * 0.4);
        if (rng() < 0.3) eng += sizes[Math.floor(rng() * sizes.length)]!;
      }
      rows.push({ key: `n${i}`, name: `n${i}`, campaign: 'P', targetings: [], impressions: null, clicks, spend, orders: 0, sales: 0, engagements: eng, ordersEstimated: false, sourceRows: [] });
    }
    return rows;
  }
  it.each([
    ['realistic (mostly 1–2 actions)', [1, 1, 1, 1, 1, 1, 2, 2, 2, 3]],
    ['extreme (1–6 actions, uniform)', [1, 2, 3, 4, 5, 6]],
  ])('%s', (_label, sizes) => {
    let flagged = 0;
    let total = 0;
    for (let seed = 1; seed <= 50; seed++) {
      const rows = simulate(seed * 31, sizes);
      const totals = computeTotals(rows);
      const target: Target = { acos: null, cpe: totals.spend / totals.engagements, source: 'accountAverage', label: '', lines: [] };
      const ds: Dataset = { presetId: 'x', rows, totals, issues: [], currency: 'CNY', currencies: {}, period: null, rawRowCount: rows.length, excludedRows: [] };
      const { results } = analyzeRows(ds, target, { platform: 'xiaohongshu', kind: 'unit', conversion: 'engagements', symbol: '¥' });
      flagged += results.filter((r) => r.tier === 'loss').length;
      total += results.length;
    }
    // 所有笔记效率完全相同，被判“确定低效”的比例应该很低
    expect(flagged / total).toBeLessThanOrEqual(0.05);
  });
});

describe('M6 creatives are not merged into their plan', () => {
  it('uses the creative ID column as the unit when there is no creative name', () => {
    const rows: Cell[][] = [
      ['计划名称', '素材ID', '整体消耗', '整体成交订单数', '整体成交金额'],
      ['计划A', '1001', 3000, 0, 0],
      ['计划A', '1002', 4000, 150, 13350],
      ['计划B', '2001', 2500, 90, 8010],
    ];
    const { det, ds, report } = run('douyin', rows, { type: 'roi', value: 2.5 });
    expect(det.headers[det.mapping.unitName!]).toBe('素材ID');
    expect(ds.rows.length).toBe(3);
    expect(find(report, '1001').tier).toBe('loss');
  });
});

describe('M7 dates use one day/month order per column', () => {
  it('reads a UK file as 1–30 November', () => {
    const rows: Cell[][] = [['Date', ...AMZ_HEADER]];
    for (let d = 1; d <= 30; d++) rows.push([`${String(d).padStart(2, '0')}/11/2026`, 'C', 'G', `term ${d % 5}`, 10, 10, 1, 40]);
    const { ds } = run('amazon', rows, { type: 'acos', value: 0.3 });
    expect(ds.period).toEqual({ start: '2026-11-01', end: '2026-11-30', days: 30 });
  });
  it('drops an impossible period instead of projecting with it', () => {
    const rows: Cell[][] = [['Date', ...AMZ_HEADER], ['2027-06-01', 'C', 'G', 'a', 10, 10, 1, 40], ['2026-11-01', 'C', 'G', 'b', 10, 10, 1, 40]];
    const { ds } = run('amazon', rows, { type: 'acos', value: 0.3 });
    expect(ds.period).toBeNull();
    expect(ds.issues.some((i) => i.code === 'badPeriod')).toBe(true);
  });
});

describe('M8 European number formats', () => {
  it('reads "1.523" clicks as one thousand five hundred twenty-three', () => {
    const rows: Cell[][] = [
      ['Campaign Name', 'Ad Group Name', 'Customer Search Term', 'Impressions', 'Clicks', 'Spend', '7 Day Total Orders (#)', '7 Day Total Sales'],
      ['C', 'G', 'rucksack', '48.210', '1.523', '1.234,56', '61', '3.050,00'],
      ['C', 'G', 'wanderrucksack', '9.100', '310', '255,10', '12', '600,00'],
    ];
    const { ds } = run('amazon', rows, { type: 'acos', value: 0.3 });
    const r = ds.rows.find((x) => x.name === 'rucksack')!;
    expect(r.clicks).toBe(1523);
    expect(r.impressions).toBe(48210);
    expect(r.spend).toBeCloseTo(1234.56, 2);
  });
});

describe('low-severity fixes', () => {
  it('L9 keeps the calendar day of an Excel serial with a time part', () => {
    expect(parseDate(46296.75)).toBe('2026-10-01');
  });
  it('L10 never tells the seller to collect “0 more clicks”', () => {
    const rows: Cell[][] = [AMZ_HEADER];
    for (let i = 0; i < 40; i++) rows.push(['C', 'G', `good ${i}`, 100, 100, 10, 500]);
    rows.push(['C', 'G', 'junk', 75, 75, 0, 0]);
    const { report } = run('amazon', rows, { type: 'acos', value: 0.4 });
    const junk = find(report, 'junk');
    expect(junk.tier).toBe('suspect');
    expect(junk.action.text).not.toContain('约 0 次');
    expect(report.results.every((r) => !r.action.text.includes('约 0 次'))).toBe(true);
  });
  it('L11 a row with sales is estimated as at least one order', () => {
    const rows: Cell[][] = [
      ['Campaign Name', 'Ad Group Name', 'Customer Search Term', 'Clicks', 'Spend', '7 Day Total Sales'],
      ['C', 'G', 'cheap add-on', 30, 25, 22],
      ['C', 'G', 'main product', 300, 250, 2300],
    ];
    const sheets = [{ name: 'x', rows, rowOffset: 0 }];
    const det = detectForPlatform(sheets, 'amazon')!;
    const ds = prepareDataset(sheets, det, { price: 46, today: TODAY });
    expect(ds.rows.find((r) => r.name === 'cheap add-on')!.orders).toBe(1);
  });
});
