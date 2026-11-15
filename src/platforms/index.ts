import type { ConversionKind, PlatformId, ReportPreset } from '../core/types';
import { amazonPresets } from './amazon';
import { douyinPresets } from './douyin';
import { xhsPresets } from './xiaohongshu';

export interface PlatformMeta {
  id: PlatformId;
  name: string;
  adSystem: string;
  /** 亚马逊习惯看 ACoS（广告费 ÷ 销售额），国内习惯看 ROI（销售额 ÷ 广告费） */
  metric: 'acos' | 'roi';
  defaultCurrency: string;
  costModel: 'amazon' | 'domestic';
  /** 表头还没用真实导出文件核对过 */
  beta: boolean;
  /** 口径提示；for 不填表示所有报表都显示 */
  notes: { text: string; for?: ConversionKind }[];
  presets: ReportPreset[];
}

export const PLATFORMS: Record<PlatformId, PlatformMeta> = {
  amazon: {
    id: 'amazon',
    name: '亚马逊',
    adSystem: '亚马逊广告',
    metric: 'acos',
    defaultCurrency: 'USD',
    costModel: 'amazon',
    beta: false,
    notes: [{ text: '卖家的广告订单在点击后 7 天内陆续计入，报告最后几天的订单可能还没统计完。', for: 'orders' }],
    presets: amazonPresets,
  },
  douyin: {
    id: 'douyin',
    name: '抖音',
    adSystem: '巨量千川',
    metric: 'roi',
    defaultCurrency: 'CNY',
    costModel: 'domestic',
    beta: true,
    notes: [
      { text: '千川的“净成交”只扣除支付后 1 小时内的秒退单，之后发生的退款不会扣，所以保本线仍按你填写的真实退货率计算。', for: 'orders' },
      { text: '如果你的账户有退款订单的推广费返还（以不可提现的赠款形式），实际广告成本会比报表消耗低一些；本工具按报表消耗计算，结论可能略偏严。', for: 'orders' },
    ],
    presets: douyinPresets,
  },
  xiaohongshu: {
    id: 'xiaohongshu',
    name: '小红书',
    adSystem: '聚光 / 乘风',
    metric: 'roi',
    defaultCurrency: 'CNY',
    costModel: 'domestic',
    beta: true,
    notes: [{ text: '“7日支付”类指标包含 7 天内二次触达带来的成交，可能高于广告的实际贡献。', for: 'orders' }],
    presets: xhsPresets,
  },
};

export function presetById(id: string): ReportPreset | undefined {
  for (const p of Object.values(PLATFORMS)) {
    const found = p.presets.find((x) => x.id === id);
    if (found) return found;
  }
  return undefined;
}
