/**
 * 示例数据生成器：用固定随机种子模拟真实投放，给演示和测试用。
 * 每个词都有一个“真实转化率”（只有生成器知道），测试会检查诊断结果是否和真相一致。
 * 注意：这是模拟数据，表头格式按公开资料整理，不是真实导出文件。
 */
import type { AmazonCosts, DomesticCosts } from '../core/economics';
import type { Cell, PlatformId } from '../core/types';

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type TruthKind = 'junk' | 'bad' | 'good' | 'great' | 'thin';

export interface Spec {
  name: string;
  campaign?: string;
  adGroup?: string;
  targeting?: string;
  matchType?: string;
  clicks: number;
  cvr: number;
  cpc: number;
  ctr?: number;
  price: number;
  /** 每次点击带来的互动数（小红书种草） */
  engagementPerClick?: number;
  truth: TruthKind;
}

export interface DailyRow {
  spec: Spec;
  day: number;
  impressions: number;
  clicks: number;
  spend: number;
  orders: number;
  sales: number;
  engagements: number;
}

function simulate(specs: Spec[], days: number, rng: () => number): DailyRow[] {
  const out: DailyRow[] = [];
  for (const spec of specs) {
    const perDay = Array.from({ length: days }, (_, d) => ({ d, clicks: 0, spend: 0, orders: 0, sales: 0, eng: 0 }));
    for (let i = 0; i < spec.clicks; i++) {
      const day = perDay[Math.floor(rng() * days)]!;
      day.clicks++;
      day.spend += spec.cpc * (0.8 + rng() * 0.4);
      if (rng() < spec.cvr) {
        day.orders++;
        day.sales += spec.price * (rng() < 0.08 ? 2 : 1);
      }
      if (spec.engagementPerClick) {
        // 泊松近似：每次点击带来的互动次数
        let e = 0;
        let p = Math.exp(-spec.engagementPerClick);
        let s = p;
        const u = rng();
        while (u > s && e < 20) {
          e++;
          p *= spec.engagementPerClick / e;
          s += p;
        }
        day.eng += e;
      }
    }
    for (const d of perDay) {
      if (d.clicks === 0) continue;
      const ctr = spec.ctr ?? 0.006;
      out.push({
        spec,
        day: d.d,
        impressions: Math.max(d.clicks, Math.round((d.clicks / ctr) * (0.85 + rng() * 0.3))),
        clicks: d.clicks,
        spend: Math.round(d.spend * 100) / 100,
        orders: d.orders,
        sales: Math.round(d.sales * 100) / 100,
        engagements: d.eng,
      });
    }
  }
  return out;
}

function isoDay(start: string, offset: number): string {
  return new Date(Date.parse(start) + offset * 86400000).toISOString().slice(0, 10);
}

export interface Sample {
  id: string;
  platform: PlatformId;
  title: string;
  fileName: string;
  rows: Cell[][];
  specs: Spec[];
  product: string;
  amazonCosts?: AmazonCosts;
  domesticCosts?: DomesticCosts;
}

// ———————————————————— 亚马逊 ————————————————————

export function amazonSample(seed = 20261115): Sample {
  const rng = mulberry32(seed);
  const price = 45.99;
  const auto = { campaign: 'SP - Auto - Backpack', adGroup: 'Auto', matchType: '-' };
  const broad = { campaign: 'SP - Broad - Hiking', adGroup: 'Broad Hiking', matchType: 'BROAD' };
  const exact = { campaign: 'SP - Exact - Core', adGroup: 'Exact Core', matchType: 'EXACT' };
  const pat = { campaign: 'SP - Product Targeting', adGroup: 'Competitor ASINs', matchType: '-' };
  const s = (name: string, base: Partial<Spec> & { campaign: string; adGroup: string; matchType: string }, clicks: number, cvr: number, cpc: number, truth: TruthKind, targeting?: string): Spec => ({
    name, ...base, targeting: targeting ?? name, clicks, cvr, cpc, price, truth,
  });
  const specs: Spec[] = [
    s('hiking backpack', exact, 420, 0.14, 1.15, 'great'),
    s('waterproof backpack 40l', exact, 260, 0.16, 1.05, 'great'),
    s('travel daypack', exact, 180, 0.11, 0.95, 'good'),
    s('rain cover for backpack', exact, 48, 0, 0.9, 'junk'),
    s('hiking backpack women', broad, 150, 0.12, 1.1, 'good', 'hiking backpack'),
    s('lightweight hiking daypack', broad, 140, 0.13, 1.0, 'good', 'hiking backpack'),
    s('40l backpack waterproof men', broad, 95, 0.12, 1.05, 'good', 'waterproof backpack'),
    s('hiking backpack 65l', broad, 120, 0.02, 1.3, 'bad', 'hiking backpack'),
    s('kids school backpack', broad, 96, 0, 0.85, 'junk', 'backpack'),
    s('backpack for kids boys', broad, 41, 0, 0.8, 'junk', 'backpack'),
    s('kids hiking backpack small', broad, 22, 0, 0.9, 'junk', 'hiking backpack'),
    s('laptop backpack 17 inch', broad, 88, 0, 1.2, 'junk', 'backpack'),
    s('laptop backpack for men', broad, 38, 0, 1.15, 'junk', 'backpack'),
    s('travel laptop backpack', broad, 27, 0.01, 1.1, 'junk', 'travel backpack'),
    s('backpack cooler', broad, 35, 0, 0.75, 'junk', 'backpack'),
    s('camping tent 4 person', broad, 30, 0, 0.7, 'junk', 'camping backpack'),
    s('osprey talon 22', broad, 52, 0.01, 1.4, 'junk', 'hiking backpack'),
    s('used hiking backpack', broad, 12, 0, 0.9, 'thin', 'hiking backpack'),
    s('hydration backpack', auto, 75, 0.03, 0.95, 'bad', 'close-match'),
    s('day hiking bag', auto, 90, 0.12, 0.85, 'good', 'close-match'),
    s('outdoor travel backpack', auto, 60, 0.1, 0.8, 'good', 'loose-match'),
    s('gym bag women', auto, 72, 0, 0.7, 'junk', 'loose-match'),
    s('rolling backpack', auto, 26, 0, 0.75, 'junk', 'loose-match'),
    s('b0c7xk2q9m', auto, 70, 0, 0.95, 'junk', 'substitutes'),
    s('b09qwerty12', pat, 33, 0.06, 1.0, 'thin', 'asin="B09QWERTY12"'),
    s('b0d4hiking1', pat, 50, 0, 1.1, 'junk', 'asin="B0D4HIKING1"'),
  ];
  // 大量长尾小词：点击少，正确答案是“数据不足”
  const tails = ['packable daypack', 'backpack with rain cover', 'mens hiking pack', 'trekking backpack', 'mountain backpack', 'small hiking backpack', 'hiking bag 40 liter', 'backpacking pack', 'waterproof rucksack', 'travel backpack carry on', 'hiking daypack with hip belt', 'ultralight backpack', 'camping backpack', 'weekend travel bag', 'school backpack', 'cute backpack', 'anti theft backpack', 'canvas backpack', 'leather backpack', 'backpack purse'];
  tails.forEach((t, i) => {
    const related = i < 13;
    specs.push(s(t, i % 2 ? broad : auto, 3 + Math.floor(rng() * 9), related ? 0.1 : 0, 0.9, 'thin', i % 2 ? 'backpack' : 'loose-match'));
  });

  const days = 30;
  const start = '2026-10-01';
  const header = ['Date', 'Portfolio name', 'Currency', 'Campaign Name', 'Ad Group Name', 'Targeting', 'Match Type', 'Customer Search Term', 'Impressions', 'Clicks', 'Click-Thru Rate (CTR)', 'Cost Per Click (CPC)', 'Spend', '7 Day Total Sales ', 'Total Advertising Cost of Sales (ACOS) ', 'Total Return on Advertising Spend (ROAS)', '7 Day Total Orders (#)', '7 Day Total Units (#)', '7 Day Conversion Rate'];
  const rows: Cell[][] = [header];
  for (const d of simulate(specs, days, rng)) {
    const sp = d.spec;
    rows.push([
      isoDay(start, d.day), 'Backpacks', 'USD', sp.campaign!, sp.adGroup!, sp.targeting!, sp.matchType!, sp.name,
      d.impressions, d.clicks, `${((d.clicks / d.impressions) * 100).toFixed(2)}%`, `$${(d.spend / d.clicks).toFixed(2)}`,
      `$${d.spend.toFixed(2)}`, `$${d.sales.toFixed(2)}`, d.sales > 0 ? `${((d.spend / d.sales) * 100).toFixed(2)}%` : '', d.spend > 0 ? (d.sales / d.spend).toFixed(2) : '',
      d.orders, d.orders, d.clicks ? `${((d.orders / d.clicks) * 100).toFixed(2)}%` : '',
    ]);
  }
  return {
    id: 'amazon-st',
    platform: 'amazon',
    title: '亚马逊 · 搜索词报告（模拟：户外背包，30 天）',
    fileName: 'Sponsored_Products_Search_term_report_示例.csv',
    rows,
    specs,
    product: 'Waterproof Hiking Backpack 40L for Men and Women, Lightweight Travel Daypack with Rain Cover, Breathable Back Panel',
    amazonCosts: { price, productCost: 14, fbaFee: 7.2, referralPct: 15 },
  };
}

// ———————————————————— 抖音 ————————————————————

export function douyinSearchSample(seed = 618): Sample {
  const rng = mulberry32(seed);
  const price = 89;
  const plan = (name: string) => ({ campaign: name, adGroup: '', matchType: '' });
  const p1 = plan('搜索-防晒衣-核心词');
  const p2 = plan('搜索-防晒衣-拓词');
  const s = (name: string, base: { campaign: string; adGroup: string; matchType: string }, kw: string, mt: string, clicks: number, cvr: number, cpc: number, truth: TruthKind): Spec => ({
    name, ...base, targeting: kw, matchType: mt, clicks, cvr, cpc, ctr: 0.04, price, truth,
  });
  const specs: Spec[] = [
    s('防晒衣女', p1, '防晒衣女', '精准匹配', 520, 0.07, 1.6, 'great'),
    s('冰丝防晒衣', p1, '冰丝防晒衣', '精准匹配', 380, 0.08, 1.4, 'great'),
    s('防晒衣女夏季薄款', p1, '防晒衣', '短语匹配', 300, 0.06, 1.5, 'good'),
    s('upf50防晒衣', p1, '防晒衣', '短语匹配', 210, 0.065, 1.5, 'good'),
    s('防晒衣男', p2, '防晒衣', '广泛匹配', 160, 0, 1.3, 'junk'),
    s('儿童防晒衣', p2, '防晒衣', '广泛匹配', 140, 0, 1.2, 'junk'),
    s('防晒衣儿童女童', p2, '防晒衣', '广泛匹配', 70, 0, 1.2, 'junk'),
    s('防晒霜', p2, '防晒', '广泛匹配', 120, 0, 1.1, 'junk'),
    s('防晒伞', p2, '防晒', '广泛匹配', 80, 0, 1.0, 'junk'),
    s('骑行防晒面罩', p2, '防晒', '广泛匹配', 60, 0.005, 1.1, 'junk'),
    s('防晒衣女长款', p2, '防晒衣', '广泛匹配', 150, 0.015, 1.7, 'bad'),
    s('防晒衣女2026新款', p2, '防晒衣', '广泛匹配', 130, 0.07, 1.4, 'good'),
    s('蕉下防晒衣', p2, '防晒衣', '广泛匹配', 110, 0.01, 2.1, 'junk'),
  ];
  ['防晒衣外套', '防晒衫女', '薄款防晒外套', '防紫外线衣服', '防晒服', '冰丝外套女', '户外防晒衣', '防晒衣宽松', '防晒衣短款', '防晒衣连帽'].forEach((t, i) => {
    specs.push(s(t, i % 2 ? p1 : p2, '防晒衣', '广泛匹配', 4 + Math.floor(rng() * 10), 0.06, 1.4, 'thin'));
  });
  const days = 14;
  const start = '2026-10-20';
  const header = ['日期', '计划名称', '计划ID', '关键词', '匹配类型', '搜索词', '展示次数', '点击次数', '点击率', '消耗', '平均点击单价', '成交订单数', '成交金额', '支付ROI'];
  const rows: Cell[][] = [
    ['千川搜索广告-搜索词报表'],
    ['时间范围：2026-10-20 至 2026-11-02', '', '导出时间：2026-11-10 10:21'],
    [],
    header,
  ];
  let sumImp = 0;
  let sumClk = 0;
  let sumSpend = 0;
  let sumOrd = 0;
  let sumSales = 0;
  for (const d of simulate(specs, days, rng)) {
    const sp = d.spec;
    sumImp += d.impressions;
    sumClk += d.clicks;
    sumSpend += d.spend;
    sumOrd += d.orders;
    sumSales += d.sales;
    rows.push([
      isoDay(start, d.day), sp.campaign!, sp.campaign === p1.campaign ? '1798000000001' : '1798000000002', sp.targeting!, sp.matchType!, sp.name,
      d.impressions, d.clicks, `${((d.clicks / d.impressions) * 100).toFixed(2)}%`, d.spend.toFixed(2), (d.spend / d.clicks).toFixed(2), d.orders, d.sales.toFixed(2), d.spend ? (d.sales / d.spend).toFixed(2) : '0.00',
    ]);
  }
  rows.push(['合计', '', '', '', '', '', sumImp, sumClk, '', sumSpend.toFixed(2), '', sumOrd, sumSales.toFixed(2), '']);
  return {
    id: 'douyin-st',
    platform: 'douyin',
    title: '抖音 · 千川搜索词报表（模拟：冰丝防晒衣，14 天）',
    fileName: '千川搜索词报表_示例.csv',
    rows,
    specs,
    product: '冰丝防晒衣女夏季 UPF50+ 薄款透气防紫外线外套 连帽防晒衫',
    domesticCosts: { price, productCost: 28, shipping: 4, platformPct: 5, commissionPct: 0, returnRatePct: 35 },
  };
}

export function douyinUnitSample(seed = 1111): Sample {
  const rng = mulberry32(seed);
  const price = 89;
  // 全域推广素材报表：没有点击数据，走“按花费”的泊松检验
  const mats: { name: string; plan: string; spend: number; roi: number; truth: TruthKind }[] = [
    { name: '素材A-户外实测暴晒对比', plan: '全域-防晒衣-主推', spend: 6800, roi: 3.6, truth: 'great' },
    { name: '素材B-通勤穿搭口播', plan: '全域-防晒衣-主推', spend: 4200, roi: 3.1, truth: 'good' },
    { name: '素材C-冰丝面料特写', plan: '全域-防晒衣-主推', spend: 3900, roi: 2.9, truth: 'good' },
    { name: '素材D-工厂直发低价', plan: '全域-防晒衣-测款', spend: 3100, roi: 1.6, truth: 'bad' },
    { name: '素材E-明星同款话术', plan: '全域-防晒衣-测款', spend: 2600, roi: 1.2, truth: 'bad' },
    { name: '素材F-买一送一', plan: '全域-防晒衣-测款', spend: 1800, roi: 2.4, truth: 'good' },
    { name: '素材G-夜跑场景', plan: '全域-防晒衣-测款', spend: 260, roi: 0, truth: 'junk' },
    { name: '素材H-宝妈带娃', plan: '全域-防晒衣-测款', spend: 180, roi: 4.0, truth: 'thin' },
  ];
  const header = ['素材名称', '素材ID', '计划名称', '整体消耗', '整体成交订单数', '整体成交金额', '整体支付ROI', '千次展示费用'];
  const rows: Cell[][] = [header];
  const specs: Spec[] = [];
  mats.forEach((m, i) => {
    // 订单数 ~ 泊松(期望 = 消耗 × ROI ÷ 客单价)
    const mu = (m.spend * m.roi) / price;
    let k = 0;
    let p = Math.exp(-mu);
    let c = p;
    const u = rng();
    while (u > c && k < 10000) {
      k++;
      p *= mu / k;
      c += p;
    }
    const sales = Math.round(k * price * (0.95 + rng() * 0.1) * 100) / 100;
    rows.push([m.name, `71${(4000000 + i).toString()}`, m.plan, m.spend.toFixed(2), k, sales.toFixed(2), (sales / m.spend).toFixed(2), (20 + rng() * 10).toFixed(2)]);
    specs.push({ name: m.name, campaign: m.plan, clicks: 0, cvr: 0, cpc: 0, price, truth: m.truth });
  });
  return {
    id: 'douyin-unit',
    platform: 'douyin',
    title: '抖音 · 千川全域素材报表（模拟：8 条素材，7 天）',
    fileName: '千川全域推广素材数据_示例.csv',
    rows,
    specs,
    product: '冰丝防晒衣女夏季 UPF50+ 薄款透气防紫外线外套',
    domesticCosts: { price, productCost: 28, shipping: 4, platformPct: 5, commissionPct: 0, returnRatePct: 35 },
  };
}

// ———————————————————— 小红书 ————————————————————

export function xhsCommerceSample(seed = 520): Sample {
  const rng = mulberry32(seed);
  const price = 129;
  const s = (name: string, plan: string, clicks: number, cvr: number, cpc: number, truth: TruthKind): Spec => ({
    name, campaign: plan, clicks, cvr, cpc, ctr: 0.08, price, truth,
  });
  const specs: Spec[] = [
    s('油皮夏天必备！控油一整天的粉底液', '乘风-商品推广-粉底液', 2400, 0.045, 0.9, 'great'),
    s('黄黑皮亲测 粉底液色号怎么选', '乘风-商品推广-粉底液', 1800, 0.04, 0.85, 'good'),
    s('平价替代 大牌粉底液平替', '乘风-商品推广-粉底液', 1500, 0.012, 1.0, 'bad'),
    s('伪素颜心机妆容教程', '乘风-商品推广-粉底液', 1300, 0.006, 0.8, 'bad'),
    s('学生党开学化妆品清单', '乘风-商品推广-测图', 900, 0.003, 0.7, 'junk'),
    s('一瓶粉底液用了三年？', '乘风-商品推广-测图', 120, 0.03, 0.9, 'thin'),
    s('持妆12小时实测', '乘风-商品推广-测图', 1600, 0.05, 0.95, 'great'),
  ];
  const header = ['笔记标题', '笔记ID', '计划名称', '消费', '展现量', '点击量', '点击率', '互动量', '支付订单数', '支付金额', '支付ROI'];
  const rows: Cell[][] = [header];
  const agg = new Map<string, { imp: number; clk: number; spend: number; ord: number; sales: number }>();
  for (const d of simulate(specs, 14, rng)) {
    const a = agg.get(d.spec.name) ?? { imp: 0, clk: 0, spend: 0, ord: 0, sales: 0 };
    a.imp += d.impressions;
    a.clk += d.clicks;
    a.spend += d.spend;
    a.ord += d.orders;
    a.sales += d.sales;
    agg.set(d.spec.name, a);
  }
  specs.forEach((sp, i) => {
    const a = agg.get(sp.name)!;
    rows.push([sp.name, `66f0a${i}c2b000000001${i}`, sp.campaign!, a.spend.toFixed(2), a.imp, a.clk, `${((a.clk / a.imp) * 100).toFixed(2)}%`, Math.round(a.clk * (0.2 + rng() * 0.3)), a.ord, a.sales.toFixed(2), a.spend ? (a.sales / a.spend).toFixed(2) : '0']);
  });
  return {
    id: 'xhs-commerce',
    platform: 'xiaohongshu',
    title: '小红书 · 乘风笔记报表（模拟：粉底液，14 天）',
    fileName: '乘风笔记数据_示例.csv',
    rows,
    specs,
    product: '控油持妆粉底液 油皮 黄黑皮 遮瑕 不脱妆 夏季',
    domesticCosts: { price, productCost: 32, shipping: 5, platformPct: 5, commissionPct: 0, returnRatePct: 12 },
  };
}

export function xhsEngagementSample(seed = 1024): Sample {
  const rng = mulberry32(seed);
  const s = (name: string, plan: string, clicks: number, epc: number, cpc: number, truth: TruthKind): Spec => ({
    name, campaign: plan, clicks, cvr: 0, cpc, ctr: 0.09, price: 0, engagementPerClick: epc, truth,
  });
  const specs: Spec[] = [
    s('租房改造｜500块拥有ins风卧室', '聚光-种草-家居', 2600, 0.42, 0.6, 'great'),
    s('小户型收纳神器真的有用吗', '聚光-种草-家居', 2100, 0.3, 0.55, 'good'),
    s('宜家必买清单2026', '聚光-种草-家居', 1900, 0.08, 0.65, 'bad'),
    s('我家猫最爱的猫爬架', '聚光-种草-测试', 1500, 0.05, 0.6, 'junk'),
    s('懒人沙发测评', '聚光-种草-测试', 140, 0.25, 0.6, 'thin'),
    s('卧室灯光氛围感布置', '聚光-种草-家居', 1700, 0.33, 0.58, 'good'),
  ];
  const header = ['笔记标题', '笔记ID', '计划名称', '消费', '展现量', '点击量', '点击率', '互动量', '互动成本'];
  const rows: Cell[][] = [header];
  const agg = new Map<string, { imp: number; clk: number; spend: number; eng: number }>();
  for (const d of simulate(specs, 14, rng)) {
    const a = agg.get(d.spec.name) ?? { imp: 0, clk: 0, spend: 0, eng: 0 };
    a.imp += d.impressions;
    a.clk += d.clicks;
    a.spend += d.spend;
    a.eng += d.engagements;
    agg.set(d.spec.name, a);
  }
  specs.forEach((sp, i) => {
    const a = agg.get(sp.name)!;
    rows.push([sp.name, `67a1b${i}d3e000000002${i}`, sp.campaign!, a.spend.toFixed(2), a.imp, a.clk, `${((a.clk / a.imp) * 100).toFixed(2)}%`, a.eng, a.eng ? (a.spend / a.eng).toFixed(2) : '']);
  });
  return {
    id: 'xhs-engagement',
    platform: 'xiaohongshu',
    title: '小红书 · 聚光笔记种草报表（模拟：家居，14 天）',
    fileName: '聚光笔记数据_示例.csv',
    rows,
    specs,
    product: '',
  };
}

export const SAMPLES: Record<string, () => Sample> = {
  'amazon-st': () => amazonSample(),
  'douyin-st': () => douyinSearchSample(),
  'douyin-unit': () => douyinUnitSample(),
  'xhs-commerce': () => xhsCommerceSample(),
  'xhs-engagement': () => xhsEngagementSample(),
};

export const SAMPLE_LIST: { id: string; platform: PlatformId; title: string }[] = [
  { id: 'amazon-st', platform: 'amazon', title: '搜索词报告（户外背包，30 天）' },
  { id: 'douyin-st', platform: 'douyin', title: '千川搜索词报表（防晒衣，14 天）' },
  { id: 'douyin-unit', platform: 'douyin', title: '千川全域素材报表（防晒衣，7 天）' },
  { id: 'xhs-commerce', platform: 'xiaohongshu', title: '乘风笔记报表（粉底液，14 天）' },
  { id: 'xhs-engagement', platform: 'xiaohongshu', title: '聚光笔记种草报表（家居，14 天）' },
];

/** 把模拟表格转成 CSV 文本（测试“真实文件”解析路径用） */
export function rowsToCsv(rows: Cell[][]): string {
  return rows
    .map((r) => r.map((c) => {
      const s = c === null || c === undefined ? '' : String(c);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    }).join(','))
    .join('\n');
}
