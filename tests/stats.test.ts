import { describe, expect, it } from 'vitest';
import {
  benjaminiHochberg,
  binomCdf,
  binomSf,
  clicksToDecide,
  logGamma,
  poissonCdf,
  poissonSf,
  shrinkRate,
} from '../src/core/stats';

function binomPmfDirect(i: number, n: number, p: number): number {
  let logC = 0;
  for (let j = 1; j <= i; j++) logC += Math.log(n - i + j) - Math.log(j);
  return Math.exp(logC + i * Math.log(p) + (n - i) * Math.log(1 - p));
}

function binomCdfDirect(k: number, n: number, p: number): number {
  let s = 0;
  for (let i = 0; i <= k; i++) s += binomPmfDirect(i, n, p);
  return s;
}

function poissonCdfDirect(k: number, mu: number): number {
  let s = 0;
  let term = Math.exp(-mu);
  for (let i = 0; i <= k; i++) {
    if (i > 0) term *= mu / i;
    s += term;
  }
  return s;
}

describe('logGamma', () => {
  it('matches factorials', () => {
    const fact = [1, 1, 2, 6, 24, 120, 720, 5040, 40320];
    fact.forEach((f, n) => expect(logGamma(n + 1)).toBeCloseTo(Math.log(f), 10));
    expect(logGamma(0.5)).toBeCloseTo(Math.log(Math.sqrt(Math.PI)), 10);
  });
});

describe('binomial tails', () => {
  const cases: [number, number, number][] = [
    [0, 10, 0.1], [0, 30, 0.1], [1, 30, 0.1], [3, 50, 0.08], [5, 20, 0.3], [10, 200, 0.07], [0, 1, 0.5], [7, 8, 0.9], [40, 400, 0.12],
  ];
  it.each(cases)('cdf(k=%i, n=%i, p=%f) equals direct summation', (k, n, p) => {
    expect(binomCdf(k, n, p)).toBeCloseTo(binomCdfDirect(k, n, p), 10);
  });
  it.each(cases)('sf(k=%i, n=%i, p=%f) = 1 - cdf(k-1)', (k, n, p) => {
    const expected = k === 0 ? 1 : 1 - binomCdfDirect(k - 1, n, p);
    expect(binomSf(k, n, p)).toBeCloseTo(expected, 10);
  });
  it('handles edge cases', () => {
    expect(binomCdf(-1, 10, 0.2)).toBe(0);
    expect(binomCdf(10, 10, 0.2)).toBe(1);
    expect(binomCdf(3, 10, 0)).toBe(1);
    expect(binomCdf(3, 10, 1)).toBe(0);
    expect(binomSf(0, 10, 0.5)).toBe(1);
    expect(binomSf(11, 10, 0.5)).toBe(0);
  });
  it('zero conversions probability equals (1-p)^n', () => {
    expect(binomCdf(0, 15, 0.1)).toBeCloseTo(0.9 ** 15, 12);
    expect(binomCdf(0, 29, 0.1)).toBeLessThan(0.05);
    expect(binomCdf(0, 28, 0.1)).toBeGreaterThan(0.05);
  });
  it('stays stable for large n', () => {
    const v = binomCdf(900, 10000, 0.1);
    expect(v).toBeGreaterThan(0);
    expect(v).toBeLessThan(0.001);
  });
});

describe('poisson tails', () => {
  const cases: [number, number][] = [[0, 0.5], [0, 3], [2, 3], [5, 10], [20, 12], [100, 120]];
  it.each(cases)('cdf(k=%i, mu=%f) equals direct summation', (k, mu) => {
    expect(poissonCdf(k, mu)).toBeCloseTo(poissonCdfDirect(k, mu), 10);
  });
  it.each(cases)('sf(k=%i, mu=%f) = 1 - cdf(k-1)', (k, mu) => {
    const expected = k === 0 ? 1 : 1 - poissonCdfDirect(k - 1, mu);
    expect(poissonSf(k, mu)).toBeCloseTo(expected, 10);
  });
});

describe('Benjamini–Hochberg', () => {
  it('matches the textbook example and keeps nulls', () => {
    const p = [0.01, 0.04, 0.03, 0.005, null, 0.5];
    const q = benjaminiHochberg(p);
    // 排序后 0.005,0.01,0.03,0.04,0.5，m=5
    expect(q[3]).toBeCloseTo(0.025, 10);
    expect(q[0]).toBeCloseTo(0.025, 10);
    expect(q[2]).toBeCloseTo(0.05, 10);
    expect(q[1]).toBeCloseTo(0.05, 10);
    expect(q[5]).toBeCloseTo(0.5, 10);
    expect(q[4]).toBeNull();
  });
});

describe('helpers', () => {
  it('clicksToDecide matches the formula', () => {
    expect(clicksToDecide(0.1)).toBe(29);
    expect(clicksToDecide(0.05)).toBe(59);
  });
  it('shrinkRate pulls small samples toward the prior', () => {
    expect(shrinkRate(1, 2, 0.1, 20)).toBeCloseTo(3 / 22, 10);
    expect(shrinkRate(100, 1000, 0.05, 20)).toBeCloseTo(101 / 1020, 10);
  });
});
