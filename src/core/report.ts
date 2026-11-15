/**
 * 把各步骤串起来：确定参照线 → 逐行诊断 → 词根分析 → 汇总成报告。
 */
import { PLATFORMS } from '../platforms';
import { analyzeRows, type Target } from './analyze';
import type { Detection } from './detect';
import { amazonBreakeven, domesticBreakeven, type AmazonCosts, type DomesticCosts } from './economics';
import { currencySymbol, money, pct, ratio } from './format';
import { normalizeHeader } from './text';
import { analyzeRoots, type RootResult } from './roots';
import type { DataIssue, Dataset, PlatformId, ReportPreset, RowResult, Tier, Totals } from './types';

export type TargetInput =
  | { type: 'amazonCosts'; costs: AmazonCosts }
  | { type: 'domesticCosts'; costs: DomesticCosts }
  | { type: 'acos'; value: number }
  | { type: 'roi'; value: number }
  | { type: 'cpe'; value: number }
  | { type: 'auto' };

export type TargetResult = { ok: true; target: Target } | { ok: false; error: string };

/** 成交金额这一列是不是“净成交”口径（已扣部分退款） */
export function salesIsNet(det: Detection): boolean {
  const col = det.mapping.sales;
  if (col === undefined) return false;
  return normalizeHeader(det.headers[col]).includes('净');
}

export function resolveTarget(
  platform: PlatformId,
  preset: ReportPreset,
  input: TargetInput,
  ds: Dataset,
  opts: { netSales?: boolean } = {},
): TargetResult {
  const meta = PLATFORMS[platform];
  const sym = currencySymbol(ds.currency ?? meta.defaultCurrency);
  if (preset.conversion === 'engagements') {
    if (input.type === 'cpe') {
      if (!(input.value > 0)) return { ok: false, error: '目标互动成本要大于 0' };
      return { ok: true, target: { acos: null, cpe: input.value, source: 'userCpe', label: `目标互动成本 ${money(input.value, sym)}`, lines: [] } };
    }
    if (ds.totals.engagements <= 0) return { ok: false, error: '报表里互动量合计为 0，无法以账户平均作参照' };
    const cpe = ds.totals.spend / ds.totals.engagements;
    return {
      ok: true,
      target: {
        acos: null,
        cpe,
        source: 'accountAverage',
        label: `账户平均互动成本 ${money(cpe, sym)}`,
        lines: ['以这份报表的平均互动成本作参照，找出明显拖低整体效率的笔记；这不代表盈亏。'],
      },
    };
  }

  switch (input.type) {
    case 'amazonCosts': {
      const r = amazonBreakeven(input.costs);
      if (!r.ok) return r;
      return { ok: true, target: { acos: r.value.acos, cpe: null, source: 'breakeven', label: `保本 ACoS ${pct(r.value.acos)}`, lines: r.value.lines } };
    }
    case 'domesticCosts': {
      const r = domesticBreakeven(input.costs);
      if (!r.ok) return r;
      // 千川“净成交”只扣除支付后 1 小时内的秒退单，远不是全部退货，
      // 所以仍按含退货的保本 ROI 比较；按“扣除全部退货”的保本线比较会把亏损的计划判成赚钱。
      const roi = r.value.roi;
      const lines = [...r.value.lines];
      if (opts.netSales) {
        lines.push('报表里的成交金额是“净成交”口径，只扣除了支付后 1 小时内的秒退单，所以仍按含退货的保本 ROI 比较。秒退比例高时，结论会略偏严。');
      }
      return { ok: true, target: { acos: 1 / roi, cpe: null, source: 'breakeven', label: `保本 ROI ${ratio(roi)}`, lines } };
    }
    case 'acos': {
      if (!(input.value > 0 && input.value < 10)) return { ok: false, error: '目标 ACoS 应在 0%–1000% 之间' };
      return { ok: true, target: { acos: input.value, cpe: null, source: 'userAcos', label: `目标 ACoS ${pct(input.value)}`, lines: [] } };
    }
    case 'roi': {
      if (!(input.value > 0.1)) return { ok: false, error: '目标 ROI 应大于 0.1' };
      return { ok: true, target: { acos: 1 / input.value, cpe: null, source: 'userRoi', label: `目标 ROI ${ratio(input.value)}`, lines: [] } };
    }
    case 'cpe':
      return { ok: false, error: '这类报表按订单诊断，请填写成本或目标 ACoS/ROI' };
    case 'auto': {
      if (ds.totals.sales <= 0) {
        return { ok: false, error: '报表里没有成交金额，无法用账户平均水平作参照。请填写成本信息或目标值。' };
      }
      const acos = ds.totals.spend / ds.totals.sales;
      const label = meta.metric === 'acos' ? `账户平均 ACoS ${pct(acos)}` : `账户平均 ROI ${ratio(1 / acos)}`;
      return {
        ok: true,
        target: {
          acos,
          cpe: null,
          source: 'accountAverage',
          label,
          lines: ['没有填写成本，以这份报表的整体效率作参照线，找出明显拖低整体效率的部分；这不代表盈亏，填写成本后结论更有意义。'],
        },
      };
    }
  }
}

export interface Report {
  platform: PlatformId;
  preset: Pick<ReportPreset, 'id' | 'name' | 'kind' | 'conversion' | 'verified'>;
  currency: string | null;
  symbol: string;
  period: Dataset['period'];
  totals: Totals;
  derived: { acos: number | null; roi: number | null; cpc: number | null; ctr: number | null; cvr: number | null; aov: number | null; cpe: number | null };
  target: Target;
  summary: {
    saving: number;
    savingShare: number;
    monthlySaving: number | null;
    suspectSpend: number;
    counts: Record<Tier, number>;
  };
  results: RowResult[];
  roots: RootResult[];
  issues: DataIssue[];
  notes: string[];
  method: string[];
  generatedAt: string;
}

const TIER_ORDER: Tier[] = ['loss', 'suspect', 'win', 'insufficient', 'ok', 'untested'];

export function buildReport(args: {
  platform: PlatformId;
  preset: ReportPreset;
  dataset: Dataset;
  target: Target;
  productText?: string;
  price?: number | null;
  today?: Date;
}): Report {
  const { platform, preset, dataset: ds, target } = args;
  const meta = PLATFORMS[platform];
  const symbol = currencySymbol(ds.currency ?? meta.defaultCurrency);
  const { results, baseline } = analyzeRows(ds, target, {
    platform,
    kind: preset.kind,
    conversion: preset.conversion,
    symbol,
    productText: args.productText,
    price: args.price,
  });
  results.sort((a, b) => TIER_ORDER.indexOf(a.tier) - TIER_ORDER.indexOf(b.tier) || b.saving - a.saving || b.row.spend - a.row.spend);

  const roots =
    preset.kind === 'searchTerm' && preset.conversion === 'orders'
      ? analyzeRoots(results, target, { platform, productText: args.productText, aov: baseline.aov, symbol })
      : [];
  // 一个词同时属于累计亏损的词根时，在建议说明里提一句，方便卖家一次处理同类词
  const rootOf = new Map<string, string>();
  for (const root of roots) if (!root.cautious) for (const k of root.memberKeys) if (!rootOf.has(k)) rootOf.set(k, root.token);
  for (const r of results) {
    const token = rootOf.get(r.row.key);
    if (!token || !(r.tier === 'loss' || r.tier === 'suspect')) continue;
    const note = `它含有累计不出单的词根“${token}”，可以在“词根分析”里一起处理同类词`;
    r.action = { ...r.action, detail: r.action.detail ? `${r.action.detail.replace(/。$/, '')}；${note}。` : `${note}。` };
  }

  const counts = Object.fromEntries(TIER_ORDER.map((t) => [t, 0])) as Record<Tier, number>;
  let saving = 0;
  let suspectSpend = 0;
  for (const r of results) {
    counts[r.tier]++;
    saving += r.saving;
    if (r.tier === 'suspect') suspectSpend += r.row.spend;
  }
  saving = Math.round(saving * 100) / 100;
  const t = ds.totals;
  const monthlySaving = ds.period && ds.period.days >= 7 ? Math.round(((saving * 30) / ds.period.days) * 100) / 100 : null;

  const notes: string[] = meta.notes.filter((n) => !n.for || n.for === preset.conversion).map((n) => n.text);
  const today = args.today ?? new Date();
  if (platform === 'amazon' && ds.period) {
    const lag = Math.floor((today.getTime() - Date.parse(ds.period.end)) / 86400000);
    if (lag >= 0 && lag < 7) {
      notes.unshift(`报告截止到 ${ds.period.end}，距今不到 7 天，最后几天的订单可能还没统计完，部分词会显得比实际差。建议导出截止到 7 天前的数据。`);
    }
  }
  if ((t.clicks ?? 0) > 0 && (t.clicks ?? 0) < 300) notes.push('这份报表的点击总数较少，多数词会显示“数据不足”。建议导出 30–60 天的数据。');
  if (!preset.verified) {
    notes.push(
      meta.beta
        ? `${meta.adSystem}的表头是根据公开资料整理的，还没有用真实导出文件核对过（测试版）。请务必核对上面的列映射。`
        : '表头是根据公开资料整理的，还没有用真实导出文件逐列核对过，请核对列映射。',
    );
  }

  const isOrders = preset.conversion === 'orders';
  const method = [
    `参照线：${target.label}。${target.source === 'breakeven' ? '超过这条线的花费就是亏的。' : ''}`,
    isOrders
      ? '每一行先算出“每单最多可花多少广告费”（客单价 × 参照 ACoS），再算出要达到参照线所需的最低转化率。'
      : '每一行按“每次互动最多可花多少”计算，花费多、互动明显偏少的判为低效。',
    '然后计算：如果它其实能达到参照线，观察到这么少的转化，概率有多大。这个概率低于 5% 才判为“确定”，在 5%–20% 之间判为“疑似”。',
    '同时判断几百行时，有些会碰巧显得很差。工具用 Benjamini–Hochberg 方法做了校正，“确定”这一档里误判的比例控制在 10% 以内。',
    '点击少、0 转化的行不会被冤枉：数据不够时会显示“数据不足”，并告诉你还需要多少点击才能判断。',
    '所有计算都在你的浏览器里完成，报表不会上传到任何服务器。',
  ];

  return {
    platform,
    preset: { id: preset.id, name: preset.name, kind: preset.kind, conversion: preset.conversion, verified: preset.verified },
    currency: ds.currency,
    symbol,
    period: ds.period,
    totals: t,
    derived: {
      acos: t.sales > 0 ? t.spend / t.sales : null,
      roi: t.spend > 0 ? t.sales / t.spend : null,
      cpc: t.clicks ? t.spend / t.clicks : null,
      ctr: t.impressions && t.clicks !== null ? t.clicks / t.impressions : null,
      cvr: t.clicks ? (isOrders ? t.orders : t.engagements) / t.clicks : null,
      aov: t.orders > 0 ? t.sales / t.orders : null,
      cpe: t.engagements > 0 ? t.spend / t.engagements : null,
    },
    target,
    summary: { saving, savingShare: t.spend > 0 ? saving / t.spend : 0, monthlySaving, suspectSpend: Math.round(suspectSpend * 100) / 100, counts },
    results,
    roots,
    issues: ds.issues,
    notes,
    method,
    generatedAt: today.toISOString(),
  };
}
