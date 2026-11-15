/**
 * 统计函数。全部是标准公式（Numerical Recipes / 经典统计教材），用单元测试对照直接求和的结果。
 *
 * - 二项分布尾概率：用正则化不完全 Beta 函数计算，n 很大时也稳定
 * - 泊松分布尾概率：用正则化不完全 Gamma 函数计算
 * - Benjamini–Hochberg：同时判断几百个词时，控制“误判为亏损”的比例
 */

const LANCZOS = [
  676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059, 12.507343278686905,
  -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
];

export function logGamma(x: number): number {
  if (x < 0.5) return Math.log(Math.PI / Math.abs(Math.sin(Math.PI * x))) - logGamma(1 - x);
  x -= 1;
  let a = 0.99999999999980993;
  const t = x + 7.5;
  for (let i = 0; i < LANCZOS.length; i++) a += LANCZOS[i]! / (x + i + 1);
  return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
}

const EPS = 1e-15;
const FPMIN = 1e-300;

/** 不完全 Beta 函数的连分式（Lentz 方法） */
function betacf(a: number, b: number, x: number): number {
  const qab = a + b;
  const qap = a + 1;
  const qam = a - 1;
  let c = 1;
  let d = 1 - (qab * x) / qap;
  if (Math.abs(d) < FPMIN) d = FPMIN;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= 10000; m++) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    h *= d * c;
    aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < EPS) break;
  }
  return h;
}

/** 正则化不完全 Beta 函数 I_x(a, b) */
export function betaInc(a: number, b: number, x: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const lbt = logGamma(a + b) - logGamma(a) - logGamma(b) + a * Math.log(x) + b * Math.log(1 - x);
  const bt = Math.exp(lbt);
  if (x < (a + 1) / (a + b + 2)) return (bt * betacf(a, b, x)) / a;
  return 1 - (bt * betacf(b, a, 1 - x)) / b;
}

/** P(X ≤ k)，X ~ Binomial(n, p) */
export function binomCdf(k: number, n: number, p: number): number {
  if (k < 0) return 0;
  if (k >= n) return 1;
  if (p <= 0) return 1;
  if (p >= 1) return 0;
  return clamp01(betaInc(n - k, k + 1, 1 - p));
}

/** P(X ≥ k)，X ~ Binomial(n, p) */
export function binomSf(k: number, n: number, p: number): number {
  if (k <= 0) return 1;
  if (k > n) return 0;
  if (p <= 0) return 0;
  if (p >= 1) return 1;
  return clamp01(betaInc(k, n - k + 1, p));
}

/** 正则化下不完全 Gamma 函数 P(a, x) */
export function gammaP(a: number, x: number): number {
  if (x <= 0) return 0;
  if (x < a + 1) {
    let sum = 1 / a;
    let del = sum;
    let ap = a;
    for (let n = 1; n <= 10000; n++) {
      ap += 1;
      del *= x / ap;
      sum += del;
      if (Math.abs(del) < Math.abs(sum) * EPS) break;
    }
    return clamp01(sum * Math.exp(-x + a * Math.log(x) - logGamma(a)));
  }
  return clamp01(1 - gammaQcf(a, x));
}

function gammaQcf(a: number, x: number): number {
  let b = x + 1 - a;
  let c = 1 / FPMIN;
  let d = 1 / b;
  let h = d;
  for (let i = 1; i <= 10000; i++) {
    const an = -i * (i - a);
    b += 2;
    d = an * d + b;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = b + an / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < EPS) break;
  }
  return Math.exp(-x + a * Math.log(x) - logGamma(a)) * h;
}

/** P(K ≤ k)，K ~ Poisson(mu) */
export function poissonCdf(k: number, mu: number): number {
  if (k < 0) return 0;
  if (mu <= 0) return 1;
  return clamp01(1 - gammaP(k + 1, mu));
}

/** P(K ≥ k)，K ~ Poisson(mu) */
export function poissonSf(k: number, mu: number): number {
  if (k <= 0) return 1;
  if (mu <= 0) return 0;
  return gammaP(k, mu);
}

/**
 * Benjamini–Hochberg 校正，返回每个 p 值对应的 q 值（输入里的 null 原样返回）。
 * q ≤ 0.1 的那批结论里，误判的比例期望不超过 10%。
 */
export function benjaminiHochberg(pValues: (number | null)[]): (number | null)[] {
  const idx = pValues
    .map((p, i) => ({ p, i }))
    .filter((x): x is { p: number; i: number } => x.p !== null && Number.isFinite(x.p))
    .sort((a, b) => a.p - b.p);
  const m = idx.length;
  const q: (number | null)[] = pValues.map(() => null);
  let running = 1;
  for (let rank = m; rank >= 1; rank--) {
    const { p, i } = idx[rank - 1]!;
    running = Math.min(running, (p * m) / rank);
    q[i] = clamp01(running);
  }
  return q;
}

/** 二项：要多少次点击、全部 0 转化，才能在 alpha 水平下判断“转化率达不到 p” */
export function clicksToDecide(p: number, alpha = 0.05): number {
  if (p <= 0) return Infinity;
  if (p >= 1) return 1;
  return Math.ceil(Math.log(alpha) / Math.log(1 - p));
}

/** 贝叶斯收缩：样本少的词向所在组的平均转化率靠拢，避免被一两单带偏 */
export function shrinkRate(conversions: number, trials: number, priorRate: number, priorStrength: number): number {
  const a = priorRate * priorStrength;
  const b = (1 - priorRate) * priorStrength;
  return (conversions + a) / (trials + a + b);
}

export function clamp01(x: number): number {
  if (Number.isNaN(x)) return x;
  return x < 0 ? 0 : x > 1 ? 1 : x;
}
