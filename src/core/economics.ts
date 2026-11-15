/**
 * 保本线计算。公式全部展示给用户，假设写清楚，不做黑盒。
 *
 * 亚马逊：保本 ACoS = 每单毛利 ÷ 售价，每单毛利 = 售价 − 采购及头程 − FBA 配送费 − 售价 × 佣金比例 − 其他每单成本
 * 抖音/小红书：考虑退货。按“每产生 1 笔成交（含之后退款的）”的期望利润计算：
 *   期望利润 = (1 − 退货率) × (售价 − 商品成本 − 快递费 − 售价 × (平台扣点 + 达人佣金)) − 退货率 × 每单退货损失
 *   保本 ROI（按成交金额）= 售价 ÷ 期望利润
 *   保本 ROI（按扣除退款后的金额）= (1 − 退货率) × 售价 ÷ 期望利润
 */

export interface AmazonCosts {
  price: number;
  productCost: number;
  fbaFee: number;
  referralPct: number;
  otherCost?: number;
}

export interface DomesticCosts {
  price: number;
  productCost: number;
  shipping: number;
  platformPct: number;
  commissionPct?: number;
  returnRatePct: number;
  /** 每笔退货的损失，默认等于快递费（假设退回商品可以二次销售） */
  returnLoss?: number;
}

export interface Breakeven {
  /** 保本 ACoS（广告费 ÷ 成交金额），亚马逊直接用，国内平台换算成 ROI = 1 / ACoS */
  acos: number;
  roi: number;
  /** 按扣除退款后金额计算的保本 ROI（国内平台） */
  netRoi: number | null;
  profitPerOrder: number;
  lines: string[];
}

export type BreakevenResult = { ok: true; value: Breakeven } | { ok: false; error: string };

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
const money = (x: number) => (Math.round(x * 100) / 100).toString();

function validate(fields: [string, number | undefined, number, number][]): string | null {
  for (const [label, v, min, max] of fields) {
    if (v === undefined) continue;
    if (!Number.isFinite(v)) return `${label}不是有效数字`;
    if (v < min || v > max) return `${label}应在 ${min}–${max} 之间`;
  }
  return null;
}

export function amazonBreakeven(c: AmazonCosts): BreakevenResult {
  const err = validate([
    ['售价', c.price, 0.01, 1e7],
    ['采购及头程成本', c.productCost, 0, 1e7],
    ['FBA 配送费', c.fbaFee, 0, 1e7],
    ['佣金比例', c.referralPct, 0, 100],
    ['其他每单成本', c.otherCost, 0, 1e7],
  ]);
  if (err) return { ok: false, error: err };
  const referral = (c.price * c.referralPct) / 100;
  const profit = c.price - c.productCost - c.fbaFee - referral - (c.otherCost ?? 0);
  if (profit <= 0) {
    return { ok: false, error: `按这组成本，每单不打广告也亏 ${money(-profit)}，没有保本线可言。请先检查成本或售价。` };
  }
  const acos = profit / c.price;
  return {
    ok: true,
    value: {
      acos,
      roi: 1 / acos,
      netRoi: null,
      profitPerOrder: profit,
      lines: [
        `每单毛利 = 售价 ${money(c.price)} − 采购及头程 ${money(c.productCost)} − FBA 配送费 ${money(c.fbaFee)} − 佣金 ${money(referral)}（${c.referralPct}%）${c.otherCost ? ` − 其他 ${money(c.otherCost)}` : ''} = ${money(profit)}`,
        `保本 ACoS = 每单毛利 ÷ 售价 = ${pct(acos)}：广告费占销售额超过这个比例，这部分广告就是亏的`,
      ],
    },
  };
}

export function domesticBreakeven(c: DomesticCosts): BreakevenResult {
  const err = validate([
    ['售价', c.price, 0.01, 1e7],
    ['商品成本', c.productCost, 0, 1e7],
    ['快递费', c.shipping, 0, 1e7],
    ['平台扣点', c.platformPct, 0, 100],
    ['达人佣金', c.commissionPct, 0, 100],
    ['退货率', c.returnRatePct, 0, 99],
    ['每单退货损失', c.returnLoss, 0, 1e7],
  ]);
  if (err) return { ok: false, error: err };
  const r = c.returnRatePct / 100;
  const fees = (c.price * (c.platformPct + (c.commissionPct ?? 0))) / 100;
  const keptProfit = c.price - c.productCost - c.shipping - fees;
  const loss = c.returnLoss ?? c.shipping;
  const profit = (1 - r) * keptProfit - r * loss;
  if (profit <= 0) {
    return {
      ok: false,
      error: `按这组成本和退货率，每笔成交不投流也亏 ${money(-profit)}，没有保本线可言。请先检查成本、售价或退货率。`,
    };
  }
  const roi = c.price / profit;
  const netRoi = ((1 - r) * c.price) / profit;
  return {
    ok: true,
    value: {
      acos: 1 / roi,
      roi,
      netRoi,
      profitPerOrder: profit,
      lines: [
        `不退货时每单毛利 = 售价 ${money(c.price)} − 商品成本 ${money(c.productCost)} − 快递 ${money(c.shipping)} − 扣点和佣金 ${money(fees)} = ${money(keptProfit)}`,
        `考虑 ${c.returnRatePct}% 退货（每笔退货损失 ${money(loss)}）后，每笔成交的期望毛利 = ${money(profit)}`,
        `保本 ROI（按成交金额）= 售价 ÷ 期望毛利 = ${roi.toFixed(2)}；按扣除退款后的金额算是 ${netRoi.toFixed(2)}`,
      ],
    },
  };
}
