/**
 * 诊断引擎。核心思想：计算交给公式，结论必须有统计依据。
 *
 * 对每一行（搜索词或计划）先算出“每次转化最多可花多少广告费”（保本线或目标线），
 * 再问一个问题：如果它其实能达到这条线，观察到这么少的转化，概率有多大？
 *   - 有点击数据：二项检验，保本所需转化率 = 点击单价 ÷ 每单可花广告费
 *   - 没有点击数据（如部分计划报表）或按互动诊断：泊松检验，保本应有转化数 = 花费 ÷ 每次转化可花广告费
 * 同时判断几百行时用 Benjamini–Hochberg 控制误判比例，只有通过校正的才算“确定”。
 *
 * 防止误判的几道保险：
 *   1. 客单价用分层加权估计：这一行自己的订单 → 所在组 → 全账户，样本越少越靠近上一层，
 *      不会因为套用账户平均客单价而冤枉高客单价的词。
 *   2. 保本所需转化率高得不现实（超过同组平均的 3 倍、最高 50%）时，按这个合理上限检验，
 *      点击很少时不会仅凭“单次点击太贵”就判死刑。
 *   3. 按自己的实际成交已经达标的行，不会被判为低效；没有达标的行，不会被判为优秀。
 *   4. 互动会成串出现（同一个人点赞又收藏），泊松检验按离散度 4 做保守校正。
 */
import { writeAdvice, type RelevanceInfo } from './advice';
import { benjaminiHochberg, binomCdf, binomSf, clicksToDecide, poissonCdf, poissonSf, shrinkRate } from './stats';
import { money, pct, prob } from './format';
import { coveredByProduct, indexProduct, looksLikeAsin, normalizeKey, tokenize, type ProductIndex } from './text';
import type {
  ConversionKind,
  Dataset,
  Evidence,
  PlatformId,
  Relevance,
  ReportKind,
  Row,
  RowResult,
  Tier,
} from './types';

export type TargetSource = 'breakeven' | 'userAcos' | 'userRoi' | 'userCpe' | 'accountAverage';

export interface Target {
  /** 订单模式：保本或目标 ACoS（广告费 ÷ 成交金额） */
  acos: number | null;
  /** 互动模式：每次互动最多可花 */
  cpe: number | null;
  source: TargetSource;
  label: string;
  lines: string[];
}

export interface AnalyzeOptions {
  platform: PlatformId;
  kind: ReportKind;
  conversion: ConversionKind;
  symbol: string;
  productText?: string;
  /** 客单价，没有任何订单时用作 AOV 兜底 */
  price?: number | null;
  alpha?: number;
  suspectAlpha?: number;
  fdr?: number;
}

/** 客单价分层加权时，上一层相当于多少笔“虚拟订单” */
const AOV_PRIOR_ORDERS = 2;
/** 互动数的离散度：一个用户可能产生多个互动（点赞、收藏、评论、分享），按保守值校正 */
export const ENGAGEMENT_DISPERSION = 4;

export interface TestResult {
  evidence: Evidence;
  /** 保本所需转化率 ≥ 100%：点击单价已超过每单可花的广告费 */
  impossible: boolean;
}

/** 单行检验：返回证据（不含 q 值，q 值在批量校正后补上） */
export function testUnit(input: {
  clicks: number | null;
  spend: number;
  conversions: number;
  allowed: number | null;
  alpha: number;
  /** 二项检验的转化率上限：保本所需转化率高于它时按它检验 */
  rateCap?: number;
  /** 泊松检验的离散度（≥ 1） */
  dispersion?: number;
}): TestResult {
  const { clicks, spend, conversions: k, allowed, alpha } = input;
  const cap = input.rateCap ?? 0.5;
  const phi = Math.max(1, input.dispersion ?? 1);
  const base: Evidence = {
    method: 'none',
    allowedCostPerConversion: allowed,
    requiredRate: null,
    testedRate: null,
    expected: null,
    observed: k,
    pLoss: null,
    pWin: null,
    qLoss: null,
    qWin: null,
    needMoreClicks: null,
    needMoreSpend: null,
    costPerClick: clicks && clicks > 0 ? spend / clicks : null,
    dispersion: null,
    aov: null,
    aovSource: null,
    efficiency: null,
  };
  if (allowed === null || !(allowed > 0) || !(spend > 0)) return { evidence: base, impossible: false };

  if (clicks !== null && clicks > 0) {
    const p = spend / clicks / allowed;
    const tested = Math.min(p, cap);
    return {
      impossible: p >= 1,
      evidence: {
        ...base,
        method: 'binomial',
        requiredRate: p,
        testedRate: tested,
        expected: clicks * tested,
        pLoss: binomCdf(k, clicks, tested),
        pWin: p >= 1 ? null : binomSf(k, clicks, p),
        needMoreClicks: k === 0 ? Math.max(0, clicksToDecide(tested, alpha) - clicks) : null,
      },
    };
  }
  // 泊松：按离散度缩放（quasi-Poisson），phi = 1 时就是普通泊松检验
  const mu = spend / allowed;
  return {
    impossible: false,
    evidence: {
      ...base,
      method: 'poisson',
      expected: mu,
      dispersion: phi,
      pLoss: poissonCdf(k / phi, mu / phi),
      pWin: poissonSf(k / phi, mu / phi),
      needMoreSpend: k === 0 ? Math.max(0, -Math.log(alpha) * phi * allowed - spend) : null,
    },
  };
}

interface GroupStat {
  clicks: number;
  conv: number;
  orders: number;
  sales: number;
}

function addStat(map: Map<string, GroupStat>, key: string, r: Row, conv: number) {
  const g = map.get(key) ?? { clicks: 0, conv: 0, orders: 0, sales: 0 };
  g.clicks += r.clicks ?? 0;
  g.conv += conv;
  g.orders += r.orders;
  g.sales += r.sales;
  map.set(key, g);
}

/**
 * 相关性粗判：搜索词里的每个词都出现在产品描述里才算“相关”。
 * 只要多出一个产品描述里没有的词（如“男”“儿童”“65l”），就算“部分相关”，
 * 因为这类修饰词往往正是不相关的原因。这只是辅助，最终由卖家或 AI 判断。
 */
function relevanceOf(term: string, product: ProductIndex | null): RelevanceInfo | null {
  if (!product) return null;
  const tokens = [...new Set(tokenize(term))];
  if (tokens.length === 0) return null;
  const missing = tokens.filter((t) => !coveredByProduct(t, product));
  const level: Relevance = missing.length === 0 ? 'related' : missing.length === tokens.length ? 'unrelated' : 'partial';
  return { level, missing: missing.slice(0, 3) };
}

function goalWord(source: TargetSource): string {
  if (source === 'breakeven') return '不亏';
  if (source === 'accountAverage') return '达到账户平均水平';
  return '达到目标';
}

export function negateText(platform: PlatformId): string {
  if (platform === 'amazon') return '加为否定精准（negative exact）';
  if (platform === 'douyin') return '加为否定词';
  return '加为否定关键词';
}

/** “概率只有 3.2%” / “概率不到 0.1%” */
function probPhrase(p: number | null): string {
  if (p === null) return '无法计算';
  return p < 0.001 ? '不到 0.1%' : `只有 ${prob(p)}`;
}

function groupKey(r: Row): string {
  return `${normalizeKey(r.campaign)}␟${normalizeKey(r.adGroup)}`;
}

export interface AnalyzeResult {
  results: RowResult[];
  baseline: { cvr: number | null; aov: number | null; cpc: number | null };
}

export function analyzeRows(ds: Dataset, target: Target, opts: AnalyzeOptions): AnalyzeResult {
  const alpha = opts.alpha ?? 0.05;
  const suspectAlpha = opts.suspectAlpha ?? 0.2;
  const fdr = opts.fdr ?? 0.1;
  const mode = opts.conversion;
  const conv = (r: Row) => (mode === 'orders' ? r.orders : r.engagements);
  const sym = opts.symbol;

  const acc: GroupStat = { clicks: 0, conv: 0, orders: 0, sales: 0 };
  const groups = new Map<string, GroupStat>();
  let accSpend = 0;
  let accClicksKnown = 0;
  for (const r of ds.rows) {
    acc.clicks += r.clicks ?? 0;
    acc.conv += conv(r);
    acc.orders += r.orders;
    acc.sales += r.sales;
    accSpend += r.spend;
    if (r.clicks !== null) accClicksKnown += r.clicks;
    addStat(groups, groupKey(r), r, conv(r));
  }
  const accCvr = accClicksKnown > 0 && acc.conv > 0 ? acc.conv / accClicksKnown : null;
  const accAov = acc.orders > 0 && acc.sales > 0 ? acc.sales / acc.orders : opts.price && opts.price > 0 ? opts.price : null;
  const accCpc = accClicksKnown > 0 ? accSpend / accClicksKnown : null;
  const groupAov = (g: GroupStat): number | null =>
    accAov !== null ? (g.sales + AOV_PRIOR_ORDERS * accAov) / (g.orders + AOV_PRIOR_ORDERS) : g.orders > 0 ? g.sales / g.orders : null;

  const productIndex = opts.productText?.trim() ? indexProduct(opts.productText) : null;
  const targetEff = mode === 'orders' ? target.acos : target.cpe;

  // —— 第一遍：逐行检验 ——
  const draft = ds.rows.map((r) => {
    const k = conv(r);
    const g = groups.get(groupKey(r))!;
    let aov: number | null = null;
    let aovSource: Evidence['aovSource'] = null;
    if (mode === 'orders') {
      const prior = groupAov(g);
      aov = prior !== null ? (r.sales + AOV_PRIOR_ORDERS * prior) / (r.orders + AOV_PRIOR_ORDERS) : r.orders > 0 ? r.sales / r.orders : null;
      aovSource = r.orders >= 3 ? 'row' : g.orders >= 3 ? 'group' : acc.orders > 0 ? 'account' : 'price';
      if (aov !== null && !(aov > 0 && Number.isFinite(aov))) aov = null;
    }
    const allowed = mode === 'orders' ? (aov !== null && target.acos ? aov * target.acos : null) : target.cpe;
    const baseCvr = g.clicks >= 30 && g.conv > 0 ? g.conv / g.clicks : accCvr;
    const rateCap = baseCvr ? Math.min(0.5, Math.max(0.05, baseCvr * 3)) : 0.5;
    const t = testUnit({
      // 互动数可能大于点击数，不满足二项分布前提，改用按花费的泊松检验
      clicks: mode === 'engagements' ? null : r.clicks,
      spend: r.spend,
      conversions: k,
      allowed,
      alpha,
      rateCap,
      dispersion: mode === 'engagements' ? ENGAGEMENT_DISPERSION : 1,
    });
    const e = t.evidence;
    // 出现负数（退款冲减等）时统计前提不成立，不做判断，避免得出错误的“概率很低”
    if (k < 0 || r.spend < 0 || r.sales < 0 || (r.clicks ?? 0) < 0) {
      e.method = 'none';
      e.pLoss = null;
      e.pWin = null;
    }
    e.aov = aov;
    e.aovSource = aov !== null ? aovSource : null;
    e.efficiency = mode === 'orders' ? (r.sales > 0 ? r.spend / r.sales : null) : k > 0 ? r.spend / k : null;
    // 这一行“最好的情况”（0 转化）能达到的最小 p 值，用于下面的离散校正
    const minP =
      e.method === 'none'
        ? null
        : e.method === 'binomial'
        ? (1 - (e.testedRate ?? 0)) ** (r.clicks ?? 0)
        : e.method === 'poisson'
          ? Math.exp(-(e.expected ?? 0) / (e.dispersion ?? 1))
          : null;
    return { row: r, k, minP, ...t };
  });

  // —— 批量校正 ——
  // 离散数据的改进（Tarone / Gilbert 2005）：一行就算 0 转化也达不到显著（样本太少），
  // 它不可能被判为“确定”，不计入校正的总数。这个筛选只看样本量、不看结果。
  const qLoss = benjaminiHochberg(draft.map((d) => (d.minP !== null && d.minP <= alpha ? d.evidence.pLoss : null)));
  const qWin = benjaminiHochberg(draft.map((d) => (d.k >= 2 ? d.evidence.pWin : null)));
  draft.forEach((d, i) => {
    d.evidence.qLoss = qLoss[i] ?? null;
    d.evidence.qWin = qWin[i] ?? null;
  });

  const goal = goalWord(target.source);
  const results: RowResult[] = draft.map((d) => {
    const { row: r, k, evidence: e, impossible } = d;
    let tier: Tier;
    if (e.method === 'none' || e.pLoss === null) tier = 'untested';
    else if (e.pLoss <= alpha && (e.qLoss ?? 1) <= fdr) tier = 'loss';
    else if (k >= 2 && e.pWin !== null && e.pWin <= alpha && (e.qWin ?? 1) <= fdr) tier = 'win';
    else if (e.pLoss <= suspectAlpha) tier = 'suspect';
    else if (k === 0) tier = 'insufficient';
    // 有转化但低于参照线、又还不显著：不能说“正常”，归为待观察
    else if (e.expected !== null && k < e.expected) tier = 'insufficient';
    else tier = 'ok';

    // 按自己的实际成交来看：已经达标的不判低效，没达标的不判优秀
    const actualEff = mode === 'orders' ? (r.sales > 0 ? r.spend / r.sales : Infinity) : k > 0 ? r.spend / k : Infinity;
    if (targetEff && k > 0 && actualEff <= targetEff && (tier === 'loss' || tier === 'suspect' || tier === 'insufficient')) tier = 'ok';
    if (targetEff && tier === 'win' && !(actualEff < targetEff)) tier = 'ok';

    const flags: string[] = [];
    const term = r.term ?? r.name;
    const isTerm = opts.kind === 'searchTerm';
    const isAsin = isTerm && !r.isKeyword && opts.platform === 'amazon' && looksLikeAsin(term);
    const exactConflict =
      isTerm && !r.isKeyword && r.targetings.some((t) => t.matchType === 'exact' && normalizeKey(t.text) === normalizeKey(term));
    if (isAsin) flags.push('asin');
    if (exactConflict) flags.push('exactConflict');
    if (r.isKeyword) flags.push('keyword');
    if (r.ordersEstimated) flags.push('ordersEstimated');
    if (tier === 'win' && (r.clicks ?? Infinity) < 20) flags.push('smallSample');
    const relevanceInfo = isTerm && !isAsin ? relevanceOf(term, productIndex) : null;
    const relevance = relevanceInfo?.level ?? null;

    // 建议出价：样本少的词向组平均转化率收缩后，算“刚好达到目标”的点击单价
    let suggestedBid: number | undefined;
    if (mode === 'orders' && r.clicks && r.clicks > 0 && e.allowedCostPerConversion) {
      const g = groups.get(groupKey(r))!;
      const prior = g.clicks >= 30 && g.conv > 0 ? g.conv / g.clicks : accCvr;
      if (prior && prior > 0) {
        const strength = Math.min(500, Math.max(10, 2 / prior));
        const rate = shrinkRate(k, r.clicks, prior, strength);
        suggestedBid = Math.round(e.allowedCostPerConversion * rate * 100) / 100;
      }
    }

    const action = writeAdvice({
      platform: opts.platform,
      kind: opts.kind,
      conversion: mode,
      tier,
      k,
      row: r,
      evidence: e,
      target,
      relevance: relevanceInfo,
      isAsin,
      exactConflict,
      suggestedBid,
      sym,
    });

    let saving = 0;
    if (tier === 'loss') {
      if (k === 0) saving = r.spend;
      else if (mode === 'orders' && target.acos) saving = Math.max(0, r.spend - target.acos * r.sales);
      else if (e.allowedCostPerConversion) saving = Math.max(0, r.spend - e.allowedCostPerConversion * k);
    }

    return {
      row: r,
      tier,
      evidence: e,
      action,
      relevance,
      flags,
      saving: Math.round(saving * 100) / 100,
      explanation: explain({ tier, k, row: r, evidence: e, impossible, goal, sym, mode }),
    };
  });

  return { results, baseline: { cvr: accCvr, aov: accAov, cpc: accCpc } };
}

function explain(a: {
  tier: Tier;
  k: number;
  row: Row;
  evidence: Evidence;
  impossible: boolean;
  goal: string;
  sym: string;
  mode: ConversionKind;
}): string {
  const { tier, k, row: r, evidence: e, impossible, goal, sym, mode } = a;
  const unit = mode === 'orders' ? '单' : '次互动';
  const per = mode === 'orders' ? '每单' : '每次互动';
  if (e.method === 'none') return '缺少客单价或目标线，无法计算。';
  const allowed = money(e.allowedCostPerConversion, sym);

  if (e.method === 'binomial') {
    const n = r.clicks ?? 0;
    const capped = e.testedRate !== null && e.requiredRate !== null && e.testedRate < e.requiredRate;
    let head: string;
    if (impossible) {
      head = `点击单价 ${money(e.costPerClick, sym)} 已经超过${per}最多可花的 ${allowed}（按客单价 ${money(e.aov, sym)} 估算），就算每次点击都成交也${goal === '不亏' ? '是亏的' : `无法${goal}`}。`;
    } else if (capped) {
      head = `${per}最多可花 ${allowed}，按点击单价 ${money(e.costPerClick, sym)}，转化率要达到 ${pct(e.requiredRate)} 才能${goal}，已超出合理范围（按 ${pct(e.testedRate)} 的上限检验）。`;
    } else {
      head = `${per}最多可花 ${allowed}，按点击单价 ${money(e.costPerClick, sym)}，转化率至少要 ${pct(e.requiredRate)} 才能${goal}。`;
    }
    if (tier === 'win') {
      return `${head}它实际 ${k}/${n} = ${pct(k / n)}；如果它只是刚好${goal}，出现这么好结果的概率${probPhrase(e.pWin)}。`;
    }
    if (tier === 'ok') {
      return k > 0 && e.efficiency !== null
        ? `${head}它点击 ${n} 次、${k} ${unit}，按实际成交来看已达到参照线，没有发现明显问题。`
        : `${head}它点击 ${n} 次、${k} ${unit}，没有发现明显问题。`;
    }
    if (tier === 'insufficient' && k > 0) {
      return `${head}它点击 ${n} 次、${k} ${unit}，转化率 ${pct(k / n)} 低于所需，但${unit}数还少，不能排除是运气差，继续观察。`;
    }
    if (tier === 'insufficient') {
      const why = capped || impossible ? '客单价也可能比平均高，' : '';
      return `${head}它只点击了 ${n} 次、0 ${unit}，还不够下结论；${why}再积累约 ${Math.ceil(e.needMoreClicks ?? 0)} 次点击仍是 0 ${unit}，才有 95% 把握。`;
    }
    const basis = capped || impossible ? `就算按 ${pct(e.testedRate)} 的转化率来算` : `能${goal}的话平均应有 ${(e.expected ?? 0).toFixed(1)} ${unit}`;
    return `${head}它点击 ${n} 次、${k} ${unit}（${basis}）；如果它其实能${goal}，出现这么差结果的概率${probPhrase(e.pLoss)}。`;
  }

  const disp = (e.dispersion ?? 1) > 1 ? `（互动会成串出现，已按离散度 ${e.dispersion} 做保守校正）` : '';
  const head = `${per}最多可花 ${allowed}，花了 ${money(r.spend, sym)} 应至少带来约 ${(e.expected ?? 0).toFixed(1)} ${unit}才能${goal}，实际 ${k} ${unit}${disp}。`;
  if (tier === 'win') return `${head}如果它只是刚好${goal}，出现这么好结果的概率${probPhrase(e.pWin)}。`;
  if (tier === 'insufficient') return k > 0 ? `${head}目前低于参照线，但还不能排除是正常波动，继续观察。` : `${head}花费还不够下结论。`;
  if (tier === 'ok') return `${head}没有发现明显问题。`;
  return `${head}如果它其实能${goal}，出现这种情况的概率${probPhrase(e.pLoss)}。`;
}
