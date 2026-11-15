/**
 * 词根分析：把所有搜索词拆成词，按词汇总表现。
 * 单个搜索词点击少、判断不了，但同一个词根（比如 "kids"、"免费"）在几十个搜索词里累计起来，
 * 往往能看出问题，适合加“否定词组”。只在词根至少出现在 3 个不同搜索词里时才判断。
 */
import { testUnit, type Target } from './analyze';
import { money } from './format';
import { benjaminiHochberg } from './stats';
import { coveredByProduct, indexProduct, looksLikeAsin, normalizeKey, tokenize } from './text';
import type { Evidence, PlatformId, RowResult } from './types';

export interface RootResult {
  token: string;
  termCount: number;
  examples: string[];
  clicks: number;
  spend: number;
  orders: number;
  sales: number;
  evidence: Evidence;
  /** 含这个词根、但本身单独判为确定亏损的搜索词数 */
  alreadyListed: number;
  /** 含这个词根的所有行（用于和 AI 判断对照） */
  memberKeys: string[];
  advice: string;
  cautious: boolean;
}

const CJK = /[㐀-鿿]/;

function usable(token: string): boolean {
  if (/^\d+$/.test(token)) return false;
  if (CJK.test(token)) return [...token].length >= 2;
  return token.length >= 3;
}

export function analyzeRoots(
  results: RowResult[],
  target: Target,
  opts: { platform: PlatformId; productText?: string; aov: number | null; symbol?: string; alpha?: number; fdr?: number; minTerms?: number },
): RootResult[] {
  const alpha = opts.alpha ?? 0.05;
  const sym = opts.symbol ?? '';
  const fdr = opts.fdr ?? 0.1;
  const minTerms = opts.minTerms ?? 3;
  if (!target.acos || !opts.aov) return [];
  const product = opts.productText?.trim() ? indexProduct(opts.productText) : null;

  interface Agg {
    terms: Map<string, { name: string; spend: number }>;
    clicks: number;
    spend: number;
    orders: number;
    sales: number;
    listed: number;
    keys: Set<string>;
  }
  const map = new Map<string, Agg>();
  for (const res of results) {
    const r = res.row;
    const term = r.term ?? r.name;
    if (!term || r.clicks === null || r.isKeyword || looksLikeAsin(term)) continue;
    const tokens = new Set(tokenize(term).filter(usable));
    for (const t of tokens) {
      if (product && coveredByProduct(t, product)) continue;
      const a = map.get(t) ?? { terms: new Map(), clicks: 0, spend: 0, orders: 0, sales: 0, listed: 0, keys: new Set<string>() };
      a.keys.add(r.key);
      const tk = normalizeKey(term);
      const prev = a.terms.get(tk);
      a.terms.set(tk, { name: term, spend: (prev?.spend ?? 0) + r.spend });
      a.clicks += r.clicks;
      a.spend += r.spend;
      a.orders += r.orders;
      a.sales += r.sales;
      if (res.tier === 'loss') a.listed++;
      map.set(t, a);
    }
  }

  const allowed = opts.aov * target.acos;
  const candidates = [...map.entries()]
    .filter(([, a]) => a.terms.size >= minTerms && a.clicks > 0)
    .map(([token, a]) => {
      const { evidence } = testUnit({ clicks: a.clicks, spend: a.spend, conversions: a.orders, allowed, alpha });
      return { token, a, evidence };
    });
  const q = benjaminiHochberg(candidates.map((c) => c.evidence.pLoss));
  const out: RootResult[] = [];
  candidates.forEach((c, i) => {
    c.evidence.qLoss = q[i] ?? null;
    const p = c.evidence.pLoss;
    if (p === null || p > alpha || (q[i] ?? 1) > fdr) return;
    const examples = [...c.a.terms.values()].sort((x, y) => y.spend - x.spend).slice(0, 4).map((x) => x.name);
    const cautious = c.a.orders > 0;
    const neg = opts.platform === 'amazon' ? '否定词组（negative phrase）' : '否定词';
    out.push({
      token: c.token,
      termCount: c.a.terms.size,
      examples,
      clicks: c.a.clicks,
      spend: Math.round(c.a.spend * 100) / 100,
      orders: c.a.orders,
      sales: Math.round(c.a.sales * 100) / 100,
      evidence: c.evidence,
      alreadyListed: c.a.listed,
      memberKeys: [...c.a.keys],
      cautious,
      advice: cautious
        ? `含“${c.token}”的 ${c.a.terms.size} 个搜索词合计花费 ${money(c.a.spend, sym)}、${c.a.orders} 单，整体没有达到参照线；因为也有成交，整体否定可能误伤，建议逐个查看，把明显不相关的单独否定`
        : `含“${c.token}”的 ${c.a.terms.size} 个搜索词合计花费 ${money(c.a.spend, sym)}、点击 ${c.a.clicks} 次都没有出单，可以考虑把“${c.token}”加为${neg}；如果它其实是你产品的用途或规格，整体否定可能会误伤`,
    });
  });
  return out.sort((x, y) => y.spend - x.spend);
}
