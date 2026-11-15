/**
 * 蒙特卡洛验证：用已知真相的模拟数据，检验统计承诺是否成立。
 * 1. 刚好保本的词，被判“亏损”的概率不超过 5%（检验的定义）
 * 2. “确定低效”这一档里，真正赚钱的词占比（误判率）平均不超过 10%
 */
import { describe, expect, it } from 'vitest';
import { analyzeRows, testUnit, type Target } from '../src/core/analyze';
import { computeTotals } from '../src/core/records';
import type { Dataset, Row } from '../src/core/types';
import { mulberry32 } from '../src/samples/generate';

function binomial(n: number, p: number, rng: () => number): number {
  let k = 0;
  for (let i = 0; i < n; i++) if (rng() < p) k++;
  return k;
}

describe('single-row test keeps its promise', () => {
  it('a row exactly at breakeven is called a loss at most ~5% of the time', () => {
    const rng = mulberry32(42);
    const allowed = 20;
    const cpc = 1;
    const p = cpc / allowed;
    let rejections = 0;
    const trials = 4000;
    for (let t = 0; t < trials; t++) {
      const n = 100;
      const k = binomial(n, p, rng);
      const { evidence } = testUnit({ clicks: n, spend: n * cpc, conversions: k, allowed, alpha: 0.05 });
      if ((evidence.pLoss ?? 1) <= 0.05) rejections++;
    }
    expect(rejections / trials).toBeLessThanOrEqual(0.06);
  });

  it('a clearly profitable row is almost never called a loss', () => {
    const rng = mulberry32(7);
    let rejections = 0;
    const trials = 4000;
    for (let t = 0; t < trials; t++) {
      const n = 60;
      const k = binomial(n, 0.075, rng); // 保本只要 5%
      const { evidence } = testUnit({ clicks: n, spend: n, conversions: k, allowed: 20, alpha: 0.05 });
      if ((evidence.pLoss ?? 1) <= 0.05) rejections++;
    }
    expect(rejections / trials).toBeLessThan(0.01);
  });

  it('a junk row is always caught once it has enough clicks', () => {
    for (const n of [59, 80, 200]) {
      const { evidence } = testUnit({ clicks: n, spend: n, conversions: 0, allowed: 20, alpha: 0.05 });
      expect(evidence.pLoss!).toBeLessThanOrEqual(0.05);
    }
  });
});

describe('batch analysis controls the false discovery rate', () => {
  it('confirmed losses are mostly real across many simulated accounts', () => {
    const target: Target = { acos: 0.4, cpe: null, source: 'breakeven', label: 'test', lines: [] };
    const price = 50; // 每单最多可花 20，点击单价 1 → 保本转化率 5%
    let confirmed = 0;
    let falseConfirmed = 0;
    let junkWithPower = 0;
    let junkCaught = 0;
    for (let seed = 1; seed <= 60; seed++) {
      const rng = mulberry32(seed * 7919);
      const rows: Row[] = [];
      const truth = new Map<string, boolean>();
      const veryLow = new Set<string>();
      for (let i = 0; i < 240; i++) {
        // 70% 赚钱的词（转化率 5.5%–15%），30% 垃圾词（转化率 0–2%）
        const profitable = rng() < 0.7;
        const cvr = profitable ? 0.055 + rng() * 0.095 : rng() * 0.02;
        const n = 5 + Math.floor(rng() * rng() * 300);
        const k = binomial(n, cvr, rng);
        const key = `t${i}`;
        truth.set(key, profitable);
        rows.push({ key, name: key, term: key, campaign: 'C', adGroup: 'G', targetings: [], impressions: null, clicks: n, spend: n, orders: k, sales: k * price, engagements: 0, ordersEstimated: false, sourceRows: [] });
        // 转化率 ≤1%、点击 ≥100 的垃圾词：和 5% 的保本线差距足够大，应该能被抓到
        if (!profitable && cvr <= 0.01 && n >= 100) {
          junkWithPower++;
          veryLow.add(key);
        }
      }
      const ds: Dataset = { presetId: 'sim', rows, totals: computeTotals(rows), issues: [], currency: 'USD', currencies: {}, period: null, rawRowCount: rows.length, excludedRows: [] };
      const { results } = analyzeRows(ds, target, { platform: 'amazon', kind: 'searchTerm', conversion: 'orders', symbol: '$', price });
      for (const r of results) {
        if (r.tier !== 'loss') continue;
        confirmed++;
        if (truth.get(r.row.key)) falseConfirmed++;
        else if (veryLow.has(r.row.key)) junkCaught++;
      }
    }
    const fdr = falseConfirmed / Math.max(1, confirmed);
    expect(confirmed).toBeGreaterThan(500);
    expect(fdr).toBeLessThanOrEqual(0.1);
    expect(junkWithPower).toBeGreaterThan(100);
    expect(junkCaught / junkWithPower).toBeGreaterThan(0.85);
  });
});
